import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeScaffold } from '../runtime/scaffold.mjs';
import { syncScenePlan } from '../runtime/sync.mjs';

function fixture(markdown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narrated-sync-test-'));
  const script = path.join(root, 'demo.md');
  const app = path.join(root, 'app');
  const output = path.join(root, 'demos', 'example');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), '{}');
  fs.writeFileSync(script, markdown);
  writeScaffold({
    script,
    url: 'http://localhost:5173',
    id: 'example',
    appCwd: app,
    outputDir: output,
  });
  return {
    root,
    script,
    output,
    manifest: path.join(output, 'demo.yaml'),
    plan: path.join(output, 'scene-plan.json'),
  };
}

test('sync preserves scene IDs for wording-only changes', () => {
  const files = fixture('# Opening\n\nOriginal words.\n\n*[Open dashboard.]*\n');
  const original = JSON.parse(fs.readFileSync(files.plan, 'utf8'));
  original.scenes[0].id = 'intro';
  original.scenes[0].actions[0].id = 'show-dashboard';
  fs.writeFileSync(files.plan, `${JSON.stringify(original, null, 2)}\n`);
  fs.writeFileSync(
    files.script,
    '# Opening\n\nImproved spoken words.\n\nA second sentence.\n\n*[Open dashboard.]*\n',
  );

  const result = syncScenePlan({ manifestPath: files.manifest });
  assert.equal(result.mode, 'preview');
  assert.equal(result.written, false);
  assert.equal(result.plan.scenes[0].id, 'intro');
  assert.equal(result.plan.scenes[0].actions[0].id, 'show-dashboard');
  assert.deepEqual(result.diff.scenes.changed, [{ id: 'intro', fields: ['narration'] }]);
  assert.deepEqual(result.diff.actions.changed, []);
  assert.deepEqual(result.diff.classification, {
    label: 'narration-only',
    kinds: ['narration'],
    driverReviewRequired: false,
  });
});

test('sync reports changed directions while preserving action IDs', () => {
  const files = fixture('# Proof\n\nThe result passed.\n\n*[Open evidence.]*\n');
  const before = JSON.parse(fs.readFileSync(files.plan, 'utf8'));
  const actionId = before.scenes[0].actions[0].id;
  fs.writeFileSync(files.script, '# Proof\n\nThe result passed.\n\n*[Open verification evidence.]*\n');

  const result = syncScenePlan({ manifestPath: files.manifest });
  assert.equal(result.plan.scenes[0].actions[0].id, actionId);
  assert.deepEqual(result.diff.actions.changed, [`proof/${actionId}`]);
  assert.deepEqual(result.diff.scenes.changed, [{ id: 'proof', fields: ['actions'] }]);
  assert.deepEqual(result.diff.classification, {
    label: 'choreography-only',
    kinds: ['choreography'],
    driverReviewRequired: true,
  });
});

test('sync classifies explicit timing changes without requiring driver review', () => {
  const files = fixture(
    '<!-- demo:scene {"id":"opening","timing":{"duration":10}} -->\n\nOriginal words.\n',
  );
  fs.writeFileSync(
    files.script,
    '<!-- demo:scene {"id":"opening","timing":{"duration":14}} -->\n\nOriginal words.\n',
  );

  const result = syncScenePlan({ manifestPath: files.manifest });
  assert.deepEqual(result.diff.scenes.changed, [{ id: 'opening', fields: ['timing'] }]);
  assert.deepEqual(result.diff.classification, {
    label: 'timing-only',
    kinds: ['timing'],
    driverReviewRequired: false,
  });
});

test('sync excludes appendices, internal notes, and captions', () => {
  const files = fixture('# Demo\n\nSpoken.\n');
  fs.writeFileSync(files.script, `# Demo

Spoken.

# Internal notes

Never narrate this.

# Captions

Nor this.

# Appendix — source material

Never this either.
`);
  const result = syncScenePlan({ manifestPath: files.manifest });
  assert.deepEqual(result.plan.scenes.map(({ id }) => id), ['demo']);
  assert.equal(result.plan.scenes[0].narration, 'Spoken.');
});

test('sync reports added and removed scenes', () => {
  const files = fixture('# Opening\n\nHello.\n\n# Old ending\n\nGoodbye.\n');
  fs.writeFileSync(files.script, '# Opening\n\nHello.\n\n# New proof\n\nPassed.\n');
  const result = syncScenePlan({ manifestPath: files.manifest });
  assert.deepEqual(result.diff.scenes.added, ['new-proof']);
  assert.deepEqual(result.diff.scenes.removed, ['old-ending']);
});

test('sync writes atomically with a unique backup and then becomes clean', () => {
  const files = fixture('# Opening\n\nOriginal.\n');
  const original = fs.readFileSync(files.plan, 'utf8');
  fs.writeFileSync(files.script, '# Opening\n\nUpdated.\n');

  const written = syncScenePlan({ manifestPath: files.manifest, write: true });
  assert.equal(written.written, true);
  assert.equal(fs.existsSync(written.backup), true);
  assert.equal(fs.readFileSync(written.backup, 'utf8'), original);
  assert.equal(
    fs.readdirSync(files.output).some((name) => name.includes('.tmp-')),
    false,
  );
  assert.equal(JSON.parse(fs.readFileSync(files.plan, 'utf8')).scenes[0].narration, 'Updated.');

  const clean = syncScenePlan({ manifestPath: files.manifest });
  assert.equal(clean.diff.changed, false);
  assert.equal(clean.written, false);
});
