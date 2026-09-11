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
    pointer.style.left = `${window.innerWidth / 2}px`;
    pointer.style.top = `${window.innerHeight / 2}px`;
    document.body.append(pointer);
    document.addEventListener('mousemove', (event) => {
      pointer.style.left = `${event.clientX}px`;
      pointer.style.top = `${event.clientY}px`;
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

export function createBrowserHelpers({ page, timeline, pause, viewport }) {
  async function point(locator, options = {}) {
    const { hold = 650, id, steps = 28, scroll = true } =
      typeof options === 'number' ? { hold: options } : options;
    const target = locator.first();
    if (scroll) await target.scrollIntoViewIfNeeded();
    await target.waitFor({ state: 'visible', timeout: 30_000 });
    const box = await target.boundingBox();
    if (!box) throw new Error(`No visible box for ${id ?? 'pointer target'}`);
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > viewport.width ||
      box.y + box.height > viewport.height
    ) {
      throw new Error(`Pointer target is clipped for ${id ?? 'unknown'}: ${JSON.stringify(box)}`);
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
    if (id) timeline.markAction(id, 'point', { box });
    await pause(hold);
    return box;
  }

  async function click(locator, id, options = {}) {
    const { hold = 450, downMs = 110, scroll = true } =
      typeof options === 'number' ? { hold: options } : options;
    const box = await point(locator, { hold: 250, scroll });
    const event = timeline.markAction(id, 'click', { box });
    await page.mouse.down();
    await pause(downMs);
    await page.mouse.up();
    const up = timeline.elapsed();
    await pause(hold);
    return { down: event.at, up, box };
  }

  async function scrollMetrics(locator) {
    return locator.first().evaluate((element) => {
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

  async function positionAtTop(locator, offset = 8) {
    return locator.first().evaluate((element, topOffset) => {
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
    durationMs,
    offset = 100,
    to = 'element',
    capture,
  }) {
    const target = locator.first();
    await target.waitFor({ state: 'attached', timeout: 30_000 });
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

  return { point, click, scrollMetrics, positionAtTop, smoothScroll };
}
