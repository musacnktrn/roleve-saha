// [codex] ureten: codex
import { validateOpeningDetail } from '../openings/drawing.js';
import {
  assertAnchorReference,
  assertPolygon,
  UnresolvedGeometry,
  cross,
  dist,
  entity,
  EPS,
  finite,
  formatLength,
  insidePolygon,
  measure,
  parseLength,
  positive,
  resolveAnchor,
  roomPoints,
  signedArea,
  wallInteriorSpans,
  wallEnds,
  wallLength,
} from './measure.js';
export {
  assertPolygon,
  formatLength,
  parseLength,
  measure,
  resolveAnchor,
  roomPoints,
  roomArea,
  wallEnds,
  wallLength,
  projectPointToWall,
} from './measure.js';

const collections = [
  'floors',
  'nodes',
  'walls',
  'rooms',
  'elements',
  'zones',
  'observations',
  'notes',
  'visits',
  'strokes',
  'faceSketches',
  'underlays',
];
export function newId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return prefix + '-' + crypto.randomUUID();
  // randomUUID is restricted to secure contexts; getRandomValues also works on a local HTTP LAN.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return prefix + '-' + Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}
const clone = (value) => structuredClone(value);
const label = (s, fallback) => String(s ?? '').trim() || fallback;
export function createProject(name = 'Yeni proje') {
  const now = new Date().toISOString();
  const p = {
    schemaVersion: 1,
    id: newId('p'),
    name: label(name, 'Yeni proje'),
    location: '',
    createdAt: now,
    updatedAt: now,
    archived: false,
    unit: 'm',
    toleranceMm: 10,
  };
  for (const key of collections) p[key] = [];
  addFloor(p, { name: 'Zemin kat', elevation: 0 });
  return p;
}
export function addFloor(p, { name, elevation = 0 }) {
  const f = {
    id: newId('floor'),
    name: label(name, 'Kat ' + (p.floors.length + 1)),
    elevation: finite(elevation, 'Kat kotu'),
  };
  p.floors.push(f);
  return f;
}
export function templatePoints(type, width, depth, origin = { x: 0, y: 0 }) {
  positive(width, 'En');
  positive(depth, 'Boy');
  finite(origin.x);
  finite(origin.y);
  const key = String(type).trim().toLowerCase();
  const shapes = {
    rect: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    l: [
      [0, 0],
      [1, 0],
      [1, 0.5],
      [0.58, 0.5],
      [0.58, 1],
      [0, 1],
    ],
    u: [
      [0, 0],
      [0.28, 0],
      [0.28, 0.58],
      [0.72, 0.58],
      [0.72, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  };
  const base =
    shapes[
      [
        'rectangle',
        'dikdörtgen',
        'corridor',
        'koridor',
        'square',
        'rectangular',
        'rectangle-room',
      ].includes(key)
        ? 'rect'
        : key
    ];
  if (!base) throw new Error('Oda şablonunu seçin veya serbest köşeler girin.');
  return base.map(([x, y]) => ({ x: origin.x + x * width, y: origin.y + y * depth }));
}
function insertRoom(p, { floorId = p.floors[0]?.id, name, code, points, height = null }) {
  entity(p.floors, floorId, 'Kat');
  assertPolygon(points, 'Oda');
  if (height != null) positive(height, 'Tavan yüksekliği');
  const r = {
    id: newId('room'),
    floorId,
    name: label(name, 'Oda'),
    code: label(code, String(p.rooms.length + 1).padStart(2, '0')),
    height,
    nodeIds: [],
    wallIds: [],
  };
  const nodes = [],
    walls = [];
  for (const pt of points) {
    const match = p.nodes.find((n) => n.floorId === floorId && dist(n, pt) < EPS);
    const n = match || { id: newId('n'), floorId, x: pt.x, y: pt.y };
    if (!match) nodes.push(n);
    r.nodeIds.push(n.id);
  }
  for (let i = 0; i < r.nodeIds.length; i++) {
    const a = r.nodeIds[i],
      b = r.nodeIds[(i + 1) % r.nodeIds.length];
    const existing = p.walls.find(
      (w) => w.floorId === floorId && ((w.a === a && w.b === b) || (w.a === b && w.b === a))
    );
    if (existing && p.rooms.filter((room) => room.wallIds.includes(existing.id)).length >= 2)
      throw new Error('Bu duvarın iki yüzünde de bir oda var.');
    const w = existing || { id: newId('w'), floorId, a, b, thickness: null, referenceRoomId: r.id };
    if (!existing) walls.push(w);
    r.wallIds.push(w.id);
  }
  if (
    p.rooms.some(
      (room) =>
        room.floorId === floorId &&
        room.wallIds.length === r.wallIds.length &&
        r.wallIds.every((id) => room.wallIds.includes(id))
    )
  )
    throw new Error('Aynı sınırda bir oda zaten var.');
  p.nodes.push(...nodes);
  p.walls.push(...walls);
  p.rooms.push(r);
  return r;
}

/** Join coincident boundary segments even when a short room occupies just part of a long wall. */
export function addRoom(p, data) {
  const floorId = data.floorId || p.floors[0]?.id;
  const points = data.points;
  assertPolygon(points, 'Oda');
  const nodes = new Map(p.nodes.filter((n) => n.floorId === floorId).map((n) => [n.id, n]));
  const edges = p.walls.filter((w) => w.floorId === floorId);
  const cuts = new Map(),
    additions = points.map(() => []);
  function position(a, b, point) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (Math.abs(cross(a, b, point)) > EPS * length) return null;
    const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (length * length);
    return t > EPS / length && t < 1 - EPS / length ? t : null;
  }
  for (const w of edges) {
    const a = nodes.get(w.a),
      b = nodes.get(w.b);
    const length = dist(a, b);
    for (let i = 0; i < points.length; i++) {
      const u = points[i],
        v = points[(i + 1) % points.length];
      if (Math.abs(cross(a, b, u)) > EPS * length || Math.abs(cross(a, b, v)) > EPS * length) continue;
      for (const candidate of [u, v]) {
        const t = position(a, b, candidate);
        if (t !== null) {
          if (!cuts.has(w.id)) cuts.set(w.id, new Set());
          cuts.get(w.id).add(t);
        }
      }
      for (const candidate of [a, b]) {
        const t = position(u, v, candidate);
        if (t !== null && !additions[i].some((item) => dist(item.point, candidate) < EPS))
          additions[i].push({ t, point: candidate });
      }
    }
  }
  const ring = points.flatMap((pt, i) => [
    pt,
    ...additions[i].sort((a, b) => a.t - b.t).map((item) => item.point),
  ]);
  if (!cuts.size) return insertRoom(p, { ...data, floorId, points: ring });
  const result = editTopology(p, (q) => {
    for (const [id, list] of cuts) {
      let right = id,
        prev = 0;
      for (const t of [...list].sort((a, b) => a - b)) {
        right = splitWall(q, right, (t - prev) / (1 - prev)).rightId;
        prev = t;
      }
    }
    return insertRoom(q, { ...data, floorId, points: ring });
  });
  return entity(p.rooms, result.id, 'Oda');
}

/** Build, validate, then commit new geometry. A rejected edit leaves the supplied project intact. */
function editTopology(p, operation) {
  const draft = { ...p };
  const edited = ['rooms', 'nodes', 'walls', 'elements', 'observations', 'zones', 'notes', 'faceSketches'];
  for (const key of edited) draft[key] = (p[key] ?? []).map((item) => ({ ...item }));
  for (const room of draft.rooms) {
    room.nodeIds = room.nodeIds.slice();
    room.wallIds = room.wallIds.slice();
  }
  const result = operation(draft);
  validateProject(draft);
  const oldNodes = new Map(p.nodes.map((n) => [n.id, n])),
    newNodes = new Map(draft.nodes.map((n) => [n.id, n]));
  const newRooms = new Map(draft.rooms.map((r) => [r.id, r]));
  for (const room of p.rooms) {
    const next = newRooms.get(room.id);
    if (!next) continue;
    const before = signedArea(room.nodeIds.map((id) => oldNodes.get(id)));
    const after = signedArea(next.nodeIds.map((id) => newNodes.get(id)));
    if (Math.sign(before) !== Math.sign(after))
      throw new Error('Köşe hareketi odanın iç ve dış yüzünü ters çeviriyor.');
  }
  for (const key of edited) {
    // Retain live references to existing entities for the normal in-place API.
    const old = new Map((p[key] ?? []).map((row) => [row.id, row]));
    p[key] = draft[key].map((row) => (old.has(row.id) ? Object.assign(old.get(row.id), row) : row));
  }
  return result;
}
function checkLocks(p) {
  for (const w of p.walls) {
    if (w.locked && Math.abs(wallLength(p, w.id) - w.lockedLength) > 0.01)
      throw new Error('Düzenleme kilitli bir duvarın ölçüsünü değiştiriyor. Önce kilidini açın.');
  }
  for (const o of p.observations) {
    if (
      o.locked &&
      !p.observations.some((later) => later.replaces === o.id) &&
      Math.abs(measure(p, o.a, o.b, o.kind) - o.value) > (o.toleranceMm ?? p.toleranceMm)
    )
      throw new Error('Düzenleme kilitli bir kontrol ölçüsüyle çelişiyor.');
  }
}
export function setWallLock(p, wallId, locked = true) {
  const w = entity(p.walls, wallId, 'Duvar');
  w.locked = Boolean(locked);
  w.lockedLength = locked ? wallLength(p, wallId) : null;
  return w;
}
export function moveNode(p, id, point) {
  const x = finite(point.x),
    y = finite(point.y);
  return editTopology(p, (q) => {
    const n = entity(q.nodes, id, 'Köşe');
    if (n.locked && (Math.abs(n.x - x) > EPS || Math.abs(n.y - y) > EPS)) throw new Error('Köşe kilitli.');
    Object.assign(n, { x, y });
    checkLocks(q);
    return n;
  });
}
export function resizeWall(p, wallId, lengthMm, { fixed = 'a', lock, mode = 'orthogonal' } = {}) {
  positive(lengthMm);
  if (!['a', 'b'].includes(fixed)) throw new Error('Sabit ucu seçin.');
  return editTopology(p, (q) => {
    const w = entity(q.walls, wallId, 'Duvar'),
      [a, b] = wallEnds(q, wallId);
    const old = dist(a, b),
      stationary = fixed === 'a' ? a : b,
      moving = fixed === 'a' ? b : a;
    if (w.locked && Math.abs(lengthMm - old) > 0.01) throw new Error('Duvar kilitli.');
    const ux = (moving.x - stationary.x) / old,
      uy = (moving.y - stationary.y) / old;
    const queue = [moving.id],
      moved = new Set(queue);
    // Propagate the end to contiguous transverse edges to preserve square corners in orthogonal templates.
    if (mode === 'orthogonal') {
      const byId = new Map(q.nodes.map((n) => [n.id, n])),
        adjacent = new Map();
      for (const edge of q.walls) {
        if (edge.floorId !== w.floorId || edge.id === w.id) continue;
        const u = byId.get(edge.a),
          v = byId.get(edge.b);
        if (Math.abs((v.x - u.x) * ux + (v.y - u.y) * uy) > EPS * dist(u, v)) continue;
        for (const [i, j] of [
          [edge.a, edge.b],
          [edge.b, edge.a],
        ]) {
          if (!adjacent.has(i)) adjacent.set(i, []);
          adjacent.get(i).push(j);
        }
      }
      for (let i = 0; i < queue.length; i++)
        for (const neighbour of adjacent.get(queue[i]) || []) {
          if (!moved.has(neighbour)) {
            moved.add(neighbour);
            queue.push(neighbour);
          }
        }
    }
    if (moved.has(stationary.id)) throw new Error('Sabit uç da hareket ediyor. Nokta düzenleme kullanın.');
    const delta = lengthMm - old;
    for (const n of q.nodes)
      if (moved.has(n.id)) {
        if (n.locked && Math.abs(delta) > 0.01) throw new Error('Hareket edecek köşe kilitli.');
        n.x += delta * ux;
        n.y += delta * uy;
      }
    if (lock != null) setWallLock(q, wallId, lock);
    checkLocks(q);
    return {
      wallId,
      from: old,
      to: lengthMm,
      movedNodeIds: [...moved],
      roomIds: q.rooms.filter((r) => r.nodeIds.some((id) => moved.has(id))).map((r) => r.id),
    };
  });
}
export function addAdjacentRoom(p, { roomId, wallId, depth, name, code, height = null }) {
  positive(depth, 'Oda derinliği');
  const parent = entity(p.rooms, roomId, 'Oda'),
    i = parent.wallIds.indexOf(wallId);
  if (i < 0) throw new Error('Bu duvar seçili odaya ait değil.');
  if (p.rooms.some((r) => r.id !== roomId && r.wallIds.includes(wallId)))
    throw new Error('Ortak duvarın diğer tarafında oda var.');
  const ends = roomPoints(p, roomId),
    a = ends[i],
    b = ends[(i + 1) % ends.length],
    len = dist(a, b);
  const sign = Math.sign(signedArea(ends)),
    dx = ((b.y - a.y) / len) * depth * sign,
    dy = (-(b.x - a.x) / len) * depth * sign;
  const pts = [b, a, { x: a.x + dx, y: a.y + dy }, { x: b.x + dx, y: b.y + dy }];
  return addRoom(p, { floorId: parent.floorId, name, code, height, points: pts });
}
export function reshapeDiagonal(p, roomId, firstId, oppositeId, lengthMm) {
  positive(lengthMm, 'Diyagonal');
  return editTopology(p, (q) => {
    const r = entity(q.rooms, roomId, 'Oda'),
      idx = r.nodeIds.indexOf(firstId);
    if (r.nodeIds.length !== 4 || idx < 0 || r.nodeIds[(idx + 2) % 4] !== oppositeId)
      throw new Error('Dörtgenin karşılıklı iki köşesini seçin.');
    const pts = roomPoints(q, r.id),
      a = pts[idx],
      c = pts[(idx + 2) % 4],
      old = dist(a, c);
    const ux = (c.x - a.x) / old,
      uy = (c.y - a.y) / old;
    const shoulder = (pt) => {
      const aLen = dist(pt, a),
        cLen = dist(pt, c);
      if (lengthMm >= aLen + cLen - EPS || lengthMm <= Math.abs(aLen - cLen) + EPS)
        throw new Error('Diyagonal bu kenarlarla bir üçgen kapatmıyor.');
      const along = (aLen * aLen - cLen * cLen + lengthMm * lengthMm) / (2 * lengthMm);
      const normal = Math.sqrt(Math.max(0, aLen * aLen - along * along)) * Math.sign(cross(a, c, pt));
      return { x: a.x + along * ux - normal * uy, y: a.y + along * uy + normal * ux };
    };
    const b = pts[(idx + 1) % 4],
      d = pts[(idx + 3) % 4];
    const edits = [
      [b, shoulder(b)],
      [d, shoulder(d)],
      [c, { x: a.x + lengthMm * ux, y: a.y + lengthMm * uy }],
    ];
    for (const [n, pt] of edits) {
      if (n.locked && dist(n, pt) > 0.01) throw new Error('Köşe kilitli.');
      Object.assign(n, pt);
    }
    checkLocks(q);
    return r;
  });
}
const elementTypes = new Set([
  'door',
  'window',
  'socket',
  'niche',
  'column',
  'beam',
  'vent',
  'switch',
  'drain',
  'fixture',
  'shaft',
]);
const isOpening = (e) => e.type === 'door' || e.type === 'window';

/** Minimum surveyed underside touching a positive-length part of the opening span. */
export function openingLevels(p, e, roomId = e.roomId) {
  const room = entity(p.rooms, roomId, 'Açıklık mahali'),
    floor = entity(p.floors, room.floorId, 'Açıklık katı');
  if (!room.wallIds.includes(e.wallId)) throw new Error('Açıklık bu mahalin duvarında değil.');
  const sill = e.sill ?? null,
    head = sill != null && e.height != null ? sill + e.height : null;
  let ceiling = room.height ?? null, missingWallFace = false;
  const zones = p.zones.filter((z) => z.roomId === room.id && (z.type === 'ceiling' || z.type === 'beam'));
  if (zones.length && e.width > 0) {
    const length = wallLength(p, e.wallId), face = {wallId:e.wallId, roomId, side:'inside'};
    const point = (station) => resolveAnchor(p, {...face, t:station/length});
    try {
      point(0);
      for (const zone of zones) {
        for (const [from, to] of wallInteriorSpans(p, roomId, e.wallId, zone.points)) {
          const left = Math.max(e.offset, from), right = Math.min(e.offset + e.width, to);
          if (right - left <= EPS) continue;
          for (const end of [left, right]) {
            const h = zoneSurfaceAt(zone, point(end));
            if (h != null) ceiling = ceiling == null ? h : Math.min(ceiling, h);
          }
        }
      }
    } catch (error) {
      if (!(error instanceof UnresolvedGeometry)) throw error;
      missingWallFace = true;
    }
  }
  return {
    floorZ: floor.elevation, sill, head, ceiling,
    ...(missingWallFace ? { missingWallFace: true } : {}),
    sillZ: sill == null ? null : floor.elevation + sill,
    headZ: head == null ? null : floor.elevation + head,
    ceilingZ: ceiling == null ? null : floor.elevation + ceiling,
  };
}
function checkOpeningEdit(p, e) {
  if (!isOpening(e)) return;
  if (e.height != null) positive(e.height, 'Açıklık yüksekliği');
  const { head, ceiling } = openingLevels(p, e);
  if (head != null && ceiling != null && head > ceiling + EPS)
    throw new Error(
      'Lento kotu ölçülen tavan veya kiriş altını ' + formatLength(head - ceiling, 'mm') + ' mm aşıyor.'
    );
}
function flipDetail(strokes) {
  return strokes?.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((pt) => ({ ...pt, x: 1 - pt.x })),
  }));
}
function elementValid(p, e) {
  const r = entity(p.rooms, e.roomId, 'Öğe odası'),
    w = entity(p.walls, e.wallId, 'Öğe duvarı');
  if (!r.wallIds.includes(w.id)) throw new Error('Öğe duvarı ve oda sınırı uyumsuz.');
  if (e.floorId && e.floorId !== r.floorId) throw new Error('Öğe ve mahal katı uyuşmuyor.');
  if (!elementTypes.has(e.type)) throw new Error('Öğe türü geçersiz.');
  if (
    finite(e.offset, 'Duvara uzaklık') < -EPS ||
    finite(e.width, 'Öğe genişliği') < 0 ||
    e.offset + e.width > wallLength(p, w.id) + 0.01
  )
    throw new Error('Öğe duvar uzunluğuna sığmıyor.');
  if (['door', 'window'].includes(e.type)) positive(e.width, 'Açıklık genişliği');
  for (const key of ['height', 'depth'])
    if (e[key] != null && finite(e[key], key) < 0) throw new Error('Öğe boyutu negatif olamaz.');
  if (e.sill != null) finite(e.sill, 'Alt kot');
  if (e.side != null && !['inside', 'outside'].includes(e.side)) throw new Error('Öğe yüzü geçersiz.');
  if (e.hardware != null && (typeof e.hardware !== 'string' || e.hardware.length > 500))
    throw new Error('Donanım açıklaması en çok 500 karakter olabilir.');
  if (
    e.handleHeight != null &&
    (finite(e.handleHeight, 'Kol/mandal kotu') < 0 || (e.height != null && e.handleHeight > e.height + EPS))
  )
    throw new Error('Kol/mandal kotu eşik ile lento arasında olmalı.');
  validateOpeningDetail(e);
}
export function addElement(p, data) {
  const element = {
    name: label(data.name, 'Öğe'),
    width: 0,
    height: null,
    sill: null,
    depth: null,
    side: 'inside',
    ...clone(data),
    id: newId('e'),
  };
  elementValid(p, element);
  checkOpeningEdit(p, element);
  p.elements.push(element);
  return element;
}
export function updateElement(p, id, patch) {
  const existing = entity(p.elements, id, 'Öğe');
  const updated = { ...existing, ...clone(patch), id: existing.id, roomId: existing.roomId };
  elementValid(p, updated);
  const dimensions = ['wallId', 'type', 'offset', 'width', 'height', 'sill'];
  if (dimensions.some((key) => updated[key] !== existing[key])) checkOpeningEdit(p, updated);
  Object.assign(existing, updated);
  return existing;
}
const zoneTypes = new Set(['platform', 'ceiling', 'void', 'beam', 'stair']);
function zoneValid(p, z) {
  const room = entity(p.rooms, z.roomId, 'Bölge odası');
  if (z.floorId && z.floorId !== room.floorId) throw new Error('Bölge ve mahal katı uyuşmuyor.');
  if (!zoneTypes.has(z.type)) throw new Error('Bölge türü geçersiz.');
  if (z.targetZoneId) {
    const target = entity(p.zones, z.targetZoneId, 'Boşluğun döşemesi');
    if (z.type !== 'void' || target.type !== 'platform' || target.roomId !== room.id)
      throw new Error('Boşluğun hedefi aynı mahalde bir platform olmalı.');
  }
  assertPolygon(z.points, 'Bölge');
  for (const k of ['bottom', 'top']) if (z[k] != null) finite(z[k], 'Bölge kotu');
  if (z.top != null && z.bottom != null && z.top < z.bottom) throw new Error('Üst kot alt kotun altında.');
  if (z.slopePoints != null) {
    if (!Array.isArray(z.slopePoints) || z.slopePoints.length > 1024)
      throw new Error('Eğim noktaları geçersiz.');
    for (const pt of z.slopePoints) {
      finite(pt.x);
      finite(pt.y);
      finite(pt.z);
    }
    if (z.slopePoints.length >= 3) zoneSurfaceAt(z, z.points[0]);
  }
}
export function addZone(p, data) {
  const zone = { bottom: null, top: null, ...clone(data), id: newId('z') };
  zoneValid(p, zone);
  p.zones.push(zone);
  return zone;
}
function anchorsMatch(a, b) {
  // Measurements from unlike faces must not collapse even when their projected coordinates coincide.
  if (a.nodeId || b.nodeId) return a.nodeId === b.nodeId && a.z === b.z;
  if (a.wallId || b.wallId)
    return (
      a.wallId === b.wallId && a.t === b.t && a.side === b.side && a.roomId === b.roomId && a.z === b.z
    );
  if (a.elementId || b.elementId)
    return (
      a.elementId === b.elementId &&
      a.at === b.at &&
      a.vertical === b.vertical &&
      a.z === b.z &&
      a.side === b.side
    );
  return a.x === b.x && a.y === b.y && a.z === b.z && a.label === b.label && a.floorId === b.floorId;
}
export function addObservation(p, data) {
  const entered = String(data.raw ?? '').trim(),
    suffix = entered.match(/(mm|cm|m)$/i);
  const raw = suffix ? entered.slice(0, -suffix[1].length).trim() : entered,
    unit = suffix ? suffix[1].toLowerCase() : (data.unit ?? p.unit);
  const value = parseLength(raw, unit);
  if (value < 0 && !['elevation', 'level'].includes(data.kind)) throw new Error('Uzunluk negatif olamaz.');
  if (data.value != null && Math.abs(data.value - value) > 0.0001)
    throw new Error('Ham ölçü ve milimetre değeri farklı.');
  const o = {
    ...clone(data),
    id: newId('obs'),
    entered,
    raw,
    unit,
    value,
    date: data.date || new Date().toISOString(),
    method: label(data.method, 'manual'),
    kind: data.kind || 'distance',
  };
  const witness = (a) => {
    try {
      return resolveAnchor(p, a);
    } catch (error) {
      if (error instanceof UnresolvedGeometry) return null;
      throw error;
    }
  };
  const start = witness(o.a),
    end = witness(o.b);
  if (o.roomId) {
    const r = entity(p.rooms, o.roomId, 'Ölçü odası');
    o.floorId ??= r.floorId;
  }
  optionalParentChecks(p, o);
  if (o.replaces) entity(p.observations, o.replaces, 'Önceki ölçü');
  if (o.locked && Math.abs(measure(p, o.a, o.b, o.kind) - value) > (o.toleranceMm ?? p.toleranceMm))
    throw new Error('Kilitli ölçü mevcut geometriyle çelişiyor.');
  // Keep original geometry as a dated witness; later topology edits only rebind live anchors.
  o.witness = { a: start, b: end, sourceA: clone(o.a), sourceB: clone(o.b) };
  p.observations.push(o);
  return o;
}
export function chainClosure(p, observationIds, totalId) {
  if (
    !Array.isArray(observationIds) ||
    !observationIds.length ||
    new Set([...observationIds, totalId]).size !== observationIds.length + 1
  )
    throw new Error('Farklı parça ölçüleri ve toplamı seçin.');
  const list = observationIds.map((id) => entity(p.observations, id, 'Parça ölçüsü'));
  const total = entity(p.observations, totalId, 'Toplam ölçü');
  function walk(start) {
    let at = start;
    for (const o of list) {
      if (anchorsMatch(at, o.a)) at = o.b;
      else if (anchorsMatch(at, o.b)) at = o.a;
      else return null;
    }
    return at;
  }
  const endA = walk(total.a),
    endB = walk(total.b);
  if (!((endA && anchorsMatch(endA, total.b)) || (endB && anchorsMatch(endB, total.a))))
    throw new Error('Parçalar aynı uçlardan bağlanan kesintisiz bir zincir oluşturmuyor.');
  const sum = list.reduce((acc, o) => acc + o.value, 0),
    difference = total.value - sum;
  return {
    sum,
    total: total.value,
    difference,
    tolerance: p.toleranceMm,
    withinTolerance: Math.abs(difference) <= p.toleranceMm,
  };
}

// Walk the pen path in drawing order. A stroke may cross the cut many times;
// a separate run on each return avoids drawing a new segment along the wall seam.
function splitFaceSketch(sketch, cut, rightId) {
  const points = sketch.points,
    runs = [];
  function append(right, a, b, interpolated = false) {
    const prev = runs.at(-1);
    if (prev && prev.right === right) {
      prev.points.push(b);
      return;
    }
    const joint = prev ? { id: newId('seam'), interpolated } : null;
    if (prev) prev.end = joint;
    runs.push({ right, points: [a, b], start: joint, end: null });
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      ax = a.x - cut,
      bx = b.x - cut;
    if (ax * bx < 0) {
      const t = -ax / (bx - ax),
        mid = { x: cut, y: a.y + t * (b.y - a.y) };
      for (const key of ['pressure', 'tiltX', 'tiltY', 'time']) {
        if (Number.isFinite(a[key]) && Number.isFinite(b[key])) mid[key] = a[key] + t * (b[key] - a[key]);
      }
      append(ax > 0, a, mid);
      append(bx > 0, mid, b, true);
    } else {
      // A stroke exactly on the split belongs to the left, including a vertical segment.
      append(ax > 0 || bx > 0, a, b);
    }
  }
  if (!runs.length) runs.push({ right: points[0].x > cut, points });
  return runs.map((run, i) => ({
    ...sketch,
    id: i === 0 ? sketch.id : newId('ink'),
    wallId: run.right ? rightId : sketch.wallId,
    points: run.points.map((pt) => ({ ...pt, x: run.right ? pt.x - cut : pt.x })),
    ...(runs.length > 1
      ? {
          sourceSketchId: sketch.sourceSketchId ?? sketch.id,
          clipStart: i === 0 ? (sketch.clipStart ?? null) : run.start,
          clipEnd: i === runs.length - 1 ? (sketch.clipEnd ?? null) : run.end,
        }
      : {}),
  }));
}

function mergeFaceSketches(sketches, mappings, wallId) {
  const output = [];
  for (const stroke of sketches) {
    const m = mappings.get(stroke.wallId);
    if (!m) {
      output.push(stroke);
      continue;
    }
    const piece = {
      ...stroke,
      wallId,
      points: stroke.points.map((pt) => ({ ...pt, x: m.start + m.direction * pt.x })),
    };
    const prev = output.at(-1);
    const matching =
      prev?.clipEnd &&
      prev.clipEnd.id === piece.clipStart?.id &&
      prev.sourceSketchId === piece.sourceSketchId &&
      prev.wallId === piece.wallId &&
      ['floorId', 'roomId', 'side', 'shape', 'brush', 'color', 'opacity', 'width'].every(
        (key) => prev[key] === piece[key]
      ) &&
      dist(prev.points.at(-1), piece.points[0]) <= EPS;
    if (!matching) {
      output.push(piece);
      continue;
    }
    // Remove the temporary intersection only if both surviving neighbours still trace its segment.
    const before = prev.points.at(-2),
      join = piece.points[0],
      after = piece.points[1];
    const redundant =
      prev.clipEnd.interpolated &&
      before &&
      after &&
      Math.abs(dist(before, join) + dist(join, after) - dist(before, after)) < EPS;
    if (redundant) prev.points.pop();
    for (let i = 1; i < piece.points.length; i++) prev.points.push(piece.points[i]);
    prev.clipEnd = piece.clipEnd ?? null;
  }
  return output;
}

function splitBindings(p, old, left, right, t, midId, length) {
  const childAt = (position) =>
    position <= t ? { w: left, t: position / t } : { w: right, t: (position - t) / (1 - t) };
  const anchor = (a) => {
    if (!a || a.wallId !== old.id) return a;
    const child = childAt(a.t);
    return { ...a, wallId: child.w.id, t: child.t };
  };
  const [start, end] = [old.a, old.b].map((id) => entity(p.nodes, id));
  function notePoint(a) {
    if (a?.wallId !== old.id || a.t != null || !Number.isFinite(a.x) || !Number.isFinite(a.y))
      return anchor(a);
    const projection =
      ((a.x - start.x) * (end.x - start.x) + (a.y - start.y) * (end.y - start.y)) / (length * length);
    const child = childAt(Math.max(0, Math.min(1, projection)));
    return { ...a, wallId: child.w.id };
  }
  for (const o of p.observations) {
    o.a = anchor(o.a);
    o.b = anchor(o.b);
    if (o.wallId === old.id && o.a?.wallId === o.b?.wallId && o.a?.wallId) o.wallId = o.a.wallId;
    else if (o.wallId === old.id) {
      o.wallId = null;
      o.formerWallId = old.id;
    }
  }
  for (const note of p.notes) {
    const anchoredT = note.anchor?.wallId === old.id ? note.anchor.t : null;
    if (note.anchor) note.anchor = notePoint(note.anchor);
    if (note.target) note.target = notePoint(note.target);
    if (note.rebind?.wallIds?.includes(old.id))
      note.rebind = {
        ...note.rebind,
        wallIds: [
          ...new Set(note.rebind.wallIds.flatMap((id) => (id === old.id ? [left.id, right.id] : [id]))),
        ],
      };
    if (note.wallId !== old.id) continue;
    const position = note.t ?? anchoredT ?? (Number.isFinite(note.offset) ? note.offset / length : null);
    if (position == null) {
      note.wallId = null;
      note.rebind = { reason: 'Duvar bölündü', wallIds: [left.id, right.id], previousStatus: note.status };
      note.status = 'open';
    } else {
      const child = childAt(position);
      note.wallId = child.w.id;
      if (note.t != null) note.t = child.t;
      if (note.offset != null && child.w.id === right.id) note.offset -= t * length;
    }
  }
  for (const r of p.rooms) {
    const idx = r.wallIds.indexOf(old.id);
    if (idx < 0) continue;
    const ids = r.nodeIds[idx] === old.a ? [left.id, right.id] : [right.id, left.id];
    r.nodeIds.splice(idx + 1, 0, midId);
    r.wallIds.splice(idx, 1, ...ids);
  }
}
export function splitWall(p, wallId, t = 0.5) {
  finite(t);
  if (t <= EPS || t >= 1 - EPS) throw new Error('Bölme noktası iki ucun arasında olmalı.');
  return editTopology(p, (q) => {
    const w = entity(q.walls, wallId, 'Duvar'),
      old = { ...w },
      [a, b] = wallEnds(q, wallId),
      length = dist(a, b),
      cut = t * length;
    if (w.locked) throw new Error('Duvar kilitli.');
    const mid = { id: newId('n'), floorId: w.floorId, x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    const against = q.nodes.find((n) => n.floorId === w.floorId && dist(mid, n) < EPS);
    const midId = against?.id || mid.id;
    if (!against) q.nodes.push(mid);
    const right = { ...w, id: newId('w'), a: midId, b: old.b };
    w.b = midId;
    q.walls.push(right);
    for (const e of q.elements.filter((el) => el.wallId === wallId)) {
      if (e.offset < cut - EPS && e.offset + e.width > cut + EPS)
        throw new Error('Bölme noktası bir açıklık/öğe içinden geçiyor.');
      if (e.offset >= cut - EPS) {
        e.wallId = right.id;
        e.offset = Math.max(0, e.offset - cut);
      }
    }
    splitBindings(q, old, w, right, t, midId, length);
    q.faceSketches = q.faceSketches.flatMap((stroke) =>
      stroke.wallId === old.id ? splitFaceSketch(stroke, cut, right.id) : [stroke]
    );
    return { leftId: w.id, rightId: right.id, nodeId: midId };
  });
}
export function mergeWalls(p, firstWallId, secondWallId) {
  if (firstWallId === secondWallId) throw new Error('İki farklı duvar seçin.');
  return editTopology(p, (q) => {
    const first = entity(q.walls, firstWallId, 'İlk duvar'),
      second = entity(q.walls, secondWallId, 'İkinci duvar');
    const shared = [first.a, first.b].find((id) => id === second.a || id === second.b);
    if (!shared || first.floorId !== second.floorId) throw new Error('Duvarlar ortak köşede buluşmalı.');
    if (first.locked || second.locked) throw new Error('Birleşecek duvar kilitli.');
    const joint = entity(q.nodes, shared);
    if (
      joint.locked ||
      q.walls.some((w) => w.id !== first.id && w.id !== second.id && (w.a === shared || w.b === shared))
    )
      throw new Error('Ortak köşe başka bir bağlantı veya kilit taşıyor.');
    if (
      first.thickness !== second.thickness ||
      (first.reference || 'face') !== (second.reference || 'face')
    )
      throw new Error('Duvar kalınlıkları veya referans yüzleri uyuşmuyor.');
    const owners = q.rooms.filter((r) => r.wallIds.includes(first.id) || r.wallIds.includes(second.id));
    if (owners.some((r) => !r.wallIds.includes(first.id) || !r.wallIds.includes(second.id)))
      throw new Error('Birleştirme farklı oda sınırlarını ayırıyor.');
    const [u, v] = wallEnds(q, first.id),
      [c, d] = wallEnds(q, second.id),
      len = dist(u, v),
      ux = (v.x - u.x) / len,
      uy = (v.y - u.y) / len;
    if (Math.max(Math.abs(cross(u, v, c)), Math.abs(cross(u, v, d))) / len > 0.01)
      throw new Error('Duvarlar aynı doğrultuda olmalı.');
    const scalar = (pt) => (pt.x - u.x) * ux + (pt.y - u.y) * uy;
    const far = second.a === shared ? d : c,
      newA = first.a === shared ? far : u,
      newB = first.b === shared ? far : v;
    const start = scalar(newA),
      newLength = scalar(newB) - start;
    if (newLength <= len + EPS) throw new Error('Duvarlar üst üste geliyor.');
    const mappings = new Map([
      [first.id, { start: -start, direction: 1, length: len }],
      [
        second.id,
        { start: scalar(c) - start, direction: Math.sign(scalar(d) - scalar(c)), length: dist(c, d) },
      ],
    ]);
    const remap = (id, t) => {
      const m = mappings.get(id);
      return (m.start + m.direction * t * m.length) / newLength;
    };
    const anchor = (a) => {
      if (!a) return a;
      if (a.nodeId === shared) {
        const { nodeId, ...rest } = a;
        return { ...rest, wallId: first.id, t: (scalar(joint) - start) / newLength };
      }
      if (!mappings.has(a.wallId)) return a;
      if (a.t == null && Number.isFinite(a.x) && Number.isFinite(a.y)) return { ...a, wallId: first.id };
      return { ...a, wallId: first.id, t: remap(a.wallId, a.t) };
    };
    for (const e of q.elements) {
      const m = mappings.get(e.wallId);
      if (!m) continue;
      e.offset = m.start + (m.direction === 1 ? e.offset : -e.offset - e.width);
      if (m.direction === -1) {
        if (e.swing) e.reversedAlongWall = !e.reversedAlongWall;
        if (e.detailStrokes?.length) e.detailStrokes = flipDetail(e.detailStrokes);
      }
      e.wallId = first.id;
    }
    for (const o of q.observations) {
      o.a = anchor(o.a);
      o.b = anchor(o.b);
      if (mappings.has(o.wallId)) o.wallId = first.id;
    }
    for (const n of q.notes) {
      if (n.anchor) n.anchor = anchor(n.anchor);
      if (n.target) n.target = anchor(n.target);
      if (n.rebind?.wallIds?.length === 2 && n.rebind.wallIds.every((id) => mappings.has(id))) {
        n.wallId = first.id;
        n.status = n.rebind.previousStatus || n.status;
        n.rebind = null;
      }
      const m = mappings.get(n.wallId);
      if (!m) continue;
      if (n.t != null) n.t = remap(n.wallId, n.t);
      if (n.offset != null) n.offset = m.start + m.direction * n.offset;
      n.wallId = first.id;
    }
    for (const r of owners) {
      const i = r.nodeIds.indexOf(shared);
      const oldIds = r.nodeIds.slice(),
        oldWalls = r.wallIds.slice();
      r.nodeIds.splice(i, 1);
      r.wallIds = r.nodeIds.map((id, idx) => {
        const oldIndex = oldIds.indexOf(id),
          next = r.nodeIds[(idx + 1) % r.nodeIds.length];
        return next === oldIds[(oldIndex + 1) % oldIds.length] ? oldWalls[oldIndex] : first.id;
      });
    }
    first.a = newA.id;
    first.b = newB.id;
    q.faceSketches = mergeFaceSketches(q.faceSketches, mappings, first.id);
    q.nodes = q.nodes.filter((n) => n.id !== shared);
    q.walls = q.walls.filter((w) => w.id !== second.id);
    return { wallId: first.id, removedWallId: second.id, removedNodeId: shared };
  });
}
function requireId(id, type = 'Kimlik') {
  if (typeof id !== 'string' || !id.trim() || id.length > 240) throw new Error(type + ' geçersiz.');
  return id;
}
function inspectJson(value, depth = 0) {
  if (depth > 30) throw new Error('Proje iç içe kayıt sınırını aşıyor.');
  if (typeof value === 'number') return finite(value);
  if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('Proje alan adı geçersiz.');
      inspectJson(item, depth + 1);
    }
}
function optionalParentChecks(p, obj) {
  const room = obj.roomId ? entity(p.rooms, obj.roomId, 'Oda bağı') : null;
  if (obj.floorId) {
    entity(p.floors, obj.floorId, 'Kat bağı');
    if (room && room.floorId !== obj.floorId) throw new Error('Oda ve kat bağı uyuşmuyor.');
  }
  if (obj.wallId) {
    const wall = entity(p.walls, obj.wallId, 'Duvar bağı');
    if (room && !room.wallIds.includes(wall.id)) throw new Error('Oda ve duvar bağı uyuşmuyor.');
    if (obj.floorId && wall.floorId !== obj.floorId) throw new Error('Kat ve duvar bağı uyuşmuyor.');
  }
}
function notePointValid(p, point) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    assertAnchorReference(p, point);
    return;
  }
  // A camera shot stores a world point and may also name the clicked room, element and wall as context.
  assertAnchorReference(p, { x: point.x, y: point.y, z: point.z, floorId: point.floorId });
  optionalParentChecks(p, point);
  if (point.elementId) {
    const e = entity(p.elements, point.elementId, 'Fotoğraf öğesi');
    if (point.wallId && point.wallId !== e.wallId) throw new Error('Fotoğraf öğesi ve duvarı uyuşmuyor.');
  }
  if (point.nodeId) entity(p.nodes, point.nodeId, 'Fotoğraf köşesi');
}

function faceSketchValid(p, sketch) {
  requireId(sketch.floorId, 'Görünüş katı');
  requireId(sketch.roomId, 'Görünüş mahali');
  requireId(sketch.wallId, 'Görünüş duvarı');
  optionalParentChecks(p, sketch);
  if (!['inside', 'outside'].includes(sketch.side)) throw new Error('Eskiz için iç veya dış yüz seçin.');
  if (!Array.isArray(sketch.points) || !sketch.points.length || sketch.points.length > 100000)
    throw new Error('Duvar görünüşü kalem izi geçersiz.');
  const length = wallLength(p, sketch.wallId);
  for (const pt of sketch.points) {
    if (finite(pt.x, 'Görünüş X') < -EPS || pt.x > length + EPS || finite(pt.y, 'Görünüş kotu') < -EPS)
      throw new Error('Görünüş eskizi duvarın iki ucu arasında ve döşemenin üzerinde olmalı.');
    if (pt.pressure != null && (finite(pt.pressure, 'Kalem basıncı') < 0 || pt.pressure > 1))
      throw new Error('Kalem basıncı 0–1 arasında olmalı.');
  }
  if (sketch.width != null) positive(sketch.width, 'Kalem kalınlığı');
  if (sketch.opacity != null && (finite(sketch.opacity, 'Opaklık') < 0 || sketch.opacity > 1))
    throw new Error('Kalem opaklığı 0–1 arasında olmalı.');
  if (sketch.color != null && (typeof sketch.color !== 'string' || !/^#[\da-f]{6}$/i.test(sketch.color)))
    throw new Error('Kalem rengi altı basamaklı renk kodu olmalı.');
  for (const key of ['brush', 'shape'])
    if (
      sketch[key] != null &&
      (typeof sketch[key] !== 'string' || !/^[a-z][a-z\d_-]{0,39}$/i.test(sketch[key]))
    )
      throw new Error('Eskiz kalemi veya şekli geçersiz.');
  if (sketch.sourceSketchId != null) requireId(sketch.sourceSketchId, 'Özgün iz kimliği');
  for (const joint of [sketch.clipStart, sketch.clipEnd])
    if (joint != null) {
      requireId(joint.id, 'Eskiz birleşim kimliği');
      if (typeof joint.interpolated !== 'boolean') throw new Error('Eskiz birleşim tanımı geçersiz.');
    }
}
export function validateProject(p) {
  if (!p || typeof p !== 'object' || p.schemaVersion !== 1) throw new Error('Desteklenmeyen proje sürümü.');
  inspectJson(p);
  requireId(p.id, 'Proje kimliği');
  if (typeof p.name !== 'string' || !p.name.trim()) throw new Error('Proje adı gerekli.');
  if (!['m', 'cm', 'mm'].includes(p.unit) || finite(p.toleranceMm, 'Tolerans') < 0)
    throw new Error('Birim veya tolerans geçersiz.');
  const ids = new Set(),
    maps = {};
  for (const key of collections) {
    const rows = key === 'faceSketches' && p[key] === undefined ? [] : p[key];
    if (!Array.isArray(rows) || rows.length > 100000) throw new Error(key + ' kayıt listesi geçersiz.');
    maps[key] = new Map();
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new Error('Proje kaydı geçersiz.');
      requireId(row.id);
      if (ids.has(row.id)) throw new Error('Yinelenen öğe kimliği.');
      ids.add(row.id);
      maps[key].set(row.id, row);
    }
  }
  if (!p.floors.length) throw new Error('En az bir kat gerekli.');
  for (const f of p.floors) finite(f.elevation, 'Kat kotu');
  for (const n of p.nodes) {
    if (!maps.floors.has(n.floorId)) throw new Error('Köşenin katı eksik.');
    finite(n.x);
    finite(n.y);
  }
  const pairs = new Set(),
    roomUse = new Map();
  for (const w of p.walls) {
    const a = maps.nodes.get(w.a),
      b = maps.nodes.get(w.b);
    if (!a || !b || a.floorId !== w.floorId || b.floorId !== w.floorId || dist(a, b) < 0.1)
      throw new Error('Duvarın iki geçerli kat noktası olmalı.');
    const pair = JSON.stringify([w.a, w.b].sort());
    if (pairs.has(pair)) throw new Error('Aynı uçlar iki farklı duvar oluşturuyor.');
    pairs.add(pair);
    if (w.thickness != null && finite(w.thickness, 'Duvar kalınlığı') < 0)
      throw new Error('Duvar kalınlığı negatif olamaz.');
    if (w.locked && Math.abs(dist(a, b) - positive(w.lockedLength, 'Kilitli duvar boyu')) > 0.01)
      throw new Error('Kilitli duvar boyu değişmiş.');
  }
  for (const r of p.rooms) {
    if (
      !maps.floors.has(r.floorId) ||
      !Array.isArray(r.nodeIds) ||
      !Array.isArray(r.wallIds) ||
      r.nodeIds.length !== r.wallIds.length ||
      new Set(r.wallIds).size !== r.wallIds.length
    )
      throw new Error('Oda çevrimi geçersiz.');
    if (r.height != null) positive(r.height, 'Tavan yüksekliği');
    const pts = r.nodeIds.map((id) => maps.nodes.get(id));
    if (!pts.every((n) => n && n.floorId === r.floorId)) throw new Error('Oda köşesi bu katta bulunamadı.');
    assertPolygon(pts, 'Oda');
    for (let i = 0; i < r.nodeIds.length; i++) {
      const a = r.nodeIds[i],
        b = r.nodeIds[(i + 1) % r.nodeIds.length],
        w = maps.walls.get(r.wallIds[i]);
      if (!w || w.floorId !== r.floorId || !((w.a === a && w.b === b) || (w.a === b && w.b === a)))
        throw new Error('Oda kenarı ile duvar uçları uyuşmuyor.');
      const rooms = roomUse.get(w.id) || [];
      rooms.push(r.id);
      roomUse.set(w.id, rooms);
    }
  }
  for (const w of p.walls) {
    const owners = roomUse.get(w.id) || [];
    if (owners.length > 2 || (w.referenceRoomId && !owners.includes(w.referenceRoomId)))
      throw new Error('Duvar yüz aidiyeti geçersiz.');
  }
  for (const e of p.elements) elementValid(p, e);
  for (const z of p.zones) zoneValid(p, z);
  for (const o of p.observations) {
    optionalParentChecks(p, o);
    assertAnchorReference(p, o.a);
    assertAnchorReference(p, o.b);
    finite(o.value, 'Ölçü');
    if (o.raw != null && Math.abs(parseLength(o.raw, o.unit) - o.value) > 0.0001)
      throw new Error('Ölçü değeri ile ham kayıt uyuşmuyor.');
    if (o.replaces && (!maps.observations.has(o.replaces) || o.replaces === o.id))
      throw new Error('Ölçü düzeltmesinin önceki kaydı bulunamadı.');
  }
  for (const n of p.notes) {
    optionalParentChecks(p, n);
    if (n.anchor) notePointValid(p, n.anchor);
    if (n.target) notePointValid(p, n.target);
    if (n.direction != null && (finite(n.direction, 'Bakış yönü') < 0 || n.direction >= 360))
      throw new Error('Bakış yönü 0–360° aralığında olmalı.');
  }
  for (const s of p.strokes) {
    optionalParentChecks(p, s);
    if (!Array.isArray(s.points)) throw new Error('Kalem izi geçersiz.');
    for (const pt of s.points) {
      finite(pt.x);
      finite(pt.y);
    }
  }
  for (const u of p.underlays) optionalParentChecks(p, u);
  for (const sketch of p.faceSketches ?? []) faceSketchValid(p, sketch);
  return p;
}
export function normalizeProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Proje dosyası geçersiz.');
  const p = clone(input);
  if (p.schemaVersion !== 1) throw new Error('Bu dosyanın proje sürümü desteklenmiyor.');
  // Early v1 drafts predate optional survey overlays and the measurements notebook.
  for (const key of [
    'elements',
    'zones',
    'observations',
    'notes',
    'visits',
    'strokes',
    'underlays',
    'faceSketches',
  ])
    if (p[key] === undefined) p[key] = [];
  p.unit ??= 'm';
  p.toleranceMm ??= 10;
  return validateProject(p);
}
export function projectChecks(p) {
  const roomsByWall = new Map();
  const out = [],
    replaced = new Set(p.observations.map((o) => o.replaces).filter(Boolean));
  for (const r of p.rooms) {
    for (const wallId of r.wallIds) {
      if (!roomsByWall.has(wallId)) roomsByWall.set(wallId, []);
      roomsByWall.get(wallId).push(r);
    }
    const base = { roomId: r.id, floorId: r.floorId, status: 'open' };
    if (r.height == null)
      out.push({
        ...base,
        id: 'height-' + r.id,
        kind: 'height',
        message: r.name + ' için tavan yüksekliği eksik.',
      });
    const obs = p.observations.filter((o) => o.roomId === r.id && !replaced.has(o.id));
    const checked = obs.some((o) => o.kind === 'diagonal' || o.kind === 'çapraz');
    if (r.nodeIds.length >= 4 && !checked)
      out.push({
        ...base,
        id: 'diagonal-' + r.id,
        kind: 'diagonal',
        message: r.name + ' için kontrol diyagonali eksik.',
      });
    for (const z of p.zones.filter((z) => z.roomId === r.id)) {
      if (z.type !== 'void' && (z.top == null || z.bottom == null))
        out.push({
          ...base,
          id: 'zone-' + z.id,
          kind: 'level',
          message: (z.name || 'Bölge') + ' için kot kontrolü gerekiyor.',
        });
      if (z.slopePoints?.length >= 4) {
        const plane = fitSlope(z.slopePoints);
        const residual = Math.max(...z.slopePoints.map((pt) => Math.abs(pt.z - plane(pt))));
        if (residual > p.toleranceMm)
          out.push({
            ...base,
            id: 'slope-' + z.id,
            kind: 'slope',
            status: 'conflict',
            difference: residual,
            message:
              (z.name || 'Eğimli tavan') +
              ' ölçüleri tek düzlemden ' +
              formatLength(residual, 'mm') +
              ' mm ayrılıyor.',
          });
      }
      if (z.points.some((pt) => !insidePolygon(pt, roomPoints(p, r.id))))
        out.push({
          ...base,
          id: 'outside-' + z.id,
          kind: 'zone',
          message: (z.name || 'Bölge') + ' oda sınırını aşıyor.',
        });
    }
  }
  const unresolvedFaces = new Set();
  for (const opening of p.elements.filter(isOpening)) {
    for (const room of roomsByWall.get(opening.wallId) || []) {
      const { head, ceiling, missingWallFace } = openingLevels(p, opening, room.id);
      const faceId = room.id + '-' + opening.wallId;
      if (missingWallFace && !unresolvedFaces.has(faceId)) {
        unresolvedFaces.add(faceId);
        out.push({
          id: 'opening-face-' + faceId, kind: 'opening-face', status: 'open',
          roomId: room.id, wallId: opening.wallId,
          message: 'Bu yüzde açıklıklarla kiriş ve tavan bölgelerini karşılaştırmak için duvar kalınlığını ölç.',
        });
      }
      if (head == null || ceiling == null || head <= ceiling + EPS) continue;
      out.push({
        id: 'opening-head-' + opening.id + (room.id === opening.roomId ? '' : '-' + room.id),
        roomId: room.id, wallId: opening.wallId, elementId: opening.id,
        kind: 'opening-head', status: 'conflict', difference: head - ceiling,
        message: opening.name + ' lentosu ' + room.name + ' tarafında tavan veya kiriş altını ' +
          formatLength(head - ceiling, 'mm') + ' mm aşıyor.',
      });
    }
  }
  for (const o of p.observations) {
    if (replaced.has(o.id)) continue;
    let expected;
    try {
      expected = measure(p, o.a, o.b, o.kind);
    } catch (error) {
      out.push({
        id: 'anchor-' + o.id,
        observationId: o.id,
        roomId: o.roomId,
        status: 'open',
        kind: 'anchor',
        message: error.message,
      });
      continue;
    }
    const difference = o.value - expected;
    if (Math.abs(difference) > (o.toleranceMm ?? p.toleranceMm))
      out.push({
        id: 'difference-' + o.id,
        kind: 'difference',
        status: 'conflict',
        roomId: o.roomId,
        wallId: o.wallId,
        observationId: o.id,
        difference,
        message:
          'Saha ölçüsü ve çizim arasında ' + formatLength(Math.abs(difference), 'mm') + ' mm fark var.',
      });
  }
  for (const n of p.notes)
    if (n.status === 'open')
      out.push({
        id: 'note-' + n.id,
        kind: 'note',
        status: 'open',
        roomId: n.roomId,
        wallId: n.wallId,
        noteId: n.id,
        message: n.text || 'Açık saha notu.',
      });
  return out;
}

function fitSlope(samples) {
  const mean = { x: 0, y: 0, z: 0 };
  for (const pt of samples)
    for (const key of ['x', 'y', 'z']) mean[key] += finite(pt[key]) / samples.length;
  let xx = 0,
    xy = 0,
    yy = 0,
    xz = 0,
    yz = 0;
  for (const pt of samples) {
    const x = pt.x - mean.x,
      y = pt.y - mean.y,
      z = pt.z - mean.z;
    xx += x * x;
    xy += x * y;
    yy += y * y;
    xz += x * z;
    yz += y * z;
  }
  const det = xx * yy - xy * xy;
  if (det <= Math.max(EPS * EPS, 1e-12 * xx * yy))
    throw new Error('Eğim için aynı doğru üzerinde olmayan üç nokta gerekir.');
  const slopeX = (xz * yy - yz * xy) / det,
    slopeY = (yz * xx - xz * xy) / det;
  return (pt) => mean.z + slopeX * (pt.x - mean.x) + slopeY * (pt.y - mean.y);
}
/** Least-squares underside using every sampled point in the floor datum. */
export function zoneSurfaceAt(zone, point, face = 'bottom') {
  const samples = zone.slopePoints;
  if (!samples?.length) return zone[face] ?? null;
  if (samples.length < 3) return null;
  const surface = fitSlope(samples)(point);
  return face === 'top'
    ? zone.top != null && zone.bottom != null
      ? surface + zone.top - zone.bottom
      : null
    : surface;
}
/** World z intervals at a plan position, including unknown top elevations. */
export function verticalProfile(p, roomId, point) {
  const r = entity(p.rooms, roomId, 'Oda'),
    floor = entity(p.floors, r.floorId, 'Kat');
  if (!insidePolygon(point, roomPoints(p, roomId))) throw new Error('Nokta odanın dışında.');
  let ceiling = r.height;
  const found = p.zones.filter((z) => z.roomId === roomId && insidePolygon(point, z.points));
  for (const z of found.filter((z) => z.type === 'ceiling' || z.type === 'beam')) {
    const h = zoneSurfaceAt(z, point);
    if (h != null) ceiling = ceiling == null ? h : Math.min(ceiling, h);
  }
  const holes = found.filter((z) => z.type === 'void');
  const intersectsLevel = (hole, level) =>
    level != null &&
    (hole.bottom == null || level >= hole.bottom - EPS) &&
    (hole.top == null || level <= hole.top + EPS);
  const floorOpen = holes.some((h) => !h.targetZoneId && intersectsLevel(h, 0));
  const platforms = found
    .filter(
      (z) =>
        z.type === 'platform' &&
        !holes.some((h) =>
          h.targetZoneId
            ? h.targetZoneId === z.id
            : intersectsLevel(h, z.top) || intersectsLevel(h, z.bottom)
        )
    )
    .map((z) => ({
      zoneId: z.id,
      bottom: z.bottom == null ? null : floor.elevation + z.bottom,
      top: z.top == null ? null : floor.elevation + z.top,
    }))
    .sort((a, b) => (a.bottom ?? Infinity) - (b.bottom ?? Infinity));
  const top = ceiling == null ? null : floor.elevation + ceiling;
  const clear = [];
  let base = floorOpen ? null : floor.elevation;
  for (const slab of platforms) {
    if (base != null && slab.bottom != null && slab.bottom >= base)
      clear.push({ bottom: base, top: slab.bottom, height: slab.bottom - base });
    base = slab.top;
  }
  if (top == null || base == null || top >= base)
    clear.push({ bottom: base, top, height: top != null && base != null ? top - base : null });
  return { floorZ: floor.elevation, floorOpen, ceilingZ: top, platforms, clear };
}
export function calibrateUnderlay(pixelA, pixelB, realLengthMm, worldA = { x: 0, y: 0 }, bearingRadians) {
  for (const pt of [pixelA, pixelB, worldA]) {
    finite(pt.x);
    finite(pt.y);
  }
  positive(realLengthMm, 'Kontrol uzunluğu');
  const px = dist(pixelA, pixelB);
  if (px < EPS) throw new Error('Kalibrasyon için iki farklı nokta seçin.');
  const segmentAngle = Math.atan2(pixelB.y - pixelA.y, pixelB.x - pixelA.x);
  const rotation = bearingRadians == null ? 0 : finite(bearingRadians, 'Yön') - segmentAngle;
  return {
    pixelA: { x: pixelA.x, y: pixelA.y },
    worldA: { x: worldA.x, y: worldA.y },
    rotation,
    mmPerPixel: realLengthMm / px,
  };
}
export function underlayPoint(cal, pixel) {
  const dx = finite(pixel.x) - cal.pixelA.x,
    dy = finite(pixel.y) - cal.pixelA.y,
    c = Math.cos(cal.rotation),
    s = Math.sin(cal.rotation);
  return {
    x: cal.worldA.x + (dx * c - dy * s) * cal.mmPerPixel,
    y: cal.worldA.y + (dx * s + dy * c) * cal.mmPerPixel,
  };
}
export function checkCalibration(cal, pixelA, pixelB, knownMm, toleranceMm) {
  positive(knownMm);
  if (finite(toleranceMm) < 0) throw new Error('Tolerans negatif olamaz.');
  const computed = dist(underlayPoint(cal, pixelA), underlayPoint(cal, pixelB)),
    difference = knownMm - computed;
  return { computed, known: knownMm, difference, withinTolerance: Math.abs(difference) <= toleranceMm };
}
export function duplicateRoom(
  p,
  roomId,
  { offset, angleDeg = 0, mirrorX = false, floorId, name, code } = {}
) {
  return editTopology(p, (q) => {
    const source = entity(q.rooms, roomId, 'Şablon oda'),
      points = roomPoints(q, roomId);
    const anchor = points[0],
      angle = (finite(angleDeg) * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const shift = offset || {
      x: Math.max(...points.map((n) => n.x)) - Math.min(...points.map((n) => n.x)) + 500,
      y: 0,
    };
    finite(shift.x);
    finite(shift.y);
    function transform(pt) {
      const dx = (pt.x - anchor.x) * (mirrorX ? -1 : 1),
        dy = pt.y - anchor.y;
      return { x: anchor.x + shift.x + dx * c - dy * s, y: anchor.y + shift.y + dx * s + dy * c };
    }
    // Snapshot the source before a coincident destination side splits an existing wall.
    const sides = source.wallIds.map((wallId) => ({
      wall: clone(entity(q.walls, wallId)),
      ends: wallEnds(q, wallId).map(transform),
      items: q.elements.filter((e) => e.roomId === roomId && e.wallId === wallId).map(clone),
    }));
    const zones = q.zones.filter((z) => z.roomId === roomId).map(clone);
    const copy = addRoom(q, {
      name: name || source.name + ' kopya',
      code,
      floorId: floorId || source.floorId,
      height: source.height,
      points: points.map(transform),
    });
    for (const {
      wall,
      ends: [start, end],
      items,
    } of sides) {
      const len = dist(start, end),
        dx = (end.x - start.x) / len,
        dy = (end.y - start.y) / len;
      const along = (pt) => (pt.x - start.x) * dx + (pt.y - start.y) * dy;
      const collinear = (pt) =>
        Math.abs(cross(start, end, pt)) <= EPS * len && along(pt) >= -EPS && along(pt) <= len + EPS;
      const pieces = [];
      for (const targetId of copy.wallIds) {
        const [a, b] = wallEnds(q, targetId);
        if (!collinear(a) || !collinear(b)) continue;
        const target = entity(q.walls, targetId);
        if (q.rooms.filter((r) => r.wallIds.includes(targetId)).length === 1)
          target.thickness = wall.thickness;
        pieces.push({ id: targetId, a: along(a), b: along(b) });
      }
      for (const el of items) {
        const piece = pieces.find(
          (t) => el.offset >= Math.min(t.a, t.b) - EPS && el.offset + el.width <= Math.max(t.a, t.b) + EPS
        );
        if (!piece) throw new Error('Kopya mahalde açıklık iki duvar parçasının üstüne geliyor.');
        const pos = piece.b > piece.a ? el.offset - piece.a : piece.a - el.offset - el.width;
        const reversed = piece.b < piece.a;
        // The transformed source wall direction already includes the room reflection.
        // Swap the normalized X only if the destination edge is stored in the opposite direction.
        const detail = el.detailStrokes?.map((stroke) => ({ ...stroke, id: newId('detail') }));
        addElement(q, {
          ...el,
          reversedAlongWall: Boolean(el.reversedAlongWall) !== reversed,
          ...(detail ? { detailStrokes: reversed ? flipDetail(detail) : detail } : {}),
          floorId: copy.floorId,
          roomId: copy.id,
          wallId: piece.id,
          offset: Math.max(0, pos),
          source: 'template',
        });
      }
    }
    const zoneIds = new Map();
    for (const z of zones.sort((a, b) => Number(!!a.targetZoneId) - Number(!!b.targetZoneId))) {
      const targetZoneId = z.targetZoneId ? zoneIds.get(z.targetZoneId) : null;
      const created = addZone(q, {
        ...z,
        targetZoneId,
        roomId: copy.id,
        floorId: copy.floorId,
        points: z.points.map(transform),
        slopePoints: z.slopePoints?.map((pt) => ({ ...transform(pt), z: pt.z })),
        source: 'template',
      });
      zoneIds.set(z.id, created.id);
    }
    copy.templateSourceId = roomId;
    return copy;
  });
}
/** Circle through chord endpoints with signed midpoint sagitta, for a measured curved wall. */
export function arcFromSagitta(p, wallId, sagitta, segments = 16) {
  const [a, b] = wallEnds(p, wallId),
    chord = dist(a, b),
    h = finite(sagitta, 'Yay yüksekliği');
  if (Math.abs(h) < EPS) throw new Error('Yay yüksekliği sıfır olamaz.');
  if (!Number.isInteger(segments) || segments < 2 || segments > 512)
    throw new Error('Yay örnek sayısı 2–512 olmalı.');
  const ux = (b.x - a.x) / chord,
    uy = (b.y - a.y) / chord,
    normal = { x: -uy, y: ux };
  const radius = (chord * chord) / (8 * Math.abs(h)) + Math.abs(h) / 2;
  const theta = 4 * Math.atan2(2 * Math.abs(h), chord);
  const centerOffset = h - Math.sign(h) * radius;
  const center = {
    x: (a.x + b.x) / 2 + normal.x * centerOffset,
    y: (a.y + b.y) / 2 + normal.y * centerOffset,
  };
  const start = Math.atan2(a.y - center.y, a.x - center.x),
    sweep = -Math.sign(h) * theta;
  const points = Array.from({ length: segments + 1 }, (_, i) => {
    if (i === 0) return { x: a.x, y: a.y };
    if (i === segments) return { x: b.x, y: b.y };
    const angle = start + (sweep * i) / segments;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
  return { wallId, chord, sagitta: h, radius, arcLength: radius * theta, center, points };
}

export function alignFloorXY(p, floorId, sourceA, sourceB, targetA, targetB) {
  for (const pt of [sourceA, sourceB, targetA, targetB]) {
    finite(pt.x);
    finite(pt.y);
  }
  const from = dist(sourceA, sourceB),
    to = dist(targetA, targetB);
  if (from < EPS || to < EPS) throw new Error('Her katta iki farklı referans noktası seçin.');
  if (Math.abs(from - to) > p.toleranceMm)
    throw new Error('Referanslar arası mesafeler proje toleransını aşıyor.');
  const angle =
    Math.atan2(targetB.y - targetA.y, targetB.x - targetA.x) -
    Math.atan2(sourceB.y - sourceA.y, sourceB.x - sourceA.x);
  const c = Math.cos(angle),
    s = Math.sin(angle),
    q = clone(p);
  const floor = entity(q.floors, floorId, 'Hizalanacak kat'),
    floorRooms = new Set(q.rooms.filter((r) => r.floorId === floorId).map((r) => r.id));
  function transform(pt) {
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
    const dx = pt.x - sourceA.x,
      dy = pt.y - sourceA.y;
    pt.x = targetA.x + dx * c - dy * s;
    pt.y = targetA.y + dx * s + dy * c;
  }
  const belongs = (row) => row.floorId === floorId || floorRooms.has(row.roomId);
  const degrees = (angle * 180) / Math.PI;
  const roundBearing = (value) => (Math.round((((value % 360) + 360) % 360) * 100) / 100) % 360;
  for (const n of q.nodes.filter(belongs)) transform(n);
  for (const z of q.zones.filter(belongs))
    for (const pt of [...z.points, ...(z.slopePoints || [])]) transform(pt);
  for (const e of q.elements.filter(belongs)) transform(e);
  for (const n of q.notes) {
    if (belongs(n)) transform(n);
    let moved = false;
    for (const pt of [n.anchor, n.target]) {
      if (!pt) continue;
      const pointFloor =
        pt.floorId ||
        (pt.wallId && q.walls.find((w) => w.id === pt.wallId)?.floorId) ||
        (pt.nodeId && q.nodes.find((v) => v.id === pt.nodeId)?.floorId);
      if (pointFloor ? pointFloor !== floorId : !belongs(n)) continue;
      // x/y represent the stored camera or target position even when it also names a clicked wall.
      transform(pt);
      moved = true;
    }
    if (!moved && !belongs(n)) continue;
    const current = (pt) => {
      if (!pt) return null;
      if (Number.isFinite(pt.x) && Number.isFinite(pt.y)) return pt;
      try {
        return resolveAnchor(q, pt);
      } catch (error) {
        if (error instanceof UnresolvedGeometry) return null;
        throw error;
      }
    };
    const a = current(n.anchor),
      b = current(n.target);
    if (a && b && dist(a, b) > EPS)
      n.direction = roundBearing((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI);
    else if (Number.isFinite(n.direction)) n.direction = roundBearing(n.direction + degrees);
  }
  for (const st of q.strokes.filter(belongs)) st.points.forEach(transform);
  for (const section of (q.sections ?? []).filter((s) => s.floorId === floorId)) {
    transform(section.a);
    transform(section.b);
  }
  for (const item of (q.furniture || []).filter(belongs)) {
    transform(item);
    item.rotation = (item.rotation || 0) + degrees;
  }
  for (const obs of q.observations)
    for (const end of [obs.a, obs.b]) {
      if (
        !end.nodeId &&
        !end.wallId &&
        !end.elementId &&
        (end.floorId ? end.floorId === floorId : belongs(obs))
      )
        transform(end);
    }
  for (const underlay of q.underlays.filter(belongs)) {
    transform(underlay);
    underlay.rotation = (underlay.rotation || 0) + degrees;
    const calibration = underlay.calibration;
    if (calibration?.worldA) {
      transform(calibration.worldA);
      calibration.rotation += angle;
    }
    if (calibration?.a) transform(calibration.a);
    if (calibration?.b) transform(calibration.b);
  }
  const record = {
    floorId,
    sourceA: { ...sourceA },
    sourceB: { ...sourceB },
    targetA: { ...targetA },
    targetB: { ...targetB },
    rotation: angle,
    residualMm: Math.abs(from - to),
    date: new Date().toISOString(),
  };
  floor.alignments = [...(floor.alignments || []), record];
  checkLocks(q);
  validateProject(q);
  Object.assign(p, q);
  return record;
}

/** Cross-section integration measures the union of irregular, overlapping cutouts once. */
export function surveyAreas(p, roomId) {
  const room = roomPoints(p, roomId),
    footprint = Math.abs(signedArea(room));
  const zones = p.zones.filter((z) => z.roomId === roomId),
    platforms = zones.filter((z) => z.type === 'platform'),
    voids = zones.filter((z) => z.type === 'void');
  if (!platforms.length && !voids.length)
    return { footprint, floorSlab: footprint, voidArea: 0, platform: 0 };
  const rings = [room, ...platforms.map((z) => z.points), ...voids.map((z) => z.points)];
  const edges = rings.flatMap((ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length]]));
  const xs = new Set(rings.flatMap((ring) => ring.map((pt) => pt.x)));
  // Crossing segments change the y-ordering of the slices; each crossing must delimit a band.
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const [c, d] = edges[j],
        rx = b.x - a.x,
        ry = b.y - a.y,
        sx = d.x - c.x,
        sy = d.y - c.y;
      const det = rx * sy - ry * sx;
      if (Math.abs(det) < EPS) continue;
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / det,
        u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / det;
      if (t > 0 && t < 1 && u > 0 && u < 1) xs.add(a.x + t * rx);
    }
  }
  const bands = [...xs].sort((a, b) => a - b);
  let floorSlab = 0,
    platform = 0;
  for (let i = 1; i < bands.length; i++) {
    const dx = bands[i] - bands[i - 1];
    if (dx < EPS) continue;
    const x = (bands[i] + bands[i - 1]) / 2,
      ys = [];
    for (const [a, b] of edges)
      if (x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x))
        ys.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
    ys.sort((a, b) => a - b);
    for (let j = 1; j < ys.length; j++) {
      const dy = ys[j] - ys[j - 1];
      if (dy < EPS) continue;
      const pt = { x, y: (ys[j] + ys[j - 1]) / 2 };
      if (!insidePolygon(pt, room)) continue;
      const holes = voids.filter((z) => insidePolygon(pt, z.points));
      const cuts = (h, level) =>
        (h.bottom == null || level >= h.bottom - EPS) && (h.top == null || level <= h.top + EPS);
      if (!holes.some((h) => !h.targetZoneId && cuts(h, 0))) floorSlab += dx * dy;
      if (
        platforms.some(
          (z) =>
            insidePolygon(pt, z.points) &&
            !holes.some((h) =>
              h.targetZoneId
                ? h.targetZoneId === z.id
                : (z.top != null && cuts(h, z.top)) || (z.bottom != null && cuts(h, z.bottom))
            )
        )
      )
        platform += dx * dy;
    }
  }
  return { footprint, floorSlab, voidArea: footprint - floorSlab, platform };
}
export function recordDeviceReading(p, packet) {
  const deviceId = requireId(packet.deviceId, 'Ölçüm cihazı'),
    readingId = requireId(packet.readingId, 'Okuma kimliği');
  const previous = p.observations.find((o) => o.deviceId === deviceId && o.readingId === readingId);
  if (previous) {
    if (
      !anchorsMatch(previous.a, packet.a) ||
      !anchorsMatch(previous.b, packet.b) ||
      Math.abs(previous.value - parseLength(packet.raw, packet.unit ?? p.unit)) > 0.0001
    )
      throw new Error('Aynı cihaz okuması farklı bir hedef veya değer içeriyor.');
    return { duplicate: true, observation: previous };
  }
  const observation = addObservation(p, {
    ...packet,
    deviceId,
    readingId,
    method: packet.method || 'laser',
  });
  return { duplicate: false, observation };
}
