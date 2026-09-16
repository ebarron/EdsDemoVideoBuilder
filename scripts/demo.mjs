#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  createVoiceoverStudio,
  ensureKokoroModel,
  finishRecording,
  finishVoiceover,
  loadManifest,
  kokoroSettings,
  preflightDemo,
  readScenePlan,
  runDemo,
  setupKokoroRuntime,
  syncScenePlan,
  verifyRecording,
  verifyVoiceoverArtifacts,
  voiceoverVerificationManifest,
  writeScaffold,
} from '../runtime/index.mjs';

const HELP = `demo-video-builder — Demo Video Builder

Usage:
  demo.mjs init --script <markdown> --url <app-url> --id <demo-id>
                [--app-cwd <dir>] [--output-dir <dir>]
  demo.mjs kokoro-setup
  demo.mjs sync --manifest <demo.yaml> [--write | --check]
  demo.mjs validate --manifest <demo.yaml>
  demo.mjs preflight --manifest <demo.yaml>
  demo.mjs rehearse --manifest <demo.yaml>
  demo.mjs record --manifest <demo.yaml>
  demo.mjs finish --manifest <demo.yaml> [--force]
  demo.mjs verify --manifest <demo.yaml>
  demo.mjs voiceover --manifest <demo.yaml> [--new-session] [--no-open]
                     [--port <number>]
  demo.mjs voiceover-finish --manifest <demo.yaml> [--force]
  demo.mjs voiceover-verify --manifest <demo.yaml>

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
    if (['force', 'write', 'check', 'help', 'new-session', 'no-open'].includes(key)) {
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
  if (command === 'kokoro-setup') {
    const runtime = setupKokoroRuntime();
    const settings = kokoroSettings({
      narration: { kokoro: { allowModelDownload: true } },
    });
    const model = ensureKokoroModel(settings);
    console.log(JSON.stringify({
      ...runtime,
      defaultModel: {
        model: settings.model,
        dtype: settings.dtype,
        ...model,
      },
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
  } else if (command === 'voiceover') {
    const port = options.port === undefined ? 0 : Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('--port must be an integer from 0 through 65535');
    }
    const studio = await createVoiceoverStudio(manifest, {
      port,
      open: !options['no-open'],
      newSession: options['new-session'],
      environment: process.env,
    });
    console.log(JSON.stringify({
      voiceoverStudio: studio.url,
      session: studio.directory,
      created: studio.created,
      next: 'Record a full take or every scene, then choose Save and close studio.',
    }, null, 2));
    console.log(JSON.stringify(await studio.done, null, 2));
  } else if (command === 'voiceover-finish') {
    console.log(JSON.stringify(finishVoiceover(manifest, {
      force: options.force,
    }), null, 2));
  } else if (command === 'voiceover-verify') {
    console.log(JSON.stringify({
      media: verifyRecording(voiceoverVerificationManifest(manifest)),
      voiceover: verifyVoiceoverArtifacts(manifest),
    }, null, 2));
  } else {
    throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
