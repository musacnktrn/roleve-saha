/* [codex] ureten: codex */
import { esc } from './base.js';

export function bearingOnPlan(a, b) {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1) throw Error('Çekim noktası ve bakılan nokta farklı olmalı.');
  return (Math.round((((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI + 360) % 360) * 100) / 100) % 360;
}
export function photoViewPoint(p, floorId, point, target = {}, fallbackRoomId = null) {
  const element = p.elements.find((v) => v.id === target.element),
    wallId = target.wall || element?.wallId || null;
  const floorRooms = p.rooms.filter((r) => r.floorId === floorId);
  const contains = (r) => {
    const pts = r.nodeIds.map((id) => p.nodes.find((n) => n.id === id));
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i],
        b = pts[j];
      if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    return inside;
  };
  const room =
    floorRooms.find((r) => r.id === target.room) ||
    floorRooms.find((r) => r.id === element?.roomId) ||
    (wallId
      ? floorRooms.find((r) => r.id === fallbackRoomId && r.wallIds.includes(wallId)) ||
        floorRooms.find((r) => r.wallIds.includes(wallId))
      : floorRooms.find(contains));
  return {
    x: point.x,
    y: point.y,
    floorId,
    roomId: room?.id || null,
    wallId,
    elementId: element?.id || null,
  };
}
export function photoPin(n) {
  const a = n.anchor;
  if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return '';
  const cls = n.photo ? 'photo-pin' : 'note-pin',
    titles = {
      floor: 'Zemin',
      wall: 'Duvar',
      ceiling: 'Tavan',
      facade: 'Cephe',
      detail: 'Detay',
      general: 'Genel',
    };
  const label =
    (n.scene === 'exterior' ? 'Yapı dışı · ' : '') +
    (n.photo ? `${titles[n.surface] || 'Saha'} fotoğrafı` : 'Saha notu') +
    (Number.isFinite(n.direction) ? ` · ${n.direction}°` : '');
  const target = n.target,
    direction = Number.isFinite(n.direction) ? n.direction : null;
  return (
    `<g class="${cls}" data-note="${esc(n.id)}" transform="translate(${a.x} ${a.y})" role="button" tabindex="0" aria-label="${esc(label)}"><title>${esc(label)}</title>` +
    (n.photo && direction !== null
      ? `<g transform="rotate(${direction})"><path d="M0 0l-172 -354q172 -65 344 0z" fill="#237968" fill-opacity=".19" stroke="#1e695b" stroke-width="14"/><path d="M0 -266v-100m-28 37 28-37 28 37" fill="none" stroke="#165c4c" stroke-width="27"/></g>`
      : '') +
    (n.photo && target && Number.isFinite(target.x) && Number.isFinite(target.y)
      ? `<path d="M0 0 L${target.x - a.x} ${target.y - a.y}" fill="none" stroke="#396c60" stroke-dasharray="45 65" stroke-width="15" pointer-events="none"/>`
      : '') +
    `<circle r="135" fill="${n.photo ? '#245d50' : '#a76d32'}" stroke="white" stroke-width="24"/>` +
    (n.photo
      ? '<rect x="-69" y="-38" width="138" height="87" rx="13" fill="none" stroke="white" stroke-width="15"/><circle r="21" cy="4" fill="none" stroke="white" stroke-width="13"/><path d="M-38 -38l11-18h43l10 18" fill="none" stroke="white" stroke-width="13"/>'
      : '<circle r="24" fill="white"/>') +
    '</g>'
  );
}
