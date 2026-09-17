# FFmpeg and validation

The finisher maps raw timestamps through successful wait compressions, trims
normal-speed and accelerated segments, adds a visible fast-forward badge, and
concatenates them. The initiating click is not in the compressed interval.

The orchestration timeline begins before lifecycle/authentication/preparation,
but Playwright video begins when the recorded page is created. The recorder
stores that media-clock origin as `timeline.meta.videoStart`. FFmpeg trim and
compression boundaries subtract this offset; narration and canonical timeline
events remain on the orchestration clock. Legacy timelines use
`videoStart ?? 0`.

The graph is explicitly bounded:

- raw video is trimmed to `contentStart..contentEnd`;
- concatenated video is trimmed to computed final duration;
- mixed narration uses `apad=whole_dur=<duration>` and
  `atrim=duration=<duration>`;
- silent/reference modes are also trimmed to the same duration;
- output receives `-t <duration>`;
- `-shortest` is never used.

This avoids the CPU-active near-EOF stall caused by indefinite `apad`/`amix`
combined with `-shortest`.

Output is normalized to:

- constant 25 fps;
- H.264, yuv420p;
- AAC at 48 kHz;
- manifest viewport dimensions;
- MP4 faststart.

`finish` refuses to overwrite the final video, contact sheet, or timeline
unless `--force` is explicit. `verify`:

1. parses stream metadata;
2. checks dimensions, codecs, fps, and sample rate;
3. confirms the `moov` atom precedes media data;
4. fully decodes both streams under a safety timeout;
5. samples progressive frame hashes;
6. requires the generated contact sheet and final timeline;
7. for Kokoro, matches every narrated source scene to complete token-safe
   synthesis coverage;
8. rejects substantial unexplained silence inside Kokoro narration windows.

These checks do not replace visual review. Inspect compressed boundaries for a
visible initiation, no failed state, and a clean successful destination.
