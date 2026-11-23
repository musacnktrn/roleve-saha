/** [codex] ureten: codex. Distances and coordinates use millimetres. Positive plan y points down. */
export const EPS = 0.00001;
export class UnresolvedGeometry extends Error {}
const scale = { mm: 1, cm: 10, m: 1000 };
const formats = new Map();
export function finite(value, label = 'Değer') {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(label + ' sonlu bir sayı olmalı.');
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER)
    throw new Error(label + ' işlenebilen sayı aralığını aşıyor.');
  return value;
}
export function positive(value, label = 'Uzunluk') {
  if (finite(value, label) <= 0) throw new Error(label + ' sıfırdan büyük olmalı.');
  return value;
}
export function parseLength(raw, unit = 'm') {
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error('Bir ölçü girin.');
  const parts = String(raw)
    .trim()
    .match(/^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*(mm|cm|m)?$/i);
  if (!parts || !Object.hasOwn(scale, unit)) throw new Error('Geçerli bir uzunluk girin (ör. 4,285 m).');
  return finite(Number(parts[1].replace(',', '.')) * scale[parts[2]?.toLowerCase() || unit]);
}
export function formatLength(mm, unit = 'm') {
  finite(mm);
  if (!Object.hasOwn(scale, unit)) throw new Error('Birim m, cm veya mm olmalı.');
  if (!formats.has(unit))
    formats.set(
      unit,
      new Intl.NumberFormat('tr-TR', {
        useGrouping: false,
        maximumFractionDigits: unit === 'm' ? 6 : unit === 'cm' ? 4 : 3,
      })
    );
  return formats.get(unit).format(mm / scale[unit]);
}
export function entity(list, id, label = 'Öğe') {
  const item = list.find((row) => row.id === id);
  if (!item) throw new Error(label + ' bu projede bulunamadı.');
  return item;
}
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function signedArea(points) {
  // Shift origin before the shoelace sum for a small room far from the project origin.
  return points.slice(1, -1).reduce((sum, p, i) => sum + cross(points[0], p, points[i + 2]) / 2, 0);
}
function onSegment(a, b, p) {
  return (
    Math.abs(cross(a, b, p)) <= EPS * Math.max(1, dist(a, b)) &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}
function intersects(a, b, c, d) {
  // Fast rejection matters when validating a surveyed outline with many points.
  if (
    Math.max(a.x, b.x) + EPS < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) + EPS < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) + EPS < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) + EPS < Math.min(a.y, b.y)
  )
    return false;
  return (
    (Math.sign(cross(a, b, c)) !== Math.sign(cross(a, b, d)) &&
      Math.sign(cross(c, d, a)) !== Math.sign(cross(c, d, b))) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}
export function assertPolygon(points, label = 'Plan') {
  if (!Array.isArray(points) || points.length < 3 || points.length > 1024)
    throw new Error(label + ' 3–1024 köşe gerektirir.');
  for (const p of points) {
    finite(p.x, 'X');
    finite(p.y, 'Y');
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (dist(a, b) < 0.1) throw new Error(label + ' çakışan köşe içeriyor.');
    const prev = points[(i - 1 + points.length) % points.length];
    if (onSegment(a, b, prev) || onSegment(prev, a, b))
      throw new Error(label + ' kendi kenarına geri dönüyor.');
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length]))
        throw new Error(label + ' kendi üzerine kesişiyor.');
    }
  }
  if (Math.abs(signedArea(points)) < 0.01) throw new Error(label + ' kapalı bir alan içermeli.');
}
export function insidePolygon(point, polygon) {
  let contained = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (onSegment(a, b, point)) return true;
    if (a.y > point.y !== b.y > point.y && point.x < a.x + ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y))
      contained = !contained;
  }
  return contained;
}
export function wallEnds(p, id) {
  const w = entity(p.walls, id, 'Duvar');
  return [entity(p.nodes, w.a, 'Başlangıç noktası'), entity(p.nodes, w.b, 'Bitiş noktası')];
}
export const wallLength = (p, id) => dist(...wallEnds(p, id));
export function roomPoints(p, id) {
  const r = entity(p.rooms, id, 'Oda');
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  return r.nodeIds.map((key) => {
    const n = byId.get(key);
    if (!n) throw new Error('Oda köşesi eksik.');
    return n;
  });
}
export const roomArea = (p, id) => Math.abs(signedArea(roomPoints(p, id)));
export function projectPointToWall(p, point, wallId, clamp = true) {
  const [a, b] = wallEnds(p, wallId);
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t0 = ((finite(point.x) - a.x) * dx + (finite(point.y) - a.y) * dy) / (dx * dx + dy * dy);
  const t = clamp ? Math.max(0, Math.min(1, t0)) : t0;
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}
function pointOnFace(p, w, t, side, roomId) {
  if (t < -EPS || t > 1 + EPS) throw new Error('Ölçü ucu duvarın dışında.');
  const [a, b] = wallEnds(p, w.id);
  const x = a.x + t * (b.x - a.x),
    y = a.y + t * (b.y - a.y);
  if (!side || (side === 'axis' && w.reference === 'axis')) return { x, y };
  if (!['inside', 'outside', 'axis'].includes(side)) throw new Error('Duvar yüzü geçersiz.');
  const referenceRoom =
    p.rooms.find((r) => r.id === w.referenceRoomId) || p.rooms.find((r) => r.wallIds.includes(w.id));
  if (!referenceRoom) throw new Error('Duvarın bakış odası eksik.');
  const idx = referenceRoom.wallIds.indexOf(w.id);
  const targetRoom = roomId ? entity(p.rooms, roomId, 'Bakış odası') : referenceRoom;
  if (!targetRoom.wallIds.includes(w.id)) throw new Error('Ölçü yüzü bu odaya ait değil.');
  const sameRoom = targetRoom.id === referenceRoom.id;
  let fraction = side === 'axis' ? 0.5 : Number(side === 'outside' ? sameRoom : !sameRoom);
  if (w.reference === 'axis') fraction -= 0.5;
  if (!fraction) return { x, y };
  if (!Number.isFinite(w.thickness)) throw new UnresolvedGeometry('Bu yüz için duvar kalınlığını girin.');
  const sense =
    (referenceRoom.nodeIds[idx] === w.a ? 1 : -1) * Math.sign(signedArea(roomPoints(p, referenceRoom.id)));
  const d = dist(a, b);
  return {
    x: x + ((b.y - a.y) * sense * w.thickness * fraction) / d,
    y: y - ((b.x - a.x) * sense * w.thickness * fraction) / d,
  };
}
/** Portions of a room's interior wall face touched by a zone, measured from wall.a in mm. */
export function wallInteriorSpans(p, roomId, wallId, ring) {
  const room = entity(p.rooms, roomId, 'Mahal');
  const wall = entity(p.walls, wallId, 'Duvar');
  const wallIndex = room.wallIds.indexOf(wallId);
  if (wallIndex < 0) throw new Error('Bu duvar seçili mahale ait değil.');
  let a, b;
  try {
    a = pointOnFace(p, wall, 0, 'inside', roomId);
    b = pointOnFace(p, wall, 1, 'inside', roomId);
  } catch (error) {
    if (error instanceof UnresolvedGeometry) return [];
    throw error;
  }
  const size = dist(a, b), dx = (b.x - a.x) / size, dy = (b.y - a.y) / size;
  const inward = Math.sign(signedArea(roomPoints(p, roomId))) * (room.nodeIds[wallIndex] === wall.a ? 1 : -1);
  const winding = Math.sign(signedArea(ring));
  const relative = ring.map(pt => ({u:(pt.x-a.x)*dx+(pt.y-a.y)*dy, v:(pt.y-a.y)*dx-(pt.x-a.x)*dy}));
  const cuts = [0,size], edges = [];
  const add = u => { if (u > EPS && u < size-EPS) cuts.push(u); };
  for (let i=0; i<relative.length; i++) {
    const c=relative[i], d=relative[(i+1)%relative.length];
    if (Math.abs(c.v) <= EPS) add(c.u);
    if (Math.abs(c.v) <= EPS && Math.abs(d.v) <= EPS) {
      edges.push({from:Math.min(c.u,d.u),to:Math.max(c.u,d.u),intoRoom:winding*Math.sign(d.u-c.u)===inward});
    } else if (c.v*d.v < 0) {
      add(c.u+(d.u-c.u)*c.v/(c.v-d.v));
    }
  }
  cuts.sort((x,y)=>x-y);
  const spans = [];
  for (let i=1; i<cuts.length; i++) {
    const from=cuts[i-1], to=cuts[i];
    if (to-from <= EPS) continue;
    const mid=(from+to)/2;
    const edge=edges.find(e=>e.from<=mid && mid<=e.to);
    if (!(edge ? edge.intoRoom : insidePolygon({x:a.x+dx*mid,y:a.y+dy*mid},ring))) continue;
    const previous=spans.at(-1);
    if (previous && from-previous[1] <= EPS) previous[1]=to;
    else spans.push([from,to]);
  }
  return spans;
}
export function assertAnchorReference(p, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Ölçü için iki uç seçin.');
  const references = [a.nodeId, a.wallId, a.elementId].filter((id) => id != null);
  if (references.length > 1) throw new Error('Ölçü ucu birden fazla öğeye bağlanmış.');
  let floorId;
  if (a.nodeId != null) floorId = entity(p.nodes, a.nodeId, 'Ölçü köşesi').floorId;
  else if (a.wallId != null || a.elementId != null) {
    const e = a.elementId != null ? entity(p.elements, a.elementId, 'Ölçü öğesi') : null;
    const w = entity(p.walls, e ? e.wallId : a.wallId, 'Ölçü duvarı');
    if (!e && (finite(a.t, 'Duvar üzerindeki konum') < -EPS || a.t > 1 + EPS))
      throw new Error('Ölçü ucu duvar sınırı dışında.');
    if (e && a.at != null && !['start', 'end', 'center'].includes(a.at))
      throw new Error('Öğe ucu geçersiz.');
    if (a.side != null && !['inside', 'outside', 'axis'].includes(a.side))
      throw new Error('Ölçü yüzü geçersiz.');
    if (a.roomId && !entity(p.rooms, a.roomId, 'Ölçü odası').wallIds.includes(w.id))
      throw new Error('Ölçü yüzü bu odaya ait değil.');
    floorId = w.floorId;
  } else {
    finite(a.x, 'Ölçü ucu X');
    finite(a.y, 'Ölçü ucu Y');
  }
  if (a.floorId != null) {
    entity(p.floors, a.floorId, 'Ölçü katı');
    if (floorId && a.floorId !== floorId) throw new Error('Ölçü ucu başka katta.');
  }
  if (a.z != null) finite(a.z, 'Ölçü kotu');
}
export function resolveAnchor(p, anchor) {
  assertAnchorReference(p, anchor);
  let point,
    floorId = anchor.floorId,
    localHeight = 0;
  if (anchor.nodeId) {
    const n = entity(p.nodes, anchor.nodeId, 'Ölçü köşesi');
    point = { x: n.x, y: n.y };
    floorId = n.floorId;
  } else if (anchor.wallId) {
    const w = entity(p.walls, anchor.wallId, 'Ölçü duvarı');
    point = pointOnFace(p, w, finite(anchor.t, 'Duvar üzerindeki konum'), anchor.side, anchor.roomId);
    floorId = w.floorId;
  } else if (anchor.elementId) {
    const e = entity(p.elements, anchor.elementId, 'Ölçü öğesi');
    const w = entity(p.walls, e.wallId, 'Öğe duvarı');
    const at = { start: 0, center: 0.5, end: 1 }[anchor.at || 'center'];
    if (at == null) throw new Error('Öğe ucu geçersiz.');
    point = pointOnFace(
      p,
      w,
      (e.offset + at * e.width) / wallLength(p, w.id),
      anchor.side || e.side,
      anchor.roomId || e.roomId
    );
    floorId = w.floorId;
    if (e.sill == null || (anchor.vertical === 'top' && e.height == null)) localHeight = null;
    else localHeight = e.sill + (anchor.vertical === 'top' ? e.height : 0);
  } else point = { x: finite(anchor.x, 'Ölçü ucu X'), y: finite(anchor.y, 'Ölçü ucu Y') };
  if (anchor.z != null) point.z = finite(anchor.z, 'Ölçü kotu');
  else if (floorId && localHeight != null && !anchor.unmeasuredZ)
    point.z = entity(p.floors, floorId, 'Kat').elevation + localHeight;
  return point;
}
export function measure(p, a, b, kind = 'spatial') {
  const from = resolveAnchor(p, a);
  if (kind === 'perpendicular' && b?.wallId) {
    const start = resolveAnchor(p, { ...b, t: 0 }),
      end = resolveAnchor(p, { ...b, t: 1 });
    return Math.abs(cross(start, end, from)) / dist(start, end);
  }
  const to = resolveAnchor(p, b),
    plan = dist(from, to);
  if (['vertical', 'spatial', 'slope', '3d', 'elevation', 'level'].includes(kind)) {
    if (from.z == null || to.z == null)
      throw new UnresolvedGeometry('Düşey ve eğik ölçü için iki kot gerekir.');
    if (kind === 'elevation' || kind === 'level') return to.z - from.z;
    return kind === 'vertical' ? Math.abs(to.z - from.z) : Math.hypot(plan, to.z - from.z);
  }
  if (kind === 'x') return Math.abs(to.x - from.x);
  if (kind === 'y') return Math.abs(to.y - from.y);
  return plan;
}
