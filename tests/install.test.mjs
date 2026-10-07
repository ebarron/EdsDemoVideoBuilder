import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { browserLaunchOptions, browserTlsOptions } from '../runtime/recorder.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INSTALL = path.join(ROOT, 'scripts', 'install.sh');

function writeExecutable(file, source) {
  fs.writeFileSync(file, source, { mode: 0o755 });
}

test('installer is executable, idempotent, and verifies required tooling', () => {
  const script = fs.readFileSync(INSTALL, 'utf8');
  assert.notEqual(fs.statSync(INSTALL).mode & 0o111, 0);
  for (const pattern of [
    /uname -s/,
    /command -v gh/,
    /Node\.js 20/,
    /command -v npm/,
    /command -v curl/,
    /npm ci/,
    /playwright" install chromium/,
    /node scripts\/demo\.mjs kokoro-setup/,
    /npm run smoke/,
    /npm test/,
    /node scripts\/demo\.mjs help/,
  ]) {
    assert.match(script, pattern);
  }
  assert.doesNotMatch(script, /token=|password=|credential=/i);
  assert.doesNotMatch(script, /\.cursor\/skills\//);
});

test('fresh-clone layout installs twice from an arbitrary directory', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-video-builder-install-'));
  try {
    const checkout = path.join(sandbox, 'arbitrary-install-directory');
    const tracked = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], {
      encoding: 'buffer',
    });
    assert.equal(tracked.status, 0, tracked.stderr.toString());
    for (const relative of tracked.stdout.toString().split('\0').filter(Boolean)) {
      const source = path.join(ROOT, relative);
      if (!fs.existsSync(source)) continue;
      const destination = path.join(checkout, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      fs.chmodSync(destination, fs.statSync(source).mode);
    }

    const fakeBin = path.join(sandbox, 'bin');
    const log = path.join(sandbox, 'install.log');
    fs.mkdirSync(fakeBin);
    writeExecutable(path.join(fakeBin, 'uname'), '#!/bin/sh\nprintf "Darwin\\n"\n');
    writeExecutable(path.join(fakeBin, 'gh'), '#!/bin/sh\nexit 0\n');
    writeExecutable(
      path.join(fakeBin, 'node'),
      `#!/bin/sh
if [ "$1" = "-p" ]; then
  printf "20\\n"
  exit 0
fi
printf "node %s\\n" "$*" >> "$INSTALL_TEST_LOG"
`,
    );
    writeExecutable(
      path.join(fakeBin, 'npm'),
      `#!/bin/sh
printf "npm %s\\n" "$*" >> "$INSTALL_TEST_LOG"
if [ "$1" = "ci" ]; then
  mkdir -p "$PWD/node_modules/.bin"
  cat > "$PWD/node_modules/.bin/playwright" <<'EOF'
#!/bin/sh
printf "playwright %s\\n" "$*" >> "$INSTALL_TEST_LOG"
EOF
  chmod +x "$PWD/node_modules/.bin/playwright"
fi
`,
    );

    const runInstaller = () => spawnSync(path.join(checkout, 'scripts', 'install.sh'), {
      cwd: sandbox,
      encoding: 'utf8',
      env: {
        ...process.env,
        INSTALL_TEST_LOG: log,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = runInstaller();
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, new RegExp(`ready at ${checkout.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }

    const calls = fs.readFileSync(log, 'utf8');
    for (const invocation of [
      'npm ci --no-audit --no-fund',
      'playwright install chromium',
      'node scripts/demo.mjs kokoro-setup',
      'npm run smoke',
      'npm test',
      'node scripts/demo.mjs help',
    ]) {
      assert.equal(
        calls.split('\n').filter((line) => line === invocation).length,
        2,
        `expected two calls to ${invocation}`,
      );
    }
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('default Chromium launch uses the browser installed by Playwright', () => {
  assert.deepEqual(browserLaunchOptions('chromium'), {});
  assert.deepEqual(browserLaunchOptions('chrome'), { channel: 'chrome' });
});

test('browser TLS bypass is scoped to the manifest option', () => {
  assert.deepEqual(browserTlsOptions({ app: {} }), { ignoreHTTPSErrors: false });
  assert.deepEqual(
    browserTlsOptions({ app: { allowInsecureTls: true } }),
    { ignoreHTTPSErrors: true },
  );
});

test('repository ignores generated artifacts without hiding source media', () => {
  const generated = {
    dependencies: [
      'node_modules/example/index.js',
      '.kokoro-runtime/node_modules/example/index.js',
    ],
    playwright: [
      'playwright-report/index.html',
      'test-results/run/screenshot.png',
      'blob-report/report.zip',
      '.playwright/cache/browser',
      'artifacts/trace.zip',
    ],
    recording: [
      'demos/example/demo.yaml',
      'output/example.mp4',
      'captures/frame.png',
      'raw/take.webm',
      'scratch/click-evidence/001-save.png',
      'scratch/example-timeline.json',
      'scratch/example-contact-sheet.png',
    ],
    voiceover: [
      'output/example-voiceover/sessions/one/takes/opening.wav',
      'output/example-human.mp4',
      'scratch/.studio-launch-private.html',
      'scratch/.studio.lock',
    ],
    localState: [
      '.env.local',
      '.auth/browser.json',
      'auth-state-local.json',
      'account-storage-state.json',
    ],
    transient: [
      'coverage/lcov.info',
      '.nyc_output/process.json',
      'logs/recording.log',
      'scratch/app-lifecycle.log',
      'scratch/scene-plan.json.tmp-123',
      'tmp/session.json',
    ],
  };
  const sourceExamples = [
    '.env.test.example',
    'docs/video/example.mp4',
    'examples/narration.wav',
    'tests/fixtures/capture.har',
    'tests/fixtures/take.webm',
  ];
  const candidates = [...Object.values(generated).flat(), ...sourceExamples];
  const check = spawnSync(
    'git',
    ['-C', ROOT, 'check-ignore', '--no-index', '-z', '--stdin'],
    { input: `${candidates.join('\0')}\0`, encoding: 'utf8' },
  );
  assert.ok([0, 1].includes(check.status), check.stderr);
  const ignored = new Set(check.stdout.split('\0').filter(Boolean));
  for (const [category, paths] of Object.entries(generated)) {
    for (const file of paths) {
      assert.equal(ignored.has(file), true, `${category} artifact is not ignored: ${file}`);
    }
  }
  for (const file of sourceExamples) {
    assert.equal(ignored.has(file), false, `source example is unexpectedly ignored: ${file}`);
  }

  const trackedIgnored = spawnSync(
    'git',
    ['-C', ROOT, 'ls-files', '-ci', '--exclude-standard'],
    { encoding: 'utf8' },
  );
  assert.equal(trackedIgnored.status, 0, trackedIgnored.stderr);
  assert.equal(trackedIgnored.stdout, '', 'tracked source is hidden by .gitignore');
});
