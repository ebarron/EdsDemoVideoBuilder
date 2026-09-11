# Narration modes

## Simple human-voice workflow

Finish the Markdown first, then make a rough reference read so Cursor can
rehearse the intended pacing. For the final take:

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
