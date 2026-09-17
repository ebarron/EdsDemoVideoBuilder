import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { validateKokoroNarrationCoverage } from '../runtime/validator.mjs';

function hash(text) {
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

function fixture() {
  const narration = Array.from({ length: 616 }, (_, index) => `word${index}`).join(' ');
  const firstCharacters = narration
    .split(/\s+/)
    .slice(0, 308)
    .join('')
    .length;
  const totalCharacters = narration.replace(/\s+/g, '').length;
  const compact = narration.replace(/\s+/g, '');
  return {
    scenePlan: {
      scenes: [{ id: 'long-scene', narration }],
    },
    timeline: {
      meta: {
        finalDuration: 90,
        narration: { mode: 'kokoro' },
      },
      narrations: [{
        id: 'long-scene',
        duration: 80,
        finalStart: 2,
        coverage: {
          version: 1,
          complete: true,
          sourceHash: hash(narration),
          sourceCharacters: narration.length,
          sourceNonWhitespaceCharacters: totalCharacters,
          sourceNonWhitespaceHash: hash(compact),
          tokenLimit: 512,
          chunkCount: 2,
          maxTokenCount: 310,
          chunks: [
            {
              index: 0,
              sourceStart: 0,
              sourceEnd: firstCharacters,
              sourceHash: hash(compact.slice(0, firstCharacters)),
              tokenCount: 310,
              nonWhitespaceCharacters: firstCharacters,
            },
            {
              index: 1,
              sourceStart: firstCharacters,
              sourceEnd: totalCharacters,
              sourceHash: hash(compact.slice(firstCharacters)),
              tokenCount: 310,
              nonWhitespaceCharacters: totalCharacters - firstCharacters,
            },
          ],
        },
      }],
    },
  };
}

test('validates complete token-safe Kokoro narration coverage', () => {
  const { timeline, scenePlan } = fixture();
  const result = validateKokoroNarrationCoverage(timeline, scenePlan, [
    { start: 0, end: 1 },
    { start: 40, end: 42 },
  ]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.scenes.map((scene) => scene.id), ['long-scene']);
  assert.equal(result.scenes[0].maxTokenCount, 310);
});

test('rejects missing or stale Kokoro synthesis coverage', () => {
  const missing = fixture();
  delete missing.timeline.narrations[0].coverage;
  assert.throws(
    () => validateKokoroNarrationCoverage(missing.timeline, missing.scenePlan),
    /lacks complete, token-safe synthesis coverage/,
  );

  const stale = fixture();
  stale.timeline.narrations[0].coverage.sourceHash = hash('truncated');
  assert.throws(
    () => validateKokoroNarrationCoverage(stale.timeline, stale.scenePlan),
    /lacks complete, token-safe synthesis coverage/,
  );

  const omitted = fixture();
  omitted.timeline.narrations[0].coverage.chunks[0].sourceEnd -= 1;
  assert.throws(
    () => validateKokoroNarrationCoverage(omitted.timeline, omitted.scenePlan),
    /lacks complete, token-safe synthesis coverage/,
  );
});

test('rejects unexplained silence inside a Kokoro narration window', () => {
  const { timeline, scenePlan } = fixture();
  assert.throws(
    () => validateKokoroNarrationCoverage(timeline, scenePlan, [
      { start: 35, end: 70.3 },
    ]),
    /contains 35\.3s of unexplained silence/,
  );
});
