export function installDemoPointer() {
  const install = () => {
    if (document.getElementById('__narrated_demo_pointer')) return;
    const style = document.createElement('style');
    style.textContent = `
      #__narrated_demo_pointer {
        position: fixed; z-index: 2147483647; width: 24px; height: 24px;
        border: 3px solid white; border-radius: 50%; background: #00a6c8;
        box-shadow: 0 0 0 2px #053f5c, 0 2px 8px #0008;
        pointer-events: none; transform: translate(-50%, -50%);
        transition: left .04s linear, top .04s linear;
      }
      #__narrated_demo_pointer.clicking::after {
        content: ""; position: absolute; inset: -11px; border: 4px solid #00a6c8;
        border-radius: 50%; animation: __narrated_demo_pulse .55s ease-out;
      }
      @keyframes __narrated_demo_pulse {
        from { transform: scale(.45); opacity: 1; }
        to { transform: scale(1.8); opacity: 0; }
      }
    `;
    document.head.append(style);
    const pointer = document.createElement('div');
    pointer.id = '__narrated_demo_pointer';
    const place = (x, y) => {
      const parsedZoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
      const zoom = Number.isFinite(parsedZoom) && parsedZoom > 0 ? parsedZoom : 1;
      pointer.style.left = `${x / zoom}px`;
      pointer.style.top = `${y / zoom}px`;
    };
    place(window.innerWidth / 2, window.innerHeight / 2);
    document.body.append(pointer);
    document.addEventListener('mousemove', (event) => {
      place(event.clientX, event.clientY);
    }, true);
    document.addEventListener('mousedown', () => {
      pointer.classList.remove('clicking');
      void pointer.offsetWidth;
      pointer.classList.add('clicking');
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

export function installDemoZoom(zoom) {
  const apply = () => {
    if (zoom !== 1) document.documentElement.style.zoom = String(zoom);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
}

export function createBrowserHelpers({
  captureClickEvidence,
  page,
  timeline,
  pause,
  viewport,
  pace = 1,
}) {
  const defaultScrollDurationMs = 1_600;
  let motionTail = Promise.resolve();

  async function uniqueVisibleTarget(locator, id = 'target') {
    let count = await locator.count();
    if (count === 0) {
      await locator.first().waitFor({ state: 'visible', timeout: 30_000 });
      count = await locator.count();
    }
    if (count !== 1) {
      throw new Error(
        `Expected one scoped locator for ${id}, found ${count}; scope it to a stable visible region`,
      );
    }
    await locator.waitFor({ state: 'visible', timeout: 30_000 });
    return locator;
  }

  async function stableBox(locator, id, {
    intervalMs = 50,
    samples = 3,
    timeoutMs = 5_000,
    tolerancePx = 0.75,
  } = {}) {
    const started = Date.now();
    let previous;
    let stableSamples = 0;
    while (Date.now() - started < timeoutMs) {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`No visible box for ${id}`);
      const delta = previous
        ? Math.max(
            Math.abs(box.x - previous.x),
            Math.abs(box.y - previous.y),
            Math.abs(box.width - previous.width),
            Math.abs(box.height - previous.height),
          )
        : Number.POSITIVE_INFINITY;
      stableSamples = delta <= tolerancePx ? stableSamples + 1 : 1;
      if (stableSamples >= samples) return box;
      previous = box;
      await page.waitForTimeout(intervalMs);
    }
    throw new Error(`Layout did not settle for ${id} within ${timeoutMs}ms`);
  }

  async function movePointer(x, y, { steps, travelMs }) {
    const start = await page.evaluate(({ width, height }) => {
      const pointer = document.getElementById('__narrated_demo_pointer');
      if (!pointer) return { x: width / 2, y: height / 2 };
      const box = pointer.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }, viewport);
    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      await page.mouse.move(
        start.x + (x - start.x) * fraction,
        start.y + (y - start.y) * fraction,
      );
      if (travelMs > 0) await pause(travelMs / steps);
    }
  }

  function isClipped(box) {
    return (
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > viewport.width ||
      box.y + box.height > viewport.height
    );
  }

  function boxesMatch(left, right, tolerancePx) {
    return Math.max(
      Math.abs(left.x - right.x),
      Math.abs(left.y - right.y),
      Math.abs(left.width - right.width),
      Math.abs(left.height - right.height),
    ) <= tolerancePx;
  }

  async function verifyPointerHit(target, id, box) {
    const proof = await target.evaluate((element, expectedBox) => {
      const pointer = element.ownerDocument.getElementById('__narrated_demo_pointer');
      if (!pointer) return { error: 'Visible demo pointer is missing' };
      const pointerRect = pointer.getBoundingClientRect();
      const targetRect = element.getBoundingClientRect();
      const x = pointerRect.left + pointerRect.width / 2;
      const y = pointerRect.top + pointerRect.height / 2;
      const hit = element.ownerDocument.elementFromPoint(x, y);
      const overlap =
        x >= targetRect.left &&
        x <= targetRect.right &&
        y >= targetRect.top &&
        y <= targetRect.bottom;
      const hitMatches = Boolean(hit && (hit === element || element.contains(hit)));
      return {
        expectedBox,
        hit: hit
          ? {
              ariaLabel: hit.getAttribute('aria-label'),
              role: hit.getAttribute('role'),
              tag: hit.tagName,
            }
          : null,
        hitMatches,
        overlap,
        pointer: { x, y },
        targetBox: {
          x: targetRect.left,
          y: targetRect.top,
          width: targetRect.width,
          height: targetRect.height,
        },
      };
    }, box);
    if (proof.error) throw new Error(`${id}: ${proof.error}`);
    if (!proof.overlap || !proof.hitMatches) {
      throw new Error(
        `Visible pointer does not match the real hit target for ${id}: ${JSON.stringify(proof)}`,
      );
    }
    return proof;
  }

  async function point(locator, options = {}) {
    const {
      hold = 650,
      id,
      layoutIntervalMs = 50,
      layoutSamples = 3,
      layoutTimeoutMs = 5_000,
      layoutTolerancePx = 0.75,
      mark = true,
      maxRealignments = 2,
      scroll = 'smooth',
      scrollDurationMs = defaultScrollDurationMs,
      scrollOffset = 100,
      steps = 28,
      travelMs = 900,
    } = typeof options === 'number' ? { hold: options } : options;
    const target = await uniqueVisibleTarget(locator, id ?? 'pointer target');
    const targetId = id ?? 'pointer target';
    const stability = {
      intervalMs: layoutIntervalMs,
      samples: layoutSamples,
      timeoutMs: layoutTimeoutMs,
      tolerancePx: layoutTolerancePx,
    };
    let box = await stableBox(target, targetId, stability);
    if (isClipped(box) && scroll) {
      if (scroll === 'instant') {
        await target.scrollIntoViewIfNeeded();
      } else {
        await smoothScroll(target, {
          id: `${id ?? 'pointer-target'}.scroll`,
          durationMs: scrollDurationMs * pace,
          offset: scrollOffset,
        });
      }
      box = await stableBox(target, targetId, stability);
    }
    if (isClipped(box)) {
      throw new Error(`Pointer target is clipped for ${id ?? 'unknown'}: ${JSON.stringify(box)}`);
    }
    let aligned = false;
    for (let attempt = 0; attempt <= maxRealignments; attempt += 1) {
      await movePointer(box.x + box.width / 2, box.y + box.height / 2, { steps, travelMs });
      if (attempt === 0) await pause(hold);
      const latest = await stableBox(target, targetId, stability);
      if (boxesMatch(box, latest, layoutTolerancePx)) {
        box = latest;
        aligned = true;
        break;
      }
      box = latest;
    }
    if (!aligned) {
      throw new Error(`Target kept moving during pointer travel for ${targetId}`);
    }
    if (id && mark) timeline.markAction(id, 'point', { box });
    return box;
  }

  async function click(locator, id, options = {}) {
    const {
      evidence = false,
      hold = 450,
      downMs = 110,
      scroll = 'smooth',
      scrollDurationMs = defaultScrollDurationMs,
      scrollOffset = 100,
      steps = 28,
      travelMs = 900,
      ...stability
    } = typeof options === 'number' ? { hold: options } : options;
    const box = await point(locator, {
      hold: 250,
      id,
      ...stability,
      mark: false,
      scroll,
      scrollDurationMs,
      scrollOffset,
      steps,
      travelMs,
    });
    const target = await uniqueVisibleTarget(locator, id);
    const proof = await verifyPointerHit(target, id, box);
    const event = timeline.markAction(id, 'click', { box, pointerProof: proof });
    await page.mouse.down();
    try {
      if (evidence) {
        if (!captureClickEvidence) {
          throw new Error(`Click evidence was requested for ${id}, but no capture hook is available`);
        }
        event.evidenceFile = await captureClickEvidence(id);
      }
      await pause(downMs);
    } finally {
      await page.mouse.up();
    }
    const up = timeline.elapsed();
    await pause(hold);
    return { down: event.at, up, box };
  }

  async function typeText(locator, text, id, options = {}) {
    const {
      clear = false,
      delayMs = 55,
      hold = 350,
      layoutIntervalMs = 50,
      layoutSamples = 3,
      layoutTimeoutMs = 5_000,
      layoutTolerancePx = 0.75,
      maxRealignments = 2,
      scroll = 'smooth',
      scrollDurationMs = defaultScrollDurationMs,
      scrollOffset = 100,
      travelMs = 900,
    } = options;
    const target = await uniqueVisibleTarget(locator, id);
    await click(target, `${id}.focus`, {
      hold: 150,
      layoutIntervalMs,
      layoutSamples,
      layoutTimeoutMs,
      layoutTolerancePx,
      maxRealignments,
      scroll,
      scrollDurationMs,
      scrollOffset,
      travelMs,
    });
    await stableBox(target, `${id}.typing`, {
      intervalMs: layoutIntervalMs,
      samples: layoutSamples,
      timeoutMs: layoutTimeoutMs,
      tolerancePx: layoutTolerancePx,
    });
    if (clear) {
      await target.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await target.press('Backspace');
    }
    const event = timeline.markAction(id, 'type', { characters: [...String(text)].length });
    await target.pressSequentially(String(text), { delay: Math.max(0, delayMs * pace) });
    await pause(hold);
    return event;
  }

  async function scrollMetrics(locator) {
    const target = await uniqueVisibleTarget(locator, 'scroll target');
    return target.evaluate((element) => {
      let owner = element.parentElement;
      while (owner && owner !== document.body) {
        const style = getComputedStyle(owner);
        if (/(auto|scroll)/.test(style.overflowY) && owner.scrollHeight > owner.clientHeight + 1) break;
        owner = owner.parentElement;
      }
      if (!owner || owner === document.body) owner = document.scrollingElement;
      if (!owner) throw new Error('No scrolling owner found');
      return {
        scrollTop: owner.scrollTop,
        max: owner.scrollHeight - owner.clientHeight,
        clientHeight: owner.clientHeight,
        scrollHeight: owner.scrollHeight,
        owner: owner === document.scrollingElement
          ? 'document.scrollingElement'
          : owner.getAttribute('data-testid') || owner.getAttribute('aria-label') || owner.tagName,
      };
    });
  }

  async function positionAtTop(locator, offset = 8, options = {}) {
    const target = await uniqueVisibleTarget(locator, 'position target');
    const {
      durationMs = defaultScrollDurationMs,
      id = 'position-at-top',
      instant = false,
    } = options;
    if (!instant) {
      await smoothScroll(target, {
        id,
        durationMs: durationMs * pace,
        offset,
      });
      return scrollMetrics(target);
    }
    return target.evaluate((element, topOffset) => {
      let owner = element.parentElement;
      while (owner && owner !== document.body) {
        const style = getComputedStyle(owner);
        if (/(auto|scroll)/.test(style.overflowY) && owner.scrollHeight > owner.clientHeight + 1) break;
        owner = owner.parentElement;
      }
      if (!owner || owner === document.body) owner = document.scrollingElement;
      if (!owner) throw new Error('No scrolling owner found');
      owner.style.scrollBehavior = 'auto';
      owner.style.overflowAnchor = 'none';
      const ownerTop = owner === document.scrollingElement ? 0 : owner.getBoundingClientRect().top;
      const elementTop = element.getBoundingClientRect().top;
      owner.scrollTop = Math.max(
        0,
        Math.min(owner.scrollHeight - owner.clientHeight, owner.scrollTop + elementTop - ownerTop - topOffset),
      );
      return { scrollTop: owner.scrollTop, max: owner.scrollHeight - owner.clientHeight };
    }, offset);
  }

  async function smoothScroll(locator, {
    id,
    durationMs = defaultScrollDurationMs,
    offset = 100,
    to = 'element',
    capture,
  }) {
    const target = await uniqueVisibleTarget(locator, id ?? 'smooth-scroll target');
    const runtimeDuration = Math.max(250, durationMs);
    const started = timeline.elapsed();
    const animation = target.evaluate((element, settings) => new Promise((resolve, reject) => {
      let owner = element.parentElement;
      while (owner && owner !== document.body) {
        const style = getComputedStyle(owner);
        if (/(auto|scroll)/.test(style.overflowY) && owner.scrollHeight > owner.clientHeight + 1) break;
        owner = owner.parentElement;
      }
      if (!owner || owner === document.body) owner = document.scrollingElement;
      if (!owner) {
        reject(new Error('No scrolling owner found'));
        return;
      }
      owner.style.scrollBehavior = 'auto';
      owner.style.overflowAnchor = 'none';
      const ownerTop = owner === document.scrollingElement ? 0 : owner.getBoundingClientRect().top;
      const start = owner.scrollTop;
      const desired = settings.to === 'end'
        ? owner.scrollHeight - owner.clientHeight
        : start + element.getBoundingClientRect().top - ownerTop - settings.offset;
      const end = Math.max(0, Math.min(owner.scrollHeight - owner.clientHeight, desired));
      const began = performance.now();
      const frame = (now) => {
        const progress = Math.min(1, (now - began) / settings.duration);
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - ((-2 * progress + 2) ** 2) / 2;
        owner.scrollTop = start + (end - start) * eased;
        if (progress < 1) requestAnimationFrame(frame);
        else resolve({ start, end, final: owner.scrollTop });
      };
      requestAnimationFrame(frame);
    }), { duration: runtimeDuration, offset, to });

    const samples = [{ fraction: 0, ...(await scrollMetrics(target)) }];
    if (capture) await capture(0);
    for (const fraction of [0.25, 0.5, 0.75]) {
      await page.waitForTimeout(runtimeDuration / 4);
      samples.push({ fraction, ...(await scrollMetrics(target)) });
      if (capture) await capture(fraction);
    }
    await page.waitForTimeout(runtimeDuration / 4);
    const result = await animation;
    samples.push({ fraction: 1, ...(await scrollMetrics(target)) });
    if (capture) await capture(1);

    const movement = Math.abs(result.end - result.start);
    if (movement > 12) {
      const direction = Math.sign(result.end - result.start);
      for (let index = 1; index < samples.length; index += 1) {
        if (direction * (samples[index].scrollTop - samples[index - 1].scrollTop) < -1) {
          throw new Error(`Non-progressive scroll ${id}: ${JSON.stringify(samples)}`);
        }
      }
      if (new Set(samples.map((sample) => Math.round(sample.scrollTop))).size < 4) {
        throw new Error(`Scroll ${id} lacked four distinct progressive samples`);
      }
    }
    timeline.scrolls.push({
      id,
      start: started,
      end: timeline.elapsed(),
      owner: samples[0].owner,
      from: result.start,
      to: result.end,
      samples,
    });
    timeline.markAction(id, 'smooth-scroll', { from: result.start, to: result.end });
    return result;
  }

  function serializeMotion(action) {
    const result = motionTail.then(action, action);
    motionTail = result.catch(() => {});
    return result;
  }

  return {
    point: (...args) => serializeMotion(() => point(...args)),
    click: (...args) => serializeMotion(() => click(...args)),
    typeText: (...args) => serializeMotion(() => typeText(...args)),
    scrollMetrics,
    positionAtTop: (...args) => serializeMotion(() => positionAtTop(...args)),
    smoothScroll: (...args) => serializeMotion(() => smoothScroll(...args)),
  };
}
