import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { resolveFfmpeg } from './ffmpeg.mjs';
import { assertKokoroCoverage } from './kokoro.mjs';

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

function detectSilences(ffmpeg, file, duration) {
  const result = spawnSync(ffmpeg, [
    '-v', 'info',
    '-i', file,
    '-map', '0:a:0',
    '-af', 'silencedetect=noise=-50dB:d=0.5',
    '-f', 'null',
    '-',
  ], { encoding: 'utf8', timeout: 10 * 60_000 });
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error('Narration silence validation timed out');
  }
  if (result.status !== 0) {
    throw new Error(`Narration silence validation failed:\n${result.stderr}`);
  }
  const intervals = [];
  let start = null;
  for (const match of result.stderr.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    const at = Number(match[2]);
    if (match[1] === 'start') {
      start = at;
    } else if (start !== null) {
      intervals.push({ start, end: at });
      start = null;
    }
  }
  if (start !== null) intervals.push({ start, end: duration });
  return intervals;
}

function longestOverlap(start, end, intervals) {
  return intervals.reduce(
    (longest, interval) =>
      Math.max(longest, Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start))),
    0,
  );
}

export function validateKokoroNarrationCoverage(timeline, scenePlan, silences = []) {
  const expected = scenePlan.scenes.filter((scene) => scene.narration);
  const entries = new Map();
  for (const entry of timeline.narrations) {
    if (entries.has(entry.id)) {
      throw new Error(`Kokoro narration scene ${entry.id} appears more than once`);
    }
    entries.set(entry.id, entry);
  }
  const scenes = [];
  for (const scene of expected) {
    const entry = entries.get(scene.id);
    if (!entry) throw new Error(`Kokoro narration coverage is missing scene ${scene.id}`);
    const coverage = entry.coverage;
    try {
      assertKokoroCoverage(scene.narration, coverage);
    } catch {
      throw new Error(
        `Kokoro narration scene ${scene.id} lacks complete, token-safe synthesis coverage`,
      );
    }
    const chunks = coverage.chunks;
    if (!(entry.duration > 0) || !(entry.finalStart >= 0)) {
      throw new Error(`Kokoro narration scene ${scene.id} has an invalid final audio window`);
    }
    if (entry.finalStart + entry.duration > timeline.meta.finalDuration + 0.1) {
      throw new Error(`Kokoro narration scene ${scene.id} extends beyond the final video`);
    }
    const availableDuration = Math.max(
      0,
      Math.min(entry.duration, timeline.meta.finalDuration - entry.finalStart),
    );
    if (!(availableDuration > 0)) {
      throw new Error(`Kokoro narration scene ${scene.id} falls outside the final video`);
    }
    const longestSilence = longestOverlap(
      entry.finalStart,
      entry.finalStart + availableDuration,
      silences,
    );
    if (
      longestSilence >= availableDuration - 0.1 ||
      longestSilence > Math.max(5, availableDuration * 0.4)
    ) {
      throw new Error(
        `Kokoro narration scene ${scene.id} contains ${longestSilence.toFixed(1)}s ` +
        'of unexplained silence',
      );
    }
    scenes.push({
      id: scene.id,
      chunks: chunks.length,
      maxTokenCount: coverage.maxTokenCount,
      longestSilence,
    });
  }
  return { complete: true, scenes };
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
  const timeline = JSON.parse(fs.readFileSync(manifest.output.timeline, 'utf8'));

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

  let narrationCoverage = null;
  if (timeline.meta?.narration?.mode === 'kokoro') {
    const scenePlan = JSON.parse(fs.readFileSync(manifest.scenePlan, 'utf8'));
    const silences = detectSilences(ffmpeg, file, metadata.duration);
    narrationCoverage = validateKokoroNarrationCoverage(timeline, scenePlan, silences);
  }

  const fractions = metadata.duration < 2 ? [0.1, 0.5, 0.9] : [0.1, 0.5, 0.9];
  const hashes = fractions.map((fraction) =>
    frameHash(ffmpeg, file, Math.max(0, metadata.duration * fraction - 0.04)));
  if (new Set(hashes).size < 2) throw new Error('Progressive-frame checks found no visible change');
  return {
    file,
    ...metadata,
    fastStart: true,
    fullDecode: true,
    progressiveFrames: hashes,
    ...(narrationCoverage ? { narrationCoverage } : {}),
  };
}
