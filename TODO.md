# Demo Video Builder backlog

These items are intentionally not part of the current runtime contract.
Preserve the existing Quick Start and backward compatibility when designing
them.

## Optional Kokoro ONNX iteration voice

Add Kokoro as an opt-in synthetic narration provider for rehearsal and video
iteration. Human voiceover remains a later picture-lock step.

- Add a `kokoro` narration mode while retaining the current lightweight
  default.
- Use a pinned Kokoro ONNX model, quantization, voice, and speed configuration.
- Load generation asynchronously and emit one measured WAV clip per scene or
  narration cue.
- Cache generated audio by text, model, voice, speed, and relevant
  normalization settings.
- Download model assets only after the user explicitly selects Kokoro and
  reuse the local cache afterward.
- Validate supported voices and report model/download failures clearly.
- Keep Quick Start and existing narration modes unchanged.
- Document model licensing, storage, offline behavior, and platform support.

## Picture-lock human voiceover

Add an explicit post-production phase after synthetic narration, browser
choreography, and picture timing are approved.

- Preserve a picture-lock package containing the raw silent browser capture,
  canonical timeline, narration text, and synthetic guide version.
- Play the approved video muted with a scene-aware teleprompter; synthetic
  audio playback is not required.
- Provide microphone selection, input metering, countdown, recording controls,
  and a clear indication of current and upcoming narration.
- Record a continuous 48 kHz master with scene markers.
- Support scene-level punch-in retakes while retaining take history.
- Compare accepted speech with scene windows and report early/late timing.
- Trim silence and make bounded clip-position or existing-hold adjustments.
- Do not automatically speed up human speech or important browser motion.
- Refinish from the preserved raw capture into a new output without
  overwriting the approved synthetic version.
- Require a retake or an explicit audio-first browser rerecord when narration
  cannot fit naturally.

### Initial voiceover scope

Start with muted playback, teleprompter synchronization, microphone capture,
scene markers and retakes, duration-fit reporting, and refinish from the raw
capture. Defer phrase-level forced alignment and general automatic video
retiming until the simpler workflow is proven.
