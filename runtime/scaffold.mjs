import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDemoScript, slugify } from './parser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(HERE, '..', 'templates');

function relativePath(from, to) {
  const value = path.relative(from, to) || '.';
  return value.startsWith('.') ? value : `./${value}`;
}

function render(template, values) {
  return template.replace(/\{\{([A-Z_]+)}}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Missing template value ${key}`);
    return values[key];
  });
}

export function scaffoldFiles({ script, url, id, appCwd, outputDir }) {
  const absoluteScript = path.resolve(script);
  const demoId = slugify(id);
  const absoluteOutput = path.resolve(outputDir ?? path.join(process.cwd(), 'demos', demoId));
  const absoluteAppCwd = path.resolve(appCwd ?? process.cwd());
  if (!fs.existsSync(absoluteScript)) throw new Error(`Script does not exist: ${absoluteScript}`);

  const manifestTemplate = fs.readFileSync(path.join(TEMPLATE_DIR, 'demo.yaml'), 'utf8');
  const driverTemplate = fs.readFileSync(path.join(TEMPLATE_DIR, 'driver.mjs'), 'utf8');
  const notesTemplate = fs.readFileSync(path.join(TEMPLATE_DIR, 'notes.md'), 'utf8');
  const plan = parseDemoScript(fs.readFileSync(absoluteScript, 'utf8'), {
    source: relativePath(absoluteOutput, absoluteScript),
  });
  plan.sourceHash = `sha256:${crypto.createHash('sha256')
    .update(fs.readFileSync(absoluteScript))
    .digest('hex')}`;
  if (!plan.scenes.length) throw new Error(`No narration or stage directions found in ${absoluteScript}`);

  const files = new Map([
    [
      path.join(absoluteOutput, 'demo.yaml'),
      render(manifestTemplate, {
        ID: demoId,
        SCRIPT: relativePath(absoluteOutput, absoluteScript),
        URL: url,
        APP_CWD: relativePath(absoluteOutput, absoluteAppCwd),
      }),
    ],
    [path.join(absoluteOutput, 'driver.mjs'), driverTemplate],
    [path.join(absoluteOutput, 'scene-plan.json'), `${JSON.stringify(plan, null, 2)}\n`],
    [path.join(absoluteOutput, 'building-the-video.md'), notesTemplate],
  ]);
  return { demoId, outputDir: absoluteOutput, files, plan };
}

export function writeScaffold(options) {
  const scaffold = scaffoldFiles(options);
  const conflicts = [...scaffold.files.keys()].filter((file) => fs.existsSync(file));
  if (conflicts.length) {
    throw new Error(`Refusing to overwrite existing scaffold files:\n- ${conflicts.join('\n- ')}`);
  }
  fs.mkdirSync(scaffold.outputDir, { recursive: true });
  for (const [file, contents] of scaffold.files) fs.writeFileSync(file, contents, { flag: 'wx' });
  return scaffold;
}
