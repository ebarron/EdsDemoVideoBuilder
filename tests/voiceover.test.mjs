import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import ffmpegStatic from 'ffmpeg-static';

import { createVoiceoverStudio } from '../runtime/voiceover-studio.mjs';
import {
  acceptLatestEligibleVoiceoverTakes,
  buildVoiceoverAudioGraph,
  buildVoiceoverPrompts,
  createVoiceoverSession,
  finishVoiceover,
  readVoiceoverSession,
  registerVoiceoverTake,
  verifyVoiceoverArtifacts,
  voiceoverPaths,
  voiceoverTimingFit,
} from '../runtime/voiceover.mjs';

function fixture({ validVideo = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-voiceover-test-'));
  const output = path.join(root, 'output');
  const workDir = path.join(root, 'work');
  fs.mkdirSync(output);
  fs.mkdirSync(workDir);
  const video = path.join(output, 'sample.mp4');
  if (validVideo) {
    const generated = spawnSync(ffmpegStatic, [
      '-v', 'error',
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=320x240:r=25:d=2',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=48000:cl=stereo',
      '-t', '2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      video,
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
  } else {
    fs.writeFileSync(video, 'locked-video');
  }
  const timeline = path.join(output, 'sample-timeline.json');
  fs.writeFileSync(timeline, `${JSON.stringify({
    meta: {
      finalDuration: 2,
      viewport: { width: 320, height: 240 },
      narration: { mode: 'macos-say' },
    },
    narrations: [
      { id: 'opening', finalStart: 0, duration: 1.4 },
      { id: 'close', finalStart: 1.4, duration: 0.5 },
    ],
  })}\n`);
  const plan = path.join(root, 'scene-plan.json');
  fs.writeFileSync(plan, `${JSON.stringify({
    version: 1,
    scenes: [
      {
        id: 'opening',
        title: 'Opening',
        narration: 'Introduce the dashboard.',
        actions: [],
        cues: [
          { id: 'opening-narration-1', kind: 'narration', text: 'Introduce the dashboard.' },
        ],
      },
      {
        id: 'close',
        title: 'Close',
        narration: 'Summarize the outcome.',
        actions: [],
        cues: [
          { id: 'close-narration-1', kind: 'narration', text: 'Summarize the outcome.' },
        ],
      },
    ],
  })}\n`);
  const script = path.join(root, 'script.md');
  fs.writeFileSync(script, '# Opening\n\nIntroduce the dashboard.\n');
  const contactSheet = path.join(output, 'sample-contact-sheet.png');
  fs.writeFileSync(contactSheet, 'same locked frames');
  return {
    root,
    manifest: {
      id: 'sample',
      script,
      scenePlan: plan,
      output: {
        workDir,
        video,
        timeline,
        contactSheet,
        notes: path.join(root, 'notes.md'),
      },
      tools: {},
    },
  };
}

function waveBuffer(seconds = 1) {
  const sampleRate = 48000;
  const samples = Math.round(sampleRate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test('builds teleprompter windows from finished-timeline positions and ordered cues', () => {
  const files = fixture();
  const plan = JSON.parse(fs.readFileSync(files.manifest.scenePlan, 'utf8'));
  const timeline = JSON.parse(fs.readFileSync(files.manifest.output.timeline, 'utf8'));
  assert.deepEqual(buildVoiceoverPrompts(plan, timeline), [
    {
      sceneId: 'opening',
      title: 'Opening',
      text: 'Introduce the dashboard.',
      start: 0,
      guideDuration: 1.4,
      end: 1.4,
      windowDuration: 1.4,
    },
    {
      sceneId: 'close',
      title: 'Close',
      text: 'Summarize the outcome.',
      start: 1.4,
      guideDuration: 0.5,
      end: 2,
      windowDuration: 0.6000000000000001,
    },
  ]);
  assert.equal(voiceoverTimingFit(1, 1.4).status, 'fits');
  assert.equal(voiceoverTimingFit(1.2, 1.4).status, 'tight');
  assert.equal(voiceoverTimingFit(2, 1.4).status, 'over');
});

test('creates an immutable picture-lock session and preserves prior sessions', () => {
  const files = fixture();
  const first = createVoiceoverSession(files.manifest);
  assert.equal(first.created, true);
  assert.equal(fs.existsSync(path.join(first.directory, 'picture-lock', 'synthetic.mp4')), true);
  assert.equal(
    fs.statSync(path.join(first.directory, 'picture-lock', 'synthetic.mp4')).mode & 0o222,
    0,
  );
  assert.equal(first.state.pictureLock.files.video.hash, first.state.pictureLock.sourceHash);
  assert.equal(createVoiceoverSession(files.manifest).created, false);

  fs.appendFileSync(files.manifest.output.video, '-changed');
  assert.throws(() => createVoiceoverSession(files.manifest), /use --new-session/);
  const second = createVoiceoverSession(files.manifest, { newSession: true });
  assert.notEqual(second.directory, first.directory);
  assert.equal(fs.existsSync(first.directory), true);
  assert.equal(readVoiceoverSession(files.manifest).directory, second.directory);
  assert.match(voiceoverPaths(files.manifest).video, /sample-human\.mp4$/);
});

test('builds full-master and scene-override audio without speeding speech', () => {
  const state = {
    pictureLock: { finalDuration: 4 },
    prompts: [
      { sceneId: 'opening', start: 0.5, end: 2, windowDuration: 1.5 },
    ],
    takes: [
      {
        id: 'master',
        kind: 'master',
        wave: 'takes/master.wav',
        videoOffset: 0.1,
        effectiveDuration: 3.8,
      },
      {
        id: 'opening-take',
        kind: 'scene',
        sceneId: 'opening',
        wave: 'takes/opening.wav',
        videoOffset: 0.05,
        effectiveDuration: 1.2,
        fit: voiceoverTimingFit(1.2, 1.5),
      },
    ],
    accepted: { master: 'master', scenes: { opening: 'opening-take' } },
  };
  const graph = buildVoiceoverAudioGraph(state);
  assert.deepEqual(graph.inputs, ['takes/master.wav', 'takes/opening.wav']);
  assert.match(graph.filters.join('\n'), /between\(t,0\.5,2\)/);
  assert.match(graph.filters.join('\n'), /adelay=500:all=1/);
  assert.doesNotMatch(graph.filters.join('\n'), /atempo/);

  state.takes[1].effectiveDuration = 2;
  assert.throws(() => buildVoiceoverAudioGraph(state), /natural retake instead of speeding/);
});

test('records 48 kHz takes and finishes a separate human-voice video', () => {
  const files = fixture({ validVideo: true });
  createVoiceoverSession(files.manifest);
  const over = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'opening',
    contentType: 'audio/wav',
    bytes: waveBuffer(1.5),
  });
  assert.equal(over.accepted, false);
  assert.equal(over.eligible, false);
  assert.equal(over.state.accepted.scenes.opening, undefined);
  const boundaryStopped = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'opening',
    contentType: 'audio/wav',
    captureDurationMs: 1400,
    bytes: waveBuffer(1.5),
  });
  assert.equal(boundaryStopped.accepted, false);
  assert.equal(boundaryStopped.eligible, true);
  assert.equal(boundaryStopped.state.accepted.scenes.opening, undefined);
  assert.equal(boundaryStopped.take.effectiveDuration, 1.4);
  const opening = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'opening',
    contentType: 'audio/wav',
    bytes: waveBuffer(1),
  });
  assert.equal(opening.take.sampleRate, 48000);
  assert.match(opening.take.waveHash, /^sha256:[a-f0-9]{64}$/);
  const close = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'close',
    contentType: 'audio/wav',
    bytes: waveBuffer(0.4),
  });
  const latest = acceptLatestEligibleVoiceoverTakes(files.manifest);
  assert.deepEqual(
    latest.accepted,
    [
      { sceneId: 'opening', takeId: opening.take.id },
      { sceneId: 'close', takeId: close.take.id },
    ],
  );
  const result = finishVoiceover(files.manifest, { stdio: 'pipe' });
  assert.equal(fs.existsSync(result.video), true);
  assert.notEqual(result.video, files.manifest.output.video);
  const timeline = JSON.parse(fs.readFileSync(result.timeline, 'utf8'));
  assert.equal(timeline.meta.narration.mode, 'human-voiceover');
  assert.equal(verifyVoiceoverArtifacts(files.manifest).session, result.session);
  timeline.meta.narration.sceneTakes.opening.takeId = 'changed-selection';
  fs.writeFileSync(result.timeline, `${JSON.stringify(timeline)}\n`);
  assert.throws(
    () => verifyVoiceoverArtifacts(files.manifest),
    /take selections differ/,
  );
  assert.equal(fs.existsSync(files.manifest.output.video), true);
});

test('serves the muted studio and take audio only through its local token', async () => {
  const files = fixture();
  const studio = await createVoiceoverStudio(files.manifest, { open: false });
  const page = await fetch(studio.url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /The video is always muted/);
  assert.match(html, /data-play-take/);
  assert.match(html, /data-stop-take/);
  assert.match(html, /Use latest eligible takes/);
  assert.doesNotMatch(html, /<h2>Take history<\/h2>/);
  const unauthorized = await fetch(new URL('/api/session', studio.url));
  assert.equal(unauthorized.status, 403);
  const token = new URL(studio.url).searchParams.get('token');
  const session = await fetch(`${new URL(studio.url).origin}/api/session?token=${token}`);
  assert.equal(session.status, 200);
  const firstState = await session.json();
  const take = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'opening',
    contentType: 'audio/wav',
    bytes: waveBuffer(1),
    sessionDir: studio.directory,
  });
  const audioUrl = new URL('/api/take-audio', studio.url);
  audioUrl.searchParams.set('token', token);
  audioUrl.searchParams.set('takeId', take.take.id);
  const audio = await fetch(audioUrl, { headers: { range: 'bytes=0-31' } });
  assert.equal(audio.status, 206);
  assert.equal(audio.headers.get('content-type'), 'audio/wav');
  assert.equal((await audio.arrayBuffer()).byteLength, 32);
  const unauthorizedAudio = new URL(audioUrl);
  unauthorizedAudio.searchParams.delete('token');
  assert.equal((await fetch(unauthorizedAudio)).status, 403);
  const latestUrl = new URL('/api/accept-latest', studio.url);
  latestUrl.searchParams.set('token', token);
  const latest = await fetch(latestUrl, { method: 'POST' });
  assert.equal(latest.status, 200);
  assert.equal((await latest.json()).accepted[0].takeId, take.take.id);
  await assert.rejects(
    createVoiceoverStudio(files.manifest, { open: false }),
    /already open/,
  );
  const newer = await createVoiceoverStudio(files.manifest, {
    open: false,
    newSession: true,
  });
  const oldSession = await fetch(
    `${new URL(studio.url).origin}/api/session?token=${token}`,
  ).then((response) => response.json());
  assert.equal(oldSession.id, firstState.id);
  const newerUrl = new URL(newer.url);
  const newerState = await fetch(
    `${newerUrl.origin}/api/session?token=${newerUrl.searchParams.get('token')}`,
  ).then((response) => response.json());
  assert.notEqual(oldSession.id, newerState.id);
  const completed = await fetch(
    `${new URL(studio.url).origin}/api/complete?token=${token}`,
    { method: 'POST' },
  );
  assert.equal(completed.status, 200);
  assert.equal((await studio.done).completedAt !== null, true);
  await newer.close();
});
