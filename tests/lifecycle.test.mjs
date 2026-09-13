import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkUrl, startLifecycle, waitForUrl } from '../runtime/lifecycle.mjs';

test('runtime never sets a process-wide TLS bypass', () => {
  const source = [
    '../runtime/lifecycle.mjs',
    '../runtime/preflight.mjs',
    '../runtime/recorder.mjs',
  ].map((relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(source, /NODE_TLS_REJECT_UNAUTHORIZED/);
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
