import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parseDemoScript } from './parser.mjs';
import {
  atomicWriteWithBackup,
  diffScenePlans,
  mergeScenePlan,
  sourceHash,
} from './sync.mjs';
import {
  isVoiceoverTakeCurrent,
  readVoiceoverSession,
  stampLegacyTakeNarrationRevisions,
  voiceoverNarrationRevision,
  voiceoverSceneNarrationRevision,
  writeVoiceoverSessionState,
} from './voiceover.mjs';

const MAX_CUE_CHARACTERS = 100_000;

function hashText(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function normalized(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function narrationCues(scene) {
  return (scene.cues ?? []).filter((cue) => cue.kind === 'narration');
}

function spokenText(scene) {
  const cues = narrationCues(scene);
  return (cues.length ? cues.map((cue) => cue.text).join(' ') : scene.narration ?? '').trim();
}

function actionDirections(scene) {
  return (scene.actions ?? []).map((action) => normalized(action.direction));
}

function cueShape(scene) {
  if (!Array.isArray(scene.cues)) return null;
  const actions = new Map(
    (scene.actions ?? []).map((action) => [action.id, normalized(action.direction)]),
  );
  return scene.cues.map((cue) =>
    cue.kind === 'narration'
      ? 'narration'
      : `action:${actions.get(cue.actionId) ?? cue.actionId}`);
}

function sameSceneContent(left, right) {
  if (spokenText(left) !== spokenText(right)) return false;
  if (JSON.stringify(actionDirections(left)) !== JSON.stringify(actionDirections(right))) {
    return false;
  }
  const leftShape = cueShape(left);
  const rightShape = cueShape(right);
  return !leftShape || !rightShape || JSON.stringify(leftShape) === JSON.stringify(rightShape);
}

function uniqueCandidate(candidates) {
  return candidates.length === 1 ? candidates[0] : null;
}

function mappedScene(planScene, parsedScenes, used) {
  const available = parsedScenes.filter((scene) => !used.has(scene));
  const semantic = available.filter((scene) => sameSceneContent(planScene, scene));
  const tiers = [
    semantic.filter((scene) =>
      Number.isInteger(planScene.source?.startLine) &&
      scene.source?.startLine === planScene.source.startLine &&
      normalized(scene.title) === normalized(planScene.title)),
    semantic.filter((scene) => scene.id === planScene.id),
    semantic.filter((scene) => normalized(scene.title) === normalized(planScene.title)),
  ];
  for (const tier of tiers) {
    const candidate = uniqueCandidate(tier);
    if (candidate) return candidate;
    if (tier.length > 1) return null;
  }
  return null;
}

function sceneCueMapping(planScene, parsedScene) {
  const parsedCues = narrationCues(parsedScene);
  const planCues = narrationCues(planScene);
  if (!parsedCues.length) {
    return { editable: false, message: 'This scene has no spoken narration to edit.', cues: [] };
  }
  if (
    parsedCues.some((cue) =>
      !Number.isInteger(cue.source?.startOffset) ||
      !Number.isInteger(cue.source?.endOffset) ||
      cue.source.endOffset <= cue.source.startOffset)
  ) {
    return {
      editable: false,
      message: 'This scene does not have safe narration source spans. Resynchronize it first.',
      cues: [],
    };
  }
  if (planCues.length && planCues.length !== parsedCues.length) {
    return {
      editable: false,
      message: 'The scene cues do not map uniquely to the backing Markdown. Resynchronize it first.',
      cues: [],
    };
  }
  return {
    editable: true,
    message: null,
    cues: parsedCues.map((cue, index) => ({
      id: planCues[index]?.id ?? `${planScene.id}-narration-${index + 1}`,
      text: cue.text,
      source: cue.source,
    })),
  };
}

export function mapNarrationSourceSpans(scenePlan, markdown, source = 'script.md') {
  const parsed = parseDemoScript(markdown, { source });
  const used = new Set();
  const scenes = new Map();
  for (const planScene of scenePlan.scenes) {
    const sourceScene = mappedScene(planScene, parsed.scenes, used);
    if (!sourceScene) {
      scenes.set(planScene.id, {
        sceneId: planScene.id,
        title: planScene.title,
        editable: false,
        message:
          'This scene cannot be mapped uniquely to the backing Markdown. Resynchronize it first.',
        cues: [],
      });
      continue;
    }
    used.add(sourceScene);
    scenes.set(planScene.id, {
      sceneId: planScene.id,
      title: planScene.title,
      ...sceneCueMapping(planScene, sourceScene),
    });
  }
  return { parsed, scenes };
}

function publicAuthoringScenes(state, mappings) {
  return Object.fromEntries(state.prompts.map((prompt) => {
    const mapping = mappings.get(prompt.sceneId) ?? {
      editable: false,
      message: 'This narrated scene is missing from the current scene plan.',
      cues: [],
    };
    return [prompt.sceneId, {
      editable: mapping.editable,
      message: mapping.message,
      narrationRevision: voiceoverSceneNarrationRevision(prompt),
      cues: mapping.cues.map(({ id, text }) => ({ id, text })),
    }];
  }));
}

function planPromptText(plan, sceneId) {
  const scene = plan.scenes.find((entry) => entry.id === sceneId);
  return scene ? spokenText(scene) : null;
}

export class NarrationEditError extends Error {
  constructor(code, publicMessage, detail = publicMessage, status = 409) {
    super(detail === publicMessage ? publicMessage : `${publicMessage}\n${detail}`);
    this.name = 'NarrationEditError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.status = status;
  }
}

function driftError(kind, detail) {
  return new NarrationEditError(
    'external_drift',
    `The backing ${kind} changed outside Voiceover Studio. Reopen or resynchronize before saving.`,
    detail,
  );
}

function readAuthoringFiles(manifest) {
  const markdown = fs.readFileSync(manifest.script, 'utf8');
  const planText = fs.readFileSync(manifest.scenePlan, 'utf8');
  return {
    markdown,
    scriptHash: sourceHash(markdown),
    planText,
    planHash: hashText(planText),
    plan: JSON.parse(planText),
  };
}

export function prepareVoiceoverNarrationEditor(manifest, sessionDir = null) {
  const session = readVoiceoverSession(manifest, sessionDir);
  const files = readAuthoringFiles(manifest);
  if (
    session.state.authoring?.scriptHash &&
    session.state.authoring.scriptHash !== files.scriptHash
  ) {
    throw driftError(
      'Markdown script',
      `Voiceover script hash changed: expected ${session.state.authoring.scriptHash}, ` +
      `received ${files.scriptHash} at ${manifest.script}`,
    );
  }
  if (
    session.state.authoring?.scenePlanHash &&
    session.state.authoring.scenePlanHash !== files.planHash
  ) {
    throw driftError(
      'scene plan',
      `Voiceover scene-plan hash changed: expected ${session.state.authoring.scenePlanHash}, ` +
      `received ${files.planHash} at ${manifest.scenePlan}`,
    );
  }
  for (const prompt of session.state.prompts) {
    if (planPromptText(files.plan, prompt.sceneId) !== prompt.text) {
      throw new NarrationEditError(
        'session_drift',
        'The open voiceover session no longer matches the generated scene plan. Reopen or resynchronize before editing.',
        `Voiceover prompt ${prompt.sceneId} differs from ${manifest.scenePlan}`,
      );
    }
  }
  const mappings = mapNarrationSourceSpans(
    files.plan,
    files.markdown,
    path.relative(path.dirname(manifest.scenePlan), manifest.script),
  );
  stampLegacyTakeNarrationRevisions(session.state);
  const revision = voiceoverNarrationRevision(session.state.prompts);
  session.state.version = Math.max(3, Number(session.state.version) || 0);
  session.state.narration ??= {
    revision,
    openingRevision: revision,
    editedAt: null,
  };
  session.state.narration.revision = revision;
  session.state.narration.openingRevision ??= revision;
  session.state.authoring = {
    version: 1,
    scriptHash: files.scriptHash,
    scenePlanHash: files.planHash,
    narrationRevision: revision,
    revision: session.state.authoring?.revision ?? 0,
    openedAt: session.state.authoring?.openedAt ?? new Date().toISOString(),
    editedAt: session.state.authoring?.editedAt ?? null,
    scenes: publicAuthoringScenes(session.state, mappings.scenes),
  };
  writeVoiceoverSessionState(session);
  return session.state;
}

function normalizedCueEdit(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ');
}

function validateEditRequest(scene, body) {
  if (!Array.isArray(body.cues) || body.cues.length !== scene.cues.length) {
    throw new NarrationEditError(
      'stale_save',
      'This narration editor is stale. Reload the Studio state and try again.',
    );
  }
  const edits = body.cues.map((cue, index) => {
    const source = scene.cues[index];
    if (cue?.id !== source.id) {
      throw new NarrationEditError(
        'stale_save',
        'This narration editor is stale. Reload the Studio state and try again.',
      );
    }
    const text = normalizedCueEdit(cue.text);
    if (!text) {
      throw new NarrationEditError(
        'invalid_narration',
        'Spoken narration cannot be empty.',
        `Narration cue ${source.id} was empty`,
        400,
      );
    }
    if (text.length > MAX_CUE_CHARACTERS) {
      throw new NarrationEditError(
        'invalid_narration',
        'Spoken narration is too long to save.',
        `Narration cue ${source.id} exceeded ${MAX_CUE_CHARACTERS} characters`,
        400,
      );
    }
    return { ...source, text };
  });
  return edits;
}

function applyCueReplacements(markdown, edits) {
  const ordered = [...edits].sort(
    (left, right) => right.source.startOffset - left.source.startOffset,
  );
  let boundary = markdown.length + 1;
  let updated = markdown;
  for (const edit of ordered) {
    const { startOffset, endOffset } = edit.source;
    if (
      startOffset < 0 ||
      endOffset > markdown.length ||
      endOffset > boundary
    ) {
      throw new NarrationEditError(
        'unsafe_mapping',
        'The narration source spans overlap or are invalid. Resynchronize before saving.',
      );
    }
    updated = `${updated.slice(0, startOffset)}${edit.text}${updated.slice(endOffset)}`;
    boundary = startOffset;
  }
  return updated;
}

function assertNarrationOnlyChange(diff, sceneId) {
  const unsafe =
    diff.scenes.added.length ||
    diff.scenes.removed.length ||
    diff.actions.added.length ||
    diff.actions.removed.length ||
    diff.actions.changed.length ||
    diff.actions.reordered.length ||
    diff.cues.alignmentChanged.length ||
    diff.scenes.changed.some(
      (change) =>
        change.id !== sceneId ||
        change.fields.some((field) => field !== 'narration'),
    );
  if (unsafe) {
    throw new NarrationEditError(
      'unsafe_narration',
      'The edited text would change scene structure or stage directions. Keep actions unchanged and edit spoken wording only.',
      `Narration edit produced ${JSON.stringify(diff.classification)}`,
      400,
    );
  }
}

function restoreBackup(file, backup) {
  const temporary = `${file}.restore-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  fs.copyFileSync(backup, temporary, fs.constants.COPYFILE_EXCL);
  fs.renameSync(temporary, file);
}

function impactedTakes(state, sceneId) {
  return state.takes.filter(
    (take) =>
      isVoiceoverTakeCurrent(state, take) &&
      (take.kind === 'master' || take.sceneId === sceneId),
  );
}

export function updateVoiceoverNarration(
  manifest,
  {
    sceneId,
    cues,
    expectedScriptHash,
    expectedScenePlanHash,
    expectedNarrationRevision,
    confirmTakeInvalidation = false,
  },
  sessionDir = null,
) {
  const session = readVoiceoverSession(manifest, sessionDir);
  const files = readAuthoringFiles(manifest);
  if (
    expectedScriptHash !== session.state.authoring?.scriptHash ||
    files.scriptHash !== session.state.authoring?.scriptHash
  ) {
    throw driftError(
      'Markdown script',
      `Stale narration save for ${manifest.script}: expected ${session.state.authoring?.scriptHash}, ` +
      `client ${expectedScriptHash}, current ${files.scriptHash}`,
    );
  }
  if (
    expectedScenePlanHash !== session.state.authoring?.scenePlanHash ||
    files.planHash !== session.state.authoring?.scenePlanHash
  ) {
    throw driftError(
      'scene plan',
      `Stale scene-plan save for ${manifest.scenePlan}: expected ${session.state.authoring?.scenePlanHash}, ` +
      `client ${expectedScenePlanHash}, current ${files.planHash}`,
    );
  }
  const mappings = mapNarrationSourceSpans(
    files.plan,
    files.markdown,
    path.relative(path.dirname(manifest.scenePlan), manifest.script),
  );
  const scene = mappings.scenes.get(sceneId);
  if (!scene?.editable) {
    throw new NarrationEditError(
      'unsafe_mapping',
      scene?.message ??
        'This scene cannot be mapped uniquely to the backing Markdown. Resynchronize it first.',
    );
  }
  const prompt = session.state.prompts.find((entry) => entry.sceneId === sceneId);
  if (
    !prompt ||
    expectedNarrationRevision !== voiceoverSceneNarrationRevision(prompt)
  ) {
    throw new NarrationEditError(
      'stale_save',
      'This narration editor is stale. Reload the Studio state and try again.',
    );
  }
  const edits = validateEditRequest(scene, { cues });
  if (edits.every((edit, index) => edit.text === scene.cues[index].text)) {
    return { changed: false, state: session.state, backups: null, invalidated: null };
  }
  const markdown = applyCueReplacements(files.markdown, edits);
  const parsed = parseDemoScript(markdown, {
    source: path.relative(path.dirname(manifest.scenePlan), manifest.script),
  });
  const plan = mergeScenePlan(files.plan, parsed, sourceHash(markdown));
  const diff = diffScenePlans(files.plan, plan);
  assertNarrationOnlyChange(diff, sceneId);
  const updatedScene = plan.scenes.find((entry) => entry.id === sceneId);
  if (!updatedScene) {
    throw new NarrationEditError(
      'unsafe_mapping',
      'The edited scene could not be retained safely. Resynchronize before saving.',
    );
  }

  const nextState = structuredClone(session.state);
  stampLegacyTakeNarrationRevisions(nextState);
  const affected = impactedTakes(nextState, sceneId);
  if (affected.length && confirmTakeInvalidation !== true) {
    throw new NarrationEditError(
      'take_confirmation_required',
      'Confirm that prior recordings for this wording may be marked stale before saving.',
      `Narration edit affects ${affected.length} current takes`,
    );
  }
  const nextPrompt = nextState.prompts.find((entry) => entry.sceneId === sceneId);
  nextPrompt.text = spokenText(updatedScene);
  const editedAt = new Date().toISOString();
  for (const take of affected) {
    take.stale = true;
    take.staleAt = editedAt;
    take.staleReason = take.kind === 'master'
      ? 'A scene narration changed after this full take was recorded.'
      : 'This scene narration changed after the take was recorded.';
  }
  const clearedMaster = Boolean(nextState.accepted.master);
  const clearedScene = Boolean(nextState.accepted.scenes[sceneId]);
  nextState.accepted.master = null;
  delete nextState.accepted.scenes[sceneId];
  const nextNarrationRevision = voiceoverNarrationRevision(nextState.prompts);
  nextState.narration = {
    ...(nextState.narration ?? {}),
    openingRevision:
      nextState.narration?.openingRevision ??
      voiceoverNarrationRevision(session.state.prompts),
    revision: nextNarrationRevision,
    editedAt,
  };
  const planText = `${JSON.stringify(plan, null, 2)}\n`;
  const nextMappings = mapNarrationSourceSpans(
    plan,
    markdown,
    path.relative(path.dirname(manifest.scenePlan), manifest.script),
  );
  nextState.authoring = {
    ...nextState.authoring,
    scriptHash: sourceHash(markdown),
    scenePlanHash: hashText(planText),
    narrationRevision: nextNarrationRevision,
    revision: (nextState.authoring?.revision ?? 0) + 1,
    editedAt,
    scenes: publicAuthoringScenes(nextState, nextMappings.scenes),
  };

  let scriptBackup;
  let planBackup;
  try {
    scriptBackup = atomicWriteWithBackup(manifest.script, markdown);
    planBackup = atomicWriteWithBackup(manifest.scenePlan, planText);
    writeVoiceoverSessionState({ ...session, state: nextState });
  } catch (error) {
    if (planBackup) restoreBackup(manifest.scenePlan, planBackup);
    if (scriptBackup) restoreBackup(manifest.script, scriptBackup);
    throw error;
  }
  return {
    changed: true,
    state: nextState,
    backups: { script: scriptBackup, scenePlan: planBackup },
    invalidated: {
      takes: affected.map((take) => take.id),
      sceneTakes: affected.filter((take) => take.kind === 'scene').length,
      fullTakes: affected.filter((take) => take.kind === 'master').length,
      clearedMaster,
      clearedScene,
    },
  };
}
