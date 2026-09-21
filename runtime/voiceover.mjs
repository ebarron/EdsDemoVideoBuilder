import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { resolveFfmpeg } from './ffmpeg.mjs';

function suffixed(file, suffix) {
  const extension = path.extname(file);
  return path.join(
    path.dirname(file),
    `${path.basename(file, extension)}${suffix}${extension}`,
  );
}

export function voiceoverPaths(manifest) {
  return {
    root: path.join(path.dirname(manifest.output.video), `${manifest.id}-voiceover`),
    video: suffixed(manifest.output.video, '-human'),
    timeline: suffixed(manifest.output.timeline, '-human'),
    contactSheet: suffixed(manifest.output.contactSheet, '-human'),
  };
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes;
    do {
      bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest('hex')}`;
}

function writeJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

function requireFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} does not exist: ${file}`);
}

function safePathComponent(value) {
  const safe = String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
  if (!safe) throw new Error(`Unsafe empty path component: ${value}`);
  return safe;
}

export function buildVoiceoverPrompts(scenePlan, timeline) {
  const scenes = new Map(scenePlan.scenes.map((scene) => [scene.id, scene]));
  const prompts = timeline.narrations
    .map((entry) => {
      const scene = scenes.get(entry.id);
      if (!scene) return null;
      const cueText = (scene.cues ?? [])
        .filter((cue) => cue.kind === 'narration')
        .map((cue) => cue.text)
        .join(' ')
        .trim();
      return {
        sceneId: scene.id,
        title: scene.title,
        text: cueText || scene.narration,
        start: entry.finalStart,
        guideDuration: entry.duration,
      };
    })
    .filter((entry) =>
      entry?.text &&
      Number.isFinite(entry.start) &&
      entry.start >= 0)
    .sort((left, right) => left.start - right.start);
  return prompts.map((prompt, index) => {
    const nextStart = prompts[index + 1]?.start;
    const end = Number.isFinite(nextStart)
      ? nextStart
      : timeline.meta.finalDuration;
    if (!(end > prompt.start)) {
      throw new Error(`Invalid teleprompter window for scene ${prompt.sceneId}`);
    }
    return {
      ...prompt,
      end,
      windowDuration: end - prompt.start,
    };
  });
}

export function voiceoverTimingFit(duration, windowDuration, tolerance = 0.35) {
  const delta = duration - windowDuration;
  return {
    duration,
    windowDuration,
    delta,
    status: delta > 0
      ? 'over'
      : delta > -tolerance
        ? 'tight'
        : 'fits',
  };
}

function currentSessionFile(root) {
  return path.join(root, 'current.json');
}

function sessionFile(directory) {
  return path.join(directory, 'session.json');
}

function readCurrentDirectory(root) {
  const current = currentSessionFile(root);
  if (!fs.existsSync(current)) return null;
  const pointer = JSON.parse(fs.readFileSync(current, 'utf8'));
  const directory = path.resolve(root, pointer.session);
  const sessions = path.resolve(root, 'sessions');
  if (directory !== sessions && !directory.startsWith(`${sessions}${path.sep}`)) {
    throw new Error('Voiceover session pointer escapes its session root');
  }
  return directory;
}

export function readVoiceoverSession(manifest, sessionDirectory = null) {
  const paths = voiceoverPaths(manifest);
  const directory = sessionDirectory
    ? path.resolve(sessionDirectory)
    : readCurrentDirectory(paths.root);
  if (!directory) throw new Error(`No voiceover session exists for ${manifest.id}`);
  const sessions = path.resolve(paths.root, 'sessions');
  if (!directory.startsWith(`${sessions}${path.sep}`)) {
    throw new Error('Voiceover session directory escapes its session root');
  }
  const state = JSON.parse(fs.readFileSync(sessionFile(directory), 'utf8'));
  return { paths, directory, state };
}

function copyIfPresent(source, destination) {
  if (!source || !fs.existsSync(source)) return null;
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o400);
  return path.basename(destination);
}

function verifyPictureLock(session) {
  const manifestName = session.state.pictureLock.manifest;
  const manifestFile = manifestName
    ? path.resolve(session.directory, manifestName)
    : null;
  const pictureLockRoot = path.resolve(session.directory, 'picture-lock');
  if (manifestFile && !manifestFile.startsWith(`${pictureLockRoot}${path.sep}`)) {
    throw new Error('Picture-lock manifest path escapes its directory');
  }
  const lockManifest = manifestFile
    ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    : null;
  if (
    lockManifest &&
    (
      lockManifest.sourceHash !== session.state.pictureLock.sourceHash ||
      lockManifest.finalDuration !== session.state.pictureLock.finalDuration
    )
  ) {
    throw new Error('Picture-lock manifest does not match the voiceover session');
  }
  const files = lockManifest?.files ?? session.state.pictureLock.files;
  if (!files) {
    const video = path.join(session.directory, session.state.pictureLock.video);
    requireFile(video, 'Locked synthetic video');
    if (hashFile(video) !== session.state.pictureLock.sourceHash) {
      throw new Error('Locked synthetic video changed after voiceover recording began');
    }
    return { verified: 1 };
  }
  let verified = 0;
  for (const [label, expected] of Object.entries(files)) {
    const file = path.resolve(session.directory, expected.path);
    const pictureLock = path.resolve(session.directory, 'picture-lock');
    if (!file.startsWith(`${pictureLock}${path.sep}`)) {
      throw new Error(`Locked ${label} path escapes the picture-lock directory`);
    }
    requireFile(file, `Locked ${label}`);
    if (fs.statSync(file).size !== expected.bytes || hashFile(file) !== expected.hash) {
      throw new Error(`Locked ${label} changed after voiceover recording began`);
    }
    verified += 1;
  }
  return { verified };
}

function rawVideoPath(manifest) {
  const pointer = path.join(manifest.output.workDir, 'video-path.txt');
  if (!fs.existsSync(pointer)) return null;
  const video = fs.readFileSync(pointer, 'utf8').trim();
  return fs.existsSync(video) ? video : null;
}

export function createVoiceoverSession(manifest, { newSession = false } = {}) {
  const paths = voiceoverPaths(manifest);
  requireFile(manifest.output.video, 'Approved synthetic video');
  requireFile(manifest.output.timeline, 'Finished timeline');
  requireFile(manifest.output.contactSheet, 'Synthetic contact sheet');
  requireFile(manifest.scenePlan, 'Scene plan');
  requireFile(manifest.script, 'Markdown narration');
  const sourceHash = hashFile(manifest.output.video);
  const existingDirectory = readCurrentDirectory(paths.root);
  if (existingDirectory && !newSession) {
    const existing = JSON.parse(fs.readFileSync(sessionFile(existingDirectory), 'utf8'));
    if (existing.pictureLock.sourceHash !== sourceHash) {
      throw new Error(
        'The approved video changed after this voiceover session was created; use --new-session to preserve the old takes and create a new picture lock.',
      );
    }
    verifyPictureLock({ directory: existingDirectory, state: existing });
    return { paths, directory: existingDirectory, state: existing, created: false };
  }

  const timeline = JSON.parse(fs.readFileSync(manifest.output.timeline, 'utf8'));
  const scenePlan = JSON.parse(fs.readFileSync(manifest.scenePlan, 'utf8'));
  if (!(timeline.meta?.finalDuration > 0)) {
    throw new Error('Finished timeline is missing a positive finalDuration');
  }
  const prompts = buildVoiceoverPrompts(scenePlan, timeline);
  if (!prompts.length) throw new Error('No narrated scenes are available for voiceover');

  fs.mkdirSync(path.join(paths.root, 'sessions'), { recursive: true, mode: 0o700 });
  const id =
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const directory = path.join(paths.root, 'sessions', id);
  const pictureLock = path.join(directory, 'picture-lock');
  fs.mkdirSync(path.join(directory, 'takes'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(pictureLock, { recursive: true, mode: 0o700 });
  fs.copyFileSync(manifest.output.video, path.join(pictureLock, 'synthetic.mp4'), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(manifest.output.timeline, path.join(pictureLock, 'timeline.json'), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(
    manifest.output.contactSheet,
    path.join(pictureLock, 'contact-sheet.png'),
    fs.constants.COPYFILE_EXCL,
  );
  fs.copyFileSync(manifest.scenePlan, path.join(pictureLock, 'scene-plan.json'), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(manifest.script, path.join(pictureLock, 'script.md'), fs.constants.COPYFILE_EXCL);
  const raw = rawVideoPath(manifest);
  const rawVideo = copyIfPresent(raw, path.join(pictureLock, `raw${path.extname(raw ?? '') || '.webm'}`));
  const rawTimeline = copyIfPresent(
    path.join(manifest.output.workDir, 'timeline.json'),
    path.join(pictureLock, 'raw-timeline.json'),
  );
  const lockedFiles = {
    video: 'picture-lock/synthetic.mp4',
    timeline: 'picture-lock/timeline.json',
    contactSheet: 'picture-lock/contact-sheet.png',
    scenePlan: 'picture-lock/scene-plan.json',
    script: 'picture-lock/script.md',
    ...(rawVideo ? { rawVideo: `picture-lock/${rawVideo}` } : {}),
    ...(rawTimeline ? { rawTimeline: `picture-lock/${rawTimeline}` } : {}),
  };
  for (const relative of Object.values(lockedFiles)) {
    fs.chmodSync(path.join(directory, relative), 0o400);
  }
  const lockFiles = Object.fromEntries(
    Object.entries(lockedFiles).map(([label, relative]) => {
      const file = path.join(directory, relative);
      return [label, {
        path: relative,
        bytes: fs.statSync(file).size,
        hash: hashFile(file),
      }];
    }),
  );
  const lockManifest = path.join(pictureLock, 'manifest.json');
  writeJson(lockManifest, {
    version: 1,
    sourceHash,
    finalDuration: timeline.meta.finalDuration,
    files: lockFiles,
  });
  fs.chmodSync(lockManifest, 0o400);
  const state = {
    version: 2,
    id,
    demoId: manifest.id,
    createdAt: new Date().toISOString(),
    completedAt: null,
    pictureLock: {
      video: 'picture-lock/synthetic.mp4',
      timeline: 'picture-lock/timeline.json',
      contactSheet: 'picture-lock/contact-sheet.png',
      scenePlan: 'picture-lock/scene-plan.json',
      script: 'picture-lock/script.md',
      rawVideo: rawVideo ? `picture-lock/${rawVideo}` : null,
      rawTimeline: rawTimeline ? `picture-lock/${rawTimeline}` : null,
      sourceHash,
      finalDuration: timeline.meta.finalDuration,
      manifest: 'picture-lock/manifest.json',
      files: lockFiles,
    },
    outputs: {
      video: paths.video,
      timeline: paths.timeline,
      contactSheet: paths.contactSheet,
    },
    prompts,
    takes: [],
    accepted: { master: null, scenes: {} },
  };
  writeJson(sessionFile(directory), state);
  writeJson(currentSessionFile(paths.root), {
    session: path.relative(paths.root, directory),
  });
  return { paths, directory, state, created: true };
}

function mediaExtension(contentType) {
  if (/mp4|m4a/i.test(contentType)) return '.m4a';
  if (/ogg/i.test(contentType)) return '.ogg';
  if (/wav/i.test(contentType)) return '.wav';
  return '.webm';
}

function probeDuration(ffmpeg, file) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const match = result.stderr.match(/Duration:\s+(\d+):(\d+):([\d.]+)/);
  if (!match) throw new Error(`Could not measure recorded voiceover audio:\n${result.stderr}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function videoStreamHash(ffmpeg, file) {
  const result = spawnSync(ffmpeg, [
    '-v', 'error',
    '-i', file,
    '-map', '0:v:0',
    '-c:v', 'copy',
    '-f', 'hash',
    '-hash', 'sha256',
    '-',
  ], { encoding: 'utf8', timeout: 5 * 60_000 });
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`Video stream hashing timed out: ${file}`);
  }
  const match = result.stdout?.match(/SHA256=([a-f0-9]+)/i);
  if (result.status !== 0 || !match) {
    throw new Error(`Could not hash video stream: ${file}\n${result.stderr ?? ''}`);
  }
  return `sha256:${match[1].toLowerCase()}`;
}

function audioStreamHash(ffmpeg, file) {
  const result = spawnSync(ffmpeg, [
    '-v', 'error',
    '-i', file,
    '-map', '0:a:0',
    '-c:a', 'copy',
    '-f', 'hash',
    '-hash', 'sha256',
    '-',
  ], { encoding: 'utf8', timeout: 5 * 60_000 });
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`Audio stream hashing timed out: ${file}`);
  }
  const match = result.stdout?.match(/SHA256=([a-f0-9]+)/i);
  if (result.status !== 0 || !match) {
    throw new Error(`Could not hash audio stream: ${file}\n${result.stderr ?? ''}`);
  }
  return `sha256:${match[1].toLowerCase()}`;
}

export function registerVoiceoverTake({
  manifest,
  kind,
  sceneId,
  contentType,
  videoOffsetMs = 0,
  captureDurationMs = null,
  bytes,
  sessionDir = null,
  environment = process.env,
}) {
  if (!['master', 'scene'].includes(kind)) throw new Error(`Unsupported voiceover take kind: ${kind}`);
  const session = readVoiceoverSession(manifest, sessionDir);
  const prompt = kind === 'scene'
    ? session.state.prompts.find((entry) => entry.sceneId === sceneId)
    : null;
  if (kind === 'scene' && !prompt) throw new Error(`Unknown voiceover scene: ${sceneId}`);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Voiceover take is empty');
  const offset = Math.max(0, Math.min(5, Number(videoOffsetMs) / 1000 || 0));
  const takeId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  const takeDirectory = path.join(
    session.directory,
    'takes',
    kind === 'master' ? 'master' : safePathComponent(sceneId),
  );
  fs.mkdirSync(takeDirectory, { recursive: true, mode: 0o700 });
  const source = path.join(
    takeDirectory,
    `${takeId}.source${mediaExtension(contentType)}`,
  );
  const wave = path.join(takeDirectory, `${takeId}.wav`);
  fs.writeFileSync(source, bytes, { flag: 'wx', mode: 0o600 });
  const ffmpeg = resolveFfmpeg(manifest, environment);
  const conversion = spawnSync(ffmpeg, [
    '-v', 'error',
    '-y',
    '-i', source,
    '-vn',
    '-ac', '1',
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    wave,
  ], { encoding: 'utf8', timeout: 5 * 60_000 });
  if (conversion.error?.code === 'ETIMEDOUT') throw new Error('Voiceover conversion timed out');
  if (conversion.status !== 0) {
    fs.rmSync(wave, { force: true });
    throw new Error(`Voiceover conversion failed:\n${conversion.stderr}`);
  }
  const duration = probeDuration(ffmpeg, wave);
  const measuredDuration = Math.max(0, duration - offset);
  const reportedDuration = Number(captureDurationMs) / 1000;
  const effectiveDuration =
    Number.isFinite(reportedDuration) && reportedDuration > 0
      ? Math.min(measuredDuration, reportedDuration)
      : measuredDuration;
  if (!(effectiveDuration > 0.05)) {
    throw new Error('Voiceover take is too short to use');
  }
  const take = {
    id: takeId,
    kind,
    sceneId: kind === 'scene' ? sceneId : null,
    createdAt: new Date().toISOString(),
    source: path.relative(session.directory, source),
    wave: path.relative(session.directory, wave),
    contentType,
    bytes: bytes.length,
    sampleRate: 48000,
    channels: 1,
    waveHash: hashFile(wave),
    videoOffset: offset,
    duration,
    measuredDuration,
    effectiveDuration,
    fit: kind === 'scene'
      ? voiceoverTimingFit(effectiveDuration, prompt.windowDuration)
      : voiceoverTimingFit(effectiveDuration, session.state.pictureLock.finalDuration),
  };
  session.state.takes.push(take);
  writeJson(sessionFile(session.directory), session.state);
  return {
    take,
    accepted: false,
    eligible: take.fit.status !== 'over',
    state: session.state,
  };
}

export function resolveVoiceoverTakeAudio(manifest, takeId, sessionDir = null) {
  const session = readVoiceoverSession(manifest, sessionDir);
  const take = session.state.takes.find((entry) => entry.id === takeId);
  if (!take) throw new Error(`Unknown voiceover take: ${takeId}`);
  const takesDirectory = fs.realpathSync(path.join(session.directory, 'takes'));
  const file = fs.realpathSync(path.resolve(session.directory, take.wave));
  if (!file.startsWith(`${takesDirectory}${path.sep}`)) {
    throw new Error(`Voiceover take path escapes its session: ${takeId}`);
  }
  return { file, take };
}

function takeScope(take) {
  return take.kind === 'master' ? 'master' : `scene:${take.sceneId}`;
}

function planTakeCleanup(session, selectedTakes) {
  const selectedByScope = new Map(
    selectedTakes.map((take) => [takeScope(take), take.id]),
  );
  const discarded = session.state.takes.filter((take) => {
    const selected = selectedByScope.get(takeScope(take));
    return selected && selected !== take.id;
  });
  const takesDirectory = path.resolve(session.directory, 'takes');
  const realTakesDirectory = fs.realpathSync(takesDirectory);
  const files = discarded.flatMap((take) =>
    [take.source, take.wave].filter(Boolean).map((relative) => {
      const file = path.resolve(session.directory, relative);
      if (!file.startsWith(`${takesDirectory}${path.sep}`)) {
        throw new Error(`Voiceover take path escapes its session: ${take.id}`);
      }
      if (!fs.existsSync(file)) return file;
      const realFile = fs.realpathSync(file);
      if (!realFile.startsWith(`${realTakesDirectory}${path.sep}`)) {
        throw new Error(`Voiceover take path escapes its session: ${take.id}`);
      }
      return realFile;
    }));
  const discardedIds = new Set(discarded.map((take) => take.id));
  return {
    discarded,
    files,
    retained: session.state.takes.filter((take) => !discardedIds.has(take.id)),
  };
}

function deleteTakeArtifacts(files) {
  for (const file of files) fs.rmSync(file, { force: true });
}

export function acceptVoiceoverTake(
  manifest,
  takeId,
  sessionDir = null,
  { cleanup = false } = {},
) {
  const session = readVoiceoverSession(manifest, sessionDir);
  const take = session.state.takes.find((entry) => entry.id === takeId);
  if (!take) throw new Error(`Unknown voiceover take: ${takeId}`);
  if (take.fit.status === 'over') {
    throw new Error('An overlong voiceover take cannot be accepted; record a natural retake');
  }
  if (take.kind === 'master') session.state.accepted.master = take.id;
  else session.state.accepted.scenes[take.sceneId] = take.id;
  const cleanupPlan = cleanup
    ? planTakeCleanup(session, [take])
    : { discarded: [], files: [], retained: session.state.takes };
  session.state.takes = cleanupPlan.retained;
  writeJson(sessionFile(session.directory), session.state);
  deleteTakeArtifacts(cleanupPlan.files);
  return {
    ...session.state,
    cleanup: { deleted: cleanupPlan.discarded.length },
  };
}

export function acceptLatestEligibleVoiceoverTakes(
  manifest,
  sessionDir = null,
  { cleanup = false } = {},
) {
  const session = readVoiceoverSession(manifest, sessionDir);
  const accepted = [];
  const selected = [];
  for (const prompt of session.state.prompts) {
    const take = [...session.state.takes].reverse().find(
      (entry) =>
        entry.kind === 'scene' &&
        entry.sceneId === prompt.sceneId &&
        entry.fit.status !== 'over',
    );
    if (!take) continue;
    selected.push(take);
    if (session.state.accepted.scenes[prompt.sceneId] !== take.id) {
      session.state.accepted.scenes[prompt.sceneId] = take.id;
      accepted.push({ sceneId: prompt.sceneId, takeId: take.id });
    }
  }
  const cleanupPlan = cleanup
    ? planTakeCleanup(session, selected)
    : { discarded: [], files: [], retained: session.state.takes };
  session.state.takes = cleanupPlan.retained;
  if (accepted.length || cleanupPlan.discarded.length) {
    writeJson(sessionFile(session.directory), session.state);
  }
  deleteTakeArtifacts(cleanupPlan.files);
  return {
    accepted,
    selected: selected.length,
    deleted: cleanupPlan.discarded.length,
    state: session.state,
  };
}

export function clearVoiceoverAcceptance(
  manifest,
  { kind, sceneId = null, sessionDir = null },
) {
  const session = readVoiceoverSession(manifest, sessionDir);
  if (kind === 'master') {
    session.state.accepted.master = null;
  } else if (kind === 'scene' && sceneId) {
    delete session.state.accepted.scenes[sceneId];
  } else {
    throw new Error('Specify master or a scene to clear voiceover acceptance');
  }
  writeJson(sessionFile(session.directory), session.state);
  return session.state;
}

export function completeVoiceoverSession(manifest, sessionDir = null) {
  const session = readVoiceoverSession(manifest, sessionDir);
  session.state.completedAt = new Date().toISOString();
  writeJson(sessionFile(session.directory), session.state);
  return session.state;
}

function acceptedTake(state, id) {
  const take = state.takes.find((entry) => entry.id === id);
  if (!take) throw new Error(`Accepted voiceover take is missing: ${id}`);
  return take;
}

function verifyAcceptedTakes(session) {
  const acceptedIds = [
    session.state.accepted.master,
    ...Object.values(session.state.accepted.scenes),
  ].filter(Boolean);
  for (const id of new Set(acceptedIds)) {
    const take = acceptedTake(session.state, id);
    const file = path.resolve(session.directory, take.wave);
    const takes = path.resolve(session.directory, 'takes');
    if (!file.startsWith(`${takes}${path.sep}`)) {
      throw new Error(`Accepted voiceover take path escapes its session: ${id}`);
    }
    requireFile(file, `Accepted voiceover take ${id}`);
    if (!take.waveHash || hashFile(file) !== take.waveHash) {
      throw new Error(`Accepted voiceover take changed after recording: ${id}`);
    }
  }
  return { verified: new Set(acceptedIds).size };
}

export function buildVoiceoverAudioGraph(state) {
  const master = state.accepted.master
    ? acceptedTake(state, state.accepted.master)
    : null;
  const sceneTakes = state.prompts
    .map((prompt) => {
      const id = state.accepted.scenes[prompt.sceneId];
      return id ? { prompt, take: acceptedTake(state, id) } : null;
    })
    .filter(Boolean);
  if (!master && sceneTakes.length !== state.prompts.length) {
    const missing = state.prompts
      .filter((prompt) => !state.accepted.scenes[prompt.sceneId])
      .map((prompt) => prompt.sceneId);
    throw new Error(
      `Record a full master or accept a take for every scene; missing: ${missing.join(', ')}`,
    );
  }
  if (master && master.effectiveDuration > state.pictureLock.finalDuration) {
    throw new Error(
      `Full voiceover exceeds the locked video by ` +
      `${(master.effectiveDuration - state.pictureLock.finalDuration).toFixed(2)}s; ` +
      'record a natural retake instead of truncating or speeding it up.',
    );
  }
  for (const { prompt, take } of sceneTakes) {
    if (take.effectiveDuration > prompt.windowDuration) {
      throw new Error(
        `Voiceover take for ${prompt.sceneId} exceeds its window by ` +
        `${(take.effectiveDuration - prompt.windowDuration).toFixed(2)}s; record a natural retake instead of speeding it up.`,
      );
    }
  }

  const inputs = [];
  const filters = [];
  const labels = [];
  if (master) {
    inputs.push(master.wave);
    let chain = `[1:a]atrim=start=${master.videoOffset},asetpts=PTS-STARTPTS`;
    for (const { prompt } of sceneTakes) {
      chain += `,volume=volume=0:enable='between(t,${prompt.start},${prompt.end})'`;
    }
    chain += `[master]`;
    filters.push(chain);
    labels.push('[master]');
  }
  for (const [index, { prompt, take }] of sceneTakes.entries()) {
    inputs.push(take.wave);
    const input = inputs.length;
    filters.push(
      `[${input}:a]atrim=start=${take.videoOffset}:duration=${take.effectiveDuration},` +
      `asetpts=PTS-STARTPTS,adelay=${Math.round(prompt.start * 1000)}:all=1[scene${index}]`,
    );
    labels.push(`[scene${index}]`);
  }
  const finalDuration = state.pictureLock.finalDuration;
  if (labels.length === 1) {
    filters.push(
      `${labels[0]}apad=whole_dur=${finalDuration},atrim=duration=${finalDuration},` +
      'aresample=48000[audio]',
    );
  } else {
    filters.push(
      `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,` +
      `apad=whole_dur=${finalDuration},atrim=duration=${finalDuration},` +
      'aresample=48000[audio]',
    );
  }
  return { inputs, filters, master, sceneTakes, finalDuration };
}

function availableOutputs(paths, force) {
  if (force) return;
  const existing = [paths.video, paths.timeline, paths.contactSheet]
    .filter((file) => fs.existsSync(file));
  if (existing.length) {
    throw new Error(`Refusing to overwrite human voiceover artifacts:\n- ${existing.join('\n- ')}`);
  }
}

export function finishVoiceover(
  manifest,
  { force = false, environment = process.env, stdio = 'inherit' } = {},
) {
  const session = readVoiceoverSession(manifest);
  verifyPictureLock(session);
  verifyAcceptedTakes(session);
  availableOutputs(session.paths, force);
  const graph = buildVoiceoverAudioGraph(session.state);
  const ffmpeg = resolveFfmpeg(manifest, environment);
  const lockedVideo = path.join(session.directory, session.state.pictureLock.video);
  const pictureStreamHash = videoStreamHash(ffmpeg, lockedVideo);
  const resolvedInputs = graph.inputs.map((file) => path.join(session.directory, file));
  const filterFile = path.join(session.directory, 'voiceover-filter.txt');
  fs.writeFileSync(filterFile, `${graph.filters.join(';\n')}\n`, { mode: 0o600 });
  fs.mkdirSync(path.dirname(session.paths.video), { recursive: true });
  const args = [force ? '-y' : '-n', '-i', lockedVideo];
  for (const input of resolvedInputs) args.push('-i', input);
  args.push(
    '-filter_complex_script', filterFile,
    '-map', '0:v:0',
    '-map', '[audio]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-movflags', '+faststart',
    '-t', String(graph.finalDuration),
    session.paths.video,
  );
  const mux = spawnSync(ffmpeg, args, {
    stdio,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
    timeout: 10 * 60_000,
  });
  if (mux.error?.code === 'ETIMEDOUT') throw new Error('Voiceover finishing timed out');
  if (mux.status !== 0) {
    throw new Error(
      `Voiceover finishing failed with status ${mux.status}` +
      (mux.stderr ? `:\n${mux.stderr}` : ''),
    );
  }
  const outputStreamHash = videoStreamHash(ffmpeg, session.paths.video);
  if (outputStreamHash !== pictureStreamHash) {
    throw new Error('Human voiceover output changed the locked video stream');
  }
  const outputAudioStreamHash = audioStreamHash(ffmpeg, session.paths.video);

  fs.copyFileSync(
    path.join(session.directory, session.state.pictureLock.contactSheet),
    session.paths.contactSheet,
    force ? 0 : fs.constants.COPYFILE_EXCL,
  );
  const contactSheetHash = hashFile(session.paths.contactSheet);
  if (
    contactSheetHash !== hashFile(
      path.join(session.directory, session.state.pictureLock.contactSheet),
    )
  ) {
    throw new Error('Human contact sheet differs from the locked picture');
  }
  const sourceTimeline = JSON.parse(
    fs.readFileSync(path.join(session.directory, session.state.pictureLock.timeline), 'utf8'),
  );
  const acceptedScenes = Object.fromEntries(
    Object.entries(session.state.accepted.scenes).map(([sceneId, takeId]) => {
      const take = acceptedTake(session.state, takeId);
      return [sceneId, {
        takeId,
        duration: take.effectiveDuration,
        fit: take.fit,
      }];
    }),
  );
  const finalTimeline = {
    ...sourceTimeline,
    meta: {
      ...sourceTimeline.meta,
      narration: {
        mode: 'human-voiceover',
        session: session.state.id,
        pictureLockHash: session.state.pictureLock.sourceHash,
        pictureStreamHash,
        outputAudioStreamHash,
        contactSheetHash,
        masterTake: session.state.accepted.master,
        sceneTakes: acceptedScenes,
      },
    },
  };
  writeJson(session.paths.timeline, finalTimeline);
  return {
    video: session.paths.video,
    timeline: session.paths.timeline,
    contactSheet: session.paths.contactSheet,
    session: session.state.id,
    masterTake: session.state.accepted.master,
    sceneTakes: acceptedScenes,
    pictureStreamHash,
    outputAudioStreamHash,
    contactSheetHash,
  };
}

export function voiceoverVerificationManifest(manifest) {
  const paths = voiceoverPaths(manifest);
  return {
    ...manifest,
    output: {
      ...manifest.output,
      video: paths.video,
      timeline: paths.timeline,
      contactSheet: paths.contactSheet,
    },
  };
}

export function verifyVoiceoverArtifacts(manifest, environment = process.env) {
  const session = readVoiceoverSession(manifest);
  const lock = verifyPictureLock(session);
  const takes = verifyAcceptedTakes(session);
  const paths = voiceoverPaths(manifest);
  requireFile(paths.video, 'Human voiceover video');
  requireFile(paths.timeline, 'Human voiceover timeline');
  requireFile(paths.contactSheet, 'Human voiceover contact sheet');
  const timeline = JSON.parse(fs.readFileSync(paths.timeline, 'utf8'));
  const narration = timeline.meta?.narration;
  if (narration?.mode !== 'human-voiceover' || narration.session !== session.state.id) {
    throw new Error('Human voiceover timeline does not match the current voiceover session');
  }
  if (timeline.meta.finalDuration !== session.state.pictureLock.finalDuration) {
    throw new Error('Human voiceover timeline duration differs from the picture lock');
  }
  const expectedSceneTakes = Object.entries(session.state.accepted.scenes)
    .sort(([left], [right]) => left.localeCompare(right));
  const timelineSceneTakes = Object.entries(narration.sceneTakes ?? {})
    .map(([sceneId, value]) => [sceneId, value.takeId])
    .sort(([left], [right]) => left.localeCompare(right));
  if (
    narration.masterTake !== session.state.accepted.master ||
    JSON.stringify(timelineSceneTakes) !== JSON.stringify(expectedSceneTakes)
  ) {
    throw new Error('Human voiceover timeline take selections differ from the session');
  }
  buildVoiceoverAudioGraph(session.state);
  const ffmpeg = resolveFfmpeg(manifest, environment);
  const lockedVideo = path.join(session.directory, session.state.pictureLock.video);
  const pictureStreamHash = videoStreamHash(ffmpeg, lockedVideo);
  const outputStreamHash = videoStreamHash(ffmpeg, paths.video);
  if (
    pictureStreamHash !== outputStreamHash ||
    narration.pictureStreamHash !== pictureStreamHash ||
    narration.pictureLockHash !== session.state.pictureLock.sourceHash
  ) {
    throw new Error('Human voiceover output no longer matches its locked picture');
  }
  const outputAudioStreamHash = audioStreamHash(ffmpeg, paths.video);
  if (narration.outputAudioStreamHash !== outputAudioStreamHash) {
    throw new Error('Human voiceover output audio changed after finishing');
  }
  const contactSheetHash = hashFile(paths.contactSheet);
  const lockedContactSheetHash = hashFile(
    path.join(session.directory, session.state.pictureLock.contactSheet),
  );
  if (
    contactSheetHash !== lockedContactSheetHash ||
    narration.contactSheetHash !== contactSheetHash
  ) {
    throw new Error('Human contact sheet no longer matches the locked picture');
  }
  const duration = probeDuration(ffmpeg, paths.video);
  if (Math.abs(duration - session.state.pictureLock.finalDuration) > 0.1) {
    throw new Error('Human voiceover output duration differs from the picture lock');
  }
  return {
    session: session.state.id,
    lockedArtifacts: lock.verified,
    acceptedTakes: takes.verified,
    pictureStreamHash,
    outputAudioStreamHash,
    contactSheetHash,
    duration,
  };
}
