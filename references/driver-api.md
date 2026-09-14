# Driver API

The driver default-exports `apiVersion: 1`, readiness metadata, and hooks.
It imports no generic runtime: the recorder supplies a context.

## Hooks

- `authenticate(ctx)`: log in using `ctx.secrets` in the unrecorded context.
- `prepare(ctx)`: set theme, presentation mode, or local storage before
  storage state is captured.
- `setup(ctx)`: navigate and prove the first recorded view is ready.
- `snapshot(ctx)`: return a stable JSON state projection.
- `run(ctx)`: execute scenes.
- `restore({page, context, manifest, secrets, rehearsal, workDir, scenePlan,
  timeline, before})`: undo partial or completed mutation through an
  independent path. Recorded pointer, typing, and scene helpers are
  intentionally unavailable.
- `verifyRestored({...ctx, before, after})`: fail unless the baseline is
  restored.

`status.productionReady` gates production recording. `status.mutatesState`
must equal `manifest.state.mutatingActions`. Keep actionable items in
`status.todos`; a scaffold may rehearse and fail clearly but cannot record.
Structural preflight treats readiness as informational and returns a separate
`recordReady` value so repair work is not blocked.

The driver is maintained by the Cursor agent, not generated perfectly from
natural language and not repaired by a generic CLI command. After `sync`, the
agent reviews changed actions and rehearsal failures, inspects the actual
accessibility tree/DOM, edits locators and boundaries here, and rehearses
again.

## Driver organization

Keep product-specific semantic targets separate from scene choreography. A
small locator factory is enough; a large page-object framework is not
required:

```js
function productTargets(page) {
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  const canvas = page.getByRole('main');
  return {
    navigation: {
      inventory: navigation.getByRole('link', { name: 'Inventory', exact: true }),
    },
    alertRule: {
      explainAndEdit: canvas.getByRole('button', { name: 'Explain & edit', exact: true }),
    },
  };
}
```

Create the targets in `run()` and use semantic names in scene actions. When the
product layout changes, repair the factory once. Keep stable mechanics in the
runtime helpers; do not copy click, scroll, typing, settling, zoom, or evidence
logic into the product driver.

## Context

The important values and helpers are:

- `page`, `context`, `manifest`, `scenePlan`, `secrets`, `workDir`,
  `rehearsal`; each `scenePlan` scene exposes ordered `cues` plus compatible
  `narration` and `actions` projections;
- `pause(ms)`: scaled in rehearsal;
- `point(locator, {id, hold, layoutIntervalMs, layoutSamples,
  layoutTimeoutMs, layoutTolerancePx, maxRealignments, scroll,
  scrollDurationMs, scrollOffset, steps, travelMs})`;
- `click(locator, id, {evidence, hold, downMs, scroll, scrollDurationMs,
  scrollOffset, steps, travelMs, ...layoutOptions})`, returning
  `{down, up, box}`;
- `typeText(locator, text, id, {clear, delayMs, hold, scroll,
  scrollDurationMs, scrollOffset, travelMs, ...layoutOptions})` for
  viewer-facing sequential typing;
- `startNarration(id, {start, anchor})` and
  `waitNarrationFraction(entry, fraction)`;
- `scene(id, action)`, which starts narration, runs the action concurrently,
  and holds through the segment;
- `measuredWait(id, click.up, targetSeconds, completion)`;
- `scrollMetrics(locator)`,
  `positionAtTop(locator, offset, {id, durationMs, instant})`, and
  `smoothScroll(locator, {id, durationMs, offset, to, capture})`;
- `timeline.markAction(...)`.

## Locator and interaction contract

Every locator passed to a recorded helper must resolve to exactly one visible
element. Scope repeated accessible names to a stable semantic container, for
example:

```js
const navigation = page.getByRole('navigation', { name: 'Primary' });
const alertingLink = navigation.getByRole('link', { name: 'Alerting', exact: true });
await click(alertingLink, 'alerting.open');
```

Do not use `.first()` or `.nth()` to silence a strictness failure. Repeated
labels in navigation, canvas, chat, tabs, and dialogs are normal; choose the
container that expresses the intended target.

`point` and `click` use about 900 ms of visible pointer travel by default.
`typeText` focuses visibly and types sequentially. Use instant `fill()` only
when the input is not meant to be read, such as unrecorded setup, a targeted
probe, or restoration. Never type credentials in the recorded context.

## Stable layout and pointer-hit contract

Recorded motion follows one sequence:

```text
settle → measure → travel → settle and remeasure → verify overlap/hit target → click
```

The runtime requires three stable box samples before travel. If an accordion,
canvas swap, sticky header, or other layout motion changes the box during
travel, it moves the pointer to the new center and checks again. A target that
keeps moving rejects the take.

Immediately before mouse-down, the runtime proves that the drawn pointer
overlaps the latest target box and that `elementFromPoint()` resolves to the
target or one of its descendants. This check uses the browser's rendered
coordinate space, including page zoom. A functional click with a visibly
misaligned pointer is a failed click; never compensate with hard-coded pixel
offsets.

All recorded motion helpers share a queue, so scroll, pointer travel, viewport
positioning, and typing cannot overlap each other. Drivers must also await the
rendered completion boundary of any external layout transition before starting
the next helper.

Set `evidence: true` on each critical `click`. While mouse-down keeps the
pointer pulse visible, the runtime saves a screenshot under
`<workDir>/click-evidence/` and records its path plus pointer/target geometry in
`timeline.json`. Review this evidence for the essential clicks; a green
functional rehearsal alone does not prove visual alignment.

## Narration ownership

Read each scene's ordered `cues` in source order when implementing or repairing
the driver. A narration cue followed by an action cue documents which spoken
context owns that action; the action cue's `actionId` resolves to the matching
entry in `scene.actions`.

Translate those relationships into narration fractions. Each important
sentence should own the action it describes:

```js
await scene('alert-editing', async (narration) => {
  await waitNarrationFraction(narration, 0.28);
  await click(alertingLink, 'alerting.open');
  await waitNarrationFraction(narration, 0.62);
  await click(editButton, 'alerting.edit');
});
```

Do not place every click at scene start merely because narration and actions
run concurrently.

## Event boundaries

The initiating click must finish before a measured wait starts. For an
API/LLM-driven canvas change, prove both phases: the busy state appears, then it
clears and the intended result—not merely any result—becomes unique.

```js
const sent = await click(sendButton, 'analysis.send', { hold: 80 });
const wait = await measuredWait('analysis.response', sent.up, 2, async () => {
  await stopButton.waitFor({ state: 'visible' });
  await sendButton.waitFor({ state: 'visible', timeout: 300_000 });
  await page.getByText('Thinking...', { exact: true }).waitFor({ state: 'hidden' });
  const resultHeading = canvas.getByRole('heading', {
    name: expectedRuleName,
    exact: true,
  });
  if (await resultHeading.count() !== 1) {
    throw new Error(`Expected one completed result for ${expectedRuleName}`);
  }
  await resultHeading.waitFor({ state: 'visible' });
  if (await errorBanner.isVisible()) throw new Error('Analysis failed');
});
startNarration('analysis', {
  start: wait.start + 0.5,
  anchor: { wait: wait.id, offset: 0.5 },
});
```

The timeout only rejects the take. It must never move the driver forward or be
shown as a successful scene.

## Restoration

Prefer an API or isolated-fixture reset. If restoration must use the UI, build
plain, separately scoped locators inside `restore`; search, expand, verify the
target identity, mutate, and verify disappearance or baseline equality. Do not
reuse scene closures or `point`, `click`, and `typeText`: restoration must also
work after a scene fails before those helpers or local variables are usable.

## Scrolling

Use the actual inner owner. `smoothScroll` walks ancestors for vertical
overflow, uses requestAnimationFrame with easing, samples five positions, and
rejects non-progressive movement. Its default duration is 1.6 seconds.
`point`, `click`, and `typeText` automatically use the same slow scroll to
reveal an offscreen target. `positionAtTop` is also smooth by default.

Do not use `scrollIntoViewIfNeeded()`, direct `scrollTop` assignment, or a
single large wheel event during recorded choreography. An explicit
`scroll: 'instant'` or `positionAtTop(..., {instant: true})` is allowed only
when the user asks for a jump. Use `scroll: false` when the target must already
be onscreen and any automatic movement should fail.
