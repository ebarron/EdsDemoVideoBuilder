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
  assert.deepEqual(
    plan.scenes[0].cues.map((cue) => ({
      id: cue.id,
      kind: cue.kind,
      value: cue.text ?? cue.actionId,
    })),
    [
      {
        id: 'opening-narration-1',
        kind: 'narration',
        value: 'This is spoken narration.',
      },
      {
        id: 'opening-action-1',
        kind: 'action',
        value: 'opening-action-1',
      },
      {
        id: 'opening-narration-2',
        kind: 'narration',
        value: 'This blockquote is also spoken.',
      },
      {
        id: 'opening-action-2',
        kind: 'action',
        value: 'opening-action-2',
      },
    ],
  );
});

test('keeps English square-bracket directions in narration order', () => {
  const plan = parseDemoScript(`# Analytics

This dashboard gives us the overview. [Click Analytics.] Now point to the morning peak.
`, { source: 'demo.md' });
  const scene = plan.scenes[0];
  assert.equal(
    scene.narration,
    'This dashboard gives us the overview. Now point to the morning peak.',
  );
  assert.deepEqual(scene.actions.map(({ direction }) => direction), ['Click Analytics.']);
  assert.deepEqual(
    scene.cues.map((cue) => cue.kind),
    ['narration', 'action', 'narration'],
  );
  assert.equal(scene.cues[0].source.startLine, 3);
  assert.equal(scene.cues[1].source.startLine, 3);
  assert.equal(scene.cues[2].source.startLine, 3);
});

test('does not treat ordinary Markdown links as inline directions', () => {
  const plan = parseDemoScript(
    '# Links\n\nRead the [Open issues](https://example.com/issues) guide first.\n',
  );
  assert.equal(
    plan.scenes[0].narration,
    'Read the [Open issues](https://example.com/issues) guide first.',
  );
  assert.deepEqual(plan.scenes[0].actions, []);
  assert.deepEqual(plan.scenes[0].cues.map((cue) => cue.kind), ['narration']);
});

test('parses explicit JSON scene and action comments', () => {
  const plan = parseDemoScript(`<!-- demo:scene {"id":"proof","title":"Proof"} -->
The outcome passed.
<!-- demo:action {"id":"show-proof","type":"click","success":"Passed is visible"} -->
`);
  assert.equal(plan.scenes[0].id, 'proof');
  assert.equal(plan.scenes[0].actions[0].id, 'show-proof');
  assert.equal(plan.scenes[0].actions[0].success, 'Passed is visible');
  assert.deepEqual(
    plan.scenes[0].cues.map((cue) => cue.kind),
    ['narration', 'action'],
  );
  assert.equal(plan.scenes[0].cues[1].actionId, 'show-proof');
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
