export class DemoTimeline {
  constructor({ manifest, narration, rehearsal }) {
    this.startedAt = Date.now();
    this.manifest = manifest;
    this.narration = narration;
    this.rehearsal = rehearsal;
    this.actions = [];
    this.narrations = [];
    this.waits = [];
    this.scrolls = [];
    this.compressions = [];
    this.state = {};
    this.meta = {
      demoId: manifest.id,
      rehearsal,
      viewport: manifest.browser.viewport,
      browser: `Playwright ${manifest.browser.channel}`,
      source: manifest.script,
      narration: {
        mode: manifest.narration.mode,
        referenceFile: narration.referenceFile ?? null,
      },
    };
  }

  elapsed() {
    return (Date.now() - this.startedAt) / 1000;
  }

  markAction(id, kind, details = {}) {
    const entry = { id, kind, at: this.elapsed(), ...details };
    this.actions.push(entry);
    return entry;
  }

  startNarration(id, { start, anchor } = {}) {
    const segment = this.narration.segments.get(id);
    if (!segment) throw new Error(`No normalized narration scene named ${id}`);
    const entry = {
      id,
      start: start ?? this.elapsed() + this.manifest.narration.defaultOffsetSeconds,
      duration: segment.duration,
      runtimeDuration: segment.runtimeDuration,
      file: segment.file,
      ...(anchor ? { anchor } : {}),
    };
    this.narrations.push(entry);
    return entry;
  }

  async measuredWait(id, start, target, completion) {
    await completion();
    const end = this.elapsed();
    const entry = { id, start, end, duration: end - start, target: Math.min(target, end - start) };
    this.waits.push(entry);
    if (!this.rehearsal && entry.duration > target + 0.12) {
      this.compressions.push({ id, start, end, target });
    }
    return entry;
  }

  toJSON() {
    return {
      meta: this.meta,
      narrations: this.narrations.map(({ runtimeDuration: _runtimeDuration, ...entry }) => entry),
      actions: this.actions,
      waits: this.waits,
      compressions: this.compressions,
      scrolls: this.scrolls,
      state: this.state,
    };
  }
}

export function mapTime(time, contentStart, compressions) {
  let mapped = time - contentStart;
  for (const entry of compressions) {
    if (time >= entry.end) {
      mapped -= (entry.end - entry.start) - entry.target;
    } else if (time > entry.start) {
      const duration = Math.max(0.001, entry.end - entry.start);
      mapped -= (time - entry.start) * (1 - entry.target / duration);
      break;
    } else {
      break;
    }
  }
  return Math.max(0, mapped);
}

export function validateCompressions(compressions, contentStart, contentEnd) {
  const sorted = [...compressions].sort((left, right) => left.start - right.start);
  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index];
    if (!(entry.start >= contentStart && entry.end <= contentEnd && entry.end > entry.start)) {
      throw new Error(`Compression ${entry.id} lies outside successful content boundaries`);
    }
    if (!(entry.target > 0 && entry.target <= entry.end - entry.start)) {
      throw new Error(`Compression ${entry.id} has an invalid target duration`);
    }
    if (index && entry.start < sorted[index - 1].end) {
      throw new Error(`Overlapping compressions: ${sorted[index - 1].id} and ${entry.id}`);
    }
  }
  return sorted;
}
