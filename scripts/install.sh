#!/bin/sh

set -eu

fail() {
  printf 'demo-video-builder install: %s\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] ||
  fail "macOS is required; this installer does not support $(uname -s)."

command -v gh >/dev/null 2>&1 ||
  fail "GitHub CLI is required. Install it from https://cli.github.com/."

command -v node >/dev/null 2>&1 ||
  fail "Node.js 20 or newer is required. Install Node.js, then rerun this script."
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')" ||
  fail "Unable to determine the installed Node.js version."
[ "$NODE_MAJOR" -ge 20 ] ||
  fail "Node.js 20 or newer is required; found $(node --version)."

command -v npm >/dev/null 2>&1 ||
  fail "npm is required. Install it with Node.js, then rerun this script."
command -v curl >/dev/null 2>&1 ||
  fail "curl is required to install the verified Kokoro model."

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

npm ci --no-audit --no-fund
"$ROOT/node_modules/.bin/playwright" install chromium
node scripts/demo.mjs kokoro-setup
npm run smoke
npm test
node scripts/demo.mjs help >/dev/null

printf 'Demo Video Builder (demo-video-builder) is ready at %s\n' "$ROOT"
