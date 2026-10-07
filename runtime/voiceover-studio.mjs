import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {
  acceptLatestEligibleVoiceoverTakes,
  acceptVoiceoverTake,
  clearVoiceoverAcceptance,
  completeVoiceoverSession,
  createVoiceoverSession,
  deleteVoiceoverTake,
  readVoiceoverSession,
  rebaseVoiceoverSession,
  registerVoiceoverTake,
  resolveVoiceoverTakeAudio,
} from './voiceover.mjs';
import {
  voiceoverBootstrapHtml,
  voiceoverStudioHtml,
} from './voiceover-ui.mjs';

const MAX_TAKE_BYTES = 500 * 1024 * 1024;
const BOOTSTRAP_TTL_MS = 60_000;
const SESSION_TTL_MS = 8 * 60 * 60_000;

function acquireStudioLock(directory) {
  const file = path.join(directory, '.studio.lock');
  const owner = crypto.randomBytes(16).toString('hex');
  const acquire = () => {
    try {
      fs.writeFileSync(
        file,
        `${JSON.stringify({ owner, pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        { flag: 'wx', mode: 0o600 },
      );
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let active = true;
      try {
        const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
        process.kill(lock.pid, 0);
      } catch {
        active = false;
      }
      if (active) {
        throw new Error(
          'This voiceover session is already open; close its studio or use --new-session',
        );
      }
      throw new Error(
        `This voiceover session has a stale studio lock at ${file}; ` +
        'remove it after confirming no studio is running, or use --new-session',
      );
    }
  };
  acquire();
  return () => {
    try {
      const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (lock.owner === owner) fs.rmSync(file, { force: true });
    } catch {
      // The lock is already gone or no longer belongs to this studio.
    }
  };
}

function send(
  response,
  status,
  body,
  contentType = 'text/plain; charset=utf-8',
  additionalHeaders = {},
) {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'content-security-policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self'; connect-src 'self'",
    ...additionalHeaders,
  });
  response.end(body);
}

function sendJson(response, status, value, additionalHeaders = {}) {
  send(
    response,
    status,
    `${JSON.stringify(value)}\n`,
    'application/json; charset=utf-8',
    additionalHeaders,
  );
}

function readBody(request, maximum = MAX_TAKE_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximum) {
        reject(new Error(`Request exceeds ${maximum} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length &&
    crypto.timingSafeEqual(leftBytes, rightBytes);
}

function cookieValue(request, name) {
  for (const entry of String(request.headers.cookie ?? '').split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }
  return null;
}

function redactSecrets(value, secrets) {
  let redacted = String(value);
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

function logStudioError(logger, request, error, secrets) {
  const detail = error?.stack ?? error?.message ?? String(error);
  logger?.error?.(
    `[voiceover-studio] ${request.method} ${new URL(request.url, 'http://127.0.0.1').pathname} failed\n` +
    redactSecrets(detail, secrets),
  );
}

function publicError(pathname, error) {
  if (error instanceof SyntaxError) {
    return { status: 400, message: 'Invalid JSON request' };
  }
  if (pathname === '/api/session') {
    return { status: 500, message: 'Voiceover session is unavailable' };
  }
  if (pathname === '/video') {
    return { status: 404, message: 'Locked video is unavailable' };
  }
  if (pathname === '/api/take-audio') {
    return { status: 404, message: 'Voiceover take audio is unavailable' };
  }
  if (pathname === '/api/takes') {
    return { status: 400, message: 'Voiceover take could not be processed' };
  }
  if (pathname === '/api/complete') {
    return { status: 400, message: 'Voiceover session cannot be completed' };
  }
  if (pathname.startsWith('/api/')) {
    return { status: 400, message: 'Voiceover request could not be completed' };
  }
  return { status: 500, message: 'Voiceover studio request failed' };
}

function writeBootstrapLauncher(file, url) {
  fs.writeFileSync(file, `<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Open Demo Voiceover Studio</title>
<script>window.location.replace(${JSON.stringify(url)});</script>
`, { flag: 'wx', mode: 0o600 });
}

function serveMedia(request, response, file, contentType) {
  const stat = fs.statSync(file);
  const range = request.headers.range;
  const headers = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
  };
  if (!range) {
    response.writeHead(200, { ...headers, 'content-length': stat.size });
    fs.createReadStream(file).pipe(response);
    return;
  }
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    response.writeHead(416, { ...headers, 'content-range': `bytes */${stat.size}` });
    response.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = Math.min(match[2] ? Number(match[2]) : stat.size - 1, stat.size - 1);
  if (!(start >= 0 && start <= end && start < stat.size)) {
    response.writeHead(416, { ...headers, 'content-range': `bytes */${stat.size}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    ...headers,
    'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${stat.size}`,
  });
  fs.createReadStream(file, { start, end }).pipe(response);
}

export async function createVoiceoverStudio(manifest, {
  port = 0,
  open = true,
  newSession = false,
  rebase = false,
  environment = process.env,
  logger = console,
  bootstrapTtlMs = BOOTSTRAP_TTL_MS,
} = {}) {
  if (newSession && rebase) {
    throw new Error('Choose either a new voiceover session or rebase, not both');
  }
  if (!Number.isInteger(bootstrapTtlMs) || bootstrapTtlMs <= 0) {
    throw new Error('Voiceover Studio bootstrap TTL must be a positive integer');
  }
  let prepared;
  let releaseStudioLock;
  if (rebase) {
    const source = readVoiceoverSession(manifest);
    const releaseSourceLock = acquireStudioLock(source.directory);
    try {
      prepared = rebaseVoiceoverSession(
        manifest,
        { allowStudioLock: true },
      );
      releaseStudioLock = acquireStudioLock(prepared.directory);
    } finally {
      releaseSourceLock();
    }
  } else {
    prepared = createVoiceoverSession(manifest, { newSession });
    releaseStudioLock = acquireStudioLock(prepared.directory);
  }
  const sessionDir = prepared.directory;
  const bootstrapToken = crypto.randomBytes(32).toString('hex');
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const cookieName = `dvb_voiceover_${crypto.randomBytes(8).toString('hex')}`;
  const bootstrapExpiresAt = Date.now() + bootstrapTtlMs;
  const sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  const authSecrets = [bootstrapToken, sessionToken];
  let bootstrapAvailable = true;
  let origin;
  let launcher;
  let bootstrapTimer;
  let server;
  const removeLauncher = () => {
    if (launcher) fs.rmSync(launcher, { force: true });
  };
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  let closing = false;
  const closeStudio = (result, delayMs = 0) => {
    if (closing) return;
    closing = true;
    bootstrapAvailable = false;
    clearTimeout(bootstrapTimer);
    removeLauncher();
    const close = () => server.close(() => {
      releaseStudioLock();
      finish(result);
    });
    if (delayMs) setTimeout(close, delayMs);
    else close();
  };
  const expireBootstrap = () => {
    closeStudio({
      session: prepared.state.id,
      directory: prepared.directory,
      completedAt: null,
      reason: 'bootstrap-expired',
    });
  };
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname === '/auth/session') {
      try {
        if (
          request.headers.origin !== origin ||
          !String(request.headers['content-type'] ?? '').startsWith('application/json')
        ) {
          send(response, 403, 'Voiceover studio authorization required');
          return;
        }
        const body = JSON.parse((await readBody(request, 4096)).toString('utf8'));
        if (
          !bootstrapAvailable ||
          Date.now() > bootstrapExpiresAt ||
          !sameSecret(body.bootstrap, bootstrapToken)
        ) {
          send(response, 403, 'Voiceover studio authorization required');
          return;
        }
        bootstrapAvailable = false;
        clearTimeout(bootstrapTimer);
        removeLauncher();
        send(
          response,
          204,
          '',
          'text/plain; charset=utf-8',
          {
            'set-cookie':
              `${cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; ` +
              `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
          },
        );
      } catch (error) {
        logStudioError(logger, request, error, authSecrets);
        send(response, 400, 'Voiceover studio authorization failed');
      }
      return;
    }
    const authenticated =
      Date.now() <= sessionExpiresAt &&
      sameSecret(cookieValue(request, cookieName), sessionToken);
    if (request.method === 'GET' && url.pathname === '/') {
      send(
        response,
        200,
        authenticated ? voiceoverStudioHtml() : voiceoverBootstrapHtml(),
        'text/html; charset=utf-8',
      );
      return;
    }
    if (!authenticated) {
      send(response, 403, 'Voiceover studio authorization required');
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== origin) {
      send(response, 403, 'Voiceover studio authorization required');
      return;
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/session') {
        sendJson(response, 200, readVoiceoverSession(manifest, sessionDir).state);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/video') {
        const session = readVoiceoverSession(manifest, sessionDir);
        serveMedia(
          request,
          response,
          path.join(session.directory, session.state.pictureLock.video),
          'video/mp4',
        );
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/take-audio') {
        const { file } = resolveVoiceoverTakeAudio(
          manifest,
          url.searchParams.get('takeId'),
          sessionDir,
        );
        serveMedia(request, response, file, 'audio/wav');
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/takes') {
        const bytes = await readBody(request);
        const result = registerVoiceoverTake({
          manifest,
          kind: url.searchParams.get('kind'),
          sceneId: url.searchParams.get('sceneId') || null,
          contentType: request.headers['content-type'] ?? 'application/octet-stream',
          videoOffsetMs: url.searchParams.get('videoOffsetMs'),
          captureDurationMs: url.searchParams.get('captureDurationMs'),
          bytes,
          sessionDir,
          environment,
        });
        sendJson(response, 201, result);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/accept') {
        const body = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8'));
        sendJson(response, 200, acceptVoiceoverTake(
          manifest,
          body.takeId,
          sessionDir,
          {
            cleanup: body.cleanup === true,
            allowOverlong: body.allowOverlong === true,
          },
        ));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/accept-latest') {
        const bytes = await readBody(request, 1024 * 1024);
        const body = bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
        sendJson(
          response,
          200,
          acceptLatestEligibleVoiceoverTakes(
            manifest,
            sessionDir,
            { cleanup: body.cleanup === true },
          ),
        );
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/unaccept') {
        const body = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8'));
        sendJson(response, 200, clearVoiceoverAcceptance(manifest, {
          kind: body.kind,
          sceneId: body.sceneId,
          sessionDir,
        }));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/delete-take') {
        const body = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8'));
        sendJson(
          response,
          200,
          deleteVoiceoverTake(manifest, body.takeId, sessionDir),
        );
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/complete') {
        const bytes = await readBody(request, 1024 * 1024);
        const body = bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
        const state = completeVoiceoverSession(
          manifest,
          sessionDir,
          { allowMissing: body.allowMissing === true },
        );
        sendJson(
          response,
          200,
          {
            completedAt: state.completedAt,
            completionWarnings: state.completionWarnings,
          },
          {
            'set-cookie':
              `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
          },
        );
        closeStudio({
          session: state.id,
          directory: prepared.directory,
          completedAt: state.completedAt,
        }, 100);
        return;
      }
      send(response, 404, 'Not found');
    } catch (error) {
      logStudioError(logger, request, error, authSecrets);
      const failure = publicError(url.pathname, error);
      send(response, failure.status, failure.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      releaseStudioLock();
      reject(error);
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  const url = `${origin}/`;
  launcher = path.join(
    sessionDir,
    `.studio-launch-${crypto.randomBytes(8).toString('hex')}.html`,
  );
  try {
    writeBootstrapLauncher(
      launcher,
      `${url}#bootstrap=${encodeURIComponent(bootstrapToken)}`,
    );
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    releaseStudioLock();
    throw error;
  }
  bootstrapTimer = setTimeout(expireBootstrap, bootstrapTtlMs);
  bootstrapTimer.unref();
  if (open) {
    if (process.platform !== 'darwin') {
      closeStudio({
        session: prepared.state.id,
        directory: prepared.directory,
        completedAt: null,
        reason: 'unsupported-platform',
      });
      await done;
      throw new Error('Automatic voiceover studio opening currently requires macOS');
    }
    const opener = spawn('/usr/bin/open', [launcher], {
      detached: true,
      stdio: 'ignore',
    });
    opener.unref();
  }
  return {
    url,
    launcher,
    directory: prepared.directory,
    created: prepared.created,
    rebased: prepared.rebased === true,
    rebase: prepared.rebase ?? null,
    done,
    close: async () => {
      closeStudio({
        session: prepared.state.id,
        directory: prepared.directory,
        completedAt: null,
        reason: 'closed',
      });
      await done;
    },
  };
}
