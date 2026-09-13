# Production workflow

## 1. Preserve the workspace

Inspect git status in every repository the demo touches. Do not reset, clean,
stash, stage, or overwrite unrelated work. Keep existing one-off recorder
helpers and final videos until the generic path has repeated parity.

## 2. Establish the baseline

Use isolated data when possible. Record the exact state projection in
`snapshot()`. A read-only driver must produce the same projection after the
take. A mutating driver must restore on success and failure, then prove the
same baseline. Never continue a take after an unsuccessful operation.

## 3. Pre-authenticate

Authentication and presentation setup run in an unrecorded context. Supply
secrets only through environment references. The runtime keeps generated
storage state in memory. If an existing state file is supplied, require mode
0600 and never copy it into project output.

Keep TLS verification strict unless the manifest explicitly enables
`app.allowInsecureTls` for a known self-signed demo endpoint. The same
manifest-scoped choice applies to preflight, lifecycle readiness,
authentication/preparation, and recording. Never set a process-wide TLS bypass.

## 4. Rehearse cheaply

Before editing the driver, classify the change from sync output and runtime
evidence. Narration-only changes do not touch `driver.mjs`; timing-only changes
do not touch locators. Choreography changes alter actions, locator/layout
changes repair the driver's semantic target factory, and functional changes
repair boundaries or state handling. Infer and report this internally without
requiring the user to complete a classification step.

Run structural preflight and accelerated rehearsal before generating speech or
browser video. Preflight deliberately allows an incomplete
`productionReady: false` driver: readiness is reported separately as
`recordReady`, while structural, environment, and app failures still fail the
command. Repair:

- role/name locators that are absent, hidden, or duplicated; scope repeated
  labels to their navigation, canvas, chat, tab, or dialog container instead
  of selecting `.first()` or `.nth()`;
- clipped targets;
- missed initiating or completion events;
- wrong nested scroll owners;
- jump scrolling or automatic target reveals that skip visible travel;
- pointer overlays that do not overlap the real click target;
- layout motion that continues while a box is measured or a pointer travels;
- non-progressive scroll samples;
- state restoration mismatches.

These are internal production safeguards the agent may run automatically after
a user asks for a finished video. Users only need to request `rehearse`
explicitly when they want a separate no-recording dry run.

There is no generic selector-repair command. Cursor compares script-sync
action changes and rehearsal failures, probes the app's accessibility
tree/DOM, edits `driver.mjs`, and reruns rehearsal.

Never overlap rehearsals against the same application or fixture. When a
late-scene boundary fails, probe that step directly and repair it before
replaying earlier costly API/LLM mutations. After targeted probes pass, run one
clean end-to-end rehearsal and prove restoration before production.

## 5. Record

Playwright records the real browser. Pointer moves, hover, clicks, route
transitions, loading UI, and rAF scrolling remain visible. Narration scenes are
segmented and scheduled concurrently with actions.

Use the recorded interaction helpers for watchable behavior: pointer travel is
about one second per target, and text the viewer should read is entered
sequentially. Instant `fill()` remains appropriate for unrecorded setup,
focused probes, and restoration.

Every recorded scroll is slow and smooth by default, including bringing an
offscreen click target into view and positioning generated content. Use the
rAF helper rather than `scrollIntoViewIfNeeded()`, direct `scrollTop`
assignment, or one large wheel event. Jump scrolling requires an explicit user
request.

Treat the visible pointer and real browser hit as one product surface. Sequence
every interaction as settle, measure, travel, settle and remeasure, verify
pointer overlap and `elementFromPoint()`, then click. If layout changes during
travel, realign or reject the take; never add a pixel fudge. Recorded motion
helpers are serialized so scrolling, pointer movement, viewport positioning,
and typing do not overlap.

Mark essential clicks for click-time evidence. Inspect the screenshot with the
pointer pulse on and confirm the saved pointer/target geometry overlaps for
navigation, expandable groups, selected rows, action controls, and inputs
critical to that demo. Driver exit status proves function, not visual
alignment.

Schedule actions at explicit narration fractions. A spoken sentence owns the
click or typing it introduces; do not front-load all actions at scene start.

Set `status.productionReady: true` only after a successful complete rehearsal
and restoration proof. Production `record` rejects a driver that remains
false.

For an API or LLM operation:

1. click;
2. observe the expected form, request, or busy/start event;
3. start the measured interval after the click;
4. observe the busy state clear;
5. prove the expected identity or state change is uniquely rendered;
6. reject on error or watchdog timeout;
7. only then retain that observed interval for compression.

Restoration is a separate, deliberately plain path. Prefer an API or fixture
reset. If UI restoration is unavoidable, search and scope its own locators,
perform direct Playwright actions without recorded pointer helpers, and verify
the baseline. It must work after both successful and partially failed takes.

Optimize the take for comprehension: readable narration, visible motion, and
enough time to recognize state changes. A requested duration is an optional
constraint, not a quality target; do not accelerate the opening or important
clicks merely to fit a range.

## 6. Finish and verify

Finish once, preserving existing finals by default. Verify full audio/video
decode, codec/size/fps/sample-rate metadata, faststart atom order, contact
sheet, and distinct progressive frames. Inspect the contact sheet and the
start/middle/end of every pan manually.

## 7. Update notes

Record exact working locators, state hooks, observed compression intervals,
rejected takes, validation results, and environment changes in the per-demo
Building the video notes.
