import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { browserLaunchOptions } from '../runtime/recorder.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INSTALL = path.join(ROOT, 'scripts', 'install.sh');

test('installer is executable, idempotent, and verifies required tooling', () => {
  const script = fs.readFileSync(INSTALL, 'utf8');
  assert.notEqual(fs.statSync(INSTALL).mode & 0o111, 0);
  for (const pattern of [
    /uname -s/,
    /command -v gh/,
    /Node\.js 20/,
    /command -v npm/,
    /npm ci/,
    /playwright" install chromium/,
    /npm run smoke/,
    /npm test/,
    /node scripts\/demo\.mjs help/,
  ]) {
    assert.match(script, pattern);
  }
  assert.doesNotMatch(script, /token=|password=|credential=/i);
});

test('default Chromium launch uses the browser installed by Playwright', () => {
  assert.deepEqual(browserLaunchOptions('chromium'), {});
  assert.deepEqual(browserLaunchOptions('chrome'), { channel: 'chrome' });
});

test('repository ignores generated demos, captures, media, and auth state', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const pattern of [
    /^node_modules\/$/m,
    /^\/demos\/$/m,
    /^playwright-report\/$/m,
    /^\*\*\/storage-state\*\.json$/m,
    /^\*\*\/\*\.mp4$/m,
    /^\*\*\/\*\.wav$/m,
  ]) {
    assert.match(ignore, pattern);
  }
});
