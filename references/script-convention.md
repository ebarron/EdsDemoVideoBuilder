# Script convention

The Markdown keeps spoken words and visual instructions together in viewer
order. The generated plan preserves that order as cues while retaining
separate compatibility projections for narration audio and driver actions.

## Interleaved Markdown

- Ordinary paragraphs and blockquotes become narration.
- Standalone italic or bracketed directions become actions. Put each direction
  where it belongs in the spoken flow:

```markdown
The platform verifies the result independently.

*[Open the verification evidence and point to Passed.]*

This is the evidence an operator can audit later.
```

- An English square-bracket direction may also appear inline when that is
  easier to author:

```markdown
First, open the dashboard. [Click Dashboard.] The health summary is now in view.
```

  The two prose fragments become narration cues around one action cue.
  Plain inline directions begin with an action verb such as `Click`, `Open`,
  `Point`, `Type`, or `Scroll`, so ordinary Markdown links and bracketed prose
  remain narration. Existing emphasized bracket directions remain supported.
- Headings provide scene names and generated IDs.
- Code fences are not narration.

Each generated scene contains ordered `cues`. Narration cues hold spoken text;
action cues refer to the matching entry in `actions`:

```json
{
  "cues": [
    { "id": "opening-narration-1", "kind": "narration", "text": "First, open the dashboard." },
    { "id": "open-dashboard", "kind": "action", "actionId": "open-dashboard" },
    { "id": "opening-narration-2", "kind": "narration", "text": "The health summary is now in view." }
  ],
  "narration": "First, open the dashboard. The health summary is now in view.",
  "actions": [
    { "id": "open-dashboard", "direction": "Click Dashboard." }
  ]
}
```

`narration` and `actions` remain available so existing drivers, clip naming,
and scene-level audio continue to work. They are generated projections, not an
instruction to separate the human source.

Cursor reviews the generated plan after initialization; users normally keep
editing only the Markdown. Long design documents commonly contain tables of
contents, implementation notes, appendices, captions, and other non-spoken
content. The parser excludes sections headed `Appendix`,
`Building the video notes`, `Internal notes`/`Internal runbook`, or `Captions`
(including their subsections) and `Narration timing budget` by default. In a
larger design document, a `Voiceover narrative`, `Spoken script`, or
`Demo narration` section becomes the preferred script root. Use clear English
scene headings or a dedicated script if a document uses less recognizable
conventions.

## Legacy machine comments

Older scripts containing `demo:scene` or `demo:action` machine comments remain
readable for backward compatibility, and those comments are removed from
spoken narration. Do not add them to new or existing human-authored scripts.
New authoring uses English headings, spoken prose, and English square-bracket
directions; stable IDs and driver hints belong in generated artifacts managed
by Cursor.

## Updating an existing script

Markdown is authoritative. Preview a resynchronization before writing:

```bash
node scripts/demo.mjs sync --manifest path/to/demo.yaml
node scripts/demo.mjs sync --manifest path/to/demo.yaml --write
```

The first command reports scene/action additions, removals, and changes plus
cue-alignment changes, an internal classification, and whether driver review
is required.
`--write` backs up the existing plan and atomically replaces it; `--check`
exits nonzero when drift exists. The generated plan stores a SHA-256 source
hash. Stable scene/action IDs and custom hints are preserved when matching is
deterministic.

### Existing demos

Plans created before ordered cues are still valid. When their square-bracket
directions were already recognized as standalone actions, the first sync
reports `representation-only` and `driverReviewRequired: false`. Run
`sync --write` to add `scene.cues`; this does not change `scene.narration`,
`scene.actions`, driver hooks, or scene-based narration clip names.

An old plan may contain an inline `[Click ...]` direction inside
`scene.narration`, because the old parser recognized bracket directions only
on standalone lines. The new preview removes it from spoken narration and adds
an action at that source position. This is an intentional semantic correction,
not a representation-only migration: review the new action against the driver
before writing and rerecording.

No automatic Markdown rewrite is necessary when the source already alternates
spoken paragraphs and stage directions. If a prior workflow physically
collected directions in a separate section, their intended narration
association is not recoverable from the old plan. Manually move each direction
beside the sentence it supports, preview sync, and review any `alignment`
classification before writing and rerecording.

Legacy plans may contain hand-curated scene splits that are not represented in
the Markdown. If preview reports broad structural churn, stop before
`--write`; use clear English headings or have the agent reconcile that
segmentation first. Do not require JSON comments in the narration file.

Wording changes update narration but do not require a driver or locator
change. Moving an unchanged stage direction to another source line without
crossing a narration/action boundary is also not a choreography change.
Moving it across a narration boundary is an `alignment` change and requires
reviewing its `waitNarrationFraction` checkpoint. Changed, added, removed, or
reordered stage directions require the agent to compare affected actions with
`driver.mjs`, inspect the live app, edit the driver, and rehearse. The CLI
validates this work; it does not pretend to repair arbitrary selectors.

Users do not need to classify changes. Plain requests such as “I revised the
narration; resynchronize and rerecord” are sufficient. Stating the intended
change type is optional and helps detect accidental churn, but runtime evidence
still wins.

For demos that will be revised repeatedly, keep scene headings and action
wording recognizable so generated IDs remain stable. Keep spoken copy and
English square-bracket browser directions syntactically distinct but
interleave them in viewer order; do not collect directions elsewhere. For an
expensive late scene, provide an isolated seed/setup and reset procedure and
ask for a targeted probe before the final full rehearsal.

## Timing

Optional explicit scene timing belongs in the normalized plan:

```json
{
  "timing": {
    "duration": 18.4,
    "rate": 150
  }
}
```

Generated macOS speech and supplied clips replace estimated duration with the
measured audio duration. Keep one narration segment per scene so human clips
can be replaced independently.
