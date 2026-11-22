// [codex] ureten: codex
import { pointAtImage, shiftMark } from './annotations.js';

export function connectPhotoSurface(svg, options) {
  const {
    w,
    h,
    tool,
    selected,
    blockDrawing,
    onSelect,
    onPoint,
    onStroke,
    onMove,
    onPreview,
    onViewport,
  } = options;
  let box = { x: 0, y: 0, w, h },
    session = null,
    pinch = null;
  const contacts = new Map();
  const imagePoint = (e, clamp = false) => pointAtImage(svg, e.clientX, e.clientY, w, h, clamp);
  const update = () => {
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    onViewport(Math.round((100 * w) / box.w));
  };
  const world = (cx, cy) => new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
  function zoom(factor, cx, cy) {
    const rect = svg.getBoundingClientRect();
    cx ??= rect.left + rect.width / 2;
    cy ??= rect.top + rect.height / 2;
    const anchor = world(cx, cy),
      amount = Math.max(1, Math.min(10, (w / box.w) * factor));
    box = { x: box.x, y: box.y, w: w / amount, h: h / amount };
    update();
    const after = world(cx, cy);
    box.x += anchor.x - after.x;
    box.y += anchor.y - after.y;
    confine();
    update();
  }
  function confine() {
    box.x = Math.min(w - box.w, Math.max(0, box.x));
    box.y = Math.min(h - box.h, Math.max(0, box.y));
  }
  const reset = () => {
    box = { x: 0, y: 0, w, h };
    update();
  };
  const clear = () => {
    session = null;
    pinch = null;
    contacts.clear();
    onPreview(null);
  };
  const pair = () => {
    const [a, b] = [...contacts.values()];
    return {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
      dist: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
    };
  };
  function updatePinch() {
    const current = pair();
    box = { ...pinch.box };
    update();
    zoom(current.dist / pinch.begin.dist, pinch.begin.x, pinch.begin.y);
    const m = svg.getScreenCTM();
    box.x += (pinch.begin.x - current.x) / m.a;
    box.y += (pinch.begin.y - current.y) / m.d;
    confine();
    update();
  }
  function pick(markId) {
    if (markId !== undefined) onSelect(markId);
    return selected();
  }
  svg.onpointerdown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.pointerType === 'touch' && session?.kind === 'pen') return;
    if (e.pointerType === 'pen' && contacts.size) clear();
    if (contacts.size >= 2) return;
    e.preventDefault();
    contacts.set(e.pointerId, e);
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {}
    if (contacts.size === 2) {
      session = null;
      onPreview(null);
      pinch = { begin: pair(), box: { ...box } };
      return;
    }
    const p = imagePoint(e),
      active = e.button === 1 ? 'pan' : blockDrawing() ? 'hold' : tool();
    const id = e.target.closest('[data-mark]')?.dataset.mark;
    const handle = e.target.closest('[data-handle]')?.dataset.handle;
    const mark = active === 'select' && p ? (handle == null ? pick(id || null) : selected()) : null;
    session = {
      id: e.pointerId,
      kind: e.pointerType,
      at: p,
      client: { x: e.clientX, y: e.clientY },
      box: { ...box },
      mode: active,
      mark,
      handle: handle == null ? null : Number(handle),
      points: p ? [p] : [],
      moved: false,
      updated: null,
    };
  };
  function move(e) {
    if (!contacts.has(e.pointerId)) return;
    contacts.set(e.pointerId, e);
    if (pinch) {
      if (contacts.size === 2) updatePinch();
      return;
    }
    const s = session;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.client.x,
      dy = e.clientY - s.client.y;
    if (Math.hypot(dx, dy) > 3) s.moved = true;
    if (!s.moved) return;
    if (s.mode === 'pan') {
      const m = svg.getScreenCTM();
      box = { ...s.box, x: s.box.x - dx / m.a, y: s.box.y - dy / m.d };
      confine();
      update();
      return;
    }
    if (!s.at) return;
    const p = imagePoint(e, true);
    if (s.mode === 'ink') {
      if (
        s.points.length < 2999 &&
        Math.hypot((s.points.at(-1).x - p.x) * w, (s.points.at(-1).y - p.y) * h) > 0.3
      ) {
        s.points.push(p);
        onPreview({ type: 'ink', points: s.points });
      }
    } else if (s.mode === 'select' && s.mark) {
      s.updated =
        s.handle == null
          ? shiftMark(s.mark, p.x - s.at.x, p.y - s.at.y)
          : { ...s.mark, points: s.mark.points.map((point, i) => (i === s.handle ? p : point)) };
      onPreview(s.updated);
    } else if (s.mode === 'arrow' || s.mode === 'dimension') {
      onPreview({ type: 'segment', points: [s.at, p] });
    }
  }
  svg.onpointermove = move;
  svg.onpointerup = (e) => {
    if (!contacts.has(e.pointerId)) return;
    // Capture fast strokes with just down and up, including the final stylus segment.
    if (!pinch) move(e);
    contacts.delete(e.pointerId);
    if (pinch) {
      if (!contacts.size) clear();
      return;
    }
    const s = session;
    if (!s || s.id !== e.pointerId) return;
    const p = imagePoint(e, true);
    session = null;
    onPreview(null);
    if (!s.at || !p || s.mode === 'pan') return;
    if (s.mode === 'ink') {
      if (s.points.length > 1) onStroke(s.points);
      return;
    }
    if (s.mode === 'select') {
      if (s.moved && s.updated) onMove(s.updated);
      return;
    }
    if (s.moved && ['arrow', 'dimension'].includes(s.mode)) onPoint(s.at, p);
    else if (!s.moved) onPoint(p);
  };
  svg.onpointercancel = (e) => {
    if (contacts.has(e.pointerId)) clear();
  };
  svg.onlostpointercapture = (e) => {
    if (contacts.has(e.pointerId)) clear();
  };
  svg.onwheel = (e) => {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  };
  reset();
  return { zoom, reset, cancel: clear };
}
