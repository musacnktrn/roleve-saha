/* [codex] ureten: codex */
import { pairs } from './plan.js';
export function asWorld(svg, x, y) {
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const v = new DOMPoint(x, y).matrixTransform(m.inverse());
  return { x: Math.round(v.x), y: Math.round(v.y) };
}
export function zoomBox(v, f, anchor = { x: v.x + v.w / 2, y: v.y + v.h / 2 }) {
  const w = Math.min(2e7, Math.max(350, v.w * f)),
    k = w / v.w;
  return { x: anchor.x + (v.x - anchor.x) * k, y: anchor.y + (v.y - anchor.y) * k, w, h: v.h * k };
}
export function targetAt(el) {
  const a = {};
  for (const k of ['node', 'room', 'wall', 'element', 'zone', 'note', 'obs']) {
    const v = el?.closest?.(`[data-${k}]`);
    if (v) a[k] = v.dataset[k];
  }
  return a;
}
export function wireCanvas(
  svg,
  { onTap, onDragNode, onInk, onZoom, getTool, getBox, setBox, pencilOnly, onPen, previewInk },
) {
  const down = new Map();
  let session = null,
    ink = null,
    pinch = null,
    pen = false;
  const loc = (e) => ({ x: e.clientX, y: e.clientY });
  let lens = null;
  function magnify(e) {
    if (
      !['draw', 'measure', 'zone', 'notePin', 'photoLocate', 'calibrate', 'sectionline'].includes(
        getTool(),
      ) ||
      e.pointerType === 'mouse' ||
      !svg.querySelector('#plan-content')
    )
      return;
    if (!lens) {
      lens = document.createElement('div');
      lens.className = 'plan-lens';
      lens.setAttribute('aria-hidden', 'true');
      lens.innerHTML = '<svg width="100%" height="100%"><use href="#plan-content"/></svg><i></i>';
      svg.parentElement.append(lens);
    }
    const b = svg.parentElement.getBoundingClientRect(),
      pos = asWorld(svg, e.clientX, e.clientY),
      wide = 72 / Math.max(0.00001, svg.getScreenCTM().a * 2);
    lens
      .querySelector('svg')
      .setAttribute('viewBox', [pos.x - wide / 2, pos.y - wide / 2, wide, wide].join(' '));
    lens.style.left =
      Math.max(
        0,
        Math.min(b.width - 76, e.clientX - b.left + (e.clientX - b.left < b.width / 2 ? 22 : -92)),
      ) + 'px';
    lens.style.top = Math.max(0, Math.min(b.height - 76, e.clientY - b.top - 87)) + 'px';
  }
  function hideLens() {
    lens?.remove();
    lens = null;
  }
  const clear = () => {
    hideLens();
    down.clear();
    session = null;
    ink = null;
    pinch = null;
    pen = false;
    svg.querySelector('#gesture')?.remove();
  };
  const guide = (pts) => {
    const style = previewInk?.(pts, session?.tool);
    if (style) pts = style.points;
    let g = svg.querySelector('#gesture');
    if (!g) {
      g = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      g.id = 'gesture';
      g.setAttribute('class', 'gesture');
      svg.append(g);
    }
    if (style) {
      g.style.stroke = style.color;
      g.style.strokeWidth = style.width;
      g.style.opacity = style.opacity;
    }
    g.setAttribute('points', pairs(pts));
  };
  svg.onpointerdown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.pointerType === 'touch' && pen) return;
    if (e.pointerType === 'pen') {
      clear();
      pen = true;
      onPen?.();
    }
    const at = loc(e);
    down.set(e.pointerId, at);
    const target = targetAt(e.target);
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {}
    if (down.size === 2) {
      const [a, b] = [...down.values()];
      pinch = {
        dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        v: { ...getBox() },
      };
      session = null;
      ink = null;
      hideLens();
      svg.querySelector('#gesture')?.remove();
      return;
    }
    session = {
      at,
      world: asWorld(svg, at.x, at.y),
      target,
      tool: getTool(),
      pointer: e.pointerId,
      v: { ...getBox() },
      moved: false,
    };
    if (e.button === 1 || (e.pointerType === 'touch' && pencilOnly())) session.tool = 'pan';
    if (['ink', 'erase'].includes(session.tool))
      ink = [{ ...session.world, pressure: e.pointerType === 'pen' && e.pressure ? e.pressure : null }];
    else if (session.tool !== 'pan') magnify(e);
  };
  svg.onpointermove = (e) => {
    if (!down.has(e.pointerId)) return;
    down.set(e.pointerId, loc(e));
    if (pinch && down.size === 2) {
      const [a, b] = [...down.values()],
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        v = pinch.v,
        rect = svg.getBoundingClientRect();
      const k = Math.min(rect.width / v.w, rect.height / v.h);
      if (!k) return;
      const pm = {
        x: v.x + v.w / 2 + (pinch.mid.x - rect.left - rect.width / 2) / k,
        y: v.y + v.h / 2 + (pinch.mid.y - rect.top - rect.height / 2) / k,
      };
      const next = zoomBox(v, pinch.dist / dist, pm),
        ks = (k * v.w) / next.w;
      next.x -= (mid.x - pinch.mid.x) / ks;
      next.y -= (mid.y - pinch.mid.y) / ks;
      setBox(next);
      return;
    }
    if (!session || session.pointer !== e.pointerId) return;
    if (session.tool !== 'pan') magnify(e);
    const dx = e.clientX - session.at.x,
      dy = e.clientY - session.at.y;
    if (Math.hypot(dx, dy) > 4) session.moved = true;
    if (!session.moved) return;
    const world = asWorld(svg, e.clientX, e.clientY);
    if (['ink', 'erase'].includes(session.tool)) {
      const points = e.getCoalescedEvents?.() || [];
      for (const event of points) {
        ink.push({
          ...asWorld(svg, event.clientX, event.clientY),
          pressure: event.pointerType === 'pen' && event.pressure ? event.pressure : null,
        });
      }
      ink.push({ ...world, pressure: e.pointerType === 'pen' && e.pressure ? e.pressure : null });
      guide(ink);
    } else if (['draw', 'zone', 'sectionline'].includes(session.tool)) guide([session.world, world]);
    else if (session.target.node && session.tool === 'select') guide([session.world, world]);
    else if (session.tool === 'pan' || session.tool === 'select') {
      const m = svg.getScreenCTM();
      if (m) setBox({ ...session.v, x: session.v.x - dx / m.a, y: session.v.y - dy / m.d });
    }
  };
  svg.onpointercancel = (e) => {
    if (down.has(e.pointerId)) clear();
  };
  svg.onlostpointercapture = (e) => {
    if (down.has(e.pointerId)) clear();
  };
  svg.onpointerup = (e) => {
    if (!down.has(e.pointerId)) return;
    down.delete(e.pointerId);
    if (pinch) {
      if (!down.size) clear();
      return;
    }
    const s = session;
    if (!s || s.pointer !== e.pointerId) return;
    const world = asWorld(svg, e.clientX, e.clientY),
      stroke = ink;
    clear();
    if (
      ['ink', 'erase'].includes(s.tool) &&
      stroke &&
      (s.tool === 'erase' || stroke.length > 1 || Math.hypot(e.clientX - s.at.x, e.clientY - s.at.y) > 2)
    ) {
      if (stroke.at(-1).x !== world.x || stroke.at(-1).y !== world.y)
        stroke.push({ ...world, pressure: stroke.at(-1).pressure });
      onInk(stroke);
      return;
    }
    if (s.tool === 'select' && s.target.node && s.moved) {
      onDragNode(s.target.node, world);
      return;
    }
    if (
      s.moved &&
      ['draw', 'zone', 'measure', 'notePin', 'photoLocate', 'calibrate', 'sectionline'].includes(s.tool)
    ) {
      onTap(world, targetAt(document.elementFromPoint(e.clientX, e.clientY)), e);
      return;
    }
    if (!s.moved && s.tool !== 'pan' && s.tool !== 'ink') onTap(world, s.target, e);
  };
  svg.onwheel = (e) => {
    e.preventDefault();
    onZoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, asWorld(svg, e.clientX, e.clientY));
  };
}
