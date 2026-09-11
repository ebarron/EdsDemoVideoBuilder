import fs from 'node:fs';

import { materializeEnvironment, readScenePlan, referencedEnvironment } from './config.mjs';
import { resolveFfmpeg } from './ffmpeg.mjs';
import { checkUrl } from './lifecycle.mjs';
import { loadDriver, loadPlaywright } from './recorder.mjs';

export function driverReadiness(status = {}) {
  const productionReady = Boolean(status.productionReady);
  return {
    ok: true,
    productionReady,
    detail: productionReady
      ? 'production-ready'
      : `not production-ready; rehearsal is allowed${
        status.todos?.length ? ` (${status.todos.join('; ')})` : ''
      }`,
  };
}

export async function preflightDemo(manifest, environment = process.env) {
  const checks = [];
  let productionReady = false;
  const check = (name, ok, detail, extra = {}) => checks.push({ name, ok, detail, ...extra });
  check('platform', process.platform === 'darwin', `${process.platform} (v1 is macOS-first)`);
  check('node', Number(process.versions.node.split('.')[0]) >= 20, process.version);

  for (const [name, file] of [
    ['script', manifest.script],
    ['scene plan', manifest.scenePlan],
    ['driver', manifest.driver],
    ['app cwd', manifest.app.cwd],
  ]) {
    check(name, fs.existsSync(file), file);
  }
  try {
    const plan = readScenePlan(manifest);
    check('normalized scenes', plan.scenes.length > 0, `${plan.scenes.length} scenes`);
  } catch (error) {
    check('normalized scenes', false, error.message);
  }

  const environmentResult = materializeEnvironment(referencedEnvironment(manifest), environment);
  check(
    'environment references',
    environmentResult.missing.length === 0,
    environmentResult.missing.length
      ? `missing ${environmentResult.missing.map((item) => item.environmentName).join(', ')}`
      : 'all referenced variables are set',
  );
  try {
    check('ffmpeg', true, resolveFfmpeg(manifest, environment));
  } catch (error) {
    check('ffmpeg', false, error.message);
  }
  if (manifest.narration.mode === 'macos-say') {
    check('macOS say', fs.existsSync('/usr/bin/say'), '/usr/bin/say');
    check('macOS afinfo', fs.existsSync('/usr/bin/afinfo'), '/usr/bin/afinfo');
  }
  try {
    await loadPlaywright();
    check('Playwright', true, 'resolved from the installed skill');
  } catch (error) {
    check('Playwright', false, error.message);
  }
  try {
    const driver = await loadDriver(manifest.driver);
    const readiness = driverReadiness(driver.status);
    productionReady = readiness.productionReady;
    check(
      'driver readiness',
      readiness.ok,
      readiness.detail,
      { productionReady: readiness.productionReady },
    );
    check(
      'state contract',
      Boolean(driver.status?.mutatesState) === manifest.state.mutatingActions,
      `driver=${Boolean(driver.status?.mutatesState)} manifest=${manifest.state.mutatingActions}`,
    );
  } catch (error) {
    check('driver module', false, error.message);
  }
  const app = await checkUrl(
    manifest.app.lifecycle.readyUrl ?? manifest.app.url,
    3000,
  );
  check('app URL', app.ok, app.ok ? `HTTP ${app.status}` : app.error ?? `HTTP ${app.status}`);
  return {
    ok: checks.every((entry) => entry.ok),
    recordReady: checks.every((entry) => entry.ok) && productionReady,
    checks,
    note: 'Preflight is read-only and never starts the configured lifecycle. Driver readiness is informational so incomplete drivers can be rehearsed and repaired; record remains gated.',
  };
}
