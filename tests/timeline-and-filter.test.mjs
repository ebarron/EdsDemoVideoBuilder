import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRawVideoCoversTimeline,
  buildFilterGraph,
  videoClockBoundaries,
} from '../runtime/ffmpeg.mjs';
import { mapTime, validateCompressions } from '../runtime/timeline.mjs';

const compressions = [{ id: 'wait', start: 15, end: 25, target: 2 }];

test('maps raw time through observed wait compression', () => {
  assert.equal(mapTime(10, 10, compressions), 0);
  assert.equal(mapTime(15, 10, compressions), 5);
  assert.equal(mapTime(20, 10, compressions), 6);
  assert.equal(mapTime(30, 10, compressions), 12);
});

test('rejects overlapping or out-of-bound compression spans', () => {
  assert.throws(
    () => validateCompressions([
      { id: 'one', start: 11, end: 20, target: 2 },
      { id: 'two', start: 19, end: 22, target: 1 },
    ], 10, 30),
    /Overlapping/,
  );
  assert.throws(
    () => validateCompressions([{ id: 'bad', start: 9, end: 12, target: 1 }], 10, 30),
    /outside/,
  );
});

test('builds an explicitly bounded filter graph', () => {
  const plan = buildFilterGraph({
    timeline: {
      meta: {
        contentStart: 10,
        contentEnd: 30,
        viewport: { width: 1920, height: 1080 },
        narration: { mode: 'silent', referenceFile: null },
      },
      compressions,
      narrations: [],
      waits: [],
    },
  });
  const graph = plan.filters.join(';');
  assert.equal(plan.finalDuration, 12);
  assert.match(graph, /FAST FORWARD/);
  assert.match(graph, /atrim=duration=12/);
  assert.doesNotMatch(graph, /apad=/);
  assert.doesNotMatch(graph, /shortest/);
});

test('bounds mixed narration with finite pad and trim', () => {
  const plan = buildFilterGraph({
    timeline: {
      meta: {
        contentStart: 0,
        contentEnd: 5,
        viewport: { width: 1280, height: 720 },
        narration: { mode: 'clips', referenceFile: null },
      },
      compressions: [],
      narrations: [{ id: 'opening', start: 0.5, duration: 2, file: '/tmp/opening.wav' }],
      waits: [],
    },
  });
  const graph = plan.filters.join(';');
  assert.match(graph, /apad=whole_dur=5,atrim=duration=5/);
});

test('normalizes video trims without shifting narration output timing', () => {
  const plan = buildFilterGraph({
    timeline: {
      meta: {
        videoStart: 10,
        contentStart: 12,
        contentEnd: 32,
        viewport: { width: 1920, height: 1080 },
        narration: { mode: 'clips', referenceFile: null },
      },
      compressions: [{ id: 'wait', start: 17, end: 27, target: 2 }],
      narrations: [{ id: 'opening', start: 14, duration: 2, file: '/tmp/opening.wav' }],
      waits: [],
    },
  });
  const graph = plan.filters.join(';');
  assert.equal(plan.finalDuration, 12);
  assert.equal(plan.compressions[0].start, 17);
  assert.match(graph, /trim=start=2:end=7/);
  assert.match(graph, /trim=start=7:end=17/);
  assert.match(graph, /trim=start=17:end=22/);
  assert.match(graph, /adelay=2000:all=1/);
});

test('raw duration checks use the recorded-page clock and support legacy timelines', () => {
  const delayed = {
    meta: {
      videoStart: 0.583,
      contentStart: 2,
      contentEnd: 16.223,
    },
  };
  assert.doesNotThrow(() => assertRawVideoCoversTimeline(15.64, delayed));
  assert.throws(
    () => assertRawVideoCoversTimeline(15.4, delayed),
    /Raw video ends before its explicit content boundary/,
  );
  assert.deepEqual(videoClockBoundaries({
    meta: { contentStart: 10, contentEnd: 30 },
  }), {
    videoStart: 0,
    contentStart: 10,
    contentEnd: 30,
  });
});
