import assert from 'node:assert/strict';
import test from 'node:test';

import { appUrlCheckOptions, driverReadiness, supportedRecordingPlatform } from '../runtime/preflight.mjs';
import { studioLaunchSpec } from '../runtime/voiceover-studio.mjs';

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

test('recording is supported on macOS and Windows', () => {
  assert.equal(supportedRecordingPlatform('darwin'), true);
  assert.equal(supportedRecordingPlatform('win32'), true);
  assert.equal(supportedRecordingPlatform('linux'), false);
});

test('voiceover studio opens in the default browser on Windows', () => {
  assert.deepEqual(studioLaunchSpec('/tmp/studio.html', 'darwin'), {
    command: '/usr/bin/open',
    args: ['/tmp/studio.html'],
  });
  assert.deepEqual(
    studioLaunchSpec('C:\\Users\\demo\\studio.html', 'win32'),
    {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'start "" "C:\\Users\\demo\\studio.html"'],
      windowsVerbatimArguments: true,
    },
  );
  assert.equal(studioLaunchSpec('/tmp/studio.html', 'linux'), null);
});

test('preflight scopes insecure TLS to the manifest option', () => {
  assert.deepEqual(appUrlCheckOptions({ app: {} }), { allowInsecureTls: false });
  assert.deepEqual(
    appUrlCheckOptions({ app: { allowInsecureTls: true } }),
    { allowInsecureTls: true },
  );
});
