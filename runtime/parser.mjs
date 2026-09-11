import path from 'node:path';

const MACHINE_COMMENT = /^\s*<!--\s*demo:(scene|action)\s+(\{.*\})\s*-->\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const STAGE_DIRECTION = /^\s*(?:\*|_)?\[(.+)](?:\*|_)?\s*$/;
const ITALIC_STAGE_DIRECTION = /^\s*(?:\*|_)(On screen:|Navigate|Open|Close|Click|Select|Point|Move|Enter|Type|Wait|Return|Scroll|While|When|Enable|Disable|Use\b)([\s\S]*)(?:\*|_)\s*$/i;
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
  let paragraphStart = 1;
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

  const ensureScene = (title = path.basename(source)) => {
    if (current) return current;
    current = {
      id: uniqueId(title),
      title,
      narration: '',
      actions: [],
      source: { startLine: paragraphStart, endLine: paragraphStart },
    };
    scenes.push(current);
    return current;
  };

  const flushParagraph = (endLine) => {
    if (!paragraph.length || !selected) {
      paragraph = [];
      return;
    }
    const text = paragraph.map(stripNarrationPrefix).filter(Boolean).join(' ');
    if (text) {
      const scene = ensureScene();
      scene.narration = [scene.narration, text].filter(Boolean).join('\n\n');
      scene.source.endLine = endLine;
    }
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
        current = {
          id: uniqueId(value.id),
          title: value.title ?? value.id,
          narration: value.narration ?? '',
          actions: [],
          timing: value.timing,
          source: { startLine: lineNumber, endLine: lineNumber },
        };
        scenes.push(current);
      } else {
        const scene = ensureScene();
        const value = machine.value;
        scene.actions.push({
          id: value.id ?? `${scene.id}-action-${scene.actions.length + 1}`,
          ...value,
          sourceLine: lineNumber,
        });
        scene.source.endLine = lineNumber;
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
        current = {
          id: uniqueId(title),
          title,
          narration: '',
          actions: [],
          source: { startLine: lineNumber, endLine: lineNumber },
        };
        scenes.push(current);
      } else {
        current = null;
      }
      continue;
    }

    if (!selected) continue;
    if (STAGE_DIRECTION.test(line) || ITALIC_STAGE_DIRECTION.test(line)) {
      flushParagraph(lineNumber - 1);
      const scene = ensureScene();
      scene.actions.push({
        id: `${scene.id}-action-${scene.actions.length + 1}`,
        direction: stripDirection(line),
        sourceLine: lineNumber,
      });
      scene.source.endLine = lineNumber;
      continue;
    }

    if (!line.trim()) {
      flushParagraph(lineNumber - 1);
      continue;
    }
    if (!paragraph.length) paragraphStart = lineNumber;
    paragraph.push(line);
  }
  flushParagraph(lines.length);

  return {
    version: 1,
    source,
    scenes: scenes.filter((scene) => scene.narration || scene.actions.length),
  };
}
