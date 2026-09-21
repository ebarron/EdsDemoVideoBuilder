# Human voiceover

Use synthetic narration while browser choreography and picture timing are
changing. Start human voiceover only after a finished synthetic video is
approved as the picture-lock candidate.

With an unambiguous current demo, say:

> Okay, now let’s rerecord the video with my own voice using the teleprompter.

The skill locates the manifest and opens the studio; no command names or paths
are required.

## Open the studio

```bash
node scripts/demo.mjs voiceover --manifest path/to/demo.yaml
```

The command copies the approved video and its supporting artifacts into a
timestamped, immutable session, then opens a local teleprompter in the default
browser. The page is bound to `127.0.0.1` and protected by a random session
token. Microphone audio and takes stay on the local machine.

The locked package contains:

- the approved synthetic video, final timeline, contact sheet, scene plan, and
  Markdown narration;
- the raw browser video and raw timeline when they are still available in the
  work directory;
- normalized microphone takes, acceptance choices, timing-fit results, and
  retake history.

Picture-lock media and source artifacts are copied read-only and recorded in a
digest manifest. Reopening or finishing rejects changed files.

If the approved video changes, the studio refuses to mix old takes with it.
Create another timestamped session without deleting the old one:

```bash
node scripts/demo.mjs voiceover --manifest path/to/demo.yaml --new-session
```

## Record

The video is always muted; the synthetic voice is not played.

- **Record full take** starts at the beginning and scrolls the teleprompter as
  the locked video plays.
- **Record selected scene** seeks to one scene for a punch-in retake.
- Recording controls, microphone selection, level meter, and status remain
  pinned while the scene and take lists scroll.
- A selected-scene recording pins that scene's prompt through the initial seek
  boundary, so it never begins on the prior scene's text.
- Choose the desired microphone after granting access; the live meter follows
  the selected input.
- Every take is retained without changing the accepted selection. Use
  **Play** and **Stop** directly on a recorded scene row to audition its latest
  take, then choose **Use** only after approving what you heard. Each scene
  contains a collapsed history for its prior takes; full-take history stays
  beside the master area instead of forming one long global list.
- **Use latest eligible takes** explicitly selects the newest non-overlong take
  for every recorded scene. It is a reversible bulk action, not automatic
  acceptance during recording.
- **Delete other takes after selection** is unchecked by default. When enabled,
  choosing **Use** permanently deletes every other take and audio file in that
  scene or full-take group. Bulk selection keeps only the latest eligible take
  in each recorded scene.
- Every take history row also has **Delete** for removing an accidental take,
  including a full take. Deletion removes both the original recording and
  normalized WAV after confirmation. An in-use take must first be replaced or
  cleared.
- Overlong takes show their exact overage and offer **Use anyway** as a distinct
  one-click action. This accepts the take and trims audio beyond the locked
  scene boundary; it never speeds speech or overlaps the next scene. Use a
  previous take from history to restore it, or clear a scene override to return
  to the full take.
- The microphone meter remains visible during setup and recording.
- A take is discarded if locked playback stalls, pauses, seeks, or changes
  speed, because its audio can no longer be aligned safely.
- **Save and close studio** persists choices, ends the local server, and shows
  an unmistakable saved state with a copyable finish-and-verify handoff prompt.
  It does not assemble the final video; run the finish and verify steps below.

Finishing preserves the session. To revise the result, reopen the studio
without `--new-session`, change takes or selections, save again, then rerun
`voiceover-finish --force` and `voiceover-verify`.

After successful finishing and verification, the agent response must provide a
clickable link to the finished video and this reusable revision request:

> Reopen the existing human voiceover studio for this demo so I can make
> changes. Preserve the existing session, takes, and selections; do not use
> `--new-session`.

Browser capture formats vary. Every uploaded take is retained in its original
format and normalized to a 48 kHz mono PCM WAV master before it is available
for audition and acceptance.

## Timing fit

Teleprompter windows use `narrations[].finalStart` from the finished timeline,
so they follow the compressed final video rather than the raw recording clock.
Scene retakes are classified as:

- `fits`: comfortably inside the scene window;
- `tight`: ends within 350 ms before the boundary;
- `over`: crosses the boundary and cannot be accepted.

Finishing bounds an explicitly accepted overlong take to its locked scene or
video boundary. **Use anyway** is appropriate for excess stop-button reaction
time or trailing silence; if speech itself crosses the boundary, record a
natural retake to avoid cutting words. Finishing never speeds speech, overlaps
the next scene, or retimes browser motion.

## Finish and verify

```bash
node scripts/demo.mjs voiceover-finish --manifest path/to/demo.yaml
node scripts/demo.mjs voiceover-verify --manifest path/to/demo.yaml
```

The finisher copies the locked H.264 video stream without re-encoding it and
replaces only the audio. A full take forms the base track; accepted scene
retakes mute and replace their corresponding windows. Without a full take,
every narrated scene needs an accepted take.

Verification decodes the final media, rechecks every locked-artifact digest,
rechecks every accepted take, confirms the selected take IDs and final
duration, and proves that the output H.264 stream is identical to the locked
picture. It also records the finished AAC stream digest so later verification
detects changed audio.

Human outputs add `-human` to the configured video, timeline, and contact-sheet
filenames. Synthetic outputs are never overwritten. `--force` applies only to
the human outputs and must be explicit.
