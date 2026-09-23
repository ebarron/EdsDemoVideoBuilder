# Human voiceover

Use synthetic narration while browser choreography and picture timing are
changing. Start human voiceover only after a finished synthetic video is
approved as the picture-lock candidate.

With an unambiguous current demo, say:

> Okay, now let’s rerecord the video with my own voice using the teleprompter.

The skill locates the manifest and opens the studio; no command names or paths
are required.

## Open the studio

Ask in plain language:

> Open the human voiceover studio for this demo so I can record or revise my
> narration. Preserve my existing takes and selections.

The skill copies the approved video and its supporting artifacts into a
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

If the approved video changes but the Markdown script and spoken scene
structure are unchanged, rebase the existing takes onto a new immutable
picture lock by saying:

> Update this demo for the new branding and reuse my existing human voice
> recordings. The script has not changed.

Voice reuse is explicit and prompt driven. The guarded operation requires a
byte-for-byte unchanged Markdown script and the same narrated scene IDs,
order, and spoken text. It copies all take history and selections into a new
session, recomputes every fit against the revised scene windows, and leaves
the prior session untouched. Scene takes are placed at their revised scene
starts, so small recording-time timing variance does not require rerecording
the voice.

A continuous full take cannot safely follow shifted scene starts. If starts
shift, rebase requires accepted scene takes for every narrated segment and
clears the now-redundant full-take selection. It refuses the operation when a
shifted full take is still needed for coverage. If the script or spoken scene
structure changed, ask the skill to update the demo and reopen voice recording.
It preserves the old session while creating a fresh one for changed narration.

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
  It does not assemble the final video in the browser; send the displayed
  prompt back to the agent, which finishes and verifies it.
  If there is no accepted full take and any segment lacks an in-use scene take,
  the studio lists those uncovered segments and asks before closing. Saving
  anyway produces a reopen-studio handoff instead of claiming the video is
  ready to finish.

Finishing preserves the session. To revise the result, ask the skill to reopen
the existing studio while preserving takes and selections. After saving, the
skill regenerates and verifies the result.

For a visual-only revision such as branding, one prompt drives the whole
workflow: the skill rerecords and verifies the synthetic video, performs the
guarded voice reuse, opens the studio to review recalculated fit badges, and
finishes and verifies after the user saves.

After successful finishing and verification, the agent response must provide a
clickable link to the finished video and this reusable revision request:

> Reopen the existing human voiceover studio for this demo so I can make
> changes. Preserve my existing session, takes, and selections.

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

Saving the studio hands control back to the skill. The agent finishes,
verifies, and opens the human-voice video without asking the user to run a
command.

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
filenames. Synthetic outputs are never overwritten. When regenerating an
existing human output, the agent enables overwrite only for those human
artifacts.
