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
    /duration as an optional\s+constraint, never as the quality goal/,
  ]) {
    assert.match(SKILL, pattern);
  }
  for (const pattern of [
    /exactly one visible\s+element/,
    /about 900 ms of visible pointer travel/,
    /types sequentially/,
    /sentence should own\s+the action/,
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
    /Never overlap rehearsals/,
    /probe that step directly/,
    /API or fixture\s+reset/,
    /Every recorded scroll is slow and smooth by default/,
    /Jump scrolling requires an explicit user\s+request/,
    /realign or reject the take; never add a pixel fudge/,
    /Driver exit status proves function, not visual\s+alignment/,
    /optional\s+constraint, not a quality target/,
  ]) {
    assert.match(WORKFLOW, pattern);
  }
});
