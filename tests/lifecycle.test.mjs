import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkUrl,
  lifecycleEnvironment,
  startLifecycle,
  waitForUrl,
} from '../runtime/lifecycle.mjs';

test('runtime never sets a process-wide TLS bypass', () => {
  const source = [
    '../runtime/lifecycle.mjs',
    '../runtime/preflight.mjs',
    '../runtime/recorder.mjs',
  ].map((relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(source, /NODE_TLS_REJECT_UNAUTHORIZED/);
});

test('lifecycle environment excludes ambient values and maps explicit references', () => {
  const child = lifecycleEnvironment({
    env: {
      API_TOKEN: 'SOURCE_TOKEN',
      APP_MODE: 'SOURCE_MODE',
    },
  }, {
    PATH: '/portable/bin',
    HOME: '/portable/home',
    TMPDIR: '/portable/tmp',
    SOURCE_TOKEN: 'explicit-secret',
    SOURCE_MODE: 'test',
    AMBIENT_SECRET: 'must-not-leak',
    NODE_OPTIONS: '--inspect',
  });

  assert.deepEqual(child, {
    PATH: '/portable/bin',
    HOME: '/portable/home',
    TMPDIR: '/portable/tmp',
    API_TOKEN: 'explicit-secret',
    APP_MODE: 'test',
  });
  assert.throws(
    () => lifecycleEnvironment({ env: { API_TOKEN: 'MISSING_TOKEN' } }, {}),
    /Missing lifecycle environment variable MISSING_TOKEN/,
  );
});

test('command lifecycle receives only baseline and explicitly mapped environment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-lifecycle-env-'));
  const script = path.join(root, 'server.mjs');
  const capture = path.join(root, 'environment.json');
  const reservation = http.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  fs.writeFileSync(script, `
import fs from 'node:fs';
import http from 'node:http';
fs.writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({
  ambient: process.env.AMBIENT_SECRET ?? null,
  explicit: process.env.API_TOKEN ?? null,
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  path: process.env.PATH ?? null,
}));
http.createServer((_request, response) => response.end('ready'))
  .listen(Number(process.env.APP_PORT), '127.0.0.1');
`);
  let stop;
  try {
    stop = await startLifecycle({
      app: {
        url: `http://127.0.0.1:${port}/`,
        cwd: root,
        lifecycle: {
          mode: 'command',
          start: [process.execPath, script],
          env: {
            APP_PORT: 'TEST_APP_PORT',
            CAPTURE_FILE: 'TEST_CAPTURE_FILE',
            API_TOKEN: 'SOURCE_TOKEN',
          },
          readyTimeoutMs: 5_000,
        },
      },
    }, path.join(root, 'work'), {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TEST_APP_PORT: String(port),
      TEST_CAPTURE_FILE: capture,
      SOURCE_TOKEN: 'explicit-secret',
      AMBIENT_SECRET: 'must-not-leak',
      NODE_OPTIONS: '--trace-warnings',
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(capture, 'utf8')), {
      ambient: null,
      explicit: 'explicit-secret',
      nodeOptions: null,
      path: process.env.PATH,
    });
  } finally {
    await stop?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('URL checks allow a self-signed certificate only when scoped to the demo', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-self-signed-tls-'));
  const key = path.join(root, 'key.pem');
  const certificate = path.join(root, 'certificate.pem');
  const generated = spawnSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-nodes',
    '-keyout',
    key,
    '-out',
    certificate,
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
  ], { encoding: 'utf8' });
  if (generated.status !== 0) {
    fs.rmSync(root, { recursive: true, force: true });
    t.skip(`openssl unavailable: ${generated.stderr || generated.stdout}`);
    return;
  }

  const server = https.createServer({
    key: fs.readFileSync(key),
    cert: fs.readFileSync(certificate),
  }, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ready');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `https://127.0.0.1:${address.port}/`;
  const originalGlobalBypass = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  try {
    const strict = await checkUrl(url, 2_000);
    assert.equal(strict.ok, false);

    const allowed = await checkUrl(url, 2_000, { allowInsecureTls: true });
    assert.deepEqual(
      { ok: allowed.ok, status: allowed.status, url: allowed.url },
      { ok: true, status: 200, url },
    );

    const ready = await waitForUrl(url, 2_000, { allowInsecureTls: true });
    assert.equal(ready.ok, true);

    const stop = await startLifecycle({
      app: {
        url,
        allowInsecureTls: true,
        cwd: root,
        lifecycle: { mode: 'external', readyTimeoutMs: 2_000 },
      },
    }, root);
    await stop();
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalGlobalBypass);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
