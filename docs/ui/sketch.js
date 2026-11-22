// [codex] ureten: codex
import { esc, uid } from './base.js';
import { indexProject, inwardSign } from '../views/model.js';

export const inkColors = [
  ['#314239', 'Grafit'],
  ['#9c562d', 'Kiremit'],
  ['#245fa6', 'Mavi'],
  ['#a62c45', 'Kırmızı'],
  ['#29704b', 'Yeşil'],
  ['#8650a1', 'Mor'],
  ['#be8a15', 'Hardal'],
];
export const inkBrushes = [
  ['pen', 'Teknik kalem'],
  ['pencil', 'Kurşun kalem'],
  ['marker', 'Fosforlu kalem'],
];
export const inkShapes = [
  ['free', 'Serbest çizgi'],
  ['line', 'Düz çizgi'],
  ['rect', 'Dikdörtgen'],
];
export const defaultInk = { color: '#314239', brush: 'pen', shape: 'free', width: 25 };
const has = (choices, key) => choices.some((v) => v[0] === key);
export function inkSettings(raw = {}) {
  const chosen = Number(raw.width);
  return {
    color: has(inkColors, raw.color) ? raw.color : defaultInk.color,
    brush: has(inkBrushes, raw.brush) ? raw.brush : defaultInk.brush,
    shape: has(inkShapes, raw.shape) ? raw.shape : defaultInk.shape,
    width: Number.isFinite(chosen) ? Math.min(150, Math.max(5, chosen)) : 25,
  };
}
export function faceFrame(p, s) {
  const room = p.rooms.find((r) => r.id === s.roomId) || p.rooms.find((r) => r.floorId === s.floorId);
  if (!room) return null;
  const wall = p.walls.find((w) => w.id === (s.wallId || room.wallIds[0]));
  if (!wall || !room.wallIds.includes(wall.id)) return null;
  const idx = indexProject(p),
    side = s.side === 'outside' ? 'outside' : 'inside',
    sign = inwardSign(idx, room, wall) * (side === 'outside' ? -1 : 1);
  return {
    wallId: wall.id,
    roomId: room.id,
    floorId: room.floorId,
    side,
    reverse: sign < 0,
    length: idx.frames.get(wall.id).len,
  };
}
export function brushPath(points, shape) {
  if (points.length < 2 || shape === 'free') return points;
  const a = points[0],
    b = points.at(-1);
  if (shape === 'line') return [a, b];
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
}
export function inkStyle(stroke) {
  const color = /^#[0-9a-f]{6}$/i.test(stroke.color) ? stroke.color : '#9c562d';
  return {
    color,
    width: Number.isFinite(stroke.width) ? Math.max(4, Math.min(450, stroke.width)) : 25,
    opacity: Number.isFinite(stroke.opacity) ? Math.min(1, Math.max(0.1, stroke.opacity)) : 1,
  };
}
export function strokeMarkup(stroke, points = stroke.points) {
  const style = inkStyle(stroke);
  return `<polyline data-sketch="${esc(stroke.id)}" points="${points.map((p) => `${Number(p.x)},${Number(p.y)}`).join(' ')}" fill="none" stroke="${style.color}" stroke-width="${style.width}" opacity="${style.opacity}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
}
export function visibleSketches(p, s) {
  if (s.mode !== 'elevation')
    return (p.strokes || [])
      .filter((st) => st.floorId === s.floorId)
      .map((stroke) => ({ stroke, points: stroke.points }));
  const f = faceFrame(p, s);
  if (!f) return [];
  return (p.faceSketches || [])
    .filter(
      (st) =>
        st.floorId === f.floorId && st.roomId === f.roomId && st.wallId === f.wallId && st.side === f.side,
    )
    .map((stroke) => ({
      stroke,
      points: stroke.points.map((v) => ({ x: f.reverse ? f.length - v.x : v.x, y: -v.y })),
    }));
}
export function addSketch(p, s, points, settings) {
  const opts = inkSettings(settings),
    path = brushPath(points, opts.shape);
  if (path.length < 2) return null;
  const pvals = points.map((v) => v.pressure).filter((v) => Number.isFinite(v) && v > 0 && v <= 1);
  const pressure =
    opts.brush === 'pencil' && pvals.length ? 0.45 + pvals.reduce((a, b) => a + b, 0) / pvals.length : 1;
  const item = {
    id: uid(),
    floorId: s.floorId,
    roomId: s.roomId || null,
    brush: opts.brush,
    shape: opts.shape,
    color: opts.color,
    width: Math.round(opts.width * pressure * (opts.brush === 'marker' ? 2.6 : 1)),
    opacity: opts.brush === 'marker' ? 0.42 : opts.brush === 'pencil' ? 0.78 : 1,
    date: new Date().toISOString(),
  };
  if (s.mode === 'elevation') {
    const f = faceFrame(p, s);
    if (!f) throw Error('Önce çizmek istediğiniz duvarı seçin.');
    if (path.some((v) => v.x < -0.5 || v.x > f.length + 0.5 || v.y > 0.5))
      throw Error('Mobilya eskizini duvarın iki ucu arasında ve döşemenin üzerinde çizin.');
    Object.assign(item, {
      floorId: f.floorId,
      roomId: f.roomId,
      wallId: f.wallId,
      side: f.side,
      points: path.map((v) => ({
        x: Math.min(f.length, Math.max(0, f.reverse ? f.length - v.x : v.x)),
        y: Math.max(0, -v.y),
      })),
    });
    (p.faceSketches ??= []).push(item);
  } else {
    item.points = path;
    p.strokes.push(item);
  }
  return item;
}
function pointDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy,
    t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function segmentDistance(a, b, c, d) {
  const cross = (u, v, w) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b),
  );
}
export function hitSketches(p, s, eraser, radius) {
  if (!eraser.length) return [];
  const path = eraser.length === 1 ? [eraser[0], eraser[0]] : eraser;
  return visibleSketches(p, s)
    .filter(({ stroke, points }) => {
      const threshold = radius + inkStyle(stroke).width / 2;
      return points.some(
        (a, i) =>
          i > 0 &&
          path.some((b, j) => j > 0 && segmentDistance(points[i - 1], a, path[j - 1], b) <= threshold),
      );
    })
    .map((x) => x.stroke.id);
}
