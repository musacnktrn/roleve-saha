// [codex] ureten: codex
import { asWorld, zoomBox } from './gestures.js';

export function wireOrbit(svg, { rotate, getBox, setBox }) {
  const pointers = new Map();
  let blockClick = false;
  let frame = 0;
  let dx = 0;
  let dy = 0;
  const capture = (id) => {
    try {
      svg.setPointerCapture(id);
    } catch {}
  };
  function flush() {
    cancelAnimationFrame(frame);
    frame = 0;
    if ((dx || dy) && svg.isConnected) rotate(dx, dy);
    dx = dy = 0;
  }
  const pair = () => {
    const [a, b] = pointers.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  function pan(previous, next, factor = 1) {
    const from = asWorld(svg, previous.x, previous.y),
      to = asWorld(svg, next.x, next.y);
    const current = getBox();
    if (!current) return;
    const moved = { ...current, x: current.x + from.x - to.x, y: current.y + from.y - to.y };
    setBox(factor === 1 ? moved : zoomBox(moved, factor, from));
  }
  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 1 || pointers.size >= 2) return;
    if (!pointers.size) blockClick = false;
    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      pan: e.shiftKey || e.button === 1,
      drag: false,
    });
    if (pointers.size === 2) {
      flush();
      blockClick = true;
      for (const [id, p] of pointers) {
        p.drag = true;
        capture(id);
      }
    }
    if (e.button === 1) e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    const current = pointers.get(e.pointerId);
    if (!current) return;
    const next = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) {
      const before = pair();
      Object.assign(current, next);
      const after = pair();
      if (before.distance > 2 && after.distance > 2) pan(before, after, before.distance / after.distance);
      return;
    }
    if (!current.drag && Math.hypot(next.x - current.startX, next.y - current.startY) < 4) return;
    current.drag = true;
    blockClick = true;
    capture(e.pointerId);
    if (current.pan) pan(current, next);
    else {
      dx += next.x - current.x;
      dy += next.y - current.y;
      if (!frame) frame = requestAnimationFrame(flush);
    }
    Object.assign(current, next);
  });
  function end(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    for (const p of pointers.values()) p.pan = true;
    flush();
    if (svg.hasPointerCapture?.(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) svg.addEventListener(name, end);
  svg.addEventListener('pointerleave', (e) => {
    const p = pointers.get(e.pointerId);
    if (p && !p.drag) end(e);
  });
  svg.addEventListener(
    'click',
    (e) => {
      if (blockClick) {
        blockClick = false;
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
}
