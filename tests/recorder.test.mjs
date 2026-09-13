import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createRecordedPage,
  prepareBrowserStorageState,
} from '../runtime/recorder.mjs';

function baseManifest(auth) {
  return {
    app: {
      url: 'https://demo.example.test/',
      allowInsecureTls: false,
    },
    auth,
    browser: {
      viewport: { width: 1280, height: 720 },
      colorScheme: 'light',
      zoom: 1,
    },
  };
}

test('recorded video clock starts after delayed driver authentication and preparation', async () => {
  const events = [];
  const prepPage = {};
  const prepContext = {
    newPage: async () => {
      events.push('prep-page');
      return prepPage;
    },
    storageState: async () => {
      events.push('storage-state');
      return { cookies: [{ name: 'session' }] };
    },
    close: async () => events.push('prep-close'),
  };
  const video = {};
  const recordedPage = { video: () => video };
  const recordedContext = {
    addInitScript: async () => events.push('init-script'),
    newPage: async () => {
      events.push('recorded-page');
      return recordedPage;
    },
    close: async () => {},
  };
  const contextOptions = [];
  const contexts = [prepContext, recordedContext];
  const browser = {
    newContext: async (options) => {
      contextOptions.push(options);
      return contexts.shift();
    },
  };
  const manifest = baseManifest({ mode: 'driver', env: {} });
  const driver = {
    authenticate: async () => {
      events.push('authenticate-start');
      await new Promise((resolve) => setImmediate(resolve));
      events.push('authenticate-end');
    },
    prepare: async () => {
      events.push('prepare-start');
      await new Promise((resolve) => setImmediate(resolve));
      events.push('prepare-end');
    },
  };

  const storageState = await prepareBrowserStorageState({
    browser,
    driver,
    environment: {},
    manifest,
    rehearsal: false,
    secrets: {},
  });
  const timeline = {
    meta: {},
    elapsed: () => {
      events.push('video-start');
      return 7.25;
    },
  };
  const recorded = await createRecordedPage({
    browser,
    manifest,
    rehearsal: false,
    storageState,
    timeline,
    workDir: '/tmp/demo-video-clock-test',
  });

  assert.equal(timeline.meta.videoStart, 7.25);
  assert.equal(recorded.page, recordedPage);
  assert.equal(recorded.videoObject, video);
  assert.ok(events.indexOf('prepare-end') < events.indexOf('prep-close'));
  assert.ok(events.indexOf('prep-close') < events.indexOf('video-start'));
  assert.ok(events.indexOf('recorded-page') < events.indexOf('video-start'));
  assert.deepEqual(contextOptions[1].storageState, storageState);
});

test('storage-state preparation completes before the recorded video clock starts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-storage-state-clock-'));
  const stateFile = path.join(root, 'storage-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ cookies: [{ name: 'existing' }] }), {
    mode: 0o600,
  });
  const events = [];
  const contextOptions = [];
  const prepContext = {
    newPage: async () => ({ goto: async () => events.push('unexpected-goto') }),
    storageState: async () => {
      events.push('storage-state');
      return { cookies: [{ name: 'prepared' }] };
    },
    close: async () => events.push('prep-close'),
  };
  const recordedContext = {
    addInitScript: async () => {},
    newPage: async () => {
      events.push('recorded-page');
      return { video: () => null };
    },
    close: async () => {},
  };
  const contexts = [prepContext, recordedContext];
  const browser = {
    newContext: async (options) => {
      contextOptions.push(options);
      return contexts.shift();
    },
  };
  const manifest = baseManifest({
    mode: 'storage-state',
    env: {},
    storageStateEnv: 'DEMO_STORAGE_STATE',
  });
  const driver = {
    prepare: async () => {
      events.push('prepare');
      await new Promise((resolve) => setImmediate(resolve));
    },
  };

  try {
    const storageState = await prepareBrowserStorageState({
      browser,
      driver,
      environment: { DEMO_STORAGE_STATE: stateFile },
      manifest,
      rehearsal: false,
      secrets: {},
    });
    const timeline = {
      meta: {},
      elapsed: () => {
        events.push('video-start');
        return 4.5;
      },
    };
    await createRecordedPage({
      browser,
      manifest,
      rehearsal: false,
      storageState,
      timeline,
      workDir: root,
    });

    assert.deepEqual(contextOptions[0].storageState, { cookies: [{ name: 'existing' }] });
    assert.equal(events.includes('unexpected-goto'), false);
    assert.ok(events.indexOf('prepare') < events.indexOf('video-start'));
    assert.ok(events.indexOf('prep-close') < events.indexOf('video-start'));
    assert.ok(events.indexOf('recorded-page') < events.indexOf('video-start'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
