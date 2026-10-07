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
  waits for `readyUrl`, and stops its child after rehearsal/recording. Command
  children receive a minimal startup environment rather than the agent's
  complete ambient environment.
- `app.allowInsecureTls` defaults to `false`. Set it to `true` only for a known
  self-signed demo endpoint.
- `browser` defines Chrome channel, viewport, zoom, and color scheme.
- `auth.mode` is `none`, `driver`, or `storage-state`. `auth.env` maps logical
  names used by the driver to environment-variable names. `storageStateEnv`
  names an environment variable containing a path to a mode-0600 Playwright
  state file.
- `narration.mode` is `macos-say`, `kokoro`, `clips`, `reference`, or
  `silent`. New scaffolds use Kokoro and its nested configuration.
- `timing` controls rehearsal scale, successful-wait compression target,
  visible label, and tail padding.
- `state.policy` is `read-only` or `restore`; `mutatingActions` must match the
  driver's declaration.
- `output.workDir` contains replaceable take data. Final video, contact sheet,
  and timeline are never overwritten unless `finish --force` is explicit.
- `tools.ffmpegEnv`, when present, names an environment variable containing
  the FFmpeg executable path.

## Generated-artifact locations

The scaffold keeps replaceable recording data in `/tmp/<id>-demo` and final
artifacts in its `output/` directory. Raw browser video, generated narration,
click evidence, lifecycle logs, rejected-take diagnostics, filter scripts, and
timeline pointers stay under `output.workDir`. Human-voice sessions, takes,
private launchers, and studio locks stay in the adjacent `<id>-voiceover/`
directory. The installed Kokoro runtime uses `.kokoro-runtime/`; its model and
audio cache default to the user's system cache outside the checkout.

These standard locations and exact generated filenames are ignored by this
repository. Media extensions are not ignored globally because narration clips,
reference audio, and documentation media may be intentional source assets. If
`output.workDir`, `narration.kokoro.cacheDir`, or final output paths are
overridden to another location inside a repository, ignore that exact
directory or generated file in the consuming repository unless the artifact
is intentionally published. Storage-state files remain external inputs; the
runtime keeps newly prepared browser state in memory and never copies it into
project output.

## Default Kokoro narration

Existing manifests remain valid and keep their declared provider. New
scaffolds default to Kokoro. Its configuration is nested so speed and model
settings cannot alter another narration provider:

```yaml
narration:
  mode: kokoro
  defaultOffsetSeconds: 0.5
  audioFirst: false
  kokoro:
    model: onnx-community/Kokoro-82M-v1.0-ONNX
    voice: af_heart
    speed: 1
    dtype: q8
    device: cpu
    allowModelDownload: true
```

`model` and `cacheDir` are optional; the runtime uses the pinned model and
user-cache path by default. If `model` is present, it must name that pinned
model; arbitrary remote code or weights are rejected. `speed` accepts `0.5`
through `2`, and `dtype`
accepts `q8`, `q4`, `q4f16`, `fp16`, or `fp32`. The Node provider currently
requires `device: cpu`.

`allowModelDownload` defaults to `true` only after `mode: kokoro` has been
selected. Set it to `false` for cache-only operation. Install/update runs
`kokoro-setup`, placing the provider in the installed skill's ignored
`.kokoro-runtime` directory and the verified default model in the user cache.
Production repairs missing assets. Generated-audio caches remain under the
user cache unless `cacheDir` overrides them.

## Self-signed TLS

Strict certificate validation is the default. For a demo environment with a
known self-signed certificate:

```yaml
app:
  url: https://demo.example.com/
  allowInsecureTls: true
  cwd: ../../..
  lifecycle:
    mode: external
```

When enabled, the runtime sets `ignoreHTTPSErrors: true` on both the unrecorded
authentication/preparation context and the recorded browser context.
Preflight and lifecycle checks also accept the self-signed certificate,
including an HTTPS `lifecycle.readyUrl`.

The bypass belongs only to this manifest and its requests. Never use
`NODE_TLS_REJECT_UNAUTHORIZED=0`; that disables verification process-wide and
can affect unrelated network traffic.

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
environment-variable name. Values stay outside the manifest.

Command lifecycles inherit only portable process-startup settings: executable
search paths, home/user/shell values, temporary-directory and locale values,
plus the corresponding Windows startup variables. App, cloud, credential,
debugging, and package-manager configuration is excluded unless named in
`lifecycle.env`. This includes ambient values such as `NODE_OPTIONS`.

For an existing app that previously relied on implicit inheritance, map each
required source variable explicitly. A same-name mapping is the migration
escape hatch:

```yaml
lifecycle:
  mode: command
  start: ["npm", "run", "dev"]
  env:
    DATABASE_URL: DATABASE_URL
    NODE_ENV: PRODUCT_DEMO_NODE_ENV
```

There is intentionally no wildcard or “inherit everything” setting. The skill
inspects the app's startup configuration and maintains these name-only
mappings. It asks only when a required variable or credential cannot be
inferred, and never writes the value into managed files.
