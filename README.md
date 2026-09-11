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

Start a new Cursor chat or reload Cursor after installation so
`/demo-video-builder` is discovered across projects.

## Quick start: first demo

### 1. Write or edit the Markdown script

Normal paragraphs are spoken. Put browser directions in standalone italic
brackets:

```markdown
# Analytics overview

This dashboard shows request volume and service health at a glance.

*[Open Analytics from the main navigation.]*

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

## Update

```bash
git -C "$HOME/.cursor/skills/demo-video-builder" pull --ff-only
"$HOME/.cursor/skills/demo-video-builder/scripts/install.sh"
```

## Defaults and discovery

When omitted, the skill uses synthetic narration, standard video settings, and
fast internal checks before expensive capture. It inspects the repository and
running app for start, authentication, readiness, and state information, then
asks when uncertain.

Recorded interactions default to visible pointer travel, sequential typing for
text the viewer should read, and action timing aligned to the relevant spoken
cue. The skill favors comprehension over a fixed duration; a duration request
is treated as an optional constraint.

It may infer the login flow and required environment-variable names, but it
must **never** guess or persist credential values. It asks you if credentials
are needed. The default state policy is read-only. If the script requests a
write, the skill asks for explicit authorization and restoration requirements
before proceeding.

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

Wording-only edits usually change narration without changing browser actions.
Added or changed stage directions may require Cursor to inspect the UI, repair
the affected actions, and rehearse again.

## Using your own voice

Finish the script first. Make a rough reference narration so Cursor can
rehearse the pacing. For the final version, supply either one clip per scene
(best alignment) or one continuous narration track. Cursor measures the audio,
aligns browser actions, rehearses again, and records a synchronized take.

See [Narration modes](references/narration.md) for clip names, supported
formats, and audio-first pacing.

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
- `scene-plan.json`: generated spoken/action plan. Cursor updates it from the
  Markdown; do not normally hand-edit it.
- `driver.mjs`: app-specific browser choreography generated and maintained by
  Cursor. Rehearsal validates it; the CLI does not magically repair selectors.
- `building-the-video.md`: operational notes updated by Cursor as it learns
  selectors, timing, and restoration procedures.
- Raw timelines, browser captures, narration segments, and other intermediates:
  replaceable working data used to finish and diagnose a take.

For low-level operation, run
`node "$HOME/.cursor/skills/demo-video-builder/scripts/demo.mjs" help`.
Script
resynchronization previews changes by default and writes only with explicit
backup/atomic replacement. A not-yet-ready demo may rehearse, but production
recording remains gated on a successful rehearsal and restoration proof.

Detailed references:

- [Production workflow](references/production-workflow.md)
- [Manifest reference](references/manifest.md)
- [Driver API](references/driver-api.md)
- [FFmpeg and validation](references/ffmpeg-and-validation.md)
