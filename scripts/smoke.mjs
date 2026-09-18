#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { chromium } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';

import { createBrowserHelpers, installDemoPointer } from '../runtime/browser.mjs';
import { voiceoverStudioHtml } from '../runtime/voiceover-ui.mjs';

function waveBuffer(seconds = 2) {
  const sampleRate = 48000;
  const samples = Math.round(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

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
  await page.route('http://voiceover-smoke.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') {
      await route.fulfill({
        contentType: 'text/html',
        body: voiceoverStudioHtml('smoke-token'),
      });
    } else if (url.pathname === '/api/session') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          pictureLock: { finalDuration: 2 },
          prompts: [{
            sceneId: 'intro',
            title: 'Intro',
            text: 'Introduce the demo.',
            start: 0,
            end: 2,
            windowDuration: 2,
          }],
          takes: [{
            id: 'intro-take',
            kind: 'scene',
            sceneId: 'intro',
            effectiveDuration: 1.5,
            fit: { status: 'fits' },
          }],
          accepted: { master: null, scenes: {} },
        }),
      });
    } else if (url.pathname === '/api/take-audio') {
      await route.fulfill({ contentType: 'audio/wav', body: waveBuffer() });
    } else {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto('http://voiceover-smoke.test/');
  assert.equal(
    await page.getByRole('button', { name: 'Record full take' }).isVisible(),
    true,
  );
  assert.equal(await page.getByLabel('Microphone').isVisible(), true);
  assert.equal(await page.locator('video').evaluate((element) => element.muted), true);
  assert.equal(await page.locator('#take-player').count(), 1);
  const playLatest = page.getByRole('button', { name: 'Play latest take for Intro' });
  const stopLatest = page.getByRole('button', { name: 'Stop latest take for Intro' });
  assert.equal(await playLatest.isVisible(), true);
  await playLatest.click();
  await page.waitForFunction(() =>
    !document.querySelector('[aria-label="Stop latest take for Intro"]').disabled);
  assert.equal(await stopLatest.isEnabled(), true);
  await stopLatest.click();
  assert.equal(await stopLatest.isDisabled(), true);
  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
}

console.log('Pointer alignment, voiceover studio, Chromium, and package-local FFmpeg are ready.');
