import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDemoScript } from '../runtime/parser.mjs';

test('parses legacy narration and stage directions', () => {
  const plan = parseDemoScript(`# Opening

This is spoken narration.

*[Open the dashboard.]*

> This blockquote is also spoken.

[Return to Review]
`, { source: 'demo.md' });
  assert.equal(plan.scenes.length, 1);
  assert.equal(plan.scenes[0].id, 'opening');
  assert.equal(
    plan.scenes[0].narration,
    'This is spoken narration.\n\nThis blockquote is also spoken.',
  );
  assert.deepEqual(
    plan.scenes[0].actions.map((action) => action.direction),
    ['Open the dashboard.', 'Return to Review'],
  );
});

test('parses explicit JSON scene and action comments', () => {
  const plan = parseDemoScript(`<!-- demo:scene {"id":"proof","title":"Proof"} -->
The outcome passed.
<!-- demo:action {"id":"show-proof","type":"click","success":"Passed is visible"} -->
`);
  assert.equal(plan.scenes[0].id, 'proof');
  assert.equal(plan.scenes[0].actions[0].id, 'show-proof');
  assert.equal(plan.scenes[0].actions[0].success, 'Passed is visible');
});

test('rejects malformed explicit comments with a line number', () => {
  assert.throws(
    () => parseDemoScript('<!-- demo:scene {bad} -->'),
    /line 1/,
  );
});

test('prefers a voiceover section in a larger design document', () => {
  const plan = parseDemoScript(`# Design

Not narration.

## Voiceover narrative (current demo)

Presenter guidance, not spoken.

### 0:00–0:24 — Overnight Review

This is spoken.

*[Open Review.]*

## Implementation

Not narration either.
`);
  assert.deepEqual(plan.scenes.map(({ id }) => id), ['overnight-review']);
  assert.equal(plan.scenes[0].title, 'Overnight Review');
  assert.equal(plan.scenes[0].narration, 'This is spoken.');
});
