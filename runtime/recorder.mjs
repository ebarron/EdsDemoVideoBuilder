import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createBrowserHelpers, installDemoPointer, installDemoZoom } from './browser.mjs';
import { materializeEnvironment, readScenePlan } from './config.mjs';
import { resolveFfmpeg } from './ffmpeg.mjs';
import { startLifecycle } from './lifecycle.mjs';
import { prepareNarration } from './narration.mjs';
import { DemoTimeline } from './timeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_FILE = path.join(HERE, '..', 'package.json');

function resetWorkDir(workDir) {
  const resolved = path.resolve(workDir);
  const forbidden = new Set(['/', os.homedir(), process.cwd(), path.parse(resolved).root]);
  if (forbidden.has(resolved) || resolved.length < 8) {
    throw new Error(`Refusing unsafe demo work directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  return resolved;
}

async function loadDriver(driverPath) {
  const module = await import(`${pathToFileURL(driverPath).href}?loaded=${Date.now()}`);
  const driver = module.default;
  if (!driver || driver.apiVersion !== 1) {
    throw new Error(`Driver ${driverPath} must default-export apiVersion: 1`);
  }
  return driver;
}

async function loadPlaywright() {
  const require = createRequire(PACKAGE_FILE);
  let resolved;
  try {
    resolved = require.resolve('@playwright/test');
  } catch {
    throw new Error('@playwright/test is missing. Rerun scripts/install.sh in the skill directory.');
  }
  const module = await import(pathToFileURL(resolved).href);
  const playwright = module.chromium ? module : module.default;
  if (!playwright?.chromium) {
    throw new Error('The installed @playwright/test package did not export chromium');
  }
  return playwright;
}

function browserLaunchOptions(channel) {
  return channel && channel !== 'chromium' ? { channel } : {};
}

export function browserTlsOptions(manifest) {
  return {
    ignoreHTTPSErrors: Boolean(manifest.app.allowInsecureTls),
  };
}

function authSecrets(manifest, environment) {
  const refs = Object.entries(manifest.auth.env ?? {}).map(([logicalName, environmentName]) => ({
    logicalName,
    environmentName,
  }));
  const result = materializeEnvironment(refs, environment);
  if (result.missing.length) {
    throw new Error(
      `Missing authentication environment variables: ${result.missing.map((item) => item.environmentName).join(', ')}`,
    );
  }
  return result.values;
}

function readStorageState(manifest, environment) {
  if (manifest.auth.mode !== 'storage-state') return undefined;
  const name = manifest.auth.storageStateEnv;
  const file = environment[name];
  if (!file) throw new Error(`Missing storage-state environment variable ${name}`);
  const stat = fs.statSync(file);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`Storage-state file must not be group/world accessible: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createDriverContext(base, timeline, helpers, narration) {
  const pace = narration.pace;
  const pause = (milliseconds) => base.page.waitForTimeout(Math.max(0, milliseconds * pace));
  const waitUntil = async (seconds) => {
    const remaining = seconds - timeline.elapsed();
    if (remaining > 0) await base.page.waitForTimeout(remaining * 1000);
  };
  const startNarration = (id, options) => timeline.startNarration(id, options);
  const waitNarrationFraction = async (entry, fraction) => {
    const anchoredWait = entry.anchor?.wait &&
      timeline.waits.find((candidate) => candidate.id === entry.anchor.wait);
    if (!base.rehearsal && anchoredWait && anchoredWait.duration > anchoredWait.target + 0.12) {
      const elapsedInOutput =
        Math.max(0, anchoredWait.target - (entry.anchor.offset ?? 0)) +
        Math.max(0, timeline.elapsed() - anchoredWait.end);
      const remaining = entry.runtimeDuration * fraction - elapsedInOutput;
      if (remaining > 0) await base.page.waitForTimeout(remaining * 1000);
      return;
    }
    await waitUntil(entry.start + entry.runtimeDuration * fraction);
  };
  const finishAnchoredNarration = async (entry, wait, fraction = 1) => {
    const anchorOffset = entry.anchor?.offset ?? 0;
    const elapsedInOutput = !base.rehearsal && wait.duration > wait.target + 0.12
      ? Math.max(0, wait.target - anchorOffset) + Math.max(0, timeline.elapsed() - wait.end)
      : Math.max(0, timeline.elapsed() - entry.start);
    const remaining = entry.runtimeDuration * fraction - elapsedInOutput;
    if (remaining > 0) await base.page.waitForTimeout(remaining * 1000);
  };
  const scene = async (id, action = async () => {}, options = {}) => {
    const entry = startNarration(id, options);
    await action(entry);
    await waitNarrationFraction(entry, 1);
    await pause(base.manifest.timing.tailPaddingMs);
    return entry;
  };
  return {
    ...base,
    timeline,
    ...helpers,
    pause,
    waitUntil,
    startNarration,
    waitNarrationFraction,
    finishAnchoredNarration,
    scene,
    measuredWait: (...args) => timeline.measuredWait(...args),
    smoothScroll: (locator, options = {}) =>
      helpers.smoothScroll(locator, {
        ...options,
        durationMs: (options.durationMs ?? 1_600) * pace,
      }),
  };
}

export async function runDemo(manifest, {
  rehearsal = false,
  environment = process.env,
} = {}) {
  const driver = await loadDriver(manifest.driver);
  if (!rehearsal && !driver.status?.productionReady) {
    const todos = driver.status?.todos?.join('; ') || 'driver status is incomplete';
    throw new Error(`Driver is not production-ready: ${todos}`);
  }
  if (Boolean(driver.status?.mutatesState) !== manifest.state.mutatingActions) {
    throw new Error('Manifest state.mutatingActions must match driver status.mutatesState');
  }
  if (manifest.state.policy === 'read-only' && driver.status?.mutatesState) {
    throw new Error('A mutating driver cannot run under the read-only state policy');
  }
  if (typeof driver.setup !== 'function' || typeof driver.run !== 'function') {
    throw new Error('Driver must implement setup() and run()');
  }
  if (typeof driver.snapshot !== 'function' || typeof driver.verifyRestored !== 'function') {
    throw new Error('Driver must implement snapshot() and verifyRestored()');
  }

  const workDir = resetWorkDir(manifest.output.workDir);
  const scenePlan = readScenePlan(manifest);
  const ffmpeg = resolveFfmpeg(manifest, environment);
  const narration = prepareNarration({
    manifest,
    scenePlan,
    workDir,
    rehearsal,
    ffmpeg,
  });
  const timeline = new DemoTimeline({ manifest, narration, rehearsal });
  const secrets = authSecrets(manifest, environment);
  const { chromium } = await loadPlaywright();
  const stopLifecycle = await startLifecycle(manifest, workDir, environment);
  let browser;
  let context;
  let page;
  let before;
  let accepted = false;
  let videoObject;

  try {
    browser = await chromium.launch(browserLaunchOptions(manifest.browser.channel));
    const prepContext = await browser.newContext({
      viewport: manifest.browser.viewport,
      storageState: readStorageState(manifest, environment),
      colorScheme: manifest.browser.colorScheme,
      ...browserTlsOptions(manifest),
    });
    const prepPage = await prepContext.newPage();
    const prepBase = { page: prepPage, context: prepContext, manifest, secrets, rehearsal };
    if (manifest.auth.mode === 'driver') {
      if (typeof driver.authenticate !== 'function') {
        throw new Error('auth.mode driver requires driver.authenticate()');
      }
      await driver.authenticate(prepBase);
    } else if (manifest.auth.mode === 'none') {
      await prepPage.goto(manifest.app.url);
    }
    if (typeof driver.prepare === 'function') await driver.prepare(prepBase);
    const storageState = await prepContext.storageState();
    await prepContext.close();

    const contextOptions = {
      viewport: manifest.browser.viewport,
      storageState,
      colorScheme: manifest.browser.colorScheme,
      ...browserTlsOptions(manifest),
    };
    if (!rehearsal) {
      contextOptions.recordVideo = {
        dir: path.join(workDir, 'video'),
        size: manifest.browser.viewport,
      };
    }
    context = await browser.newContext(contextOptions);
    await context.addInitScript(installDemoPointer);
    await context.addInitScript(installDemoZoom, manifest.browser.zoom);
    page = await context.newPage();
    videoObject = rehearsal ? null : page.video();
    const base = { page, context, manifest, secrets, rehearsal, workDir, scenePlan };
    let driverContext;
    const pause = (milliseconds) =>
      page.waitForTimeout(Math.max(0, milliseconds * narration.pace));
    const captureClickEvidence = async (id) => {
      const evidenceDir = path.join(workDir, 'click-evidence');
      fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
      const safeId = String(id).replace(/[^a-z0-9._-]+/gi, '-');
      const file = path.join(
        evidenceDir,
        `${String(timeline.actions.length).padStart(3, '0')}-${safeId}.png`,
      );
      await page.screenshot({ path: file, animations: 'allow' });
      return file;
    };
    const helpers = createBrowserHelpers({
      captureClickEvidence,
      page,
      timeline,
      pause,
      viewport: manifest.browser.viewport,
      pace: narration.pace,
    });
    driverContext = createDriverContext(base, timeline, helpers, narration);

    await driver.setup(driverContext);
    before = await driver.snapshot(driverContext);
    timeline.state.before = before;
    timeline.meta.contentStart = timeline.elapsed();
    await driver.run(driverContext);
    await pause(manifest.timing.tailPaddingMs);
    timeline.meta.contentEnd = timeline.elapsed();

    if (manifest.state.policy === 'restore' && typeof driver.restore === 'function') {
      await driver.restore({
        page,
        context,
        manifest,
        secrets,
        rehearsal,
        workDir,
        scenePlan,
        timeline,
        before,
      });
    }
    const after = await driver.snapshot(driverContext);
    timeline.state.after = after;
    await driver.verifyRestored({ ...driverContext, before, after });
    accepted = true;
  } catch (error) {
    let restoreError;
    let restorationVerified = false;
    if (page && before !== undefined && typeof driver.restore === 'function') {
      try {
        await driver.restore({
          page,
          context,
          manifest,
          secrets,
          rehearsal,
          workDir,
          scenePlan,
          timeline,
          before,
        });
        const after = await driver.snapshot({
          page,
          context,
          manifest,
          secrets,
          rehearsal,
          workDir,
          scenePlan,
          timeline,
        });
        timeline.state.after = after;
        await driver.verifyRestored({
          page,
          context,
          manifest,
          secrets,
          rehearsal,
          workDir,
          scenePlan,
          timeline,
          before,
          after,
        });
        restorationVerified = true;
      } catch (caught) {
        restoreError = caught;
      }
    }
    fs.writeFileSync(
      path.join(workDir, 'rejected-take.json'),
      `${JSON.stringify({
        rejected: true,
        reason: error.message,
        restorationError: restoreError?.message ?? null,
        restorationVerified,
        timeline: timeline.toJSON(),
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    if (restoreError) {
      throw new Error(
        `Take failed (${error.message}) and state restoration also failed (${restoreError.message})`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await stopLifecycle().catch(() => {});
  }

  if (!accepted) throw new Error('Take was rejected');
  const timelineJson = timeline.toJSON();
  fs.writeFileSync(
    path.join(workDir, 'timeline.json'),
    `${JSON.stringify(timelineJson, null, 2)}\n`,
    { mode: 0o600 },
  );
  if (!rehearsal) {
    const video = await videoObject.path();
    fs.writeFileSync(path.join(workDir, 'video-path.txt'), `${video}\n`, { mode: 0o600 });
  }
  return {
    rehearsal,
    workDir,
    duration: timeline.meta.contentEnd - timeline.meta.contentStart,
    compressions: timeline.compressions,
    stateRestored: true,
  };
}

export { browserLaunchOptions, loadDriver, loadPlaywright };
