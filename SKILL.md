---
name: narrated-browser-demo
description: Creates, rehearses, records, finishes, and validates narrated Playwright browser demos from Markdown scripts. Use when the user asks to record a narrated browser demo, initialize a demo manifest and driver, repair demo selectors, finish a recording, or validate demo video artifacts.
---

# Narrated browser demo

Build real browser recordings from a Markdown narrative. This v1 is macOS-first
for `say` narration and provides portable `clips`, `reference`, and `silent`
modes. Keep reusable orchestration in this skill and application knowledge in a
per-demo `demo.yaml`, normalized `scene-plan.json`, and `driver.mjs`.

The user normally edits only the Markdown script and, optionally, supplies
voice clips. The agent owns generated configuration and browser choreography:

- Markdown is the human source of narration and intent.
- `scene-plan.json` is generated normalized output; update it with `sync`.
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
- output paths when omitted;
- optional narration/browser overrides—the default is macOS synthetic speech
  and standard video settings;
- authorization, baseline, and restoration only when the script requests a
  write—the default state policy is read-only.

Do not put passwords, tokens, cookies, or credentials in a manifest, driver,
chat output, or command line. Pass only environment-variable names in
`auth.env`. Prefer an isolated fixture. Login and presentation setup happen in
an unrecorded context.

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

Treat ordinary paragraphs and blockquotes as narration. Treat italic or
bracketed directions as actions. Machine-readable
`<!-- demo:scene {...} -->` and `<!-- demo:action {...} -->` comments override
ambiguity. Legacy parsing is intentionally reviewable, not magical: inspect the
normalized plan and remove presenter notes, appendices, or non-spoken material.

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

Preview reports added, removed, and changed scenes/actions. `--write` creates a
unique backup and atomically replaces the plan. `--check` is available for
drift checks. Stable IDs and existing custom hints are retained when title,
explicit ID, action text, or action ID gives a deterministic match. Default
parser exclusions remove appendices, Building the video/internal notes, and
caption sections from narration.

If a legacy hand-curated plan previews broad structural churn because its
scene splits are absent from Markdown, do not write. Add explicit stable scene
comments or reconcile the segmentation first.

After sync, compare action changes with `driver.mjs`, inspect the running app,
repair affected selectors/actions/boundaries, and internally rehearse again as
needed. Do not claim the CLI can autonomously repair arbitrary apps.

## Generate and repair the app driver

The generated driver is a scaffold, not a claim that natural-language stage
directions can deterministically operate an arbitrary app. The agent must:

1. Inspect existing recording/E2E helpers and the running app.
2. Use Playwright accessibility roles and DOM inspection to prove locators.
3. Implement each scene with robust selectors and explicit initiating,
   success, and error boundaries.
4. Identify the actual inner scroll owner. Use the runtime rAF scroll helper
   and verify progressive 0/25/50/75/100 samples.
5. Implement snapshot, restore, and restoration verification hooks.
6. Clear `status.todos` and set `productionReady: true` only after accelerated
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
- inject the visible pointer/click pulse;
- keep narration concurrent with actions and segmented by scene.

Read [references/production-workflow.md](references/production-workflow.md)
before recording and [references/narration.md](references/narration.md) for
voice options.

## Record, finish, and verify

Run production `macos-say` recording outside restricted sandboxes so `say` can
write audio:

```bash
node scripts/demo.mjs record --manifest path/to/demo.yaml
node scripts/demo.mjs finish --manifest path/to/demo.yaml
node scripts/demo.mjs verify --manifest path/to/demo.yaml
```

The driver must be production-ready before `record`. A failed action rejects
the take and invokes restoration. Variable API/LLM waits are measured only
between an initiating action and an observed successful completion. Compress
only those successful intervals; keep the click outside the interval and show
the visible fast-forward overlay. Anchor important generated content at the
viewport top before any hold or pan.

The finisher uses explicit content bounds, CFR 25 fps H.264/AAC, 48 kHz audio,
and faststart. Audio uses finite `apad=whole_dur` followed by `atrim`, and the
output gets an explicit `-t`. Never combine indefinite `apad`/`amix` output
with `-shortest`. Verification performs full decode, metadata, faststart,
contact-sheet, and progressive-frame checks. Read
[references/ffmpeg-and-validation.md](references/ffmpeg-and-validation.md).
`finish` and `verify` may be invoked independently when a raw capture already
exists or finishing/validation needs recovery.

## Human narration

For final human delivery, prefer segmented clips named by scene. Record and
approve audio first, switch `narration.mode` to `clips`, set `audioFirst: true`,
and rehearse browser pacing against measured clip durations. `reference` keeps
one supplied track; `silent` records a video with a bounded silent AAC stream.

## Sharing

The canonical private repository is
`https://github.com/ebarron/EdsDemoVideoBuilder`. Read
[references/sharing.md](references/sharing.md) for the supported macOS
user-level installation and update commands.
