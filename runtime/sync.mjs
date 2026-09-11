import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { loadManifest, readScenePlan } from './config.mjs';
import { parseDemoScript } from './parser.mjs';

function normalized(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function titleSimilarity(left, right) {
  const leftTokens = new Set(normalized(left).split(/\s+/).filter(Boolean));
  const rightTokens = new Set(normalized(right).split(/\s+/).filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function sourceHash(markdown) {
  return `sha256:${crypto.createHash('sha256').update(markdown).digest('hex')}`;
}

function uniqueMatch(items, predicate, used) {
  const matches = items.filter((item, index) => !used.has(index) && predicate(item));
  return matches.length === 1 ? items.indexOf(matches[0]) : -1;
}

function matchScenes(previous, parsed) {
  const used = new Set();
  return parsed.map((scene) => {
    const candidates = [
      (candidate) => candidate.id === scene.id,
      (candidate) => normalized(candidate.title) === normalized(scene.title),
      (candidate) => titleSimilarity(candidate.title, scene.title) >= 0.6,
    ];
    let match = -1;
    for (const predicate of candidates) {
      match = uniqueMatch(previous, predicate, used);
      if (match >= 0) break;
    }
    if (match >= 0) used.add(match);
    return { scene, previous: match >= 0 ? previous[match] : null };
  });
}

function generatedActionId(id) {
  return /-action-\d+$/.test(id ?? '');
}

function mergeActions(sceneId, previous = [], parsed = []) {
  const normalizedPrevious = previous.map((action, index) => ({
    ...action,
    id: action.id ?? `${sceneId}-action-${index + 1}`,
  }));
  const used = new Set();
  return parsed.map((action, index) => {
    const candidates = [
      (candidate) =>
        normalized(candidate.direction) &&
        normalized(candidate.direction) === normalized(action.direction),
      (candidate) => candidate.id === action.id,
      (candidate) => candidate.sourceLine === action.sourceLine,
    ];
    let match = -1;
    for (const predicate of candidates) {
      match = uniqueMatch(normalizedPrevious, predicate, used);
      if (match >= 0) break;
    }
    if (match >= 0) used.add(match);
    const old = match >= 0 ? normalizedPrevious[match] : null;
    const parsedId = generatedActionId(action.id)
      ? `${sceneId}-action-${index + 1}`
      : action.id;
    return {
      ...(old ?? {}),
      ...action,
      id: old?.id ?? parsedId,
    };
  });
}

export function mergeScenePlan(previous, parsed, hash) {
  const matched = matchScenes(previous.scenes ?? [], parsed.scenes);
  const scenes = matched.map(({ scene, previous: old }) => {
    const id = old?.id ?? scene.id;
    return {
      ...(old ?? {}),
      ...scene,
      id,
      actions: mergeActions(id, old?.actions, scene.actions),
    };
  });
  return {
    ...previous,
    ...parsed,
    sourceHash: hash,
    scenes,
  };
}

function actionMap(scene) {
  return new Map((scene?.actions ?? []).map((action, index) => {
    const id = action.id ?? `${scene.id}-action-${index + 1}`;
    return [id, { ...action, id }];
  }));
}

export function diffScenePlans(previous, next) {
  const oldScenes = new Map(previous.scenes.map((scene) => [scene.id, scene]));
  const newScenes = new Map(next.scenes.map((scene) => [scene.id, scene]));
  const added = [...newScenes.keys()].filter((id) => !oldScenes.has(id));
  const removed = [...oldScenes.keys()].filter((id) => !newScenes.has(id));
  const changed = [];
  const actions = { added: [], removed: [], changed: [] };

  for (const [id, scene] of newScenes) {
    const old = oldScenes.get(id);
    if (!old) {
      for (const action of scene.actions ?? []) actions.added.push(`${id}/${action.id}`);
      continue;
    }
    const fields = [];
    if (old.title !== scene.title) fields.push('title');
    if (old.narration !== scene.narration) fields.push('narration');
    const oldActions = actionMap(old);
    const newActions = actionMap(scene);
    let actionChanged = false;
    for (const [actionId, action] of newActions) {
      const prior = oldActions.get(actionId);
      if (!prior) {
        actions.added.push(`${id}/${actionId}`);
        actionChanged = true;
      }
      else if (JSON.stringify(prior) !== JSON.stringify(action)) {
        actions.changed.push(`${id}/${actionId}`);
        actionChanged = true;
      }
    }
    for (const actionId of oldActions.keys()) {
      if (!newActions.has(actionId)) {
        actions.removed.push(`${id}/${actionId}`);
        actionChanged = true;
      }
    }
    if (actionChanged) fields.push('actions');
    if (fields.length) changed.push({ id, fields });
  }
  for (const id of removed) {
    for (const [index, action] of (oldScenes.get(id).actions ?? []).entries()) {
      actions.removed.push(`${id}/${action.id ?? `${id}-action-${index + 1}`}`);
    }
  }

  return {
    sourceChanged: previous.sourceHash !== next.sourceHash,
    scenes: { added, removed, changed },
    actions,
    changed: added.length > 0 ||
      removed.length > 0 ||
      changed.length > 0 ||
      actions.added.length > 0 ||
      actions.removed.length > 0 ||
      actions.changed.length > 0 ||
      previous.sourceHash !== next.sourceHash,
  };
}

function backupPath(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let candidate = `${file}.bak-${stamp}`;
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = `${file}.bak-${stamp}-${suffix++}`;
  return candidate;
}

export function atomicWriteWithBackup(file, contents) {
  const backup = backupPath(file);
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return backup;
}

export function syncScenePlan({ manifestPath, write = false }) {
  const loaded = loadManifest(manifestPath);
  const previous = readScenePlan(loaded.resolved);
  const markdown = fs.readFileSync(loaded.resolved.script, 'utf8');
  const parsed = parseDemoScript(markdown, {
    source: path.relative(path.dirname(loaded.resolved.scenePlan), loaded.resolved.script),
  });
  const next = mergeScenePlan(previous, parsed, sourceHash(markdown));
  const diff = diffScenePlans(previous, next);
  let backup = null;
  if (write && diff.changed) {
    backup = atomicWriteWithBackup(
      loaded.resolved.scenePlan,
      `${JSON.stringify(next, null, 2)}\n`,
    );
  }
  return {
    manifest: loaded.path,
    scenePlan: loaded.resolved.scenePlan,
    mode: write ? 'write' : 'preview',
    written: write && diff.changed,
    backup,
    diff,
    plan: next,
  };
}

export { sourceHash };
