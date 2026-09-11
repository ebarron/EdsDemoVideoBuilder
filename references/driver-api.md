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
- `restore({...ctx, before})`: undo partial or completed mutation.
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

## Context

The important values and helpers are:

- `page`, `context`, `manifest`, `scenePlan`, `secrets`, `workDir`,
  `rehearsal`;
- `pause(ms)`: scaled in rehearsal;
- `point(locator, {id, hold, scroll})`;
- `click(locator, id, {hold, downMs, scroll})`, returning `{down, up, box}`;
- `startNarration(id, {start, anchor})` and
  `waitNarrationFraction(entry, fraction)`;
- `scene(id, action)`, which starts narration, runs the action concurrently,
  and holds through the segment;
- `measuredWait(id, click.up, targetSeconds, completion)`;
- `scrollMetrics(locator)`, `positionAtTop(locator, offset)`, and
  `smoothScroll(locator, {id, durationMs, offset, to, capture})`;
- `timeline.markAction(...)`.

## Event boundaries

The initiating click must finish before a measured wait starts:

```js
const sent = await click(sendButton, 'analysis.send', { hold: 80 });
const wait = await measuredWait('analysis.response', sent.up, 2, async () => {
  await stopButton.waitFor({ state: 'visible' });
  await sendButton.waitFor({ state: 'visible', timeout: 300_000 });
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

## Scrolling

Use the actual inner owner. `smoothScroll` walks ancestors for vertical
overflow, uses requestAnimationFrame with easing, samples five positions, and
rejects non-progressive movement. Use `positionAtTop` before a hold/pan so an
important generated heading begins at the viewport top.
