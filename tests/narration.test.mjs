import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureKokoroModel,
  kokoroSettings,
  splitKokoroText,
} from '../runtime/kokoro.mjs';
import { prepareNarration } from '../runtime/narration.mjs';

function baseManifest(mode = 'macos-say') {
  return {
    narration: {
      mode,
      voice: 'Samantha',
      rate: 160,
      defaultOffsetSeconds: 0.5,
      audioFirst: false,
    },
    timing: { rehearsalScale: 0.2 },
  };
}

function scenePlan() {
  return {
    scenes: [
      { id: 'opening', narration: 'This is the opening narration.' },
      { id: 'silent-scene', narration: '' },
    ],
  };
}

function writeWave(file, seconds = 1) {
  const sampleRate = 24000;
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
  fs.writeFileSync(file, buffer);
}

test('existing narration modes retain their synchronous rehearsal contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-existing-narration-'));
  for (const mode of ['macos-say', 'clips', 'reference', 'silent']) {
    const manifest = baseManifest(mode);
    if (mode === 'reference') {
      manifest.narration.referenceFile = path.join(root, 'reference.wav');
      fs.writeFileSync(manifest.narration.referenceFile, 'rehearsal does not probe audio');
    }
    if (mode === 'clips') manifest.narration.clipsDir = '/not-read-during-rehearsal';
    const result = prepareNarration({
      manifest,
      scenePlan: scenePlan(),
      workDir: '/not-written-during-rehearsal',
      rehearsal: true,
    });
    assert.equal(result instanceof Promise, false, `${mode} became asynchronous`);
    assert.equal(result.mode, mode);
    assert.equal(result.segments.size, 1);
    assert.equal(result.segments.get('opening').file, null);
  }
});

test('Kokoro rehearsal estimates timing without loading the optional runtime', async () => {
  const manifest = baseManifest('kokoro');
  manifest.narration.kokoro = {
    voice: 'af_heart',
    speed: 1,
    cacheDir: path.join(os.tmpdir(), 'missing-kokoro-runtime'),
    allowModelDownload: false,
  };
  const result = await prepareNarration({
    manifest,
    scenePlan: scenePlan(),
    workDir: '/not-written-during-rehearsal',
    rehearsal: true,
  });
  assert.equal(result.mode, 'kokoro');
  assert.equal(result.segments.get('opening').file, null);
  assert.equal(result.metadata.voice, 'af_heart');
  const normalDuration = result.segments.get('opening').duration;
  manifest.narration.kokoro.speed = 2;
  const faster = await prepareNarration({
    manifest,
    scenePlan: scenePlan(),
    workDir: '/not-written-during-rehearsal',
    rehearsal: true,
  });
  assert.equal(faster.segments.get('opening').duration, normalDuration / 2);
});

test('Kokoro production caches measured WAV clips by synthesis settings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-kokoro-test-'));
  const manifest = baseManifest('kokoro');
  manifest.narration.kokoro = {
    voice: 'af_heart',
    speed: 1,
    dtype: 'q8',
    device: 'cpu',
    cacheDir: path.join(root, 'cache'),
    allowModelDownload: false,
  };
  let generations = 0;
  const provider = {
    async generateScene(_text, output) {
      generations += 1;
      writeWave(output);
    },
  };
  const first = await prepareNarration({
    manifest,
    scenePlan: scenePlan(),
    workDir: path.join(root, 'take-one'),
    rehearsal: false,
    ffmpeg: 'ffmpeg',
    kokoroProvider: provider,
  });
  const second = await prepareNarration({
    manifest,
    scenePlan: scenePlan(),
    workDir: path.join(root, 'take-two'),
    rehearsal: false,
    ffmpeg: 'ffmpeg',
    kokoroProvider: provider,
  });

  assert.equal(generations, 1);
  assert.equal(first.segments.get('opening').cacheHit, false);
  assert.equal(second.segments.get('opening').cacheHit, true);
  assert.equal(first.segments.get('opening').duration > 0.9, true);
  assert.equal(fs.existsSync(second.segments.get('opening').file), true);
});

test('Kokoro remains outside normal dependencies and requires verified offline assets', () => {
  const packageFile = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(packageFile.dependencies?.['kokoro-js'], undefined);
  assert.equal(packageFile.optionalDependencies?.['kokoro-js'], undefined);
  const runtimePackage = JSON.parse(
    fs.readFileSync(new URL('../resources/kokoro-runtime/package.json', import.meta.url), 'utf8'),
  );
  const runtimeLock = JSON.parse(
    fs.readFileSync(
      new URL('../resources/kokoro-runtime/package-lock.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(runtimePackage.dependencies['kokoro-js'], '1.2.1');
  assert.equal(runtimeLock.packages['node_modules/kokoro-js'].version, '1.2.1');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-kokoro-offline-'));
  const settings = kokoroSettings({
    narration: {
      kokoro: {
        cacheDir: root,
        allowModelDownload: false,
      },
    },
  });
  assert.throws(
    () => ensureKokoroModel(settings),
    /model cache is incomplete.+allowModelDownload is false/,
  );
  assert.throws(
    () => kokoroSettings({
      narration: { kokoro: { cacheDir: path.join(root, 'work', 'models') } },
      output: { workDir: path.join(root, 'work') },
    }),
    /cacheDir and output\.workDir must not overlap/,
  );
  assert.throws(
    () => kokoroSettings({
      narration: { kokoro: { cacheDir: path.join(root, 'cache') } },
      output: { workDir: path.join(root, 'cache', 'models') },
    }),
    /cacheDir and output\.workDir must not overlap/,
  );
  assert.equal(
    splitKokoroText(
      `${'A '.repeat(200)}first sentence. ${'B '.repeat(200)}second sentence.`,
      300,
    ).every((chunk) => chunk.length <= 300),
    true,
  );
  assert.deepEqual(splitKokoroText('x'.repeat(701), 300).map((chunk) => chunk.length), [
    300,
    300,
    101,
  ]);
});
