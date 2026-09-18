import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseDemoScript } from '../runtime/parser.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

test('README first-demo script interleaves narration and directions', () => {
  const example = README.match(
    /### 1\. Write or edit the Markdown script[\s\S]*?```markdown\n([\s\S]*?)\n```/,
  )?.[1];
  assert.ok(example, 'README Markdown example was not found');
  const plan = parseDemoScript(example, { source: 'README.md' });
  assert.equal(plan.scenes.length, 1);
  assert.equal(
    plan.scenes[0].narration,
    'This dashboard shows request volume and service health at a glance.\n\n' +
      'The traffic chart makes the morning peak easy to see.',
  );
  assert.deepEqual(
    plan.scenes[0].actions.map(({ direction }) => direction),
    [
      'Open Analytics from the main navigation.',
      'Point to Requests per minute, then scroll to Service health.',
    ],
  );
  assert.deepEqual(
    plan.scenes[0].cues.map((cue) => cue.kind),
    ['narration', 'action', 'narration', 'action'],
  );
});

test('README links resolve and prompt states safety gates', () => {
  const links = [...README.matchAll(/\[[^\]]+]\(([^)]+)\)/g)].map((match) => match[1]);
  assert.ok(links.length > 0);
  for (const link of links) {
    if (/^(?:https?:|#)/.test(link)) continue;
    assert.equal(fs.existsSync(path.resolve(ROOT, link)), true, `missing README link: ${link}`);
  }
  for (const pattern of [
    /docs\/ProductDemoScript\.md/,
    /http:\/\/127\.0\.0\.1:5173/,
    /docs\/video\/ProductDemo\.mp4/,
    /Option A — Natural-language request/,
    /\*\*OR\*\*/,
    /Option B — Explicit slash command/,
    /\/demo-video-builder Record a demo from docs\/ProductDemoScript\.md/,
    /`@` adds a file or other context to a prompt; it does not invoke a/,
    /Start a new Cursor chat or reload Cursor/,
    /The video is close\. In the storage section/,
    /\/demo-video-builder The video is close\./,
    /never\*\* guess or persist credential values/i,
    /asks for explicit authorization and restoration requirements/,
    /app\.allowInsecureTls: true/,
    /never changes global\s+Node\.js TLS settings/,
    /classifies the diff internally; you do not need to label it/,
    /Wording-only edits update narration without changing the driver/,
    /English\s+square-bracket directions interleaved/,
    /Do not collect actions in a separate section or add JSON to\s+the narration file/,
    /reports\s+`representation-only`/,
    /existing\s+`scene\.narration`, `scene\.actions`, driver API, and narration clip names remain\s+compatible/,
    /old\s+parser did not recognize it inside a prose line/,
    /never rewrites the Markdown/,
    /node scripts\/demo\.mjs kokoro-setup/,
    /New demos default to Kokoro ONNX with `af_heart`/,
    /Install and update prepare the separate locked runtime/,
    /rerecord the video with my own voice using the teleprompter/,
    /video is always muted/,
    /continuous full take and scene-level punch-in retakes/,
    /Play\/Stop\s+controls directly on recorded scene rows/,
    /Each scene folds its prior takes into a collapsed local history/,
    /Use latest eligible takes/,
    /Recording itself does not\s+replace accepted selections/,
    /recording\s+toolbar stays pinned/,
    /selected-scene\s+recording pins the correct prompt/,
    /node scripts\/demo\.mjs voiceover-finish/,
    /Human output uses `-human` filenames and never overwrites the\s+synthetic version/,
    /gh repo clone ebarron\/EdsDemoVideoBuilder "\$HOME\/\.cursor\/skills\/demo-video-builder"/,
    /"\$HOME\/\.cursor\/skills\/demo-video-builder\/scripts\/install\.sh"/,
    /git -C "\$HOME\/\.cursor\/skills\/demo-video-builder" pull --ff-only/,
  ]) {
    assert.match(README, pattern);
  }
  assert.equal((README.match(/gh repo clone/g) ?? []).length, 1);
  assert.doesNotMatch(
    README,
    /rm -rf|--delete|NABox|Harvest|project-local|received colleague|rsync|SOURCE=/i,
  );
});
