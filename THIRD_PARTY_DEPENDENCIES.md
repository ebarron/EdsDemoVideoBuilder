# Third-party dependencies

Demo Video Builder's own source is licensed under Apache-2.0. That license does
not replace the licenses of the components listed here.

## Installation and distribution model

Third-party packages, executables, browsers, and model files are not bundled or
vendored in this git repository. The repository contains package manifests,
lockfiles, and integrity metadata. At installation time:

- `npm ci` fetches the root dependency graph from the npm registry.
- Playwright fetches its compatible Chromium build from Playwright's upstream
  distribution service.
- `ffmpeg-static` obtains its platform FFmpeg executable through its upstream
  package installer.
- Kokoro setup uses the separate locked manifest in
  `resources/kokoro-runtime/` and fetches model files from the pinned
  Hugging Face revision.

Those downloaded files remain subject to their upstream licenses and notices.
This document describes the repository's dependency inputs; it is not a grant
to redistribute an installed dependency tree, browser, executable, or model
cache.

## Direct and runtime components

The root `package.json` declares these direct dependencies:

- **@playwright/test** — declared and resolved as `1.63.0`;
  [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html);
  [source](https://github.com/microsoft/playwright). Its exact version selects
  the Playwright-managed Chromium build installed by `playwright install
  chromium`. Chromium is primarily BSD-3-Clause and includes components under
  additional licenses; see the
  [Chromium source and notices](https://chromium.googlesource.com/chromium/src/).
- **ajv** — declared as `^8.17.1`, currently resolved as `8.20.0`;
  [MIT](https://spdx.org/licenses/MIT.html);
  [source](https://github.com/ajv-validator/ajv).
- **ajv-formats** — declared as `^3.0.1`, currently resolved as `3.0.1`;
  [MIT](https://spdx.org/licenses/MIT.html);
  [source](https://github.com/ajv-validator/ajv-formats).
- **ffmpeg-static** — declared and resolved as `5.3.0`;
  [GPL-3.0-or-later](https://spdx.org/licenses/GPL-3.0-or-later.html);
  [package source](https://github.com/eugeneware/ffmpeg-static) and
  [FFmpeg source](https://ffmpeg.org/). The downloaded FFmpeg executable is
  used locally and is not committed to this repository.
- **js-yaml** — declared as `^4.1.0`, currently resolved as `4.3.2`;
  [MIT](https://spdx.org/licenses/MIT.html);
  [source](https://github.com/nodeca/js-yaml).

The isolated synthetic-speech runtime declares:

- **kokoro-js** — declared and resolved as `1.2.1`;
  [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html);
  [source](https://github.com/hexgrad/kokoro). Its locked transitive
  `phonemizer@1.2.1` package is Apache-2.0 and incorporates the
  [eSpeak-NG](https://github.com/espeak-ng/espeak-ng) engine, which is
  GPL-3.0-or-later. The installed runtime therefore requires GPL review before
  any separate redistribution.
- **Kokoro-82M-v1.0-ONNX model assets** —
  [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html);
  [pinned source revision](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231).
  `runtime/kokoro.mjs` pins revision
  `1939ad2a8e416c0acfeecc08a694d14ef25f2231` and validates every downloaded
  tokenizer and ONNX file by expected size and cryptographic digest. The
  default `q8` model file has SHA-256
  `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478`.

Node.js, npm, GitHub CLI, and curl are installation prerequisites rather than
repository dependencies. They are not installed, pinned, or redistributed by
this project.

## Authoritative versions

`package-lock.json` is authoritative for the complete root npm graph, including
exact transitive versions, registry URLs, integrity hashes, and package license
metadata. `resources/kokoro-runtime/package-lock.json` serves the same role for
the isolated Kokoro graph. A compatible range in a `package.json` does not
override the exact version selected by its lockfile when `npm ci` runs.

The model revision, expected sizes, and digests in `runtime/kokoro.mjs` are
authoritative for Kokoro assets. The exact Playwright and `ffmpeg-static`
package pins select their separately downloaded runtime executables. Upstream
license files and notices remain controlling if package metadata is incomplete
or inconsistent.

## Maintaining and auditing dependencies

When changing dependencies, maintainers should:

1. Update the relevant manifest and regenerate its lockfile with npm; do not
   hand-edit resolved versions or integrity values.
2. Review the lockfile diff, upstream source, release notes, license, and
   notices. Update this focused list when a direct dependency, runtime asset,
   source, or license changes.
3. If the Kokoro model changes, pin an immutable revision, record expected
   sizes and digests in `runtime/kokoro.mjs`, and verify the model's upstream
   license.
4. Reinstall with `npm ci`, run the test and smoke suites, and audit both npm
   graphs with `npm audit --omit=dev` and
   `npm --prefix resources/kokoro-runtime audit --omit=dev`.
5. Evaluate audit findings in the context of the actual runtime path and
   document or remediate them before release. Automated audit output does not
   replace dependency-license review.

These steps inspect dependencies fetched for local installation. They do not
mean that this repository packages or redistributes those dependencies.
