import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  KOKORO_MODEL_REVISION,
  kokoroSettings,
  prepareKokoroScene,
} from './kokoro.mjs';

const CLIP_EXTENSIONS = ['.aiff', '.aif', '.wav', '.m4a', '.mp3'];

export function estimateNarrationDuration(text, rate = 160) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, (words / Math.max(1, rate)) * 60);
}

function afinfoDuration(file) {
  const result = spawnSync('/usr/bin/afinfo', [file], { encoding: 'utf8' });
  if (result.status !== 0) return 0;
  return Number(result.stdout.match(/estimated duration:\s+([\d.]+)/)?.[1] ?? 0);
}

function ffmpegDuration(file, ffmpeg) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const match = result.stderr.match(/Duration:\s+(\d+):(\d+):([\d.]+)/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

function requireDuration(file, ffmpeg) {
  const duration = process.platform === 'darwin' ? afinfoDuration(file) : 0;
  const fallback = duration || (ffmpeg ? ffmpegDuration(file, ffmpeg) : 0);
  if (!(fallback > 0)) throw new Error(`Narration clip is empty or unreadable: ${file}`);
  return fallback;
}

function findClip(directory, id) {
  for (const extension of CLIP_EXTENSIONS) {
    const candidate = path.join(directory, `${id}${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing narration clip for scene ${id} in ${directory}`);
}

function prepareStandardNarration({
  manifest,
  scenePlan,
  workDir,
  rehearsal,
  ffmpeg,
}) {
  const mode = manifest.narration.mode;
  const pace = rehearsal ? manifest.timing.rehearsalScale : 1;
  const segments = new Map();
  const audioDir = path.join(workDir, 'audio');
  if (!rehearsal && mode === 'macos-say') fs.mkdirSync(audioDir, { recursive: true, mode: 0o700 });

  for (const scene of scenePlan.scenes) {
    if (!scene.narration) continue;
    let file = null;
    let duration = scene.timing?.duration ??
      estimateNarrationDuration(
        scene.narration,
        scene.timing?.rate ?? manifest.narration.rate ?? 160,
      );
    if (!rehearsal && mode === 'macos-say') {
      if (process.platform !== 'darwin') {
        throw new Error('macos-say narration requires macOS; use clips, reference, or silent mode');
      }
      file = path.join(audioDir, `${scene.id}.aiff`);
      execFileSync('/usr/bin/say', [
        '-v',
        manifest.narration.voice,
        '-r',
        String(scene.timing?.rate ?? manifest.narration.rate),
        '-o',
        file,
        scene.narration,
      ]);
      duration = requireDuration(file, ffmpeg);
    } else if (!rehearsal && mode === 'clips') {
      file = findClip(manifest.narration.clipsDir, scene.id);
      duration = requireDuration(file, ffmpeg);
    }
    segments.set(scene.id, { id: scene.id, file, duration, runtimeDuration: duration * pace });
  }

  let referenceFile = null;
  if (mode === 'reference') {
    referenceFile = manifest.narration.referenceFile;
    if (!fs.existsSync(referenceFile)) throw new Error(`Reference narration does not exist: ${referenceFile}`);
    if (!rehearsal) requireDuration(referenceFile, ffmpeg);
  }
  return { mode, pace, segments, referenceFile };
}

async function prepareKokoroNarration({
  manifest,
  scenePlan,
  workDir,
  rehearsal,
  ffmpeg,
  kokoroProvider,
}) {
  const mode = manifest.narration.mode;
  const pace = rehearsal ? manifest.timing.rehearsalScale : 1;
  const segments = new Map();
  const audioDir = path.join(workDir, 'audio');
  const settings = kokoroSettings(manifest);
  if (!rehearsal) fs.mkdirSync(audioDir, { recursive: true, mode: 0o700 });

  for (const scene of scenePlan.scenes) {
    if (!scene.narration) continue;
    let file = null;
    let cache = null;
    let duration = scene.timing?.duration ??
      (estimateNarrationDuration(
        scene.narration,
        scene.timing?.rate ?? manifest.narration.rate ?? 160,
      ) / settings.speed);
    if (!rehearsal) {
      file = path.join(audioDir, `${scene.id}.wav`);
      cache = await prepareKokoroScene({
        text: scene.narration,
        output: file,
        settings,
        ffmpeg,
        provider: kokoroProvider,
      });
      duration = requireDuration(file, ffmpeg);
    }
    segments.set(scene.id, {
      id: scene.id,
      file,
      duration,
      runtimeDuration: duration * pace,
      ...(cache ? { cacheHit: cache.cacheHit, cacheKey: cache.key } : {}),
      ...(cache?.coverage ? { coverage: cache.coverage } : {}),
    });
  }
  return {
    mode,
    pace,
    segments,
    referenceFile: null,
    metadata: {
      provider: 'kokoro-js',
      packageVersion: settings.packageVersion,
      model: settings.model,
      modelRevision: KOKORO_MODEL_REVISION,
      voice: settings.voice,
      speed: settings.speed,
      dtype: settings.dtype,
      device: settings.device,
    },
  };
}

export function prepareNarration(options) {
  return options.manifest.narration.mode === 'kokoro'
    ? prepareKokoroNarration(options)
    : prepareStandardNarration(options);
}
