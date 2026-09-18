#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { chromium } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';

import { createBrowserHelpers, installDemoPointer } from '../runtime/browser.mjs';
import { voiceoverStudioHtml } from '../runtime/voiceover-ui.mjs';

assert.ok(ffmpeg && fs.existsSync(ffmpeg), 'Package-local FFmpeg binary is missing');
const ffmpegVersion = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' });
assert.equal(
  ffmpegVersion.status,
  0,
  `Package-local FFmpeg failed:\n${ffmpegVersion.stderr || ffmpegVersion.stdout}`,
);

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`
    <title>demo-video-builder smoke test</title>
    <style>html { zoom: 1.25; }</style>
    <button
      aria-label="Pointer target"
      onclick="document.body.dataset.clicked = 'true'"
      style="position: absolute; left: 120px; top: 100px"
    >Target</button>
  `);
  await page.evaluate(installDemoPointer);
  assert.equal(await page.title(), 'demo-video-builder smoke test');
  const timeline = {
    actions: [],
    scrolls: [],
    elapsed: () => 0,
    markAction(id, kind, details) {
      const entry = { id, kind, at: 0, ...details };
      this.actions.push(entry);
      return entry;
    },
  };
  const helpers = createBrowserHelpers({
    page,
    timeline,
    pause: (milliseconds) => page.waitForTimeout(milliseconds),
    viewport: page.viewportSize(),
  });
  await helpers.click(
    page.getByRole('button', { name: 'Pointer target' }),
    'smoke.pointer-target',
    {
      downMs: 0,
      hold: 0,
      layoutIntervalMs: 1,
      layoutSamples: 2,
      travelMs: 0,
    },
  );
  assert.equal(await page.locator('body').getAttribute('data-clicked'), 'true');
  assert.equal(timeline.actions.at(-1).pointerProof.overlap, true);
  assert.equal(timeline.actions.at(-1).pointerProof.hitMatches, true);

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setContent(voiceoverStudioHtml('smoke-token'));
  assert.equal(
    await page.getByRole('button', { name: 'Record full take' }).isVisible(),
    true,
  );
  assert.equal(await page.getByLabel('Microphone').isVisible(), true);
  assert.equal(await page.locator('video').evaluate((element) => element.muted), true);
  assert.equal(await page.locator('#take-player').count(), 1);
  assert.match(await page.content(), /data-play-take/);
  assert.match(await page.content(), /data-stop-take/);
  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
}

console.log('Pointer alignment, voiceover studio, Chromium, and package-local FFmpeg are ready.');
