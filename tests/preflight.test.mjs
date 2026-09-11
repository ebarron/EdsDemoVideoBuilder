import assert from 'node:assert/strict';
import test from 'node:test';

import { driverReadiness } from '../runtime/preflight.mjs';

test('preflight allows rehearsal for an incomplete driver', () => {
  assert.deepEqual(
    driverReadiness({
      productionReady: false,
      todos: ['replace scaffold selectors'],
    }),
    {
      ok: true,
      productionReady: false,
      detail: 'not production-ready; rehearsal is allowed (replace scaffold selectors)',
    },
  );
});

test('preflight reports a production-ready driver separately', () => {
  assert.deepEqual(driverReadiness({ productionReady: true }), {
    ok: true,
    productionReady: true,
    detail: 'production-ready',
  });
});
