import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadManifest } from '../runtime/config.mjs';
import { writeScaffold } from '../runtime/scaffold.mjs';

test('generates manifest, driver, normalized plan, and notes without overwrite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narrated-demo-test-'));
  const script = path.join(root, 'source.md');
  const app = path.join(root, 'app');
  const output = path.join(root, 'demos', 'example');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), '{}');
  fs.writeFileSync(script, '# Opening\n\nHello world.\n\n*[Open the details.]*\n');

  const result = writeScaffold({
    script,
    url: 'http://localhost:5173',
    id: 'Example Demo',
    appCwd: app,
    outputDir: output,
  });
  assert.equal(result.files.size, 4);
  for (const name of ['demo.yaml', 'driver.mjs', 'scene-plan.json', 'building-the-video.md']) {
    assert.equal(fs.existsSync(path.join(output, name)), true);
  }
  assert.match(
    JSON.parse(fs.readFileSync(path.join(output, 'scene-plan.json'), 'utf8')).sourceHash,
    /^sha256:[a-f0-9]{64}$/,
  );
  const generatedManifest = loadManifest(path.join(output, 'demo.yaml')).manifest;
  assert.equal(generatedManifest.id, 'example-demo');
  assert.equal(generatedManifest.app.allowInsecureTls, false);
  assert.throws(
    () => writeScaffold({
      script,
      url: 'http://localhost:5173',
      id: 'Example Demo',
      appCwd: app,
      outputDir: output,
    }),
    /Refusing to overwrite/,
  );
});
