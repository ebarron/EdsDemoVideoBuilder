import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function requestOnce(url, { allowInsecureTls, signal }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.get(parsed, {
      signal,
      ...(parsed.protocol === 'https:'
        ? { rejectUnauthorized: !allowInsecureTls }
        : {}),
    }, (response) => {
      response.resume();
      resolve({
        location: response.headers.location,
        status: response.statusCode ?? 0,
        url: parsed.href,
      });
    });
    request.once('error', reject);
  });
}

async function requestFollowingRedirects(url, options, maxRedirects = 10) {
  let current = url;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await requestOnce(current, options);
    if (REDIRECT_STATUS.has(response.status) && response.location) {
      if (redirects === maxRedirects) throw new Error(`Too many redirects while checking ${url}`);
      current = new URL(response.location, current).href;
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects while checking ${url}`);
}

export async function checkUrl(url, timeoutMs = 5000, {
  allowInsecureTls = false,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await requestFollowingRedirects(url, {
      allowInsecureTls,
      signal: controller.signal,
    });
    return { ok: response.status < 500, status: response.status, url: response.url };
  } catch (error) {
    return { ok: false, error: error.message, url };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForUrl(url, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await checkUrl(
      url,
      Math.min(3000, Math.max(250, deadline - Date.now())),
      options,
    );
    if (latest.ok) return latest;
    await sleep(300);
  }
  throw new Error(`App did not become ready at ${url}: ${latest?.error ?? latest?.status ?? 'timeout'}`);
}

function lifecycleEnvironment(lifecycle, environment) {
  const additions = {};
  for (const [targetName, sourceName] of Object.entries(lifecycle.env ?? {})) {
    const value = environment[sourceName];
    if (!value) throw new Error(`Missing lifecycle environment variable ${sourceName}`);
    additions[targetName] = value;
  }
  return { ...environment, ...additions };
}

export async function startLifecycle(manifest, workDir, environment = process.env) {
  const lifecycle = manifest.app.lifecycle;
  const urlOptions = {
    allowInsecureTls: Boolean(manifest.app.allowInsecureTls),
  };
  if (lifecycle.mode === 'external') {
    await waitForUrl(
      lifecycle.readyUrl ?? manifest.app.url,
      lifecycle.readyTimeoutMs ?? 15_000,
      urlOptions,
    );
    return async () => {};
  }

  fs.mkdirSync(workDir, { recursive: true });
  const logPath = path.join(workDir, 'app-lifecycle.log');
  const log = fs.openSync(logPath, 'a', 0o600);
  const [command, ...args] = lifecycle.start;
  const child = spawn(command, args, {
    cwd: manifest.app.cwd,
    env: lifecycleEnvironment(lifecycle, environment),
    detached: false,
    stdio: ['ignore', log, log],
  });
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  try {
    await waitForUrl(
      lifecycle.readyUrl ?? manifest.app.url,
      lifecycle.readyTimeoutMs ?? 60_000,
      urlOptions,
    );
    if (spawnError) throw spawnError;
  } catch (error) {
    child.kill(lifecycle.stopSignal ?? 'SIGTERM');
    fs.closeSync(log);
    throw new Error(`Failed to start app lifecycle (${logPath}): ${error.message}`);
  }

  return async () => {
    if (child.exitCode === null) child.kill(lifecycle.stopSignal ?? 'SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(5000).then(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }),
    ]);
    fs.closeSync(log);
  };
}
