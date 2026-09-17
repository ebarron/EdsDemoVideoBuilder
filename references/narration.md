# Narration modes

## Simple human-voice workflow

Keep synthetic narration through script and choreography iteration. After the
finished video is approved, use the built-in muted teleprompter and microphone
studio described in [Human voiceover](human-voiceover.md).

Existing external-audio workflows remain supported:

- use one clip per scene with `clips` for the strongest action alignment; or
- use one continuous track with `reference` when a single uninterrupted read
  matters more.

Cursor measures supplied media where the mode supports it, adjusts explicit
timing as needed, and rehearses the browser again before rerecording. Keep the
rough reference until the synchronized final take validates.

## macos-say

Uses `/usr/bin/say` to write one AIFF per normalized scene and `/usr/bin/afinfo`
to reject empty files and measure duration. `voice` and default `rate` live in
the manifest; a scene may override `timing.rate`.

Some sandboxes let `say` exit successfully while producing empty audio. Run a
production take with the required host permissions. The duration check rejects
that failure before recording proceeds.

## kokoro

Kokoro ONNX is the higher-quality default for newly initialized demos.
Existing manifests retain their explicitly configured mode, including
`macos-say`.

Install and update prepare its isolated local runtime and verified default
model. To repair them manually:

```bash
node scripts/demo.mjs kokoro-setup
```

Then configure only the selected demo:

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

The pinned provider is `kokoro-js@1.2.1` with
`onnx-community/Kokoro-82M-v1.0-ONNX` at an immutable repository revision.
Rehearsal uses duration estimates and does not load or download the model.
Install/update—or production self-repair if assets are missing—places model
assets in
`~/Library/Caches/demo-video-builder/kokoro`; subsequent audio is cached by
text, provider/model, voice, speed, precision, and device. Set
`allowModelDownload: false` to require an already populated offline cache.
Every tokenizer and ONNX asset is validated against its pinned size and
cryptographic digest before loading. A corrupt or partial cache is rejected,
and downloads are written atomically.
Executable provider dependencies live in the installed skill's ignored
`.kokoro-runtime` directory so they are isolated from normal dependencies. The
setup command uses the skill's checked-in dependency lockfile and preflight
rejects an incomplete, ancestor-resolved, or differently locked runtime.

The default `q8` model is roughly 92 MB. Supported American and British voices
include `af_heart`, `af_bella`, `af_nicole`, `am_fenrir`, `am_michael`,
`bf_emma`, `bf_isabella`, `bm_fable`, and `bm_george`. `speed` ranges from
`0.5` through `2`; `1` is unchanged speed. Long scenes are split at sentence
boundaries before synthesis. Truncation is disabled at the tokenizer itself;
any chunk that still exceeds the exact 512-token limit is recursively split
and retried. Each cached clip includes coverage metadata tying every safe chunk
back to the complete source narration, then the chunks are assembled into one
measured WAV per scene. Final verification rejects missing or stale coverage
metadata and unexplained silence within a Kokoro narration window.

Kokoro model weights are Apache-2.0. The current JavaScript phonemizer uses
eSpeak-NG, which carries GPL obligations. The installer downloads that runtime
locally; it is not committed to or redistributed from this repository. Obtain
organizational licensing review before redistributing the downloaded runtime.

## clips

Uses supplied scene clips from `clipsDir`. Name each file after the normalized
scene ID; supported extensions are AIFF, AIF, WAV, M4A, and MP3. Set
`audioFirst: true` when browser action pacing should follow approved human
clips. The runtime measures each clip instead of estimating speech duration.

## reference

Uses one existing narration track as final audio. Driver scene timing still
comes from explicit normalized durations or word-count estimates. Prefer
segmented clips when action synchronization matters.

## silent

Paces scenes from explicit duration or word-count estimates and emits a finite
48 kHz silent AAC stream. This is useful for screen-only drafts, not a
substitute for an approved narration workflow.

## Concurrency

Narration is mixed at timeline positions after capture. Drivers still schedule
pointer movement and actions across each measured narration duration. For
compressed waits, anchor narration a short time after the measured wait starts
so speech continues over the visible fast-forward.

Concurrency does not mean “act immediately.” Give each important sentence
ownership of the action it describes by waiting for an explicit narration
fraction before the click, pointer move, or sequential typing begins. Favor
watchable motion and comprehension over a duration range; a requested total
duration is only an optional constraint.
