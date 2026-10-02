import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  KOKORO_MODEL,
  KOKORO_MODEL_REVISION,
  KOKORO_PACKAGE_VERSION,
} from '../runtime/kokoro.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const README = read('README.md');
const DISCLOSURE = read('THIRD_PARTY_DEPENDENCIES.md');
const ROOT_PACKAGE = readJson('package.json');
const ROOT_LOCK = readJson('package-lock.json');
const KOKORO_PACKAGE = readJson('resources/kokoro-runtime/package.json');
const KOKORO_LOCK = readJson('resources/kokoro-runtime/package-lock.json');

test('LICENSE is the canonical Apache License 2.0 text', () => {
  const digest = crypto.createHash('sha256').update(read('LICENSE')).digest('hex');
  assert.equal(digest, 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4');
});

test('package metadata and lockfile roots declare Apache-2.0', () => {
  for (const [manifest, lock] of [
    [ROOT_PACKAGE, ROOT_LOCK],
    [KOKORO_PACKAGE, KOKORO_LOCK],
  ]) {
    assert.equal(manifest.private, true);
    assert.equal(manifest.license, 'Apache-2.0');
    assert.equal(lock.packages[''].license, 'Apache-2.0');
    assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  }
});

test('dependency disclosure tracks direct locked versions and sources', () => {
  const directDependencies = [
    [ROOT_PACKAGE, ROOT_LOCK],
    [KOKORO_PACKAGE, KOKORO_LOCK],
  ];
  for (const [manifest, lock] of directDependencies) {
    for (const [name, declared] of Object.entries(manifest.dependencies)) {
      const resolved = lock.packages[`node_modules/${name}`]?.version;
      assert.ok(resolved, `${name} is missing from its lockfile`);
      const entry = DISCLOSURE.match(
        new RegExp(`- \\*\\*${escapeRegex(name)}\\*\\*[\\s\\S]*?(?=\\n- \\*\\*|\\n\\n)`),
      )?.[0];
      assert.ok(entry, `${name} is missing from the dependency disclosure`);
      assert.match(entry, new RegExp(escapeRegex(declared)));
      assert.match(entry, new RegExp(escapeRegex(resolved)));
    }
  }

  for (const source of [
    'https://github.com/microsoft/playwright',
    'https://github.com/ajv-validator/ajv',
    'https://github.com/ajv-validator/ajv-formats',
    'https://github.com/eugeneware/ffmpeg-static',
    'https://github.com/nodeca/js-yaml',
    'https://github.com/hexgrad/kokoro',
    'https://github.com/espeak-ng/espeak-ng',
  ]) {
    assert.match(DISCLOSURE, new RegExp(escapeRegex(source)));
  }
  assert.match(DISCLOSURE, /not bundled or\s+vendored in this git repository/);
  assert.match(DISCLOSURE, /`package-lock\.json` is authoritative/);
  assert.match(DISCLOSURE, /`resources\/kokoro-runtime\/package-lock\.json`/);
  assert.match(DISCLOSURE, /do not\s+mean that this repository packages or redistributes/);
});

test('Kokoro disclosure follows executable pins and integrity metadata', () => {
  assert.match(DISCLOSURE, new RegExp(escapeRegex(KOKORO_PACKAGE_VERSION)));
  assert.match(DISCLOSURE, new RegExp(escapeRegex(KOKORO_MODEL)));
  assert.match(DISCLOSURE, new RegExp(escapeRegex(KOKORO_MODEL_REVISION)));

  const runtime = read('runtime/kokoro.mjs');
  const q8Digest = runtime.match(
    /q8:\s*\{[\s\S]*?algorithm:\s*'sha256',[\s\S]*?digest:\s*'([a-f0-9]{64})'/,
  )?.[1];
  assert.ok(q8Digest, 'could not read the pinned q8 model digest');
  assert.match(DISCLOSURE, new RegExp(q8Digest));
});

test('README links to concise license and dependency details', () => {
  assert.match(README, /\[Apache License 2\.0]\(LICENSE\)/);
  assert.match(README, /\[Third-party dependencies]\(THIRD_PARTY_DEPENDENCIES\.md\)/);

  const section = README.match(/## License and dependencies\n([\s\S]*)$/)?.[1];
  assert.ok(section, 'README license section is missing');
  assert.ok(section.length < 500, 'README license section should stay concise');
  assert.doesNotMatch(section, /kokoro-js|ffmpeg-static|ajv-formats/);

  for (const document of ['README.md', 'THIRD_PARTY_DEPENDENCIES.md']) {
    const source = read(document);
    for (const match of source.matchAll(/\[[^\]]+]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|#)/.test(link)) continue;
      assert.equal(
        fs.existsSync(path.resolve(path.dirname(path.join(ROOT, document)), link)),
        true,
        `${document} has a missing link: ${link}`,
      );
    }
  }
});
