import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(HERE, '..', 'schemas', 'demo-manifest.schema.json');
const SECRET_KEY = /(password|passwd|token|secret|credential|api[-_]?key)/i;
const PATH_FIELDS = [
  'script',
  'scenePlan',
  'driver',
  'app.cwd',
  'narration.clipsDir',
  'narration.referenceFile',
  'output.workDir',
  'output.video',
  'output.contactSheet',
  'output.timeline',
  'output.notes',
];

function getPath(object, dotted) {
  return dotted.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, dotted, value) {
  const keys = dotted.split('.');
  const final = keys.pop();
  const parent = keys.reduce((current, key) => current[key], object);
  parent[final] = value;
}

function inspectSecrets(value, location = '$', errors = []) {
  if (!value || typeof value !== 'object') return errors;
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    const isEnvironmentReference = location === '$.auth.env' || location === '$.app.lifecycle.env';
    if (
      SECRET_KEY.test(key) &&
      !isEnvironmentReference &&
      key !== 'storageStateEnv' &&
      !key.endsWith('Env')
    ) {
      errors.push(`${childLocation}: literal secret fields are forbidden; reference an environment variable`);
    }
    inspectSecrets(child, childLocation, errors);
  }
  return errors;
}

export function validateManifestObject(manifest) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(manifest);
  const errors = valid
    ? []
    : validate.errors.map((error) => `${error.instancePath || '$'} ${error.message}`);
  errors.push(...inspectSecrets(manifest));
  if (
    manifest?.narration?.audioFirst &&
    !['clips', 'reference'].includes(manifest.narration.mode)
  ) {
    errors.push('$.narration.audioFirst requires clips or reference narration mode');
  }
  return { valid: errors.length === 0, errors };
}

export function resolveManifestPaths(manifest, manifestPath) {
  const base = path.dirname(manifestPath);
  const resolved = structuredClone(manifest);
  for (const field of PATH_FIELDS) {
    const value = getPath(resolved, field);
    if (!value) continue;
    setPath(resolved, field, path.resolve(base, value));
  }
  return resolved;
}

export function loadManifest(manifestPath) {
  const absolutePath = path.resolve(manifestPath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const manifest = yaml.load(source);
  const result = validateManifestObject(manifest);
  if (!result.valid) {
    throw new Error(`Invalid demo manifest ${absolutePath}:\n- ${result.errors.join('\n- ')}`);
  }
  return {
    path: absolutePath,
    source,
    manifest,
    resolved: resolveManifestPaths(manifest, absolutePath),
  };
}

export function readScenePlan(manifest) {
  const plan = JSON.parse(fs.readFileSync(manifest.scenePlan, 'utf8'));
  if (plan.version !== 1 || !Array.isArray(plan.scenes)) {
    throw new Error(`Invalid normalized scene plan: ${manifest.scenePlan}`);
  }
  const ids = new Set();
  for (const scene of plan.scenes) {
    if (!scene.id || ids.has(scene.id)) throw new Error(`Duplicate or missing scene id: ${scene.id}`);
    ids.add(scene.id);
  }
  return plan;
}

export function referencedEnvironment(manifest) {
  const refs = [];
  for (const [logicalName, environmentName] of Object.entries(manifest.auth.env ?? {})) {
    refs.push({ scope: 'auth', logicalName, environmentName });
  }
  for (const [logicalName, environmentName] of Object.entries(manifest.app.lifecycle.env ?? {})) {
    refs.push({ scope: 'lifecycle', logicalName, environmentName });
  }
  if (manifest.auth.storageStateEnv) {
    refs.push({
      scope: 'auth',
      logicalName: 'storageState',
      environmentName: manifest.auth.storageStateEnv,
    });
  }
  if (manifest.tools?.ffmpegEnv) {
    refs.push({
      scope: 'tools',
      logicalName: 'ffmpeg',
      environmentName: manifest.tools.ffmpegEnv,
    });
  }
  return refs;
}

export function materializeEnvironment(refs, environment = process.env) {
  const values = {};
  const missing = [];
  for (const ref of refs) {
    const value = environment[ref.environmentName];
    if (!value) missing.push(ref);
    else values[ref.logicalName] = value;
  }
  return { values, missing };
}
