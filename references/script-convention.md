# Script convention

The parser deliberately separates human narrative from executable truth.

## Legacy Markdown

- Ordinary paragraphs and blockquotes become narration.
- Standalone italic or bracketed directions become actions:

```markdown
The platform verifies the result independently.

*[Open the verification evidence and point to Passed.]*
```

- Headings provide scene names and generated IDs.
- Code fences are not narration.

Cursor reviews the generated plan after initialization; users normally keep
editing only the Markdown. Long design documents commonly contain tables of
contents, implementation notes, appendices, captions, and other non-spoken
content. The parser excludes sections headed `Appendix`,
`Building the video notes`, `Internal notes`/`Internal runbook`, or `Captions`
(including their subsections) and `Narration timing budget` by default. In a
larger design document, a `Voiceover narrative`, `Spoken script`, or
`Demo narration` section becomes the preferred script root. Use explicit scene
comments or a dedicated script if a document uses less recognizable
conventions.

## Explicit comments

Use JSON comments when stable IDs or machine hints matter:

```markdown
<!-- demo:scene {"id":"verification","title":"Independent verification"} -->

The platform verified the outcome, not merely the command.

<!-- demo:action {"id":"show-proof","type":"click","target":"Verification passed","success":"Timeline event is visible"} -->
```

Comments are removed from narration. An action can contain descriptive
`target`, `success`, `error`, `compressionTarget`, or other review hints. The
driver still owns selectors and behavior.

## Updating an existing script

Markdown is authoritative. Preview a resynchronization before writing:

```bash
node scripts/demo.mjs sync --manifest path/to/demo.yaml
node scripts/demo.mjs sync --manifest path/to/demo.yaml --write
```

The first command reports scene/action additions, removals, and changes plus
an internal classification and whether driver review is required.
`--write` backs up the existing plan and atomically replaces it; `--check`
exits nonzero when drift exists. The generated plan stores a SHA-256 source
hash. Stable scene/action IDs and custom hints are preserved when matching is
deterministic.

Legacy plans may contain hand-curated scene splits that are not represented in
the Markdown. If preview reports broad structural churn, stop before
`--write`; add explicit `demo:scene` comments or have the agent reconcile that
segmentation first.

Wording changes update narration but do not require a driver or locator
change. Moving an unchanged stage direction to another source line is also not
a choreography change. Changed, added, or removed stage directions require the
agent to compare the affected actions with `driver.mjs`, inspect the live app,
edit the driver, and rehearse. The CLI validates this work; it does not pretend
to repair arbitrary selectors.

Users do not need to classify changes. Plain requests such as “I revised the
narration; resynchronize and rerecord” are sufficient. Stating the intended
change type is optional and helps detect accidental churn, but runtime evidence
still wins.

For demos that will be revised repeatedly, use explicit stable scene and
action IDs. Keep spoken copy in paragraphs and browser behavior in separate
stage directions so narration edits do not look like choreography edits. For
an expensive late scene, provide an isolated seed/setup and reset procedure and
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
