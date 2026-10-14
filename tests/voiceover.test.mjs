import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import ffmpegStatic from 'ffmpeg-static';

import {
  prepareVoiceoverNarrationEditor,
  updateVoiceoverNarration,
} from '../runtime/narration-edit.mjs';
import { parseDemoScript } from '../runtime/parser.mjs';
import { sourceHash } from '../runtime/sync.mjs';
import { createVoiceoverStudio } from '../runtime/voiceover-studio.mjs';
import {
  acceptLatestEligibleVoiceoverTakes,
  acceptVoiceoverTake,
  buildVoiceoverAudioGraph,
  buildVoiceoverPrompts,
  createVoiceoverSession,
  deleteVoiceoverTake,
  finishVoiceover,
  readVoiceoverSession,
  rebaseVoiceoverSession,
  registerVoiceoverTake,
  uncoveredVoiceoverPrompts,
  verifyVoiceoverArtifacts,
  voiceoverPaths,
  voiceoverTimingFit,
  writeVoiceoverSessionState,
} from '../runtime/voiceover.mjs';

function writeVideo(file, { color = 'blue', duration = 2 } = {}) {
  const generated = spawnSync(ffmpegStatic, [
    '-v', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=320x240:r=25:d=${duration}`,
    '-f', 'lavfi',
    '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', String(duration),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    file,
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
}

function fixture({ validVideo = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-voiceover-test-'));
  const output = path.join(root, 'output');
  const workDir = path.join(root, 'work');
  fs.mkdirSync(output);
  fs.mkdirSync(workDir);
  const video = path.join(output, 'sample.mp4');
  if (validVideo) {
    writeVideo(video);
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

function editableFixture() {
  const files = fixture();
  const markdown = [
    '# Opening',
    '',
    'Repeat this. [Click Analytics.] Explain the [linked guide](https://example.com/guide).',
    '',
    '*[Open details.]*',
    '',
    'Final opening words.',
    '',
    '# Close',
    '',
    'Repeat this.',
    '',
  ].join('\r\n');
  const plan = parseDemoScript(markdown, { source: 'script.md' });
  plan.sourceHash = sourceHash(markdown);
  fs.writeFileSync(files.manifest.script, markdown);
  fs.writeFileSync(files.manifest.scenePlan, `${JSON.stringify(plan, null, 2)}\n`);
  return { ...files, markdown, plan };
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

async function authenticateStudio(studio) {
  const launcherSource = fs.readFileSync(studio.launcher, 'utf8');
  const serializedUrl = launcherSource.match(
    /window\.location\.replace\(("(?:[^"\\]|\\.)*")\)/,
  )?.[1];
  assert.ok(serializedUrl, 'private launcher did not contain its bootstrap URL');
  const bootstrapUrl = new URL(JSON.parse(serializedUrl));
  const bootstrap = new URLSearchParams(bootstrapUrl.hash.slice(1)).get('bootstrap');
  assert.ok(bootstrap);
  assert.equal(bootstrapUrl.origin, new URL(studio.url).origin);
  assert.equal(bootstrapUrl.search, '');

  const response = await fetch(new URL('/auth/session', studio.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: new URL(studio.url).origin,
    },
    body: JSON.stringify({ bootstrap }),
  });
  assert.equal(response.status, 204);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.equal(fs.existsSync(studio.launcher), false);
  return {
    bootstrap,
    bootstrapUrl,
    cookie: setCookie.split(';', 1)[0],
    sessionToken: setCookie.match(/=([^;]+)/)?.[1],
  };
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

test('rebases scene takes onto unchanged narration with revised timing', () => {
  const files = fixture({ validVideo: true });
  const previous = createVoiceoverSession(files.manifest);
  const opening = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'opening',
    contentType: 'audio/wav',
    bytes: waveBuffer(1),
  });
  const close = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'close',
    contentType: 'audio/wav',
    bytes: waveBuffer(0.4),
  });
  acceptVoiceoverTake(files.manifest, opening.take.id);
  acceptVoiceoverTake(files.manifest, close.take.id);
  const master = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'master',
    contentType: 'audio/wav',
    bytes: waveBuffer(1),
  });
  acceptVoiceoverTake(files.manifest, master.take.id);

  writeVideo(files.manifest.output.video, { color: 'green', duration: 2.2 });
  fs.writeFileSync(files.manifest.output.timeline, `${JSON.stringify({
    meta: {
      finalDuration: 2.2,
      viewport: { width: 320, height: 240 },
      narration: { mode: 'macos-say' },
    },
    narrations: [
      { id: 'opening', finalStart: 0, duration: 1.5 },
      { id: 'close', finalStart: 1.5, duration: 0.6 },
    ],
  })}\n`);
  fs.writeFileSync(files.manifest.output.contactSheet, 'revised branded frames');

  const rebased = rebaseVoiceoverSession(files.manifest);
  assert.equal(rebased.rebased, true);
  assert.notEqual(rebased.directory, previous.directory);
  assert.equal(fs.existsSync(previous.directory), true);
  assert.equal(readVoiceoverSession(files.manifest).directory, rebased.directory);
  assert.deepEqual(
    rebased.state.takes.map((take) => take.id),
    [opening.take.id, close.take.id, master.take.id],
  );
  assert.equal(rebased.state.accepted.master, null);
  assert.deepEqual(rebased.state.accepted.scenes, {
    opening: opening.take.id,
    close: close.take.id,
  });
  assert.equal(rebased.state.takes[0].fit.windowDuration, 1.5);
  assert.equal(
    Math.abs(rebased.state.takes[1].fit.windowDuration - 0.7) < 0.000001,
    true,
  );
  assert.equal(rebased.rebase.timingChanges.length, 2);
  assert.equal(rebased.rebase.masterSelectionCleared, true);
  assert.deepEqual(rebased.state.completionWarnings, []);
  for (const take of rebased.state.takes) {
    assert.equal(fs.existsSync(path.join(rebased.directory, take.wave)), true);
    assert.equal(fs.existsSync(path.join(previous.directory, take.wave)), true);
  }

  const finished = finishVoiceover(files.manifest, { stdio: 'pipe' });
  assert.equal(finished.session, rebased.state.id);
  assert.equal(verifyVoiceoverArtifacts(files.manifest).session, rebased.state.id);
});

test('rejects voiceover rebase when narration changes or a shifted master is unsafe', () => {
  const changedNarration = fixture();
  const original = createVoiceoverSession(changedNarration.manifest);
  fs.appendFileSync(changedNarration.manifest.output.video, '-branding');
  fs.appendFileSync(changedNarration.manifest.script, '\nChanged narration.\n');
  assert.throws(
    () => rebaseVoiceoverSession(changedNarration.manifest),
    /Markdown script to be unchanged/,
  );
  assert.equal(readVoiceoverSession(changedNarration.manifest).directory, original.directory);

  fs.writeFileSync(
    changedNarration.manifest.script,
    '# Opening\n\nIntroduce the dashboard.\n',
  );
  const changedPlan = JSON.parse(
    fs.readFileSync(changedNarration.manifest.scenePlan, 'utf8'),
  );
  changedPlan.scenes[0].cues[0].text = 'Use different spoken words.';
  fs.writeFileSync(
    changedNarration.manifest.scenePlan,
    `${JSON.stringify(changedPlan)}\n`,
  );
  assert.throws(
    () => rebaseVoiceoverSession(changedNarration.manifest),
    /unchanged scene order and spoken text/,
  );
  assert.equal(readVoiceoverSession(changedNarration.manifest).directory, original.directory);

  const shiftedMaster = fixture();
  const masterSession = createVoiceoverSession(shiftedMaster.manifest);
  const master = registerVoiceoverTake({
    manifest: shiftedMaster.manifest,
    kind: 'master',
    contentType: 'audio/wav',
    bytes: waveBuffer(1),
  });
  acceptVoiceoverTake(shiftedMaster.manifest, master.take.id);
  fs.appendFileSync(shiftedMaster.manifest.output.video, '-branding');
  const shiftedTimeline = JSON.parse(
    fs.readFileSync(shiftedMaster.manifest.output.timeline, 'utf8'),
  );
  shiftedTimeline.narrations[1].finalStart = 1.5;
  fs.writeFileSync(
    shiftedMaster.manifest.output.timeline,
    `${JSON.stringify(shiftedTimeline)}\n`,
  );
  assert.throws(
    () => rebaseVoiceoverSession(shiftedMaster.manifest),
    /accepted full take cannot be safely rebased/,
  );
  assert.equal(readVoiceoverSession(shiftedMaster.manifest).directory, masterSession.directory);
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
  assert.deepEqual(uncoveredVoiceoverPrompts(state), []);

  state.takes[1].effectiveDuration = 2;
  state.takes[1].fit = voiceoverTimingFit(2, 1.5);
  const trimmed = buildVoiceoverAudioGraph(state);
  assert.match(trimmed.filters.join('\n'), /atrim=start=0\.05:duration=1\.5/);
  assert.doesNotMatch(trimmed.filters.join('\n'), /atempo/);
  assert.equal(voiceoverTimingFit(1.505, 1.5).status, 'tight');
  state.accepted.master = null;
  state.accepted.scenes = {};
  assert.deepEqual(
    uncoveredVoiceoverPrompts(state).map((prompt) => prompt.sceneId),
    ['opening'],
  );
});

test('records 48 kHz takes and finishes a separate human-voice video', () => {
  const files = fixture({ validVideo: true });
  const session = createVoiceoverSession(files.manifest);
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
  assert.throws(
    () => acceptVoiceoverTake(files.manifest, over.take.id),
    /overlong voiceover take cannot be accepted/,
  );
  const allowedOver = acceptVoiceoverTake(
    files.manifest,
    over.take.id,
    null,
    { allowOverlong: true },
  );
  assert.equal(allowedOver.accepted.scenes.opening, over.take.id);
  assert.equal(allowedOver.selection.overlong, true);
  assert.equal(allowedOver.selection.trimmedSeconds > 0, true);
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
  assert.equal(boundaryStopped.state.accepted.scenes.opening, over.take.id);
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
  const discardedFiles = [over.take, boundaryStopped.take].flatMap((take) =>
    [take.source, take.wave].map((file) => path.resolve(session.directory, file)));
  assert.equal(discardedFiles.every((file) => fs.existsSync(file)), true);
  const latest = acceptLatestEligibleVoiceoverTakes(
    files.manifest,
    null,
    { cleanup: true },
  );
  assert.deepEqual(
    latest.accepted,
    [
      { sceneId: 'opening', takeId: opening.take.id },
      { sceneId: 'close', takeId: close.take.id },
    ],
  );
  assert.equal(latest.selected, 2);
  assert.equal(latest.deleted, 2);
  assert.deepEqual(latest.state.takes.map((take) => take.id), [
    opening.take.id,
    close.take.id,
  ]);
  assert.equal(discardedFiles.every((file) => !fs.existsSync(file)), true);
  const accidentalMaster = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'master',
    contentType: 'audio/wav',
    bytes: waveBuffer(1),
  });
  const accidentalFiles = [accidentalMaster.take.source, accidentalMaster.take.wave]
    .map((file) => path.resolve(session.directory, file));
  assert.equal(accidentalFiles.every((file) => fs.existsSync(file)), true);
  const deleted = deleteVoiceoverTake(files.manifest, accidentalMaster.take.id);
  assert.equal(deleted.deleted.kind, 'master');
  assert.equal(
    deleted.state.takes.some((take) => take.id === accidentalMaster.take.id),
    false,
  );
  assert.equal(accidentalFiles.every((file) => !fs.existsSync(file)), true);
  assert.throws(
    () => deleteVoiceoverTake(files.manifest, opening.take.id),
    /in-use take must be replaced or cleared/,
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

test('edits only mapped narration, synchronizes state, and invalidates stale wording', () => {
  const files = editableFixture();
  const created = createVoiceoverSession(files.manifest);
  const state = prepareVoiceoverNarrationEditor(files.manifest, created.directory);
  const opening = state.authoring.scenes.opening;
  assert.equal(opening.editable, true);
  assert.equal(opening.cues.length, 3);
  assert.equal(state.authoring.scenes.close.editable, true);
  const promptBefore = state.prompts.find((prompt) => prompt.sceneId === 'opening');
  const timingBefore = {
    start: promptBefore.start,
    end: promptBefore.end,
    windowDuration: promptBefore.windowDuration,
  };
  const actionIds = files.plan.scenes[0].actions.map((action) => action.id);
  const cueIds = files.plan.scenes[0].cues.map((cue) => cue.id);
  const lockedScript = fs.readFileSync(
    path.join(created.directory, 'picture-lock', 'script.md'),
    'utf8',
  );

  const openingTake = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'opening',
    contentType: 'audio/wav',
    bytes: waveBuffer(0.5),
  }).take;
  const closeTake = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'close',
    contentType: 'audio/wav',
    bytes: waveBuffer(0.3),
  }).take;
  const fullTake = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'master',
    contentType: 'audio/wav',
    bytes: waveBuffer(0.8),
  }).take;
  acceptVoiceoverTake(files.manifest, openingTake.id);
  acceptVoiceoverTake(files.manifest, closeTake.id);
  acceptVoiceoverTake(files.manifest, fullTake.id);

  const request = {
    sceneId: 'opening',
    cues: opening.cues.map((cue, index) => ({
      id: cue.id,
      text: index === 0 ? 'Updated opening words.' : cue.text,
    })),
    expectedScriptHash: state.authoring.scriptHash,
    expectedScenePlanHash: state.authoring.scenePlanHash,
    expectedNarrationRevision: opening.narrationRevision,
  };
  assert.throws(
    () => updateVoiceoverNarration(files.manifest, request, created.directory),
    /Confirm that prior recordings/,
  );
  const updated = updateVoiceoverNarration(
    files.manifest,
    { ...request, confirmTakeInvalidation: true },
    created.directory,
  );
  assert.equal(updated.changed, true);
  assert.equal(updated.invalidated.sceneTakes, 1);
  assert.equal(updated.invalidated.fullTakes, 1);
  assert.equal(fs.existsSync(updated.backups.script), true);
  assert.equal(fs.existsSync(updated.backups.scenePlan), true);
  assert.equal(fs.readFileSync(updated.backups.script, 'utf8'), files.markdown);

  const markdown = fs.readFileSync(files.manifest.script, 'utf8');
  assert.match(markdown, /Updated opening words\. \[Click Analytics\.\]/);
  assert.match(markdown, /\[linked guide]\(https:\/\/example\.com\/guide\)/);
  assert.match(markdown, /\*\[Open details\.\]\*/);
  assert.match(markdown, /# Close\r\n\r\nRepeat this\./);
  assert.doesNotMatch(markdown, /(^|[^\r])\n/);
  assert.equal(
    fs.readFileSync(path.join(created.directory, 'picture-lock', 'script.md'), 'utf8'),
    lockedScript,
  );

  const plan = JSON.parse(fs.readFileSync(files.manifest.scenePlan, 'utf8'));
  assert.deepEqual(plan.scenes[0].actions.map((action) => action.id), actionIds);
  assert.deepEqual(plan.scenes[0].cues.map((cue) => cue.id), cueIds);
  assert.equal(plan.scenes[0].narration.startsWith('Updated opening words.'), true);
  const prompt = updated.state.prompts.find((entry) => entry.sceneId === 'opening');
  assert.match(prompt.text, /^Updated opening words\./);
  assert.deepEqual(
    {
      start: prompt.start,
      end: prompt.end,
      windowDuration: prompt.windowDuration,
    },
    timingBefore,
  );
  assert.equal(updated.state.accepted.master, null);
  assert.equal(updated.state.accepted.scenes.opening, undefined);
  assert.equal(updated.state.accepted.scenes.close, closeTake.id);
  assert.equal(updated.state.takes.find((take) => take.id === openingTake.id).stale, true);
  assert.equal(updated.state.takes.find((take) => take.id === fullTake.id).stale, true);
  assert.equal(updated.state.takes.find((take) => take.id === closeTake.id).stale, undefined);
  assert.throws(
    () => acceptVoiceoverTake(files.manifest, openingTake.id),
    /stale narration/,
  );
  const latest = acceptLatestEligibleVoiceoverTakes(files.manifest);
  assert.equal(latest.selected, 1);
  assert.deepEqual(latest.accepted, []);

  updated.state.accepted.master = fullTake.id;
  writeVoiceoverSessionState({ directory: created.directory, state: updated.state });
  assert.throws(
    () => finishVoiceover(files.manifest, { stdio: 'pipe' }),
    /stale narration/,
  );
  assert.throws(
    () => verifyVoiceoverArtifacts(files.manifest),
    /stale narration/,
  );
});

test('rejects empty, unsafe, externally changed, and concurrent narration saves', () => {
  const files = editableFixture();
  const created = createVoiceoverSession(files.manifest);
  const state = prepareVoiceoverNarrationEditor(files.manifest, created.directory);
  const opening = state.authoring.scenes.opening;
  const base = {
    sceneId: 'opening',
    expectedScriptHash: state.authoring.scriptHash,
    expectedScenePlanHash: state.authoring.scenePlanHash,
    expectedNarrationRevision: opening.narrationRevision,
  };
  assert.throws(
    () => updateVoiceoverNarration(
      files.manifest,
      {
        ...base,
        cues: opening.cues.map((cue, index) => ({
          id: cue.id,
          text: index === 0 ? '   ' : cue.text,
        })),
      },
      created.directory,
    ),
    /cannot be empty/,
  );
  assert.throws(
    () => updateVoiceoverNarration(
      files.manifest,
      {
        ...base,
        cues: opening.cues.map((cue, index) => ({
          id: cue.id,
          text: index === 0 ? '[Click a different target.]' : cue.text,
        })),
      },
      created.directory,
    ),
    /change scene structure or stage directions/,
  );
  assert.equal(fs.readFileSync(files.manifest.script, 'utf8'), files.markdown);

  const first = updateVoiceoverNarration(
    files.manifest,
    {
      ...base,
      cues: opening.cues.map((cue, index) => ({
        id: cue.id,
        text: index === 0 ? 'First safe revision.' : cue.text,
      })),
    },
    created.directory,
  );
  assert.equal(first.changed, true);
  assert.throws(
    () => updateVoiceoverNarration(
      files.manifest,
      {
        ...base,
        cues: opening.cues.map((cue, index) => ({
          id: cue.id,
          text: index === 0 ? 'Concurrent stale revision.' : cue.text,
        })),
      },
      created.directory,
    ),
    /changed outside Voiceover Studio/,
  );
  assert.match(fs.readFileSync(files.manifest.script, 'utf8'), /First safe revision/);

  const reopened = prepareVoiceoverNarrationEditor(files.manifest, created.directory);
  fs.appendFileSync(files.manifest.script, '\r\n<!-- external edit -->\r\n');
  const currentOpening = reopened.authoring.scenes.opening;
  assert.throws(
    () => updateVoiceoverNarration(
      files.manifest,
      {
        sceneId: 'opening',
        cues: currentOpening.cues.map((cue, index) => ({
          id: cue.id,
          text: index === 0 ? 'Would overwrite external work.' : cue.text,
        })),
        expectedScriptHash: reopened.authoring.scriptHash,
        expectedScenePlanHash: reopened.authoring.scenePlanHash,
        expectedNarrationRevision: currentOpening.narrationRevision,
      },
      created.directory,
    ),
    /changed outside Voiceover Studio/,
  );
  assert.match(fs.readFileSync(files.manifest.script, 'utf8'), /external edit/);
});

test('migrates legacy take revisions at Studio open and invalidates them on first edit', () => {
  const files = editableFixture();
  const created = createVoiceoverSession(files.manifest);
  const legacyTake = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'opening',
    contentType: 'audio/wav',
    bytes: waveBuffer(0.4),
  }).take;
  const legacy = readVoiceoverSession(files.manifest, created.directory);
  delete legacy.state.narration;
  delete legacy.state.authoring;
  delete legacy.state.takes[0].narrationRevision;
  legacy.state.version = 2;
  writeVoiceoverSessionState(legacy);

  const migrated = prepareVoiceoverNarrationEditor(files.manifest, created.directory);
  assert.match(migrated.takes[0].narrationRevision, /^sha256:/);
  assert.match(migrated.narration.openingRevision, /^sha256:/);
  assert.equal(migrated.takes[0].stale, undefined);
  assert.ok(migrated.narration.legacyTakesMigratedAt);

  const opening = migrated.authoring.scenes.opening;
  const result = updateVoiceoverNarration(
    files.manifest,
    {
      sceneId: 'opening',
      cues: opening.cues.map((cue, index) => ({
        id: cue.id,
        text: index === 0 ? 'Legacy migration revision.' : cue.text,
      })),
      expectedScriptHash: migrated.authoring.scriptHash,
      expectedScenePlanHash: migrated.authoring.scenePlanHash,
      expectedNarrationRevision: opening.narrationRevision,
      confirmTakeInvalidation: true,
    },
    created.directory,
  );
  assert.equal(
    result.state.takes.find((take) => take.id === legacyTake.id).stale,
    true,
  );
});

test('uses the latest Studio narration snapshot for a later guarded picture rebase', () => {
  const files = editableFixture();
  const previous = createVoiceoverSession(files.manifest);
  const state = prepareVoiceoverNarrationEditor(files.manifest, previous.directory);
  const opening = state.authoring.scenes.opening;
  updateVoiceoverNarration(
    files.manifest,
    {
      sceneId: 'opening',
      cues: opening.cues.map((cue, index) => ({
        id: cue.id,
        text: index === 0 ? 'Authoritative Studio revision.' : cue.text,
      })),
      expectedScriptHash: state.authoring.scriptHash,
      expectedScenePlanHash: state.authoring.scenePlanHash,
      expectedNarrationRevision: opening.narrationRevision,
    },
    previous.directory,
  );
  fs.appendFileSync(files.manifest.output.video, '-revised-picture');
  fs.writeFileSync(files.manifest.output.contactSheet, 'revised contact sheet');

  const rebased = rebaseVoiceoverSession(files.manifest);
  assert.equal(rebased.rebased, true);
  assert.notEqual(rebased.directory, previous.directory);
  assert.match(rebased.state.prompts[0].text, /^Authoritative Studio revision\./);
  assert.equal(
    fs.readFileSync(path.join(rebased.directory, 'picture-lock', 'script.md'), 'utf8'),
    fs.readFileSync(files.manifest.script, 'utf8'),
  );
  assert.equal(
    fs.readFileSync(path.join(previous.directory, 'picture-lock', 'script.md'), 'utf8'),
    files.markdown,
  );
});

test('bootstraps a private Studio session without auth in URLs or responses', async () => {
  const files = fixture();
  const logs = [];
  const studio = await createVoiceoverStudio(files.manifest, {
    open: false,
    logger: { error: (message) => logs.push(message) },
  });
  const publicUrl = new URL(studio.url);
  assert.equal(publicUrl.search, '');
  assert.equal(publicUrl.hash, '');
  assert.equal(fs.statSync(studio.launcher).mode & 0o077, 0);

  const bootstrapPage = await fetch(studio.url);
  assert.equal(bootstrapPage.status, 200);
  const bootstrapHtml = await bootstrapPage.text();
  assert.match(bootstrapHtml, /window\.history\.replaceState/);
  assert.ok(
    bootstrapHtml.indexOf('window.history.replaceState') <
      bootstrapHtml.indexOf("fetch('/auth/session'"),
  );
  assert.doesNotMatch(bootstrapHtml, /bootstrap=[a-f0-9]{64}/);
  assert.doesNotMatch(bootstrapHtml, /Record full take/);

  const unauthorized = await fetch(new URL('/api/session', studio.url));
  assert.equal(unauthorized.status, 403);
  assert.equal(await unauthorized.text(), 'Voiceover studio authorization required');

  const auth = await authenticateStudio(studio);
  const ordinaryOutput = JSON.stringify({
    voiceoverStudio: studio.url,
    session: studio.directory,
  });
  assert.doesNotMatch(ordinaryOutput, new RegExp(auth.bootstrap));
  assert.doesNotMatch(ordinaryOutput, new RegExp(auth.sessionToken));
  assert.doesNotMatch(studio.launcher, new RegExp(auth.bootstrap));
  assert.doesNotMatch(studio.launcher, new RegExp(auth.sessionToken));
  const reused = await fetch(new URL('/auth/session', studio.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: publicUrl.origin,
    },
    body: JSON.stringify({ bootstrap: auth.bootstrap }),
  });
  assert.equal(reused.status, 403);

  const request = (pathname, options = {}) => fetch(new URL(pathname, studio.url), {
    ...options,
    headers: {
      cookie: auth.cookie,
      ...(!['GET', 'HEAD'].includes(options.method ?? 'GET')
        ? { origin: publicUrl.origin }
        : {}),
      ...options.headers,
    },
  });
  const crossOriginMutation = await request('/api/accept-latest', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:1' },
  });
  assert.equal(crossOriginMutation.status, 403);
  assert.equal(
    await crossOriginMutation.text(),
    'Voiceover studio authorization required',
  );
  const crossOriginNarration = await request('/api/narration', {
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:1',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(crossOriginNarration.status, 403);
  assert.equal(
    await crossOriginNarration.text(),
    'Voiceover studio authorization required',
  );
  const page = await request('/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /The video is always muted/);
  assert.match(html, /data-play-take/);
  assert.match(html, /data-stop-take/);
  assert.match(html, /Use latest eligible takes/);
  assert.match(html, /Use anyway/);
  assert.match(html, /data-delete-take/);
  assert.match(html, /Delete other takes after selection/);
  assert.match(
    html,
    /<div class="prompt">[\s\S]*?<button id="edit-narration" class="secondary" type="button">Edit<\/button>/,
  );
  assert.match(html, /id="narration-editor-form" hidden/);
  assert.match(html, /id="narration-cue-editors" class="prompt-cue-editors"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /narrationEditing \? 'Save narration' : 'Edit narration'/);
  assert.match(html, /event\.key !== 'Escape'/);
  assert.doesNotMatch(html, /Selected scene narration/);
  assert.doesNotMatch(html, /id="save-narration"/);
  assert.doesNotMatch(html, /class="narration-editor"/);
  assert.ok(
    html.indexOf('<button id="record-scene">Record selected scene</button>') <
      html.indexOf('<button id="record-master" class="secondary">Record full take</button>'),
  );
  assert.doesNotMatch(
    html,
    /id="record-scene" class="secondary"/,
  );
  assert.match(html, /Voiceover session saved/);
  assert.match(html, /Finish and verify the saved human-voiceover video/);
  assert.match(html, /Copy handoff prompt/);
  assert.match(html, /a clickable link to the finished video/);
  assert.match(html, /Reopen the existing human voiceover studio for this demo/);
  assert.doesNotMatch(html, /--new-session/);
  assert.doesNotMatch(html, /<h2>Take history<\/h2>/);
  assert.doesNotMatch(html, new RegExp(auth.bootstrap));
  assert.doesNotMatch(html, new RegExp(auth.sessionToken));
  assert.match(html, /window\.history\.replaceState/);

  const session = await request('/api/session');
  assert.equal(session.status, 200);
  const firstState = await session.json();
  const invalidNarration = await request('/api/narration', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sceneId: 'opening',
      cues: firstState.authoring.scenes.opening.cues.map((cue) => ({
        id: cue.id,
        text: ' ',
      })),
      expectedScriptHash: firstState.authoring.scriptHash,
      expectedScenePlanHash: firstState.authoring.scenePlanHash,
      expectedNarrationRevision:
        firstState.authoring.scenes.opening.narrationRevision,
    }),
  });
  assert.equal(invalidNarration.status, 400);
  assert.equal(await invalidNarration.text(), 'Spoken narration cannot be empty.');
  const take = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'opening',
    contentType: 'audio/wav',
    bytes: waveBuffer(1),
    sessionDir: studio.directory,
  });
  const audioUrl = new URL('/api/take-audio', studio.url);
  audioUrl.searchParams.set('takeId', take.take.id);
  const audio = await request(audioUrl, { headers: { range: 'bytes=0-31' } });
  assert.equal(audio.status, 206);
  assert.equal(audio.headers.get('content-type'), 'audio/wav');
  assert.equal(audio.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal((await audio.arrayBuffer()).byteLength, 32);
  assert.equal((await fetch(audioUrl)).status, 403);

  const diagnosticId = `${auth.bootstrap}-${auth.sessionToken}-${files.root}`;
  const sanitized = await request('/api/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ takeId: diagnosticId }),
  });
  assert.equal(sanitized.status, 400);
  const sanitizedBody = await sanitized.text();
  assert.equal(sanitizedBody, 'Voiceover request could not be completed');
  assert.doesNotMatch(sanitizedBody, /Error|at\s|demo-voiceover-test|[a-f0-9]{64}/);
  assert.match(logs.at(-1), /Unknown voiceover take/);
  assert.match(logs.at(-1), /\[REDACTED\]/);
  assert.match(logs.at(-1), new RegExp(files.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(logs.join('\n'), new RegExp(auth.bootstrap));
  assert.doesNotMatch(logs.join('\n'), new RegExp(auth.sessionToken));

  const latest = await request('/api/accept-latest', { method: 'POST' });
  assert.equal(latest.status, 200);
  assert.equal((await latest.json()).accepted[0].takeId, take.take.id);
  const replacement = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'scene',
    sceneId: 'opening',
    contentType: 'audio/wav',
    bytes: waveBuffer(2),
    sessionDir: studio.directory,
  });
  const accepted = await request('/api/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      takeId: replacement.take.id,
      cleanup: true,
      allowOverlong: true,
    }),
  });
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.cleanup.deleted, 1);
  assert.equal(acceptedBody.selection.overlong, true);
  assert.equal(
    [take.take.source, take.take.wave].every(
      (file) => !fs.existsSync(path.resolve(studio.directory, file)),
    ),
    true,
  );
  const accidentalMaster = registerVoiceoverTake({
    manifest: files.manifest,
    kind: 'master',
    contentType: 'audio/wav',
    bytes: waveBuffer(0.5),
    sessionDir: studio.directory,
  });
  const deleted = await request('/api/delete-take', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ takeId: accidentalMaster.take.id }),
  });
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).deleted.id, accidentalMaster.take.id);
  await assert.rejects(
    createVoiceoverStudio(files.manifest, { open: false }),
    /already open/,
  );
  const newer = await createVoiceoverStudio(files.manifest, {
    open: false,
    newSession: true,
  });
  const newerAuth = await authenticateStudio(newer);
  const newerRequest = (pathname, options = {}) => fetch(new URL(pathname, newer.url), {
    ...options,
    headers: {
      cookie: newerAuth.cookie,
      ...(!['GET', 'HEAD'].includes(options.method ?? 'GET')
        ? { origin: new URL(newer.url).origin }
        : {}),
      ...options.headers,
    },
  });
  const oldSession = await request('/api/session').then((response) => response.json());
  assert.equal(oldSession.id, firstState.id);
  const newerState = await newerRequest('/api/session').then((response) => response.json());
  assert.notEqual(oldSession.id, newerState.id);
  const blockedCompletion = await request('/api/complete', { method: 'POST' });
  assert.equal(blockedCompletion.status, 400);
  assert.equal(await blockedCompletion.text(), 'Voiceover session cannot be completed');
  const completed = await request('/api/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allowMissing: true }),
  });
  assert.equal(completed.status, 200);
  assert.match(completed.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await completed.json()).completionWarnings.length, 1);
  assert.equal((await studio.done).completedAt !== null, true);
  await newer.close();

  const expiring = await createVoiceoverStudio(files.manifest, {
    open: false,
    newSession: true,
    bootstrapTtlMs: 10,
  });
  const expired = await expiring.done;
  assert.equal(expired.reason, 'bootstrap-expired');
  assert.equal(fs.existsSync(expiring.launcher), false);
  const reopened = await createVoiceoverStudio(files.manifest, { open: false });
  await reopened.close();
});
