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

## 4. Rehearse cheaply

Run structural preflight and accelerated rehearsal before generating speech or
browser video. Preflight deliberately allows an incomplete
`productionReady: false` driver: readiness is reported separately as
`recordReady`, while structural, environment, and app failures still fail the
command. Repair:

- role/name locators that do not match the actual accessibility tree;
- clipped targets;
- missed initiating or completion events;
- wrong nested scroll owners;
- non-progressive scroll samples;
- state restoration mismatches.

These are internal production safeguards the agent may run automatically after
a user asks for a finished video. Users only need to request `rehearse`
explicitly when they want a separate no-recording dry run.

There is no generic selector-repair command. Cursor compares script-sync
action changes and rehearsal failures, probes the app's accessibility
tree/DOM, edits `driver.mjs`, and reruns rehearsal.

## 5. Record

Playwright records the real browser. Pointer moves, hover, clicks, route
transitions, loading UI, and rAF scrolling remain visible. Narration scenes are
segmented and scheduled concurrently with actions.

Set `status.productionReady: true` only after a successful complete rehearsal
and restoration proof. Production `record` rejects a driver that remains
false.

For an API or LLM operation:

1. click;
2. observe the busy/start event;
3. start the measured interval after the click;
4. wait for the actual success event and required rendered anchor;
5. reject on error or watchdog timeout;
6. only then retain that observed interval for compression.

## 6. Finish and verify

Finish once, preserving existing finals by default. Verify full audio/video
decode, codec/size/fps/sample-rate metadata, faststart atom order, contact
sheet, and distinct progressive frames. Inspect the contact sheet and the
start/middle/end of every pan manually.

## 7. Update notes

Record exact working locators, state hooks, observed compression intervals,
rejected takes, validation results, and environment changes in the per-demo
Building the video notes.
