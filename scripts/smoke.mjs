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
const smokeVideo = spawnSync(ffmpeg, [
  '-v', 'error',
  '-f', 'lavfi',
  '-i', 'color=c=black:s=320x180:r=25:d=3',
  '-an',
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-movflags', 'frag_keyframe+empty_moov',
  '-f', 'mp4',
  '-',
], { timeout: 60_000 });
assert.equal(smokeVideo.status, 0, `Could not create smoke video:\n${smokeVideo.stderr}`);
const smokePrompts = Array.from({ length: 24 }, (_, index) => ({
  sceneId: `scene-${index}`,
  title: index === 0 ? 'Intro' : index === 1 ? 'Storage' : `Scene ${index + 1}`,
  text: index === 0 ? 'Introduce the demo.' : `Narration for scene ${index + 1}.`,
  start: index,
  end: index + 1,
  windowDuration: 1,
}));

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
  let smokeAccepted = false;
  let cleanupRequested = false;
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
          pictureLock: { finalDuration: 24 },
          prompts: smokePrompts,
          takes: [{
            id: 'intro-take',
            kind: 'scene',
            sceneId: 'scene-0',
            effectiveDuration: 0.8,
            fit: { status: 'fits' },
          }],
          accepted: {
            master: null,
            scenes: smokeAccepted ? { 'scene-0': 'intro-take' } : {},
          },
        }),
      });
    } else if (url.pathname === '/api/accept-latest') {
      const body = route.request().postDataJSON();
      cleanupRequested = body.cleanup === true;
      smokeAccepted = true;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          accepted: [{ sceneId: 'scene-0', takeId: 'intro-take' }],
          selected: 1,
          deleted: 0,
        }),
      });
    } else if (url.pathname === '/api/complete') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ completedAt: new Date().toISOString() }),
      });
    } else if (url.pathname === '/api/take-audio') {
      await route.fulfill({ contentType: 'audio/wav', body: waveBuffer() });
    } else if (url.pathname === '/video') {
      await route.fulfill({ contentType: 'video/mp4', body: smokeVideo.stdout });
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
  assert.equal(
    await page.getByRole('button', { name: 'Use latest eligible takes' }).isEnabled(),
    true,
  );
  const cleanupTakes = page.getByLabel('Delete other takes after selection');
  assert.equal(await cleanupTakes.isChecked(), false);
  assert.equal(await page.getByRole('heading', { name: 'Take history' }).count(), 0);
  assert.equal(await page.getByText('Take history (1)').isVisible(), true);
  await playLatest.click();
  await page.waitForFunction(() =>
    !document.querySelector('[aria-label="Stop latest take for Intro"]').disabled);
  assert.equal(await stopLatest.isEnabled(), true);
  await stopLatest.click();
  assert.equal(await stopLatest.isDisabled(), true);
  await cleanupTakes.check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Use latest eligible takes' }).click();
  await page.waitForFunction(() =>
    document.getElementById('status').textContent.includes('Selected the latest eligible take'));
  assert.equal(cleanupRequested, true);
  const toolbar = page.locator('.studio-toolbar');
  assert.equal(await toolbar.evaluate((element) => getComputedStyle(element).position), 'sticky');
  await page.locator('aside').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  assert.equal(await page.getByRole('button', { name: 'Record full take' }).isVisible(), true);
  await page.locator('video').evaluate((element) => new Promise((resolve) => {
    if (element.readyState >= 1) resolve();
    else element.addEventListener('loadedmetadata', resolve, { once: true });
  }));
  await page.locator('[data-scene="scene-1"]').click();
  await page.locator('video').evaluate((element) => {
    element.currentTime = 0.95;
    element.dispatchEvent(new Event('timeupdate'));
  });
  assert.equal(await page.locator('#prompt-title').textContent(), 'Storage');
  assert.equal(await page.locator('#prompt-text').textContent(), 'Narration for scene 2.');
  await page.getByRole('button', { name: 'Save and close studio' }).click();
  await page.getByRole('heading', { name: 'Voiceover session saved' })
    .waitFor({ state: 'visible' });
  assert.match(
    await page.locator('#handoff-prompt').inputValue(),
    /Finish and verify the saved human-voiceover video/,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Copy handoff prompt' }).isEnabled(),
    true,
  );
  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
}

console.log('Pointer alignment, voiceover studio, Chromium, and package-local FFmpeg are ready.');
