# Demo Video Builder

`demo-video-builder` is a macOS-first Cursor skill for making a narrated
recording of a real browser app.

You normally edit one file: your Markdown demo script.

## Install

Prerequisites: macOS, [GitHub CLI](https://cli.github.com/) authenticated with
access to the private repository (`gh auth login` if needed), and Node.js 20+
with npm.

```bash
gh repo clone ebarron/EdsDemoVideoBuilder "$HOME/.cursor/skills/demo-video-builder"
"$HOME/.cursor/skills/demo-video-builder/scripts/install.sh"
```

The installer also prepares Chromium, the locked Kokoro runtime, and its
verified default `q8` model (about 92 MB), so new demos are ready to record.

Start a new Cursor chat or reload Cursor after installation so
`/demo-video-builder` is discovered across projects.

## Quick start: first demo

### 1. Write or edit the Markdown script

Normal paragraphs are spoken. Keep browser directions beside the words they
belong to as plain English inside square brackets, either standalone or inline:

```markdown
# Analytics overview

This dashboard shows request volume and service health at a glance. [Open Analytics from the main navigation.]

The traffic chart makes the morning peak easy to see.

[Point to Requests per minute, then scroll to Service health.]
```

See [Script convention](references/script-convention.md) for optional advanced
markup.

### 2. Start the app

Open the app or start its development server. The examples below use
`http://127.0.0.1:5173`.

### 3. Ask Cursor to record the demo

**Option A — Natural-language request**

> Use the `demo-video-builder` skill to record a demo from
> `docs/ProductDemoScript.md` against the app running at
> `http://127.0.0.1:5173`. Save the finished video to
> `docs/video/ProductDemo.mp4`. Inspect the app and internally verify and
> repair the action path before recording. Ask me only about anything important
> you cannot determine. Record, finish, validate, and open the result.

**OR**

**Option B — Explicit slash command**

```text
/demo-video-builder Record a demo from docs/ProductDemoScript.md against http://127.0.0.1:5173. Save the finished video to docs/video/ProductDemo.mp4. Inspect the app and internally verify and repair the action path before recording. Ask only about anything important you cannot determine. Record, finish, validate, and open the result.
```

For another app, copy either option and change the script path, app URL, and
output path. `@` adds a file or other context to a prompt; it does not invoke a
skill. If `/demo-video-builder` does not appear after installation, start a
new chat or reload Cursor so skills are rediscovered.

### 4. Review the video and request changes

**Option A — Natural-language request**

> The video is close. In the storage section, keep narration running while
> navigating the detail dialogs. Replace the overview and final-dashboard
> scroll jumps with smooth continuous scrolling, then rerecord and open
> `docs/video/ProductDemo.mp4`.

**OR**

**Option B — Explicit slash command**

```text
/demo-video-builder The video is close. In the storage section, keep narration running while navigating the detail dialogs. Replace the overview and final-dashboard scroll jumps with smooth continuous scrolling, then rerecord and open docs/video/ProductDemo.mp4.
```

The skill discards failed takes and enforces its write, secret, baseline, and
restoration safety rules without requiring you to repeat them in every prompt.

## Prompt cookbook

All demo-building interactions are prompt driven. The skill runs its internal
tools and commands; you do not need to invoke Node scripts or know workflow
flags. Include a script, manifest, or output path only when the current demo is
not obvious from the conversation.

### Initialize without recording

> Initialize a new browser demo from `docs/ProductDemoScript.md` against
> `http://127.0.0.1:5173`. Create the managed demo files, but do not rehearse or
> record yet.

### Rehearse and repair without recording

> Rehearse the current demo without recording. Inspect the app, repair any
> failed selectors or timing boundaries, verify restoration, and tell me what
> remains before a production take.

### Record a finished synthetic-voice demo

> Record the current demo with the default synthetic voice. Internally verify
> and repair the browser flow, then record, finish, validate, and open the
> finished video.

### Update a script and rerecord

> I updated `docs/ProductDemoScript.md`. Resynchronize the demo, summarize the
> changes, repair any affected browser actions, then rerecord, validate, and
> open the result.

### Rerecord visual behavior without changing narration

> Keep the existing script and narration, but update the browser recording to
> reflect the current UI. Preserve the same flow where possible, then finish,
> validate, and open the revised video.

### Change the synthetic voice

> Rerecord this demo with the current default Kokoro voice. Keep the script and
> browser flow unchanged, preserve the prior finished video until the new one
> verifies, and open the result.

### Use supplied narration or make a silent demo

> Use my supplied narration audio for this demo, align it with the existing
> browser flow, then record, finish, validate, and open the result.

Or:

> Rerecord this demo without narration. Keep the browser choreography and
> validation requirements unchanged.

### Record with your own voice

> Okay, now let’s rerecord the video with my own voice using the teleprompter.
> Preserve the synthetic version while I record and review my takes.

### Reopen an existing human-voice session

> Reopen the existing human voiceover studio for this demo so I can make
> changes. Preserve my existing session, takes, and selections.

### Update visuals and reuse existing human voice

> Update this demo for the new branding and reuse my existing human voice
> recordings. The script has not changed. Rerecord and verify the visuals,
> safely reuse the scene takes, open the studio for review, then finish,
> verify, and open the revised human-voice video after I save.

### Update a script after recording human voice

> The demo script changed after I recorded my voice. Preserve the previous
> voiceover session, update and verify the demo, then open a fresh voiceover
> session for the changed narration.

### Resume an interrupted finish or validation

> Finish and verify the existing recording artifacts for this demo, then open
> the result. Do not rerecord unless the saved artifacts cannot be completed
> safely.

## Update

```bash
git -C "$HOME/.cursor/skills/demo-video-builder" pull --ff-only
"$HOME/.cursor/skills/demo-video-builder/scripts/install.sh"
```

## Defaults and discovery

When omitted, new demos use Kokoro synthetic narration with the `af_heart`
voice, standard video settings, and fast internal checks before expensive
capture. It inspects the repository and running app for start, authentication,
readiness, and state information, then asks when uncertain.

Recorded interactions default to visible pointer travel, sequential typing for
text the viewer should read, slow smooth scrolling instead of viewport jumps,
and action timing aligned to the relevant spoken cue. Jump scrolling is used
only when you explicitly request it. The skill favors comprehension over a
fixed duration; a duration request is treated as an optional constraint.

Before a click, the runtime waits for layout to settle, remeasures after
pointer travel, and verifies that the visible pointer overlaps the browser's
real hit target. Critical clicks can retain click-time screenshot evidence;
successful navigation alone is not considered proof of visual alignment.

It may infer the login flow and required environment-variable names, but it
must **never** guess or persist credential values. It asks you if credentials
are needed. The default state policy is read-only. If the script requests a
write, the skill asks for explicit authorization and restoration requirements
before proceeding.

HTTPS certificate validation is strict by default. For a known self-signed
demo endpoint, the skill can set `app.allowInsecureTls: true`; the bypass
applies only to that demo's browser and URL checks and never changes global
Node.js TLS settings.

## More detailed start

The three values in Quick Start are usually enough. To override defaults, add
any of these optional details:

> Use the `demo-video-builder` skill to record
> `docs/ProductDemoScript.md` against `http://127.0.0.1:5173`, with finished
> output at `docs/video/ProductDemo.mp4`.
>
> Optional overrides:
>
> - App folder/start command: `<path-to-app>` / `<command if needed>`
> - Authentication: `<environment-variable names only; never literal secrets>`
> - Self-signed TLS: `<allow only for this known demo endpoint>`
> - Allowed mutations/restoration: `<what may change and how to restore it>`
> - Narration: `<voice, segmented clips, reference track, or silent>`
> - Browser: `<viewport and zoom>`
> - Extra output: `<contact-sheet path or other requested artifacts>`
> - Wait compression / optional duration constraint: `<style or duration>`
>
> Probe anything I omit, ask only about material uncertainty, internally check
> and repair the action path, then record, finish, validate, and open the video.

## Optional dry rehearsal

Normal users can ask for a finished video directly. The skill may perform fast
internal probes or an accelerated rehearsal before expensive capture.
Explicit `rehearse` is optional when you want a no-recording dry run for a new,
risky, expensive, or failing demo:

> Use the `demo-video-builder` skill to rehearse this demo without recording,
> repair any failed actions, and report what remains before a full take.

## Change an existing demo

Edit only the Markdown script, then paste:

> Use the `demo-video-builder` skill. I changed `<path-to-demo.md>`.
> Resynchronize the demo, summarize what changed, repair any affected browser
> actions by inspecting the app, internally verify the path, then rerecord,
> validate, and open the output. Preserve and restore app state, ask before
> writes, and do not store literal secrets.

The skill classifies the diff internally; you do not need to label it.
Wording-only edits update narration without changing the driver. Added or
changed stage directions may require Cursor to inspect the UI, repair the
affected actions, and rehearse again. You may state “this is narration-only”
when that intent is useful, but the skill still verifies the diff.

For frequently revised demos, recognizable headings and action wording help
generated IDs retain identity across copy changes. Keep spoken copy and English
square-bracket directions interleaved in the order the viewer should
experience them. Do not collect actions in a separate section or add JSON to
the narration file. If a late scene invokes an expensive API or LLM,
optionally provide isolated seeded state and its reset procedure so Cursor can
probe that scene before the final end-to-end rehearsal.

### Update an existing demo to ordered cues

After updating the skill, ask:

> Update this existing demo to the current ordered-cue format. Preview and
> explain the migration first, preserve compatibility, then apply it only if
> the review is safe.

An older plan
whose directions were already recognized as standalone actions reports
`representation-only`, adds ordered `scene.cues`, and sets
`driverReviewRequired` to `false`. The existing
`scene.narration`, `scene.actions`, driver API, and narration clip names remain
compatible.

Older plans may have spoken an inline `[Click ...]` direction because the old
parser did not recognize it inside a prose line. Sync now removes that English
direction from spoken narration and creates the action in its correct cue
position. Preview reports the semantic change and requires driver review
before writing and rerecording.

If the authoritative Markdown already interleaves narration and directions,
no source edit is needed. If someone physically moved all directions into a
separate section, the old plan does not contain enough information to infer
their intended spoken context. Move each direction back beside the relevant
words, preview the reported alignment changes, and let Cursor update the
affected narration checkpoints before rerecording. The skill backs up the
previous plan and never rewrites the Markdown.

See [Ordered-cue migration](references/ordered-cues-migration.md) for the
upgrade checklist and expected sync classifications.

## Default synthetic voice

New demos default to Kokoro ONNX with `af_heart`. Existing manifests keep their
explicitly configured narration mode, including `macos-say`, and are not
silently migrated. Install and update prepare the separate locked runtime and
verified default model. To repair or prepare them, ask:

> Prepare or repair the local Kokoro runtime and verified default voice model
> for Demo Video Builder.

The generated agent-managed configuration is:

```yaml
narration:
  mode: kokoro
  defaultOffsetSeconds: 0.5
  audioFirst: false
  kokoro:
    voice: af_heart
    speed: 1
    dtype: q8
    device: cpu
    allowModelDownload: true
```

Rehearsal remains download-free. Model assets come from a pinned revision and
pass size and cryptographic digest checks before loading. Generated WAV clips
are measured and cached by text and synthesis settings. Tokenizer truncation
is disabled; over-limit narration is recursively split, and final validation
requires complete source-to-audio coverage while rejecting unexplained silence.
Existing non-Kokoro demos retain their provider unchanged; the installed
Kokoro assets are not loaded by those recordings.

## Using your own voice

Keep synthetic narration while iterating. Once a finished video is approved
enough to lock, you can simply say:

> Okay, now let’s rerecord the video with my own voice using the teleprompter.

When the current demo is unambiguous, the skill finds its manifest and opens
the muted picture-locked studio without requiring command names or paths. It
asks which demo only when multiple finished candidates are plausible.

You can also be explicit:

> Use the `demo-video-builder` skill to open the human voiceover studio for
> `<path-to-demo.yaml>`. Play the approved video muted with its teleprompter,
> preserve all takes, then finish and verify a separate human-voice version.

For a branding or other visual-only rerecord, say:

> Update this demo for the new branding and reuse my existing human voice
> recordings. The script has not changed.

The skill rerecords and verifies the revised visuals, checks voiceover
compatibility, opens the preserved takes against a new picture lock, and
recalculates their timing fit. After review, it finishes and verifies the
revised human-voice video. The old session remains intact. Users do not need to
run Node commands or name the internal rebase operation.

The video is always muted in the local, token-protected studio; no synthetic
audio plays. It supports a
continuous full take and scene-level punch-in retakes, normalizes microphone
recordings to 48 kHz mono WAV, retains take history, and provides Play/Stop
controls directly on recorded scene rows for auditioning the latest take.
Each scene folds its prior takes into a collapsed local history, while full
takes stay grouped by the master area. An explicit Use latest eligible takes
action bulk-selects the newest fitting scene takes. An unchecked-by-default
cleanup option can permanently delete other takes and their audio files when
an individual or bulk selection is made. Each take history row also provides
Delete for removing an accidental scene or full take; an in-use take must first
be replaced or cleared. Recording itself does not replace accepted selections.
An overlong take can be auditioned and selected with the
distinct one-click Use anyway action, which
shows the exact overage and trims only audio beyond the locked scene boundary.
It never speeds speech or overlaps the next scene. The recording toolbar stays
pinned while long scene lists scroll, and selected-scene recording pins the
correct prompt across its initial video seek. Saving visibly closes the
recording session and hands final assembly and verification back to the skill.
The saved screen provides a copyable prompt for that handoff.
If no full take is in use, saving lists any segments without an in-use scene
take and asks before closing; confirming produces a reopen-studio handoff.
Finishing preserves the session, so prompt-driven revisions can reopen and
regenerate it without losing prior takes. After successful finishing, the
agent response includes a clickable video link and an exact prompt for
reopening the preserved studio session.

Starting the studio creates an immutable picture-lock package, including the
approved video, timeline, script, scene plan, contact sheet, and raw take when
available. Human output uses `-human` filenames and never overwrites the
synthetic version. A changed script or spoken scene structure requires fresh
voice recording; a visual-only change uses the guarded reuse workflow
automatically.

See [Narration modes](references/narration.md) and
[Human voiceover](references/human-voiceover.md) for details.

## What you touch

- Required: your Markdown demo script.
- Optional: narration clips or a reference audio track.
- Optional: tell Cursor about configuration changes in plain language. Let the
  skill manage its configuration unless you specifically need advanced
  control.

## Other independent requests

You can also ask only for one task:

- “Initialize a narrated demo from this script.”
- “Rehearse this demo and repair its browser actions.”
- “Record this demo end to end.”
- “Finish and validate this existing raw capture.”

Finishing and validation are useful on their own when a raw capture already
exists or an interrupted finishing run needs recovery.

## Advanced/debugging: generated files

These are implementation artifacts. They are normally hands off:

- `demo.yaml`: runtime configuration managed by Cursor. Advanced users may
  inspect or edit it when they need exact lifecycle, timing, or output control.
- `scene-plan.json`: generated spoken/action plan. Ordered `scene.cues` retain
  the Markdown sequence while compatibility fields keep narration and actions
  available to existing drivers. Cursor updates it from the Markdown; do not
  normally hand-edit it.
- `driver.mjs`: app-specific browser choreography generated and maintained by
  Cursor. Rehearsal validates it; the CLI does not magically repair selectors.
- `building-the-video.md`: operational notes updated by Cursor as it learns
  selectors, timing, and restoration procedures.
- Raw timelines, browser captures, narration segments, and other intermediates:
  replaceable working data used to finish and diagnose a take.

For diagnostics, ask the skill to inspect the generated artifacts, explain the
current state, and run the relevant internal validation. Script
resynchronization previews changes by default and writes only with explicit
backup/atomic replacement. A not-yet-ready demo may rehearse, but production
recording remains gated on a successful rehearsal and restoration proof.

Detailed references:

- [Production workflow](references/production-workflow.md)
- [Ordered-cue migration](references/ordered-cues-migration.md)
- [Human voiceover](references/human-voiceover.md)
- [Manifest reference](references/manifest.md)
- [Driver API](references/driver-api.md)
- [FFmpeg and validation](references/ffmpeg-and-validation.md)
