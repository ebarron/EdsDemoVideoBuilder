#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  finishRecording,
  loadManifest,
  preflightDemo,
  readScenePlan,
  runDemo,
  syncScenePlan,
  verifyRecording,
  writeScaffold,
} from '../runtime/index.mjs';

const HELP = `narrated-browser-demo

Usage:
  demo.mjs init --script <markdown> --url <app-url> --id <demo-id>
                [--app-cwd <dir>] [--output-dir <dir>]
  demo.mjs sync --manifest <demo.yaml> [--write | --check]
  demo.mjs validate --manifest <demo.yaml>
  demo.mjs preflight --manifest <demo.yaml>
  demo.mjs rehearse --manifest <demo.yaml>
  demo.mjs record --manifest <demo.yaml>
  demo.mjs finish --manifest <demo.yaml> [--force]
  demo.mjs verify --manifest <demo.yaml>

Safety:
  init never overwrites files. sync previews by default; --write makes a backup
  and atomically replaces only scene-plan.json. --check exits nonzero on drift.
  preflight is read-only. rehearse does not record.
  finish never overwrites final artifacts unless --force is explicit.
  Timeouts reject takes; only observed successful waits may be compressed.
`;

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (['force', 'write', 'check', 'help'].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = tokens[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    options[key] = value;
  }
  return { command, options };
}

function required(options, name) {
  if (!options[name]) throw new Error(`Missing required option --${name}`);
  return options[name];
}

async function validate(manifestPath) {
  const loaded = loadManifest(manifestPath);
  const manifest = loaded.resolved;
  const missing = [
    manifest.script,
    manifest.scenePlan,
    manifest.driver,
    manifest.app.cwd,
  ].filter((entry) => !fs.existsSync(entry));
  if (missing.length) throw new Error(`Manifest references missing paths:\n- ${missing.join('\n- ')}`);
  const plan = readScenePlan(manifest);
  const driver = await import(`${pathToFileURL(manifest.driver).href}?validate=${Date.now()}`);
  if (driver.default?.apiVersion !== 1) throw new Error('Driver must default-export apiVersion: 1');
  return {
    valid: true,
    manifest: loaded.path,
    id: manifest.id,
    scenes: plan.scenes.length,
    productionReady: Boolean(driver.default.status?.productionReady),
  };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (!command || command === 'help' || options.help) {
    console.log(HELP);
    return;
  }
  if (command === 'init') {
    const result = writeScaffold({
      script: required(options, 'script'),
      url: required(options, 'url'),
      id: required(options, 'id'),
      appCwd: options['app-cwd'],
      outputDir: options['output-dir'],
    });
    console.log(JSON.stringify({
      initialized: result.outputDir,
      files: [...result.files.keys()],
      scenes: result.plan.scenes.length,
      next: 'Review scene-plan.json, probe the app, and replace driver TODOs before recording.',
    }, null, 2));
    return;
  }

  const manifestPath = required(options, 'manifest');
  if (command === 'sync') {
    if (options.write && options.check) {
      throw new Error('Choose either --write or --check for sync, not both');
    }
    const result = syncScenePlan({ manifestPath, write: options.write });
    const { plan: _plan, ...summary } = result;
    console.log(JSON.stringify(summary, null, 2));
    if (options.check && result.diff.changed) process.exitCode = 1;
    return;
  }
  if (command === 'validate') {
    console.log(JSON.stringify(await validate(manifestPath), null, 2));
    return;
  }
  const { resolved: manifest } = loadManifest(manifestPath);
  if (command === 'preflight') {
    const result = await preflightDemo(manifest);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else if (command === 'rehearse') {
    console.log(JSON.stringify(await runDemo(manifest, { rehearsal: true }), null, 2));
  } else if (command === 'record') {
    console.log(JSON.stringify(await runDemo(manifest, { rehearsal: false }), null, 2));
  } else if (command === 'finish') {
    console.log(JSON.stringify(finishRecording(manifest, { force: options.force }), null, 2));
  } else if (command === 'verify') {
    console.log(JSON.stringify(verifyRecording(manifest), null, 2));
  } else {
    throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
