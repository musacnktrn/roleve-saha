// [codex] ureten: codex
import { addObservation, formatLength, openingLevels, parseLength, validateProject } from './core.js';
import { EPS, entity, positive } from './measure.js';

export const ceilingMethods = [
  ['laser', 'Lazer'],
  ['tape', 'Şerit metre'],
  ['iphone', 'Telefon ölçümü'],
  ['estimate', 'Tahmin'],
];
const labels = new Map([...ceilingMethods, ['unspecified', 'Yöntem belirtilmedi']]);
export const ceilingMethodLabel = (method) => labels.get(method) || 'Yöntem kaydı yok';

export function roomCeilingInfo(p, roomId) {
  const room = entity(p.rooms, roomId, 'Mahal');
  const floor = entity(p.floors, room.floorId, 'Kat');
  const height = room.height ?? null;
  const observations = p.observations ?? [];
  const replaced = new Set(observations.map((o) => o.replaces).filter(Boolean));
  const history = observations
    .filter(
      (o) =>
        o.roomId === room.id &&
        (!o.floorId || o.floorId === floor.id) &&
        o.purpose === 'room-ceiling' &&
        o.kind === 'vertical' &&
        Number.isFinite(o.value) &&
        o.value > 0
    )
    .reverse();
  const last = history.find((o) => !replaced.has(o.id)) || null;
  const current = height != null && last && Math.abs(last.value - height) <= EPS ? last : null;
  const status =
    height == null
      ? 'unknown'
      : !current
        ? 'legacy'
        : current.method === 'estimate'
          ? 'estimated'
          : ceilingMethods.some(([method]) => method === current.method)
            ? 'measured'
            : 'unattributed';
  const methodLabel = height == null ? 'Ölçülmedi' : ceilingMethodLabel(current?.method);
  return {
    room,
    floor,
    height,
    absoluteZ: height == null ? null : floor.elevation + height,
    history,
    current,
    last,
    methodLabel,
    status,
  };
}

// Uses the same underside and strict tolerance as projectChecks' opening-head rule.
export function ceilingOpeningConflicts(p, roomId, height) {
  const boundary = new Set(entity(p.rooms, roomId, 'Mahal').wallIds);
  const preview = {
    ...p,
    zones: p.zones ?? [],
    rooms: p.rooms.map((r) => (r.id === roomId ? { ...r, height } : r)),
  };
  return (p.elements ?? [])
    .filter((e) => boundary.has(e.wallId) && ['door', 'window'].includes(e.type))
    .flatMap((e) => {
      const { head, ceiling } = openingLevels(preview, e, roomId);
      if (head == null || ceiling == null || head <= ceiling + EPS) return [];
      return [
        {
          elementId: e.id,
          difference: head - ceiling,
          message:
            (e.name || (e.type === 'door' ? 'Kapı' : 'Pencere')) +
            ' lentosu tavan veya kiriş altını ' +
            formatLength(head - ceiling, 'mm') +
            ' mm aşıyor.',
        },
      ];
    });
}

export function setRoomCeiling(p, roomId, input) {
  const { room, floor, last } = roomCeilingInfo(p, roomId);
  const raw = String(input.height ?? '').trim();
  const method = input.method || '';
  const unknown = input.unmeasured === true || input.unmeasured === 'on';
  if (!unknown && method && !labels.has(method)) throw Error('Ölçüm yöntemini listeden seçin.');
  if (!unknown && !raw) {
    if (room.height != null)
      throw Error('Mevcut yüksekliği kaldırmak için “Ölçülmedi” seçeneğini işaretleyin.');
    if (method) throw Error('Yöntem seçtiğiniz ölçünün yüksekliğini girin.');
    return { changed: false, observation: null };
  }
  const unit = input.unit || p.unit;
  const height = unknown ? null : positive(parseLength(raw, unit), 'Net tavan yüksekliği');
  if (
    (unknown && room.height == null) ||
    (!unknown && !method && room.height != null && Math.abs(height - room.height) <= EPS)
  )
    return { changed: false, observation: null };
  // Validate on a candidate before mutating: a failed project check never loses the original survey.
  const draft = {
    ...p,
    rooms: p.rooms.map((r) => (r.id === roomId ? { ...r, height } : r)),
    observations: [...(p.observations ?? [])],
  };
  let observation = null;
  if (!unknown) {
    // No field XY is requested for a room-wide reading. The first room corner provides its drawing anchor only.
    const anchor = { nodeId: room.nodeIds[0], floorId: floor.id, roomId: room.id };
    observation = addObservation(draft, {
      kind: 'vertical',
      purpose: 'room-ceiling',
      roomId: room.id,
      floorId: floor.id,
      raw,
      unit,
      value: height,
      method: method || 'unspecified',
      estimated: method === 'estimate',
      reference: 'finished-floor-to-room-ceiling',
      xyReference: 'room-diagram-anchor',
      fieldXYRecorded: false,
      localHeightMm: height,
      floorElevationAtReading: floor.elevation,
      a: { ...anchor, z: floor.elevation, label: 'Bitmiş zemin · mahal referansı' },
      b: { ...anchor, z: floor.elevation + height, label: 'Genel tavan · mahal referansı' },
      note: method === 'estimate' ? 'Genel net tavan yüksekliği · tahmin' : 'Genel net tavan yüksekliği',
      visitId: input.visitId || null,
      replaces: last?.id || null,
    });
  }
  validateProject(draft);
  room.height = height;
  if (observation) (p.observations ??= []).push(observation);
  return { changed: true, observation };
}
