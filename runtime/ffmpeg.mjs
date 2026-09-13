import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import ffmpegStatic from 'ffmpeg-static';

import { mapTime, validateCompressions } from './timeline.mjs';

export function resolveFfmpeg(manifest, environment = process.env) {
  const configured = manifest.tools?.ffmpegEnv && environment[manifest.tools.ffmpegEnv];
  const candidates = [configured, environment.DEMO_FFMPEG, ffmpegStatic, 'ffmpeg'].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    const result = spawnSync(candidate, ['-version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  throw new Error(
    'FFmpeg was not found. Rerun scripts/install.sh or set DEMO_FFMPEG to an executable path.',
  );
}

function probeDuration(ffmpeg, video) {
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', video], { encoding: 'utf8' });
  const match = probe.stderr.match(/Duration:\s+(\d+):(\d+):([\d.]+)/);
  if (!match) throw new Error(`Could not determine video duration:\n${probe.stderr}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function videoClockBoundaries(timeline) {
  const videoStart = timeline.meta.videoStart ?? 0;
  if (!Number.isFinite(videoStart) || videoStart < 0) {
    throw new Error('Invalid raw-video clock origin');
  }
  const contentStart = timeline.meta.contentStart - videoStart;
  const contentEnd = timeline.meta.contentEnd - videoStart;
  if (!(contentStart >= 0 && contentEnd > contentStart)) {
    throw new Error('Invalid raw-video content boundaries');
  }
  return { videoStart, contentStart, contentEnd };
}

export function assertRawVideoCoversTimeline(rawDuration, timeline, tolerance = 0.15) {
  const { contentEnd } = videoClockBoundaries(timeline);
  if (rawDuration + tolerance < contentEnd) {
    throw new Error('Raw video ends before its explicit content boundary');
  }
}

export function buildFilterGraph({ timeline, label = 'FAST FORWARD' }) {
  const timelineContentStart = timeline.meta.contentStart;
  const timelineContentEnd = timeline.meta.contentEnd;
  if (!(timelineContentEnd > timelineContentStart)) {
    throw new Error('Invalid explicit content boundaries');
  }
  const compressions = validateCompressions(
    timeline.compressions ?? [],
    timelineContentStart,
    timelineContentEnd,
  );
  const { videoStart, contentStart, contentEnd } = videoClockBoundaries(timeline);
  const videoCompressions = compressions.map((entry) => ({
    ...entry,
    start: entry.start - videoStart,
    end: entry.end - videoStart,
  }));
  const finalDuration = mapTime(timelineContentEnd, timelineContentStart, compressions);
  const filters = [];
  const videoLabels = [];
  let cursor = contentStart;

  for (const [index, entry] of videoCompressions.entries()) {
    if (entry.start > cursor) {
      filters.push(`[0:v]trim=start=${cursor}:end=${entry.start},setpts=PTS-STARTPTS[vn${index}]`);
      videoLabels.push(`[vn${index}]`);
    }
    const ratio = entry.target / (entry.end - entry.start);
    const escapedLabel = label.replace(/[':\\]/g, '\\$&');
    filters.push(
      `[0:v]trim=start=${entry.start}:end=${entry.end},setpts=(PTS-STARTPTS)*${ratio},` +
      `drawbox=x=iw-250:y=28:w=220:h=50:color=black@0.68:t=fill,` +
      `drawtext=text='${escapedLabel}':x=w-tw-48:y=42:fontsize=22:fontcolor=white[vc${index}]`,
    );
    videoLabels.push(`[vc${index}]`);
    cursor = entry.end;
  }
  if (cursor < contentEnd || !videoLabels.length) {
    filters.push(`[0:v]trim=start=${cursor}:end=${contentEnd},setpts=PTS-STARTPTS[vnlast]`);
    videoLabels.push('[vnlast]');
  }
  filters.push(`${videoLabels.join('')}concat=n=${videoLabels.length}:v=1:a=0[videoconcat]`);
  filters.push(
    `[videoconcat]trim=duration=${finalDuration},fps=25,setpts=PTS-STARTPTS,` +
    `scale=${timeline.meta.viewport.width}:${timeline.meta.viewport.height}:flags=lanczos,` +
    'format=yuv420p[video]',
  );

  const audioInputs = [];
  const audioLabels = [];
  if (timeline.meta.narration.mode === 'reference') {
    audioInputs.push(timeline.meta.narration.referenceFile);
    filters.push(
      `[1:a]atrim=start=0:duration=${finalDuration},asetpts=PTS-STARTPTS,` +
      `apad=whole_dur=${finalDuration},atrim=duration=${finalDuration}[audio]`,
    );
  } else {
    for (const entry of timeline.narrations.filter((candidate) => candidate.file)) {
      audioInputs.push(entry.file);
      const input = audioInputs.length;
      let outputStart;
      if (entry.anchor?.wait) {
        const wait = timeline.waits.find((candidate) => candidate.id === entry.anchor.wait);
        if (!wait) throw new Error(`Missing wait anchor ${entry.anchor.wait}`);
        outputStart =
          mapTime(wait.start, timelineContentStart, compressions) + entry.anchor.offset;
      } else {
        outputStart = mapTime(entry.start, timelineContentStart, compressions);
      }
      const delay = Math.max(0, Math.round(outputStart * 1000));
      const audioLabel = `voice${input}`;
      filters.push(`[${input}:a]adelay=${delay}:all=1[${audioLabel}]`);
      audioLabels.push(`[${audioLabel}]`);
    }
    if (audioLabels.length) {
      filters.push(
        `${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0[mixed]`,
      );
      filters.push(
        `[mixed]apad=whole_dur=${finalDuration},atrim=duration=${finalDuration}[audio]`,
      );
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${finalDuration}[audio]`);
    }
  }
  return { filters, audioInputs, compressions, finalDuration };
}

function assertOutputsAvailable(manifest, force) {
  if (force) return;
  const existing = [
    manifest.output.video,
    manifest.output.contactSheet,
    manifest.output.timeline,
  ].filter((file) => fs.existsSync(file));
  if (existing.length) throw new Error(`Refusing to overwrite final artifacts:\n- ${existing.join('\n- ')}`);
}

export function finishRecording(manifest, { force = false, environment = process.env } = {}) {
  assertOutputsAvailable(manifest, force);
  const ffmpeg = resolveFfmpeg(manifest, environment);
  const timelinePath = path.join(manifest.output.workDir, 'timeline.json');
  const videoPathFile = path.join(manifest.output.workDir, 'video-path.txt');
  if (!fs.existsSync(timelinePath) || !fs.existsSync(videoPathFile)) {
    throw new Error(`No successful take found in ${manifest.output.workDir}`);
  }
  const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
  const video = fs.readFileSync(videoPathFile, 'utf8').trim();
  const rawDuration = probeDuration(ffmpeg, video);
  assertRawVideoCoversTimeline(rawDuration, timeline);

  const plan = buildFilterGraph({
    timeline,
    label: manifest.timing.fastForwardLabel,
  });
  fs.mkdirSync(path.dirname(manifest.output.video), { recursive: true });
  fs.mkdirSync(path.dirname(manifest.output.timeline), { recursive: true });
  const filterPath = path.join(manifest.output.workDir, 'finish-filter.txt');
  fs.writeFileSync(filterPath, `${plan.filters.join(';\n')}\n`, { mode: 0o600 });
  const args = [force ? '-y' : '-n', '-i', video];
  for (const input of plan.audioInputs) args.push('-i', input);
  args.push(
    '-filter_complex_script', filterPath,
    '-map', '[video]',
    '-map', '[audio]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-movflags', '+faststart',
    '-t', String(plan.finalDuration),
    manifest.output.video,
  );
  const mux = spawnSync(ffmpeg, args, { stdio: 'inherit', timeout: 10 * 60_000 });
  if (mux.error?.code === 'ETIMEDOUT') throw new Error('FFmpeg encode exceeded its safety bound');
  if (mux.status !== 0) throw new Error(`FFmpeg encode failed with status ${mux.status}`);

  fs.mkdirSync(path.dirname(manifest.output.contactSheet), { recursive: true });
  const samplingFps = Math.min(1, 12 / plan.finalDuration);
  const sheet = spawnSync(ffmpeg, [
    force ? '-y' : '-n',
    '-i', manifest.output.video,
    '-vf',
    `fps=${samplingFps},scale=448:252:force_original_aspect_ratio=decrease,` +
      'pad=448:252:(ow-iw)/2:(oh-ih)/2:white,tile=4x3:padding=8:margin=8:color=white',
    '-frames:v', '1',
    manifest.output.contactSheet,
  ], { stdio: 'inherit', timeout: 2 * 60_000 });
  if (sheet.error?.code === 'ETIMEDOUT') throw new Error('Contact-sheet generation timed out');
  if (sheet.status !== 0) throw new Error(`Contact-sheet generation failed with status ${sheet.status}`);

  const finalTimeline = {
    ...timeline,
    meta: {
      ...timeline.meta,
      rawVideoDuration: rawDuration,
      finalDuration: plan.finalDuration,
      frameRate: 25,
      videoCodec: 'H.264',
      audioCodec: 'AAC',
    },
    narrations: timeline.narrations.map((entry) => ({
      ...entry,
      finalStart: entry.anchor?.wait
        ? mapTime(
          timeline.waits.find((wait) => wait.id === entry.anchor.wait).start,
          timeline.meta.contentStart,
          plan.compressions,
        ) + entry.anchor.offset
        : mapTime(entry.start, timeline.meta.contentStart, plan.compressions),
    })),
  };
  fs.writeFileSync(manifest.output.timeline, `${JSON.stringify(finalTimeline, null, 2)}\n`);
  return {
    video: manifest.output.video,
    contactSheet: manifest.output.contactSheet,
    timeline: manifest.output.timeline,
    finalDuration: plan.finalDuration,
  };
}
