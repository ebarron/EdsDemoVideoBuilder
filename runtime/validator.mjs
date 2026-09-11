import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { resolveFfmpeg } from './ffmpeg.mjs';

function probe(ffmpeg, file) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const duration = result.stderr.match(/Duration:\s+(\d+):(\d+):([\d.]+)/);
  const video = result.stderr.match(/Video:\s+([^,\s]+).*?(\d{2,5})x(\d{2,5}).*?([\d.]+)\s+fps/);
  const audio = result.stderr.match(/Audio:\s+([^,\s]+).*?(\d+)\s+Hz/);
  return {
    stderr: result.stderr,
    duration: duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : 0,
    video: video && {
      codec: video[1],
      width: Number(video[2]),
      height: Number(video[3]),
      fps: Number(video[4]),
    },
    audio: audio && { codec: audio[1], sampleRate: Number(audio[2]) },
  };
}

function assertFastStart(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const size = Math.min(fs.fstatSync(descriptor).size, 8 * 1024 * 1024);
    const buffer = Buffer.alloc(size);
    fs.readSync(descriptor, buffer, 0, size, 0);
    const moov = buffer.indexOf(Buffer.from('moov'));
    const mdat = buffer.indexOf(Buffer.from('mdat'));
    if (moov < 0 || mdat < 0 || moov > mdat) {
      throw new Error('MP4 does not have a fast-start moov atom before media data');
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function frameHash(ffmpeg, file, second) {
  const result = spawnSync(ffmpeg, [
    '-v', 'error',
    '-ss', String(second),
    '-i', file,
    '-frames:v', '1',
    '-vf', 'scale=320:-2',
    '-f', 'md5',
    '-',
  ], { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(`Could not decode progressive sample at ${second}s`);
  return result.stdout.trim();
}

export function verifyRecording(manifest, environment = process.env) {
  const file = manifest.output.video;
  if (!fs.existsSync(file)) throw new Error(`Final video does not exist: ${file}`);
  if (!fs.existsSync(manifest.output.timeline)) {
    throw new Error(`Final timeline does not exist: ${manifest.output.timeline}`);
  }
  if (!fs.existsSync(manifest.output.contactSheet)) {
    throw new Error(`Contact sheet does not exist: ${manifest.output.contactSheet}`);
  }
  const ffmpeg = resolveFfmpeg(manifest, environment);
  const metadata = probe(ffmpeg, file);
  const expected = manifest.browser.viewport;
  if (!metadata.video || !/h264/i.test(metadata.video.codec)) throw new Error('Video is not H.264');
  if (metadata.video.width !== expected.width || metadata.video.height !== expected.height) {
    throw new Error(`Unexpected video dimensions ${metadata.video.width}x${metadata.video.height}`);
  }
  if (Math.abs(metadata.video.fps - 25) > 0.01) throw new Error(`Video is not constant 25 fps`);
  if (!metadata.audio || !/aac/i.test(metadata.audio.codec)) throw new Error('Audio is not AAC');
  if (metadata.audio.sampleRate !== 48000) throw new Error('Audio is not 48 kHz');
  if (!(metadata.duration > 0)) throw new Error('Video has no duration');
  assertFastStart(file);

  const decode = spawnSync(ffmpeg, [
    '-v', 'error',
    '-i', file,
    '-map', '0:v:0',
    '-map', '0:a:0',
    '-f', 'null',
    '-',
  ], { encoding: 'utf8', timeout: 10 * 60_000 });
  if (decode.error?.code === 'ETIMEDOUT') throw new Error('Full decode validation timed out');
  if (decode.status !== 0) throw new Error(`Full decode failed:\n${decode.stderr}`);

  const fractions = metadata.duration < 2 ? [0.1, 0.5, 0.9] : [0.1, 0.5, 0.9];
  const hashes = fractions.map((fraction) =>
    frameHash(ffmpeg, file, Math.max(0, metadata.duration * fraction - 0.04)));
  if (new Set(hashes).size < 2) throw new Error('Progressive-frame checks found no visible change');
  return { file, ...metadata, fastStart: true, fullDecode: true, progressiveFrames: hashes };
}
