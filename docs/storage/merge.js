/* Three-way merge uses persistent entity IDs. local/remote values are for an explicit choice. */
import { StoreError } from './local.js';

const collections = new Set([
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
  'sections',
  'furniture',
  'underlays',
]);
const shapeGroups = ['nodes', 'walls', 'rooms', 'elements', 'zones', 'faceSketches'];
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const missing = Symbol('absent');

export function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (a === missing || b === missing || !a || !b || typeof a !== 'object' || typeof b !== 'object')
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
}
const value = (obj, k, fallback = missing) => (Object.hasOwn(obj, k) ? obj[k] : fallback);
const index = (rows) => new Map(rows.map((row) => [row.id, row]));
const forDisplay = (v) => (v === missing ? null : v);
const segment = (v) => String(v).replaceAll('~', '~0').replaceAll('/', '~1');

function commonConflictingWall(base, local, remote) {
  const signatureMap = (project) => {
    const nodes = index(project.nodes || []);
    return new Map((project.walls || []).map((w) => [w.id, [w, nodes.get(w.a), nodes.get(w.b)]]));
  };
  const old = signatureMap(base),
    left = signatureMap(local),
    right = signatureMap(remote);
  return [...new Set([...old.keys(), ...left.keys(), ...right.keys()])].filter(
    (id) =>
      !equal(old.get(id), left.get(id)) &&
      !equal(old.get(id), right.get(id)) &&
      !equal(left.get(id), right.get(id))
  );
}

function invalidTopology(project) {
  const nodes = index(project.nodes || []),
    walls = index(project.walls || []),
    rooms = index(project.rooms || []);
  const floors = index(project.floors || []);
  return (
    [...nodes.values()].some((n) => !floors.has(n.floorId)) ||
    [...walls.values()].some((w) => !nodes.has(w.a) || !nodes.has(w.b) || !floors.has(w.floorId)) ||
    [...rooms.values()].some(
      (r) =>
        !floors.has(r.floorId) ||
        r.nodeIds?.some((id) => !nodes.has(id)) ||
        r.wallIds?.some((id) => !walls.has(id))
    ) ||
    (project.elements || []).some(
      (e) => (e.wallId && !walls.has(e.wallId)) || (e.roomId && !rooms.has(e.roomId))
    ) ||
    (project.zones || []).some((z) => z.roomId && !rooms.has(z.roomId))
  );
}

function recoverNotes(doc) {
  const rooms = index(doc.rooms || []),
    walls = index(doc.walls || []);
  doc.notes = (doc.notes || []).map((n) => {
    if ((!n.wallId || walls.has(n.wallId)) && (!n.roomId || rooms.has(n.roomId))) return n;
    return {
      ...n,
      wallId: walls.has(n.wallId) ? n.wallId : null,
      roomId: rooms.has(n.roomId) ? n.roomId : null,
      status: 'open',
      formerAnchor: { roomId: n.roomId || null, wallId: n.wallId || null },
      needsRebind: true,
    };
  });
}

export function mergeProjects(base, local, remote, choices = {}) {
  if (!local || !remote || local.id !== remote.id || (base && base.id !== local.id))
    throw new StoreError('INVALID_MERGE', 'Proje kimlikleri uyuşmuyor.');
  const conflicts = [];
  const decide = (path, a, b, c, detail) => {
    if (equal(b, c)) return b;
    if (equal(a, b)) return c;
    if (equal(a, c)) return b;
    if (choices[path] === 'local') return b;
    if (choices[path] === 'remote') return c;
    conflicts.push({ path, base: forDisplay(a), local: forDisplay(b), remote: forDisplay(c), detail });
    return b;
  };
  if (!base) {
    const removeTime = (p) => Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'updatedAt'));
    if (equal(removeTime(local), removeTime(remote))) return { project: remote, conflicts };
    return {
      project: decide(
        '/project',
        missing,
        local,
        remote,
        'Bu cihazın ortak bir başlangıç sürümü bulunmuyor.'
      ),
      conflicts,
    };
  }
  const result = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(remote), ...Object.keys(local)])) {
    if (reserved.has(key)) throw new StoreError('INVALID_MERGE', 'Proje alanı geçersiz.');
    if (key === 'updatedAt') {
      result[key] = local.updatedAt;
      continue;
    }
    // Early survey files omit sections. An explicit empty array can still delete known section IDs.
    const optionalSections = key === 'sections';
    const a = value(base, key, optionalSections ? [] : missing);
    const fallback = optionalSections ? a : missing;
    const b = value(local, key, fallback),
      c = value(remote, key, fallback);
    if (collections.has(key) && equal(a, c)) {
      if (b !== missing) result[key] = b;
      continue;
    }
    if (collections.has(key) && equal(a, b)) {
      if (c !== missing) result[key] = c;
      continue;
    }
    if (
      collections.has(key) &&
      [a, b, c].every((v) => Array.isArray(v) && v.every((r) => r && typeof r.id === 'string'))
    ) {
      const [ai, bi, ci] = [a, b, c].map(index);
      result[key] = [];
      // Existing server order, then genuinely local additions; capture traversal is ordered inside each entity.
      for (const id of new Set([...ci.keys(), ...bi.keys(), ...ai.keys()])) {
        const picked = decide(
          '/' + key + '/' + segment(id),
          ai.get(id) ?? missing,
          bi.get(id) ?? missing,
          ci.get(id) ?? missing
        );
        if (picked !== missing) result[key].push(picked);
      }
    } else {
      const picked = decide('/' + segment(key), a, b, c);
      if (picked !== missing) result[key] = picked;
    }
  }
  const overlapping = commonConflictingWall(base, local, remote);
  if (overlapping.length || invalidTopology(result)) {
    const keys = ['floors', ...shapeGroups];
    const geometry = (p) => Object.fromEntries(keys.map((k) => [k, p[k] || []]));
    // Coupled room rings can't be resolved per coordinate. Keep both full geometry candidates.
    for (let i = conflicts.length - 1; i >= 0; i--)
      if (keys.includes(conflicts[i].path.split('/')[1])) conflicts.splice(i, 1);
    const picked = decide(
      '/geometry',
      geometry(base),
      geometry(local),
      geometry(remote),
      overlapping.length
        ? 'Ortak duvar uçları çakışıyor: ' + overlapping.join(', ')
        : 'Bir geometrik bağ silinmiş.'
    );
    Object.assign(result, picked);
  }
  recoverNotes(result);
  return { project: result, conflicts };
}
