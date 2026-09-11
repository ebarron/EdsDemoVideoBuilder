import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserHelpers } from '../runtime/browser.mjs';

function harness({ count = 1, pace = 1 } = {}) {
  const moves = [];
  const pauses = [];
  const typed = [];
  const actions = [];
  const locator = {
    count: async () => count,
    first() {
      return this;
    },
    waitFor: async () => {},
    scrollIntoViewIfNeeded: async () => {},
    boundingBox: async () => ({ x: 100, y: 200, width: 40, height: 20 }),
    press: async () => {},
    pressSequentially: async (text, options) => typed.push({ text, options }),
  };
  const timeline = {
    elapsed: () => 1,
    markAction(id, kind, details) {
      const action = { id, kind, details, at: 1 };
      actions.push(action);
      return action;
    },
  };
  const page = {
    evaluate: async () => ({ x: 50, y: 50 }),
    mouse: {
      move: async (x, y) => moves.push({ x, y }),
      down: async () => {},
      up: async () => {},
    },
  };
  const pause = async (milliseconds) => pauses.push(milliseconds);
  const helpers = createBrowserHelpers({
    page,
    timeline,
    pause,
    viewport: { width: 800, height: 600 },
    pace,
  });
  return { actions, helpers, locator, moves, pauses, typed };
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
  assert.equal(actions.at(-1).details.characters, 15);
});
