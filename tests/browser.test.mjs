import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserHelpers } from '../runtime/browser.mjs';

function harness({
  boxes = [{ x: 100, y: 200, width: 40, height: 20 }],
  count = 1,
  moveYield = false,
  pace = 1,
  pointerProof = {},
  scrollPositions = [0, 75, 150, 225, 300],
} = {}) {
  const evidenceCaptures = [];
  const moves = [];
  const pauses = [];
  const pageWaits = [];
  const typed = [];
  const actions = [];
  let boxIndex = 0;
  let activeMoves = 0;
  let instantScrolls = 0;
  let maxActiveMoves = 0;
  let scrollIndex = 0;
  const locator = {
    count: async () => count,
    first() {
      return this;
    },
    waitFor: async () => {},
    scrollIntoViewIfNeeded: async () => {
      instantScrolls += 1;
    },
    boundingBox: async () => boxes[Math.min(boxIndex++, boxes.length - 1)],
    evaluate: async (_callback, settings) => {
      if (settings?.duration) {
        return { start: 0, end: 300, final: 300 };
      }
      if (settings?.width !== undefined) {
        return {
          expectedBox: settings,
          hit: { ariaLabel: null, role: 'button', tag: 'BUTTON' },
          hitMatches: true,
          overlap: true,
          pointer: {
            x: settings.x + settings.width / 2,
            y: settings.y + settings.height / 2,
          },
          targetBox: settings,
          ...pointerProof,
        };
      }
      const scrollTop = scrollPositions[Math.min(scrollIndex++, scrollPositions.length - 1)];
      return {
        scrollTop,
        max: 300,
        clientHeight: 600,
        scrollHeight: 900,
        owner: 'document.scrollingElement',
      };
    },
    press: async () => {},
    pressSequentially: async (text, options) => typed.push({ text, options }),
  };
  const timeline = {
    scrolls: [],
    elapsed: () => 1,
    markAction(id, kind, details) {
      const action = { id, kind, at: 1, ...details };
      actions.push(action);
      return action;
    },
  };
  const page = {
    evaluate: async () => ({ x: 50, y: 50 }),
    mouse: {
      move: async (x, y) => {
        activeMoves += 1;
        maxActiveMoves = Math.max(maxActiveMoves, activeMoves);
        moves.push({ x, y });
        if (moveYield) await new Promise((resolve) => setImmediate(resolve));
        activeMoves -= 1;
      },
      down: async () => {},
      up: async () => {},
    },
    waitForTimeout: async (milliseconds) => pageWaits.push(milliseconds),
  };
  const pause = async (milliseconds) => pauses.push(milliseconds);
  const helpers = createBrowserHelpers({
    captureClickEvidence: async (id) => {
      evidenceCaptures.push(id);
      return `/tmp/${id}.png`;
    },
    page,
    timeline,
    pause,
    viewport: { width: 800, height: 600 },
    pace,
  });
  return {
    actions,
    evidenceCaptures,
    helpers,
    instantScrolls: () => instantScrolls,
    locator,
    moves,
    maxActiveMoves: () => maxActiveMoves,
    pageWaits,
    pauses,
    timeline,
    typed,
  };
}

test('recorded pointer travel is visible and paced', async () => {
  const { helpers, locator, moves, pauses } = harness();
  await helpers.point(locator, { id: 'target', hold: 0, steps: 3, travelMs: 900 });
  assert.equal(moves.length, 3);
  assert.deepEqual(moves.at(-1), { x: 120, y: 210 });
  assert.equal(pauses.reduce((total, value) => total + value, 0), 900);
});

test('recorded helpers reject ambiguous locators', async () => {
  const { helpers, locator } = harness({ count: 2 });
  await assert.rejects(
    helpers.click(locator, 'duplicate'),
    /Expected one scoped locator for duplicate, found 2/,
  );
});

test('viewer-facing text is entered sequentially at rehearsal pace', async () => {
  const { actions, helpers, locator, typed } = harness({ pace: 0.25 });
  await helpers.typeText(locator, 'Alert threshold', 'alert.name', {
    delayMs: 60,
    hold: 0,
    travelMs: 0,
  });
  assert.deepEqual(typed, [{ text: 'Alert threshold', options: { delay: 15 } }]);
  assert.equal(actions.at(-1).kind, 'type');
  assert.equal(actions.at(-1).characters, 15);
});

test('offscreen click targets scroll slowly by default', async () => {
  const { actions, helpers, instantScrolls, locator, pageWaits, timeline } = harness({
    boxes: [
      { x: 100, y: 700, width: 40, height: 20 },
      { x: 100, y: 700, width: 40, height: 20 },
      { x: 100, y: 700, width: 40, height: 20 },
      { x: 100, y: 100, width: 40, height: 20 },
    ],
  });
  await helpers.click(locator, 'below-fold', {
    downMs: 0,
    hold: 0,
    steps: 1,
    travelMs: 0,
  });
  assert.equal(instantScrolls(), 0);
  assert.equal(pageWaits.filter((value) => value === 400).length, 4);
  assert.equal(timeline.scrolls[0].id, 'below-fold.scroll');
  assert.ok(actions.some(({ id, kind }) => id === 'below-fold.scroll' && kind === 'smooth-scroll'));
});

test('jump scrolling requires an explicit override', async () => {
  const { helpers, instantScrolls, locator, timeline } = harness({
    boxes: [
      { x: 100, y: 700, width: 40, height: 20 },
      { x: 100, y: 700, width: 40, height: 20 },
      { x: 100, y: 700, width: 40, height: 20 },
      { x: 100, y: 100, width: 40, height: 20 },
    ],
  });
  await helpers.point(locator, {
    hold: 0,
    id: 'explicit-jump',
    scroll: 'instant',
    steps: 1,
    travelMs: 0,
  });
  assert.equal(instantScrolls(), 1);
  assert.equal(timeline.scrolls.length, 0);
});

test('pointer realigns when layout moves during travel', async () => {
  const original = { x: 100, y: 200, width: 40, height: 20 };
  const shifted = { x: 120, y: 200, width: 40, height: 20 };
  const { helpers, locator, moves } = harness({
    boxes: [original, original, original, shifted, shifted, shifted],
  });
  await helpers.point(locator, {
    hold: 0,
    id: 'moving-target',
    steps: 1,
    travelMs: 0,
  });
  assert.deepEqual(moves, [
    { x: 120, y: 210 },
    { x: 140, y: 210 },
  ]);
});

test('click rejects a visible pointer that misses the real hit target', async () => {
  const { helpers, locator } = harness({
    pointerProof: { hitMatches: false },
  });
  await assert.rejects(
    helpers.click(locator, 'covered-target', { hold: 0, travelMs: 0 }),
    /Visible pointer does not match the real hit target for covered-target/,
  );
});

test('critical clicks save click-time evidence', async () => {
  const { actions, evidenceCaptures, helpers, locator } = harness();
  await helpers.click(locator, 'critical-click', {
    downMs: 0,
    evidence: true,
    hold: 0,
    travelMs: 0,
  });
  assert.deepEqual(evidenceCaptures, ['critical-click']);
  assert.equal(actions.at(-1).evidenceFile, '/tmp/critical-click.png');
  assert.equal(actions.at(-1).pointerProof.overlap, true);
});

test('recorded motion helpers do not overlap', async () => {
  const { helpers, locator, maxActiveMoves } = harness({ moveYield: true });
  await Promise.all([
    helpers.point(locator, { hold: 0, id: 'first', steps: 2, travelMs: 0 }),
    helpers.point(locator, { hold: 0, id: 'second', steps: 2, travelMs: 0 }),
  ]);
  assert.equal(maxActiveMoves(), 1);
});
