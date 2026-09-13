import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifestObject } from '../runtime/config.mjs';

function manifest() {
  return {
    version: 1,
    compatibility: '>=1.0.0 <2.0.0',
    id: 'sample',
    script: './script.md',
    scenePlan: './scene-plan.json',
    driver: './driver.mjs',
    app: {
      url: 'http://localhost:5173',
      cwd: '.',
      lifecycle: { mode: 'external' },
    },
    browser: {
      channel: 'chrome',
      viewport: { width: 1920, height: 1080 },
      zoom: 1,
      colorScheme: 'light',
    },
    auth: {
      mode: 'driver',
      env: { username: 'DEMO_USERNAME', password: 'DEMO_PASSWORD' },
    },
    narration: {
      mode: 'macos-say',
      voice: 'Samantha',
      rate: 160,
      defaultOffsetSeconds: 0.5,
      audioFirst: false,
    },
    timing: {
      rehearsalScale: 0.15,
      compressionTargetSeconds: 2,
      fastForwardLabel: 'FAST FORWARD',
      tailPaddingMs: 400,
    },
    state: { policy: 'read-only', mutatingActions: false },
    output: {
      workDir: '/tmp/sample-demo',
      video: './output/sample.mp4',
      contactSheet: './output/sample-contact-sheet.png',
      timeline: './output/sample-timeline.json',
      notes: './building-the-video.md',
    },
  };
}

test('accepts environment references and version compatibility', () => {
  assert.deepEqual(validateManifestObject(manifest()), { valid: true, errors: [] });
});

test('accepts only a boolean per-demo insecure TLS option', () => {
  const enabled = manifest();
  enabled.app.allowInsecureTls = true;
  assert.equal(validateManifestObject(enabled).valid, true);

  const invalid = manifest();
  invalid.app.allowInsecureTls = 'true';
  const result = validateManifestObject(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /allowInsecureTls.+boolean/);
});

test('rejects literal secrets and unknown fields', () => {
  const value = manifest();
  value.auth.password = 'do-not-accept';
  const result = validateManifestObject(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /literal secret|additional properties/);
});

test('rejects a storage-state manifest without an environment reference', () => {
  const value = manifest();
  value.auth = { mode: 'storage-state', env: {} };
  assert.equal(validateManifestObject(value).valid, false);
});

test('allows audio-first only with supplied audio', () => {
  const value = manifest();
  value.narration.audioFirst = true;
  assert.match(
    validateManifestObject(value).errors.join('\n'),
    /requires clips or reference/,
  );
  value.narration = {
    mode: 'clips',
    clipsDir: './voice',
    defaultOffsetSeconds: 0.5,
    audioFirst: true,
  };
  assert.equal(validateManifestObject(value).valid, true);
});
