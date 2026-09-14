# Ordered-cue migration

The human source remains a Markdown narration file. Spoken words stay as
ordinary prose, and browser instructions stay as plain English inside square
brackets at the point where they should happen:

```markdown
This dashboard summarizes the current workload. [Click Analytics.] The chart
shows when request volume peaked.
```

Do not convert this file to JSON and do not add machine metadata. The generated
`scene-plan.json` is the only JSON representation.

## What remains compatible

- Scene-plan `version` remains `1`.
- Existing plans without `scene.cues` are accepted.
- `scene.narration` and `scene.actions` remain available.
- Existing `driver.mjs` hooks and action IDs remain available.
- Narration clips keep their existing scene-based names.
- Sync never rewrites the Markdown and backs up the old plan before writing.

## Upgrade each existing demo

Update the installed skill, then preview:

```bash
node scripts/demo.mjs sync --manifest path/to/demo.yaml
```

Review the classification before applying it.

### Standalone directions

If the old parser already recognized each square-bracket direction as an
action, preview reports `representation-only` with
`driverReviewRequired: false`. Apply the additive migration:

```bash
node scripts/demo.mjs sync --manifest path/to/demo.yaml --write
```

No driver edit or rerecord is required solely for this representation change.

### Directions embedded in prose lines

The old parser may have included an inline `[Click ...]` direction in spoken
narration. The new parser removes it from speech and creates an action at that
exact cue position. Preview therefore reports narration and choreography
changes and requires driver review. Confirm or implement that action, align its
narration checkpoint, rehearse, and then rerecord.

### Directions collected in a separate section

There is not enough information to infer which sentence owns each detached
direction. Manually move each English square-bracket instruction beside the
relevant narration. Preview should report the resulting alignment or
choreography changes. Review the affected narration checkpoints and actions
before writing and rerecording.

## Verify the result

After `sync --write`, rerun preview. It should report no drift. Inspect
`scene.cues` only when diagnosing synchronization; continue editing the
Markdown narration file for normal work.
