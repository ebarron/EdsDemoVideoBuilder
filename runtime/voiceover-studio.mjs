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
  registerVoiceoverTake,
  resolveVoiceoverTakeAudio,
} from './voiceover.mjs';
import { voiceoverStudioHtml } from './voiceover-ui.mjs';

const MAX_TAKE_BYTES = 500 * 1024 * 1024;

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

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self'; connect-src 'self'",
  });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, `${JSON.stringify(value)}\n`, 'application/json; charset=utf-8');
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

function serveMedia(request, response, file, contentType) {
  const stat = fs.statSync(file);
  const range = request.headers.range;
  const headers = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
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
  environment = process.env,
} = {}) {
  const prepared = createVoiceoverSession(manifest, { newSession });
  const sessionDir = prepared.directory;
  const releaseStudioLock = acquireStudioLock(sessionDir);
  const token = crypto.randomBytes(24).toString('hex');
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  let closing = false;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.searchParams.get('token') !== token) {
      send(response, 403, 'Invalid voiceover studio token');
      return;
    }
    try {
      if (request.method === 'GET' && url.pathname === '/') {
        send(
          response,
          200,
          voiceoverStudioHtml(token),
          'text/html; charset=utf-8',
        );
        return;
      }
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
        const state = completeVoiceoverSession(manifest, sessionDir);
        sendJson(response, 200, { completedAt: state.completedAt });
        if (!closing) {
          closing = true;
          setTimeout(() => server.close(() => {
            releaseStudioLock();
            finish({
              session: state.id,
              directory: prepared.directory,
              completedAt: state.completedAt,
            });
          }), 100);
        }
        return;
      }
      send(response, 404, 'Not found');
    } catch (error) {
      send(response, 400, error.stack ?? error.message);
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
  const url = `http://127.0.0.1:${address.port}/?token=${token}`;
  if (open) {
    if (process.platform !== 'darwin') {
      await new Promise((resolve) => server.close(resolve));
      releaseStudioLock();
      throw new Error('Automatic voiceover studio opening currently requires macOS');
    }
    const opener = spawn('/usr/bin/open', [url], {
      detached: true,
      stdio: 'ignore',
    });
    opener.unref();
  }
  return {
    url,
    directory: prepared.directory,
    created: prepared.created,
    done,
    close: () => new Promise((resolve) => {
      if (closing) {
        resolve();
        return;
      }
      closing = true;
      server.close(() => {
        releaseStudioLock();
        finish({ session: prepared.state.id, directory: prepared.directory, completedAt: null });
        resolve();
      });
    }),
  };
}
