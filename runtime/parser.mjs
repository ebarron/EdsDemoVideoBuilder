import path from 'node:path';

const MACHINE_COMMENT = /^\s*<!--\s*demo:(scene|action)\s+(\{.*\})\s*-->\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const STAGE_DIRECTION = /^\s*(?:\*|_)?\[(.+)](?:\*|_)?\s*$/;
const ITALIC_STAGE_DIRECTION = /^\s*(?:\*|_)(On screen:|Navigate|Open|Close|Click|Select|Point|Move|Enter|Type|Wait|Return|Scroll|While|When|Enable|Disable|Use\b)([\s\S]*)(?:\*|_)\s*$/i;
const INLINE_STAGE_DIRECTION = /(\*\[[^\]\n]+]\*|_\[[^\]\n]+]_|(?:\[(?:On screen:|Navigate\b|Open\b|Close\b|Click\b|Select\b|Point\b|Move\b|Enter\b|Type\b|Wait\b|Return\b|Scroll\b|While\b|When\b|Enable\b|Disable\b|Use\b)[^\]\n]*])(?!\())/gi;
const DEFAULT_EXCLUDED_HEADING = /^(?:appendix\b|building the video notes?\b|internal\b|captions?\b|narration timing budget\b)/i;
const PREFERRED_SCRIPT_ROOT = /^(?:voiceover narrative|spoken (?:script|narrative)|demo narration)\b/i;

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'scene';
}

function parseMachineComment(line, lineNumber) {
  const match = line.match(MACHINE_COMMENT);
  if (!match) return null;
  try {
    return { kind: match[1], value: JSON.parse(match[2]) };
  } catch (error) {
    throw new Error(`Invalid demo:${match[1]} JSON at line ${lineNumber}: ${error.message}`);
  }
}

function stripNarrationPrefix(line) {
  return line.replace(/^\s*>\s?/, '').trim();
}

function stripDirection(line) {
  const bracketed = line.match(STAGE_DIRECTION);
  if (bracketed) return bracketed[1].trim();
  return line.trim().replace(/^([*_])/, '').replace(/([*_])$/, '').trim();
}

export function parseDemoScript(markdown, options = {}) {
  const source = options.source ?? 'script.md';
  const includeHeadings = options.includeHeadings?.map((heading) => heading.toLowerCase());
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const preferredRoot = lines
    .map((line, index) => {
      const heading = line.match(HEADING);
      if (!heading) return null;
      const title = heading[2].replace(/\s+#*$/, '').trim();
      return PREFERRED_SCRIPT_ROOT.test(title)
        ? { index, level: heading[1].length }
        : null;
    })
    .find(Boolean);
  const scenes = [];
  const usedIds = new Set();
  let current = null;
  let paragraph = [];
  let inFence = false;
  let selected = !includeHeadings;
  let excludedLevel = null;
  let inPreferredRoot = !preferredRoot;

  const uniqueId = (requested) => {
    const base = slugify(requested);
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
    usedIds.add(candidate);
    return candidate;
  };

  const createScene = ({
    id,
    title,
    timing,
    startLine,
    narration,
  }) => {
    const scene = {
      id: uniqueId(id ?? title),
      title,
      cues: [],
      narration: '',
      actions: [],
      source: { startLine, endLine: startLine },
    };
    if (timing !== undefined) scene.timing = timing;
    scenes.push(scene);
    if (narration) {
      scene.cues.push({
        id: `${scene.id}-narration-1`,
        kind: 'narration',
        text: narration,
        source: { startLine, endLine: startLine },
      });
      scene.narration = narration;
    }
    return scene;
  };

  const ensureScene = (
    title = path.basename(source),
    startLine = paragraph[0]?.lineNumber ?? 1,
  ) => {
    if (current) return current;
    current = createScene({
      id: title,
      title,
      startLine,
    });
    return current;
  };

  const addNarrationCue = (scene, text, startLine, endLine, separator = '\n\n') => {
    const narration = text.trim();
    if (!narration) return;
    const number = scene.cues.filter((cue) => cue.kind === 'narration').length + 1;
    scene.cues.push({
      id: `${scene.id}-narration-${number}`,
      kind: 'narration',
      text: narration,
      source: { startLine, endLine },
    });
    scene.narration = scene.narration
      ? `${scene.narration}${separator}${narration}`
      : narration;
    scene.source.endLine = endLine;
  };

  const addActionCue = (scene, value, lineNumber) => {
    const action = {
      id: value.id ?? `${scene.id}-action-${scene.actions.length + 1}`,
      ...value,
      sourceLine: lineNumber,
    };
    scene.actions.push(action);
    scene.cues.push({
      id: action.id,
      kind: 'action',
      actionId: action.id,
      source: { startLine: lineNumber, endLine: lineNumber },
    });
    scene.source.endLine = lineNumber;
  };

  const flushParagraph = (endLine) => {
    if (!paragraph.length || !selected) {
      paragraph = [];
      return;
    }
    const scene = ensureScene(undefined, paragraph[0].lineNumber);
    let narrationParts = [];
    let narrationStart = null;
    let narrationEnd = null;
    let narrationCuesInParagraph = 0;
    const appendNarration = (text, lineNumber) => {
      const normalized = text.trim();
      if (!normalized) return;
      narrationParts.push(normalized);
      narrationStart ??= lineNumber;
      narrationEnd = lineNumber;
    };
    const flushNarration = () => {
      if (narrationParts.length) {
        addNarrationCue(
          scene,
          narrationParts.join(' '),
          narrationStart,
          narrationEnd,
          narrationCuesInParagraph === 0 ? '\n\n' : ' ',
        );
        narrationCuesInParagraph += 1;
      }
      narrationParts = [];
      narrationStart = null;
      narrationEnd = null;
    };
    for (const entry of paragraph) {
      const text = stripNarrationPrefix(entry.text);
      let cursor = 0;
      for (const match of text.matchAll(INLINE_STAGE_DIRECTION)) {
        appendNarration(text.slice(cursor, match.index), entry.lineNumber);
        flushNarration();
        addActionCue(scene, { direction: stripDirection(match[0]) }, entry.lineNumber);
        cursor = match.index + match[0].length;
      }
      appendNarration(text.slice(cursor), entry.lineNumber);
    }
    flushNarration();
    scene.source.endLine = Math.max(scene.source.endLine, endLine);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      flushParagraph(lineNumber - 1);
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const machine = parseMachineComment(line, lineNumber);
    if (machine) {
      flushParagraph(lineNumber - 1);
      if (machine.kind === 'scene') {
        const value = machine.value;
        if (!value.id) throw new Error(`demo:scene at line ${lineNumber} requires an id`);
        current = createScene({
          id: value.id,
          title: value.title ?? value.id,
          narration: value.narration,
          timing: value.timing,
          startLine: lineNumber,
        });
      } else {
        const scene = ensureScene();
        addActionCue(scene, machine.value, lineNumber);
      }
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph(lineNumber - 1);
      const level = heading[1].length;
      const rawTitle = heading[2].replace(/\s+#*$/, '').trim();
      if (preferredRoot && index === preferredRoot.index) {
        inPreferredRoot = true;
        current = null;
        selected = false;
        continue;
      }
      if (preferredRoot && inPreferredRoot && level <= preferredRoot.level) {
        inPreferredRoot = false;
      }
      if (!inPreferredRoot) {
        current = null;
        selected = false;
        continue;
      }
      const title = rawTitle
        .replace(/^\d+:\d+\s*[–—-]\s*\d+:\d+\s*[—–:-]\s*/, '')
        .trim();
      if (excludedLevel !== null && level > excludedLevel) {
        current = null;
        selected = false;
        continue;
      }
      excludedLevel = null;
      if (DEFAULT_EXCLUDED_HEADING.test(title)) {
        excludedLevel = level;
        current = null;
        selected = false;
        continue;
      }
      selected = !includeHeadings || includeHeadings.includes(title.toLowerCase());
      if (selected) {
        current = createScene({
          id: title,
          title,
          startLine: lineNumber,
        });
      } else {
        current = null;
      }
      continue;
    }

    if (!selected) continue;
    if (STAGE_DIRECTION.test(line) || ITALIC_STAGE_DIRECTION.test(line)) {
      flushParagraph(lineNumber - 1);
      const scene = ensureScene();
      addActionCue(scene, { direction: stripDirection(line) }, lineNumber);
      continue;
    }

    if (!line.trim()) {
      flushParagraph(lineNumber - 1);
      continue;
    }
    paragraph.push({ text: line, lineNumber });
  }
  flushParagraph(lines.length);

  return {
    version: 1,
    source,
    scenes: scenes.filter((scene) => scene.cues.length),
  };
}
