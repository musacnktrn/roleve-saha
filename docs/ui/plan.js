/* [codex] ureten: codex */
import { strokeMarkup } from './sketch.js';
import { photoPin } from './photo-placement.js';
import { doorSwing } from '../views/model.js';
import { esc, num, safePhoto } from './base.js';
const colors = ['#f4f2e9', '#e9eeea', '#f4eddf', '#e3eae9', '#f2f0e4', '#ece9e8'];
export const roomColor = (i) => colors[Math.max(0, i) % colors.length];
export const wallName = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
export function boxOf(points) {
  if (!points.length) return { x: 0, y: 0, w: 6200, h: 4100 };
  let x = Infinity,
    y = Infinity,
    X = -Infinity,
    Y = -Infinity;
  for (const p of points) {
    x = Math.min(x, p.x);
    X = Math.max(X, p.x);
    y = Math.min(y, p.y);
    Y = Math.max(Y, p.y);
  }
  return { x, y, w: Math.max(1, X - x), h: Math.max(1, Y - y) };
}
export const pairs = (points) => points.map((p) => `${p.x},${p.y}`).join(' ');
function label(x, y, text, cls, more = '') {
  return `<text x="${x}" y="${y}" class="${cls}" ${more}>${esc(text)}</text>`;
}
export function figure(kind, x, y, w, h, rotation = 0) {
  const rect = (a, b, c, d, r = 0) => `<rect x="${a}" y="${b}" width="${c}" height="${d}" rx="${r}"/>`;
  const line = (a, b, c, d) => `<path d="M${a} ${b}L${c} ${d}"/>`;
  let body = '';
  if (kind === 'sofa') {
    body =
      rect(0, 0, w, h, 55) +
      rect(55, 60, w - 110, h * 0.22, 30) +
      rect(55, h * 0.3, (w - 110) / 2, h * 0.62, 38) +
      rect(w / 2, h * 0.3, (w - 110) / 2, h * 0.62, 38);
  } else if (kind === 'bed') {
    body =
      rect(0, 0, w, h, 55) +
      rect(w * 0.05, h * 0.035, w * 0.42, h * 0.19, 54) +
      rect(w * 0.53, h * 0.035, w * 0.42, h * 0.19, 54) +
      line(0, h * 0.32, w, h * 0.32) +
      line(0, h * 0.36, w, h * 0.36);
  } else if (kind === 'table') {
    body =
      rect(0, 0, w, h, 100) +
      rect(w * 0.14, -h * 0.17, w * 0.27, h * 0.12, 40) +
      rect(w * 0.59, -h * 0.17, w * 0.27, h * 0.12, 40) +
      rect(w * 0.14, h * 1.05, w * 0.27, h * 0.12, 40) +
      rect(w * 0.59, h * 1.05, w * 0.27, h * 0.12, 40);
  } else if (kind === 'counter') {
    body =
      rect(0, 0, w, h) +
      rect(w * 0.1, h * 0.16, w * 0.28, h * 0.68, 55) +
      rect(w * 0.6, h * 0.12, w * 0.33, h * 0.76, 20);
    for (const a of [0.68, 0.84])
      for (const b of [0.32, 0.69]) body += `<circle cx="${w * a}" cy="${h * b}" r="${h * 0.12}"/>`;
  } else if (kind === 'bath') {
    body =
      rect(0, 0, w, h, 55) +
      rect(w * 0.07, h * 0.1, w * 0.86, h * 0.8, 200) +
      `<circle cx="${w * 0.82}" cy="${h / 2}" r="35"/>`;
  } else body = rect(0, 0, w, h, 40);
  return `<g class="furniture" transform="translate(${x} ${y}) rotate(${+rotation || 0})">${body}</g>`;
}
function dim(x1, y1, x2, y2, caption) {
  const ang = Math.abs(x2 - x1) > Math.abs(y2 - y1) ? 0 : -90;
  return `<g class="dimension"><path d="M${x1} ${y1}L${x2} ${y2}m-50 63 100-126M${x1 - 50} ${y1 + 63}l100-126"/>${label(0, -75, caption, 'dim-label', `transform="translate(${(x1 + x2) / 2} ${(y1 + y2) / 2}) rotate(${ang})"`)}</g>`;
}
export function roomCenter(pts) {
  let s = 0,
    x = 0,
    y = 0;
  pts.forEach((a, i) => {
    let b = pts[(i + 1) % pts.length],
      d = a.x * b.y - b.x * a.y;
    s += d;
    x += (a.x + b.x) * d;
    y += (a.y + b.y) * d;
  });
  let c = s ? { x: x / (3 * s), y: y / (3 * s) } : pts[0];
  const inside = (q) => {
    let hit = false;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    });
    return hit;
  };
  if (!inside(c)) {
    const box = boxOf(pts);
    for (const t of [0.25, 0.65, 0.15, 0.85]) {
      let q = { x: box.x + box.w * t, y: box.y + box.h * 0.35 };
      if (inside(q)) return q;
    }
  }
  return c;
}
import { sectionOverlay } from './sections.js';
export function planMarkup(p, s, mini = false) {
  const node = new Map(p.nodes.map((v) => [v.id, v])),
    wall = new Map(p.walls.map((v) => [v.id, v]));
  const rooms = p.rooms.filter((r) => r.floorId === s.floorId),
    walls = p.walls.filter((w) => w.floorId === s.floorId),
    points = p.nodes.filter((n) => n.floorId === s.floorId);
  const shared = new Map(),
    parts = [],
    labels = [],
    handles = [],
    under = [];
  const b = boxOf(points);
  for (const r of rooms) for (const id of r.wallIds) shared.set(id, (shared.get(id) || 0) + 1);
  for (const u of p.underlays || [])
    if (u.floorId === s.floorId && safePhoto(u.data) && s.showUnderlay !== false)
      under.push(
        `<image href="${u.data}" x="${+u.x || 0}" y="${+u.y || 0}" width="${Math.max(1, +u.width || 4000)}" height="${Math.max(1, +u.height || 3000)}" opacity="${Math.min(1, Math.max(0, u.opacity ?? 0.45))}" transform="rotate(${+u.rotation || 0} ${+u.x || 0} ${+u.y || 0})"/>`,
      );
  rooms.forEach((r, i) => {
    const pts = r.nodeIds.map((id) => node.get(id)).filter(Boolean);
    if (pts.length < 3) return;
    const chosen = r.id === s.roomId,
      c = roomCenter(pts);
    parts.push(
      `<polygon class="room ${chosen ? 'chosen' : ''}" data-room="${esc(r.id)}" points="${pairs(pts)}" style="fill:${chosen && !mini ? '#e5edcf' : roomColor(i)};fill-opacity:${under.length ? 0.55 : 1}"/>`,
    );
    if (!mini) {
      const ar =
        Math.abs(
          pts.reduce((sum, a, j) => {
            const v = pts[(j + 1) % pts.length];
            return sum + a.x * v.y - v.x * a.y;
          }, 0),
        ) / 2e6;
      const sz = Math.max(125, Math.min(235, boxOf(pts).w / (r.name.length * 0.72 + 2)));
      labels.push(
        `<g class="room-caption" data-room="${esc(r.id)}" transform="translate(${c.x} ${c.y})">${label(0, -155, r.code || String(i + 1), 'room-code')}${label(0, 110, r.name, 'room-name', `style="font-size:${sz}px"`)}${label(0, 325, `${num(ar, 1)} m²`, 'room-area')}</g>`,
      );
    }
  });
  for (const z of p.zones || [])
    if (rooms.some((r) => r.id === z.roomId))
      parts.push(
        `<polygon data-room="${esc(z.roomId)}" data-zone="${esc(z.id)}" class="zone-fill z-${esc(z.type)}" points="${pairs(z.points)}"/>`,
      );
  for (const f of p.furniture || [])
    if (rooms.some((r) => r.id === f.roomId))
      parts.push(figure(f.type, +f.x, +f.y, +f.width, +f.depth, f.rotation));
  for (const w of walls) {
    const a = node.get(w.a),
      v = node.get(w.b);
    if (!a || !v) continue;
    const d = `M${a.x} ${a.y}L${v.x} ${v.y}`,
      th = w.thickness > 0 ? Math.min(w.thickness, 330) : 110;
    parts.push(
      `<g data-wall="${esc(w.id)}" class="wall-hit"><path d="${d}" class="wall-edge" style="stroke-width:${shared.get(w.id) > 1 ? Math.min(128, th) : th}"/><path d="${d}" class="wall-target"/></g>`,
    );
  }
  for (const e of p.elements) {
    const w = wall.get(e.wallId);
    if (w?.floorId !== s.floorId) continue;
    const a = node.get(w.a),
      v = node.get(w.b),
      len = Math.hypot(v.x - a.x, v.y - a.y);
    if (!len) continue;
    const t = e.offset / len,
      ang = (Math.atan2(v.y - a.y, v.x - a.x) * 180) / Math.PI,
      th = Math.min(330, w.thickness || 110),
      wid = e.width || 100,
      r = p.rooms.find((r) => r.id === e.roomId);
    const side = (e.side === 'outside' ? -1 : 1) * (r && r.nodeIds[r.wallIds.indexOf(w.id)] !== w.a ? -1 : 1);
    const swing = doorSwing(e),
      hingedAtEnd = swing ? !swing.atStart : false,
      swingSide = side * (swing?.direction || 1);
    let d =
      e.type === 'window'
        ? `<path d="M0 ${-th * 0.37}h${wid}v${th * 0.74}H0zM0 0h${wid}M${wid / 2} ${-th * 0.37}v${th * 0.74}" class="window"/>`
        : e.type === 'door' && swing
          ? `<g transform="translate(${hingedAtEnd ? wid : 0} 0) scale(${hingedAtEnd ? -1 : 1} ${swingSide})"><path d="M0 0v${wid}A${wid} ${wid} 0 0 0 ${wid} 0" class="door"/></g>`
          : e.type === 'door'
            ? `<path d="M0 0h${wid}" stroke="#66786c" stroke-width="20" stroke-dasharray="60 38"/>`
            : `<rect x="0" y="${side > 0 ? 0 : -150}" width="${Math.max(100, wid)}" height="150" rx="15" class="fitting"/>`;
    parts.push(
      `<g data-element="${esc(e.id)}" data-wall="${esc(w.id)}" transform="translate(${a.x + (v.x - a.x) * t} ${a.y + (v.y - a.y) * t}) rotate(${ang})">${['window', 'door'].includes(e.type) ? `<path d="M0 0h${wid}" stroke="#f6f7ed" stroke-width="${th + 10}"/>` : ''}${d}<path d="M0 0h${wid}" class="element-target"/></g>`,
    );
  }
  if (!mini && points.length && s.showDims !== false) {
    parts.push(
      dim(b.x, b.y - 460, b.x + b.w, b.y - 460, num(b.w / 1000, 3) + ' m'),
      dim(b.x - 470, b.y, b.x - 470, b.y + b.h, num(b.h / 1000, 3) + ' m'),
    );
  }
  if (s.wallId && !mini) {
    const w = wall.get(s.wallId),
      a = node.get(w?.a),
      v = node.get(w?.b);
    if (a && v)
      handles.push(`<path class="active-wall" data-wall="${esc(w.id)}" d="M${a.x} ${a.y}L${v.x} ${v.y}"/>`);
  }
  if (s.roomId && !mini) {
    const r = rooms.find((r) => r.id === s.roomId);
    if (r)
      r.nodeIds.forEach((id) => {
        const v = node.get(id);
        if (v)
          handles.push(`<circle data-node="${esc(id)}" cx="${v.x}" cy="${v.y}" r="59" class="node-handle"/>`);
      });
  }
  if (!mini && s.showNotes !== false)
    for (const n of p.notes.filter((n) => n.floorId === s.floorId)) handles.push(photoPin(n));
  for (const st of p.strokes || []) if (st.floorId === s.floorId) handles.push(strokeMarkup(st));
  const superseded = new Set(p.observations.map((o) => o.replaces).filter(Boolean));
  if (!mini && s.showDims !== false && s.anchorFn)
    for (const o of p.observations.filter((o) => o.floorId === s.floorId && !superseded.has(o.id))) {
      try {
        const a = s.anchorFn(p, o.a),
          v = s.anchorFn(p, o.b);
        if (!a || !v) continue;
        handles.push(
          `<g class="obs-guide" data-obs="${esc(o.id)}"><path d="M${a.x} ${a.y}L${v.x} ${v.y}"/>${label((a.x + v.x) / 2, (a.y + v.y) / 2 - 115, `${num(o.value / 1000, 3)} m`, 'obs-label')}</g>`,
        );
      } catch {}
    }
  const bounds = under.length
    ? boxOf([
        ...points,
        ...(p.underlays || [])
          .filter((u) => u.floorId === s.floorId)
          .flatMap((u) => {
            const radians = ((u.rotation || 0) * Math.PI) / 180,
              c = Math.cos(radians),
              s = Math.sin(radians);
            return [
              [0, 0],
              [u.width, 0],
              [0, u.height],
              [u.width, u.height],
            ].map(([x, y]) => ({ x: u.x + x * c - y * s, y: u.y + x * s + y * c }));
          }),
      ])
    : b;
  const witnesses = mini
    ? []
    : p.notes
        .filter((n) => n.floorId === s.floorId)
        .flatMap((n) => [n.anchor, n.target])
        .filter((v) => v && Number.isFinite(v.x) && Number.isFinite(v.y));
  const cut = !mini && (p.sections || []).find((v) => v.id === s.sectionId && v.floorId === s.floorId);
  if (cut) witnesses.push(cut.a, cut.b);
  const extent = witnesses.length
    ? boxOf([...witnesses, { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y + bounds.h }])
    : bounds;
  return {
    html:
      (mini ? '' : '<g id="plan-content">') +
      under.join('') +
      parts.join('') +
      sectionOverlay(cut) +
      labels.join('') +
      handles.join('') +
      (mini ? '' : '</g><g id="draft-layer" pointer-events="none"></g>'),
    bounds: extent,
  };
}
export function padded(b) {
  const pad = Math.max(800, Math.max(b.w, b.h) * 0.14);
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}
export const viewStr = (v) => `${v.x} ${v.y} ${v.w} ${v.h}`;
