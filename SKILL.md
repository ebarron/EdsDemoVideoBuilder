---
name: demo-video-builder
description: Demo Video Builder creates, rehearses, records, finishes, and validates narrated Playwright browser demos from Markdown scripts, including default Kokoro narration and final human voiceover. Use when the user asks to record a narrated browser demo, initialize a demo manifest and driver, repair demo selectors, finish or validate video artifacts, improve the synthetic voice, rerecord a video with their own voice, or use a teleprompter/teleprompt workflow.
---

# Demo Video Builder

Build real browser recordings from a Markdown narrative. New demos default to
local Kokoro ONNX narration, while existing `macos-say`, `clips`, `reference`,
and `silent` manifests remain supported. Keep reusable orchestration in this
skill and application knowledge in a per-demo `demo.yaml`, normalized
`scene-plan.json`, and `driver.mjs`.

The user normally edits only the Markdown script and, optionally, supplies
voice clips. The agent owns generated configuration and browser choreography:

- Markdown is the human source of narration and intent. Keep narration and its
  visual directions interleaved in viewer order.
- `scene-plan.json` is generated normalized output; ordered `scene.cues`
  preserve that authoring sequence while compatibility projections retain
  `scene.narration` and `scene.actions`. Update it with `sync`.
- `demo.yaml` is agent-managed recording/runtime configuration unless the user
  asks for advanced control.
- `driver.mjs` is agent-generated and agent-maintained executable app
  choreography.
- `building-the-video.md` is updated by the agent with proven operational
  lessons.

## Start by settling material inputs

Infer values already present in the request, repository, and running app. Ask
only for missing choices that materially affect safety or output:

- source script path;
- app URL;
- app cwd/start command only when repository inspection cannot determine it;
- authentication flow and environment-variable names only when login is
  required (never guess secret values);
- self-signed TLS authorization only when an HTTPS demo probe reports a
  certificate error—the default is strict certificate validation;
- output paths when omitted;
- optional narration/browser overrides—the default is Kokoro synthetic speech
  and standard video settings;
- authorization, baseline, and restoration only when the script requests a
  write—the default state policy is read-only.

Do not put passwords, tokens, cookies, or credentials in a manifest, driver,
chat output, or command line. Pass only environment-variable names in
`auth.env`. Prefer an isolated fixture. Login and presentation setup happen in
an unrecorded context.

For a known self-signed demo endpoint, set `app.allowInsecureTls: true`. This
scopes certificate bypass to that manifest's preflight/lifecycle URL checks and
Playwright preparation/recording contexts. Never set
`NODE_TLS_REJECT_UNAUTHORIZED=0` or disable certificate validation globally.

## Initialize once

Run from the installed skill directory after `scripts/install.sh`:

```bash
node scripts/demo.mjs init \
  --script /absolute/path/to/docs/demo.md \
  --url http://localhost:5173 \
  --id product-demo \
  --app-cwd /absolute/path/to/app
```

`init` creates `demo.yaml`, `scene-plan.json`, `driver.mjs`, and
`building-the-video.md` without overwriting any existing file. Read
[references/script-convention.md](references/script-convention.md) when
normalizing a script and [references/manifest.md](references/manifest.md) when
editing configuration.

Treat ordinary paragraphs and blockquotes as narration. Treat standalone
italic/bracketed directions and inline English action directions such as
`[Click Analytics.]` as actions. Keep each action beside the words it supports;
never extract all actions into a separate section or file. Do not insert JSON
or machine metadata into the user's narration file. Existing `demo:scene` and
`demo:action` comments remain readable only for backward compatibility. Legacy
parsing is intentionally reviewable, not magical: inspect the normalized plan
and remove presenter notes, appendices, or non-spoken material.

The natural-language requests “initialize,” “rehearse and repair,” “record,”
and “finish/validate” are independent entry points, not mandatory commands the
user must issue in sequence. A user may ask for the finished video directly.
The agent internally initializes, preflights, probes/repairs, and rehearses as
needed before recording, then finishes and verifies. Ask the user only for
material ambiguity or required write authorization—not a routine extra
rehearsal approval.

## Resynchronize an edited script

Markdown remains the source. After it changes, preview and then apply:

```bash
node scripts/demo.mjs sync --manifest path/to/demo.yaml
node scripts/demo.mjs sync --manifest path/to/demo.yaml --write
```

Preview reports added, removed, and changed scenes/actions/cue alignment.
`--write` creates a unique backup and atomically replaces the plan. `--check`
is available for drift checks. Stable IDs and existing custom hints are
retained when title, explicit ID, action text, or action ID gives a
deterministic match. Default parser exclusions remove appendices, Building the
video/internal notes, and caption sections from narration.

Existing v1 plans without `scene.cues` remain readable. If their standalone
directions were already recognized as actions, the first sync reports a
`representation-only` migration with no driver review, and `--write` adds
ordered cues without removing or changing the compatibility `narration` and
`actions` fields. An inline English `[Click ...]` direction that the old parser
treated as spoken text is now removed from narration and added as an action;
that semantic migration requires driver review. If the Markdown itself still
interleaves directions, do not rewrite it. If a prior workflow physically
separated all directions from narration, do not guess their intended
placement: restore each direction beside the relevant spoken words, preview
the alignment changes, then update affected narration checkpoints before
rerecording. Follow
[references/ordered-cues-migration.md](references/ordered-cues-migration.md)
for current-demo upgrade cases.

Before editing generated artifacts, classify the change internally. The sync
preview labels deterministic script changes; supplement it with live evidence:

- **narration-only** changes update the plan/audio and do not edit
  `driver.mjs`;
- **timing-only** changes update cue checkpoints or timing values, not
  locators;
- **alignment** changes move an action across a narration boundary and require
  review of that action's narration checkpoint;
- **choreography** changes add, remove, reorder, or alter browser actions;
- **locator/layout** changes repair semantic targets after observed UI drift;
- **functional** changes update event boundaries, state handling, or
  restoration after observed behavior changes.

Classifications may combine. Do not ask the user to label ordinary edits;
infer them from the sync diff, driver, and running app, then report the result.
Only ask when ambiguity materially affects safety or output. If a
narration-only request coincides with unrelated app drift, describe that drift
separately rather than attributing driver churn to the copy edit.

If a legacy hand-curated plan previews broad structural churn because its
scene splits are absent from Markdown, do not write. Reconcile the segmentation
with clear English Markdown headings first; do not solve it by adding JSON to
the narration file.

After sync, compare action changes with `driver.mjs`, inspect the running app,
repair affected selectors/actions/boundaries, and internally rehearse again as
needed. Do not claim the CLI can autonomously repair arbitrary apps.

## Generate and repair the app driver

The generated driver is a scaffold, not a claim that natural-language stage
directions can deterministically operate an arbitrary app. The agent must:

1. Inspect existing recording/E2E helpers and the running app.
2. Use Playwright accessibility roles and DOM inspection to prove every
   recorded locator is visible and unique. Scope repeated labels to a stable
   region such as navigation, canvas, dialog, or chat; never hide ambiguity
   with `.first()` or `.nth()`.
3. Keep product-specific semantic targets in one locator factory or page
   object, separate from scene timing and choreography. A layout change should
   normally repair one target definition, not every scene that uses it.
4. Use the recorder's watchable `point`, `click`, and `typeText` helpers for
   viewer-facing interaction. Reserve instant `fill()` and direct DOM actions
   for unrecorded setup, probes, and restoration.
5. Treat the visible pointer and real hit target as one contract. After every
   scroll, expansion, canvas swap, or sticky-layout change, wait for a stable
   box, measure, travel, remeasure, prove pointer overlap and the DOM hit
   target, then click. Never use pixel fudges. Capture click-time evidence for
   critical interactions, and never overlap scroll, pointer travel, typing, or
   layout motion.
6. Give each narrated cue ownership of its action with explicit
   `waitNarrationFraction` checkpoints instead of clustering clicks at the
   start of a scene.
7. Implement each variable operation with initiating, busy/start,
   busy-complete, identity-change/success, and error boundaries.
8. Identify the actual inner scroll owner. Make every recorded scroll slow and
   smooth by default, including automatic target reveals and viewport
   positioning. Use the runtime rAF scroll helper and verify progressive
   0/25/50/75/100 samples. Jump only when the user explicitly requests it.
9. Implement snapshot, restore, and restoration verification hooks. Keep
   restoration independent of recorded pointer helpers and scene locators;
   prefer an API or fixture reset, otherwise use separately proven UI steps.
10. Clear `status.todos` and set `productionReady: true` only after accelerated
   rehearsal succeeds.

Read [references/driver-api.md](references/driver-api.md) for the contract.
Update the per-demo Building the video notes with every proven selector,
boundary, timing lesson, and restoration procedure.

## Internal validation and optional dry rehearsal

```bash
node scripts/demo.mjs validate --manifest path/to/demo.yaml
node scripts/demo.mjs preflight --manifest path/to/demo.yaml
node scripts/demo.mjs rehearse --manifest path/to/demo.yaml
```

`preflight` is read-only and does not start the configured lifecycle.
`rehearse` starts it when configured and executes the driver without recording
at `timing.rehearsalScale`. Repair selectors and boundaries until rehearsal is
clean. Never use a timeout to advance a scene; a watchdog can only reject it.
Do not overlap rehearsals against the same app or fixture. After a late-scene
failure, probe and repair that boundary directly before paying for another
complete rehearsal, especially when earlier actions invoke an API or LLM.
Targeted probes do not replace the final clean end-to-end rehearsal.
The agent may run these checks automatically before a requested full video.
Explicit rehearsal is an optional user request for risky, expensive, new, or
failing demos; it is not a mandatory user-visible gate.
Driver readiness is informational during preflight: a
`productionReady: false` scaffold can and should rehearse while the agent
repairs it. `record` remains hard-gated on `productionReady: true`, which the
agent sets only after successful rehearsal and restoration proof.

Before any take:

- inspect git status and preserve unrelated work;
- prove the state baseline and restoration path;
- verify the output does not replace an existing final artifact;
- use Playwright browser video, never a screenshot montage;
- inject the visible pointer/click pulse and use watchable pointer travel;
- use slow, smooth recorded scrolling unless the user requests a jump;
- prove critical clicks with pointer/target overlap and click-time evidence;
- keep narration concurrent with actions and segmented by scene.

Read [references/production-workflow.md](references/production-workflow.md)
before recording and [references/narration.md](references/narration.md) for
voice options.

## Default Kokoro iteration voice

New scaffolds use Kokoro with `af_heart`, `q8`, and `cpu`. Existing manifests
retain their explicitly configured narration mode and must not be migrated
silently. The installer and updater prepare the reproducibly locked runtime and
pinned, verified default model; rehearsal itself remains download-free. If
those assets are missing, the first production recording repairs them. To
repair or prepare them explicitly, run:

```bash
node scripts/demo.mjs kokoro-setup
```

Kokoro configuration is documented in
[references/narration.md](references/narration.md). Production creates one
measured WAV per scene and caches it with source-coverage metadata. Tokenizer
truncation must remain disabled; recursively split any exact token overflow.
Final verification must match every narrated scene to complete token-safe
coverage and reject unexplained silence inside its audio window. Preflight
checks the isolated runtime only for Kokoro demos.

The current JavaScript phonemizer uses GPL-licensed eSpeak-NG. Keep this a
local, user-initiated runtime and do not bundle or redistribute it. Existing
narration modes must not import, install, probe, or download Kokoro assets.

## Record, finish, and verify

When using `macos-say`, run production recording outside restricted sandboxes
so `say` can write audio:

```bash
node scripts/demo.mjs record --manifest path/to/demo.yaml
node scripts/demo.mjs finish --manifest path/to/demo.yaml
node scripts/demo.mjs verify --manifest path/to/demo.yaml
```

The driver must be production-ready before `record`. A failed action rejects
the take and invokes the separate restoration path. Variable API/LLM waits
require two-phase observation: prove the operation started, then prove busy
state ended and the intended result became uniquely identifiable. Measure only
between the completed initiating action and that observed success. Compress
only successful intervals; keep the click outside the interval and show the
visible fast-forward overlay. Anchor important generated content at the
viewport top before any hold or pan. Optimize for readable narration,
watchable motion, and comprehension. Treat a requested duration as an optional
constraint, never as the quality goal.

The orchestration timeline begins before unrecorded preparation, while raw
Playwright video begins with the recorded page. Preserve
`timeline.meta.videoStart` as that media-clock origin and normalize only raw
video trim, compression, and duration boundaries. Keep narration and canonical
timeline events on the orchestration clock; legacy captures use
`videoStart ?? 0`.

The finisher uses explicit content bounds, CFR 25 fps H.264/AAC, 48 kHz audio,
and faststart. Audio uses finite `apad=whole_dur` followed by `atrim`, and the
output gets an explicit `-t`. Never combine indefinite `apad`/`amix` output
with `-shortest`. Verification performs full decode, metadata, faststart,
contact-sheet, and progressive-frame checks. Read
[references/ffmpeg-and-validation.md](references/ffmpeg-and-validation.md).
`finish` and `verify` may be invoked independently when a raw capture already
exists or finishing/validation needs recovery.

## Human narration

Keep the synthetic version through iteration. After the user approves a
finished picture, treat natural-language requests such as these as a direct
voiceover-studio trigger:

- “Now let’s rerecord the video with my own voice using the teleprompter.”
- “Open the teleprompter so I can narrate this demo.”
- “Replace the synthetic narration with my voice.”

Do not require the user to name a command, manifest, or workflow when the
current demo is unambiguous from recent context and finished artifacts. Locate
its manifest, confirm the finished synthetic video and timeline are available,
then open the studio. Ask only which demo to use when multiple plausible
picture-lock candidates exist.

The equivalent internal command is:

```bash
node scripts/demo.mjs voiceover --manifest path/to/demo.yaml
```

The studio must play the locked video muted, show the current and next spoken
cues, request microphone permission in the local browser, and retain every full
or scene-level take. It normalizes accepted recordings to 48 kHz mono WAV.
Overlong takes require a natural retake; never speed up human speech or browser
motion.

After the user saves and closes the studio, finish and verify the separate
human-voice output automatically unless they asked only to capture takes:

```bash
node scripts/demo.mjs voiceover-finish --manifest path/to/demo.yaml
node scripts/demo.mjs voiceover-verify --manifest path/to/demo.yaml
```

The session preserves an immutable picture-lock package and the synthetic
outputs. Human artifacts use separate `-human` names. If the picture changed,
use `voiceover --new-session`; never attach prior takes to a different video.
Read [references/human-voiceover.md](references/human-voiceover.md).

Existing `clips` and `reference` workflows remain available for externally
recorded audio.

## Sharing

The canonical private repository is
`https://github.com/ebarron/EdsDemoVideoBuilder`. Read
[references/sharing.md](references/sharing.md) for the supported macOS
user-level installation and update commands.
