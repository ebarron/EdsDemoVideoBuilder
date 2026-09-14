import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MARKDOWN = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'SKILL.md'),
  ...fs.readdirSync(path.join(ROOT, 'references'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(ROOT, 'references', name)),
];
const SKILL = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
const DRIVER_API = fs.readFileSync(path.join(ROOT, 'references', 'driver-api.md'), 'utf8');
const FFMPEG = fs.readFileSync(
  path.join(ROOT, 'references', 'ffmpeg-and-validation.md'),
  'utf8',
);
const MANIFEST = fs.readFileSync(path.join(ROOT, 'references', 'manifest.md'), 'utf8');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'references', 'ordered-cues-migration.md'),
  'utf8',
);
const SCRIPT_CONVENTION = fs.readFileSync(
  path.join(ROOT, 'references', 'script-convention.md'),
  'utf8',
);
const WORKFLOW = fs.readFileSync(path.join(ROOT, 'references', 'production-workflow.md'), 'utf8');

test('local Markdown links resolve', () => {
  for (const file of MARKDOWN) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]+]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|#)/.test(link)) continue;
      assert.equal(
        fs.existsSync(path.resolve(path.dirname(file), link)),
        true,
        `${path.relative(ROOT, file)} has a missing link: ${link}`,
      );
    }
  }
});

test('skill documents watchable and resilient driver defaults', () => {
  for (const pattern of [
    /visible and unique/,
    /waitNarrationFraction/,
    /busy-complete/,
    /restoration independent of recorded pointer helpers/,
    /Do not overlap rehearsals/,
    /every recorded scroll slow and\s+smooth by default/,
    /Jump only when the user explicitly requests it/,
    /wait for a stable\s+box, measure, travel, remeasure, prove pointer overlap/,
    /Capture click-time evidence for\s+critical interactions/,
    /never overlap scroll, pointer travel, typing, or\s+layout motion/,
    /Do not ask the user to label ordinary edits/,
    /narration-only.+do not edit\s+`driver\.mjs`/s,
    /Keep narration and its\s+visual directions interleaved in viewer order/,
    /Do not insert JSON\s+or machine metadata into the user's narration file/,
    /`representation-only` migration with no driver review/,
    /alignment.+require\s+review of that action's narration checkpoint/s,
    /semantic targets in one locator factory or page\s+object/,
    /app\.allowInsecureTls: true/,
    /Never set\s+`NODE_TLS_REJECT_UNAUTHORIZED=0`/,
    /Preserve\s+`timeline.meta.videoStart` as that media-clock origin/,
    /legacy captures use\s+`videoStart \?\? 0`/,
    /duration as an optional\s+constraint, never as the quality goal/,
  ]) {
    assert.match(SKILL, pattern);
  }
  for (const pattern of [
    /exactly one visible\s+element/,
    /about 900 ms of visible pointer travel/,
    /types sequentially/,
    /sentence should own\s+the action/,
    /Read each scene's ordered `cues` in source order/,
    /busy state appears, then it\s+clears/,
    /Recorded pointer, typing, and scene helpers are\s+intentionally unavailable/,
    /default duration is 1\.6 seconds/,
    /An explicit\s+`scroll: 'instant'`.+allowed only\s+when the user asks for a jump/s,
    /settle → measure → travel → settle and remeasure → verify overlap\/hit target → click/,
    /`elementFromPoint\(\)` resolves to the\s+target/,
    /All recorded motion helpers share a queue/,
    /Set `evidence: true` on each critical `click`/,
  ]) {
    assert.match(DRIVER_API, pattern);
  }
  for (const pattern of [
    /Playwright video begins when the recorded page is created/,
    /FFmpeg trim and\s+compression boundaries subtract this offset/,
    /Legacy timelines use\s+`videoStart \?\? 0`/,
  ]) {
    assert.match(FFMPEG, pattern);
  }
  for (const pattern of [
    /app\.allowInsecureTls` defaults to `false`/,
    /ignoreHTTPSErrors: true` on both the unrecorded\s+authentication\/preparation context and the recorded browser context/,
    /Preflight and lifecycle checks also accept the self-signed certificate/,
    /Never use\s+`NODE_TLS_REJECT_UNAUTHORIZED=0`/,
  ]) {
    assert.match(MANIFEST, pattern);
  }
  for (const pattern of [
    /Users do not need to classify changes/,
    /Moving an unchanged stage direction.+without\s+crossing a narration\/action boundary.+not a choreography change/s,
    /English square-bracket direction may also appear inline/,
    /New authoring uses English headings,\s+spoken prose, and English square-bracket\s+directions/,
    /reports `representation-only` and\s+`driverReviewRequired: false`/,
    /does not change `scene\.narration`,\s+`scene\.actions`, driver hooks, or scene-based\s+narration clip names/,
    /isolated seed\/setup and reset procedure/,
  ]) {
    assert.match(SCRIPT_CONVENTION, pattern);
  }
  for (const pattern of [
    /Do not convert this file to JSON/,
    /Scene-plan `version` remains `1`/,
    /Existing plans without `scene\.cues` are accepted/,
    /Sync never rewrites the Markdown/,
    /`representation-only` with\s+`driverReviewRequired: false`/,
    /old parser may have included an inline `\[Click \.\.\.\]` direction in spoken\s+narration/,
    /not enough information to infer which sentence owns each detached\s+direction/,
  ]) {
    assert.match(MIGRATION, pattern);
  }
  for (const pattern of [
    /Never overlap rehearsals/,
    /probe that step directly/,
    /API or fixture\s+reset/,
    /Every recorded scroll is slow and smooth by default/,
    /Jump scrolling requires an explicit user\s+request/,
    /realign or reject the take; never add a pixel fudge/,
    /Driver exit status proves function, not visual\s+alignment/,
    /Infer and\s+report this internally without requiring the user/,
    /optional\s+constraint, not a quality target/,
  ]) {
    assert.match(WORKFLOW, pattern);
  }
});
