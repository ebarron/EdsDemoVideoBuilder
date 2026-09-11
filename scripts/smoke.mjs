#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { chromium } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';

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
  await page.setContent('<title>narrated-browser-demo smoke test</title>');
  assert.equal(await page.title(), 'narrated-browser-demo smoke test');
} finally {
  await browser?.close();
}

console.log('Playwright Chromium and package-local FFmpeg are ready.');
