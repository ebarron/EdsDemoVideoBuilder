# Manifest reference

`demo.yaml` is configuration; `driver.mjs` is behavior. Manifest paths resolve
relative to the manifest file.

## Contract

- `version: 1` and `compatibility: ">=1.0.0 <2.0.0"` identify the runtime
  contract.
- `script`, `scenePlan`, and `driver` point to the human source, generated
  normalized plan, and agent-maintained executable application driver. The
  plan records a source hash and is refreshed with `sync`; it is normally not
  hand-edited.
- `app.url`, `app.cwd`, and `app.lifecycle` define the app. Lifecycle
  `external` requires an already-running app. `command` uses an argv array,
  waits for `readyUrl`, and stops its child after rehearsal/recording.
- `browser` defines Chrome channel, viewport, zoom, and color scheme.
- `auth.mode` is `none`, `driver`, or `storage-state`. `auth.env` maps logical
  names used by the driver to environment-variable names. `storageStateEnv`
  names an environment variable containing a path to a mode-0600 Playwright
  state file.
- `narration.mode` is `macos-say`, `clips`, `reference`, or `silent`.
- `timing` controls rehearsal scale, successful-wait compression target,
  visible label, and tail padding.
- `state.policy` is `read-only` or `restore`; `mutatingActions` must match the
  driver's declaration.
- `output.workDir` contains replaceable take data. Final video, contact sheet,
  and timeline are never overwritten unless `finish --force` is explicit.
- `tools.ffmpegEnv`, when present, names an environment variable containing
  the FFmpeg executable path.

## Environment references

Use only names:

```yaml
auth:
  mode: driver
  env:
    username: PRODUCT_DEMO_USERNAME
    password: PRODUCT_DEMO_PASSWORD
```

The runtime passes resolved values as `secrets.username` and
`secrets.password`. A field such as `password: value` is schema-invalid.
Lifecycle environment mapping follows the same pattern:

```yaml
lifecycle:
  mode: command
  start: ["npm", "run", "dev"]
  env:
    API_TOKEN: PRODUCT_DEMO_API_TOKEN
```

Here `API_TOKEN` is the child-process variable and the value is the source
environment-variable name.
