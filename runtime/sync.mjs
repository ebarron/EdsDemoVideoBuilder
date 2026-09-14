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

function cueStartLine(cue) {
  return cue.source?.startLine ?? cue.sourceLine;
}

function mergeCues(sceneId, previous = [], parsed = [], parsedActions = [], mergedActions = []) {
  const oldNarration = previous
    .filter((cue) => cue.kind === 'narration')
    .map((cue, index) => ({ cue, index }));
  const parsedNarration = parsed
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => cue.kind === 'narration');
  const assigned = new Map();
  const used = new Set();

  const assignUnique = (predicate) => {
    for (const entry of parsedNarration) {
      if (assigned.has(entry.index)) continue;
      const matches = oldNarration.filter(
        (candidate) => !used.has(candidate.index) && predicate(candidate.cue, entry.cue),
      );
      if (matches.length === 1) {
        assigned.set(entry.index, matches[0].cue);
        used.add(matches[0].index);
      }
    }
  };
  assignUnique(
    (old, next) => normalized(old.text) &&
      normalized(old.text) === normalized(next.text),
  );
  assignUnique(
    (old, next) => cueStartLine(old) !== undefined &&
      cueStartLine(old) === cueStartLine(next),
  );
  for (const [ordinal, entry] of parsedNarration.entries()) {
    if (assigned.has(entry.index)) continue;
    const candidate = oldNarration[ordinal];
    if (candidate && !used.has(candidate.index)) {
      assigned.set(entry.index, candidate.cue);
      used.add(candidate.index);
    }
  }

  const parsedActionIndexes = new Map();
  for (const [index, action] of parsedActions.entries()) {
    const indexes = parsedActionIndexes.get(action.id) ?? [];
    indexes.push(index);
    parsedActionIndexes.set(action.id, indexes);
  }
  const actionOccurrences = new Map();
  const usedCueIds = new Set([
    ...previous.map((cue) => cue.id).filter(Boolean),
    ...mergedActions.map((action) => action.id).filter(Boolean),
  ]);
  let narrationOrdinal = 0;
  const nextNarrationId = (ordinal) => {
    const base = `${sceneId}-narration-${ordinal}`;
    let candidate = base;
    let suffix = 2;
    while (usedCueIds.has(candidate)) candidate = `${base}-${suffix++}`;
    usedCueIds.add(candidate);
    return candidate;
  };

  return parsed.map((cue, cueIndex) => {
    if (cue.kind === 'action') {
      const occurrence = actionOccurrences.get(cue.actionId) ?? 0;
      actionOccurrences.set(cue.actionId, occurrence + 1);
      const actionIndex = parsedActionIndexes.get(cue.actionId)?.[occurrence];
      const actionId = mergedActions[actionIndex]?.id;
      if (!actionId) {
        throw new Error(`Could not preserve action cue ${cue.actionId} in scene ${sceneId}`);
      }
      return { ...cue, id: actionId, actionId };
    }
    narrationOrdinal += 1;
    const id = assigned.get(cueIndex)?.id ?? nextNarrationId(narrationOrdinal);
    usedCueIds.add(id);
    return { ...cue, id };
  });
}

export function mergeScenePlan(previous, parsed, hash) {
  const matched = matchScenes(previous.scenes ?? [], parsed.scenes);
  const scenes = matched.map(({ scene, previous: old }) => {
    const id = old?.id ?? scene.id;
    const actions = mergeActions(id, old?.actions, scene.actions);
    return {
      ...(old ?? {}),
      ...scene,
      id,
      cues: mergeCues(id, old?.cues, scene.cues, scene.actions, actions),
      actions,
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

function semanticAction(action) {
  const { sourceLine: _sourceLine, ...semantic } = action;
  return semantic;
}

function cueActionIds(scene) {
  return (scene.cues ?? [])
    .filter((cue) => cue.kind === 'action')
    .map((cue) => cue.actionId);
}

function cueSequenceShape(scene) {
  const shape = [];
  for (const cue of scene.cues ?? []) {
    if (cue.kind === 'narration' && shape.at(-1) !== 'narration') {
      shape.push('narration');
    }
    if (cue.kind === 'action') {
      shape.push(`action:${cue.actionId}`);
    }
  }
  return shape;
}

export function classifyPlanChanges(diff) {
  const changedFields = diff.scenes.changed.flatMap(({ fields }) => fields);
  const narration = changedFields.includes('narration');
  const timing = changedFields.includes('timing');
  const alignment = changedFields.includes('alignment');
  const choreography =
    diff.scenes.added.length > 0 ||
    diff.scenes.removed.length > 0 ||
    changedFields.some((field) => field === 'title' || field === 'actions') ||
    diff.actions.added.length > 0 ||
    diff.actions.removed.length > 0 ||
    diff.actions.changed.length > 0 ||
    (diff.actions.reordered?.length ?? 0) > 0;
  const representation = (diff.cues?.migrated?.length ?? 0) > 0;
  const kinds = [
    ...(narration ? ['narration'] : []),
    ...(timing ? ['timing'] : []),
    ...(alignment ? ['alignment'] : []),
    ...(choreography ? ['choreography'] : []),
    ...(representation ? ['representation'] : []),
  ];
  if (kinds.length === 0 && diff.sourceChanged) kinds.push('source-only');
  const label = kinds.length === 0
    ? 'none'
    : kinds.length === 1
      ? `${kinds[0]}-only`
      : kinds.join('+');
  return {
    label,
    kinds,
    driverReviewRequired: choreography || alignment,
  };
}

export function diffScenePlans(previous, next) {
  const oldScenes = new Map(previous.scenes.map((scene) => [scene.id, scene]));
  const newScenes = new Map(next.scenes.map((scene) => [scene.id, scene]));
  const added = [...newScenes.keys()].filter((id) => !oldScenes.has(id));
  const removed = [...oldScenes.keys()].filter((id) => !newScenes.has(id));
  const changed = [];
  const actions = { added: [], removed: [], changed: [], reordered: [] };
  const cues = { migrated: [], alignmentChanged: [] };

  for (const [id, scene] of newScenes) {
    const old = oldScenes.get(id);
    if (!old) {
      for (const action of scene.actions ?? []) actions.added.push(`${id}/${action.id}`);
      continue;
    }
    const fields = [];
    if (old.title !== scene.title) fields.push('title');
    if (old.narration !== scene.narration) fields.push('narration');
    if (JSON.stringify(old.timing ?? null) !== JSON.stringify(scene.timing ?? null)) {
      fields.push('timing');
    }
    if (!Array.isArray(old.cues) && Array.isArray(scene.cues)) {
      cues.migrated.push(id);
    } else if (Array.isArray(old.cues) && Array.isArray(scene.cues)) {
      const oldActionIds = cueActionIds(old);
      const newActionIds = cueActionIds(scene);
      if (
        oldActionIds.length === newActionIds.length &&
        [...oldActionIds].sort().join('\0') === [...newActionIds].sort().join('\0') &&
        JSON.stringify(oldActionIds) !== JSON.stringify(newActionIds)
      ) {
        actions.reordered.push(id);
      } else if (
        JSON.stringify(oldActionIds) === JSON.stringify(newActionIds) &&
        JSON.stringify(cueSequenceShape(old)) !== JSON.stringify(cueSequenceShape(scene))
      ) {
        cues.alignmentChanged.push(id);
        fields.push('alignment');
      }
    }
    const oldActions = actionMap(old);
    const newActions = actionMap(scene);
    let actionChanged = actions.reordered.includes(id);
    for (const [actionId, action] of newActions) {
      const prior = oldActions.get(actionId);
      if (!prior) {
        actions.added.push(`${id}/${actionId}`);
        actionChanged = true;
      }
      else if (JSON.stringify(semanticAction(prior)) !== JSON.stringify(semanticAction(action))) {
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

  const diff = {
    sourceChanged: previous.sourceHash !== next.sourceHash,
    scenes: { added, removed, changed },
    actions,
    changed: added.length > 0 ||
      removed.length > 0 ||
      changed.length > 0 ||
      actions.added.length > 0 ||
      actions.removed.length > 0 ||
      actions.changed.length > 0 ||
      actions.reordered.length > 0 ||
      cues.migrated.length > 0 ||
      cues.alignmentChanged.length > 0 ||
      previous.sourceHash !== next.sourceHash,
    cues,
  };
  diff.classification = classifyPlanChanges(diff);
  return diff;
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
