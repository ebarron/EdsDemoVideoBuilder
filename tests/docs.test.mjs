import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MARKDOWN = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'SKILL.md'),
  ...fs.readdirSync(path.join(ROOT, 'references'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(ROOT, 'references', name)),
];

test('local Markdown links resolve', () => {
  for (const file of MARKDOWN) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]+]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|#)/.test(link)) continue;
      assert.equal(
        fs.existsSync(path.resolve(path.dirname(file), link)),
        true,
        `${path.relative(ROOT, file)} has a missing link: ${link}`,
      );
    }
  }
});
