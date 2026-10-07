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
    /### 1\. Ask Cursor with the script inline[\s\S]*?```text\n[\s\S]*?docs\/DemoScript\.md:\n([\s\S]*?)\n```/,
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
    /Open the app project in Cursor and paste one prompt containing your demo\s+script/,
    /prepares the demo, manages the app, records the browser flow,\s+and opens the finished video/,
    /Save the content below as docs\/DemoScript\.md and treat it as the\s+authoritative script/,
    /required\s+access credentials or authorization for state-changing actions/,
    /starts or\s+reuses the app as needed/,
    /initializes the managed demo files automatically/,
    /Repository inspection, browser-flow repair, rehearsal, finishing, and\s+validation are built into the skill/,
    /rather than restating those internal steps/,
    /no manual server\s+step is expected/,
    /already have a Markdown script, you can reference its\s+path instead/,
    /Start a new Cursor chat or reload Cursor/,
    /The video is close\. In the storage section/,
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
    /Prepare or repair the local Kokoro runtime/,
    /New demos default to Kokoro ONNX with `af_heart`/,
    /Install and update prepare the separate locked runtime/,
    /rerecord the video with my own voice using the teleprompter/,
    /video is always muted/,
    /continuous full take and scene-level punch-in retakes/,
    /Play\/Stop\s+controls directly on recorded scene rows/,
    /Each scene folds its prior takes into a collapsed local history/,
    /Use latest eligible takes/,
    /cleanup option can permanently delete other takes and their audio files/,
    /Delete for removing an accidental scene or full take/,
    /in-use take must first\s+be replaced or cleared/,
    /one-click Use anyway action/,
    /trims only audio beyond the locked scene boundary/,
    /Saving visibly closes the\s+recording session/,
    /saving lists any segments without an in-use scene\s+take and asks before closing/,
    /saved screen provides a copyable prompt for that handoff/,
    /agent response includes a clickable video link and an exact\s+prompt/,
    /prompt-driven revisions can reopen and\s+regenerate it without losing prior takes/,
    /Recording itself does not\s+replace\s+accepted selections/,
    /recording\s+toolbar[\s\S]{0,12}stays\s+pinned/,
    /selected-scene\s+recording pins\s+the\s+correct prompt/,
    /Managed app processes receive only portable startup\s+environment values/,
    /one-use launch value is removed from the URL before use and is never printed/,
    /All demo-building interactions are prompt driven/,
    /Rehearse and repair without recording/,
    /Record a finished synthetic-voice demo/,
    /Update a script and rerecord/,
    /Rerecord visual behavior without changing narration/,
    /Change the synthetic voice/,
    /Use supplied narration or make a silent demo/,
    /Record with your own voice/,
    /Reopen an existing human-voice session/,
    /Update visuals and reuse existing human voice/,
    /Update a script after recording human voice/,
    /Resume an interrupted finish or validation/,
    /Users do not need to\s+run Node commands or name the internal rebase operation/,
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
    /rm -rf|--delete|NABox|Harvest|project-local|received colleague|rsync|SOURCE=|node scripts\/demo\.mjs|--rebase|--new-session|voiceover-finish|voiceover-verify/i,
  );
});
