/* [codex] ureten: codex */
import { pairs, roomCenter } from './plan.js';
import { num } from './base.js';

/** Keep the picked offset within the hit target, even when the node is fractional in survey mm. */
export function draggedCorner(origin, grab, pointer) {
  return { x: origin.x + (pointer.x - grab.x), y: origin.y + (pointer.y - grab.y) };
}

/** Reposition the existing drawing while dragging. The survey records stay untouched until release. */
export function beginCornerDrag(svg, project, nodeId) {
  const handles = [...svg.querySelectorAll('[data-node]')].filter(
    (el) =>
      el.dataset.node === nodeId && el.parentElement?.closest?.('[data-node]')?.dataset.node !== nodeId,
  );
  const node = project?.nodes.find((n) => n.id === nodeId);
  const circle =
    handles.find((el) => el.hasAttribute('cx') && el.hasAttribute('cy')) ||
    handles.map((el) => el.querySelector?.('circle.node-handle')).find(Boolean);
  const origin = node
    ? { x: node.x, y: node.y }
    : circle
      ? { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) }
      : null;
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return null;

  const rooms = (project?.rooms || []).filter((r) => r.nodeIds.includes(nodeId));
  const walls = (project?.walls || []).filter((w) => w.a === nodeId || w.b === nodeId);
  const ids = new Set([...rooms.flatMap((r) => r.nodeIds), ...walls.flatMap((w) => [w.a, w.b])]);
  const nodes = new Map(
    (project?.nodes || []).filter((n) => ids.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]),
  );
  const wallIds = new Set(walls.map((w) => w.id));
  const elements = new Map(
    (project?.elements || []).filter((e) => wallIds.has(e.wallId)).map((e) => [e.id, e]),
  );
  const roomsById = new Map(rooms.map((room) => [room.id, { room, polygons: [], captions: [] }]));
  const wallsById = new Map(walls.map((wall) => [wall.id, { wall, edges: [], elements: [] }]));
  const restore = [];
  const attr = (el, key) => {
    const initial = el.getAttribute(key);
    restore.push(() => (initial === null ? el.removeAttribute(key) : el.setAttribute(key, initial)));
    return (value) => el.setAttribute(key, value);
  };
  for (const el of svg.querySelectorAll('.room[data-room],.room-caption[data-room]')) {
    const found = roomsById.get(el.dataset.room);
    if (!found) continue;
    if (el.tagName.toLowerCase() === 'polygon') found.polygons.push(attr(el, 'points'));
    else {
      const area = el.querySelector('.room-area'),
        initial = area?.textContent;
      if (area)
        restore.push(() => {
          area.textContent = initial;
        });
      found.captions.push({ move: attr(el, 'transform'), area });
    }
  }
  for (const el of svg.querySelectorAll(
    '.wall-hit[data-wall],.active-wall[data-wall],[data-element][data-wall]',
  )) {
    const found = wallsById.get(el.dataset.wall);
    if (!found) continue;
    if (el.dataset.element) {
      const item = elements.get(el.dataset.element);
      if (item) found.elements.push({ offset: item.offset, move: attr(el, 'transform') });
    } else if (el.tagName.toLowerCase() === 'path') found.edges.push(attr(el, 'd'));
    else
      for (const path of el.querySelectorAll('.wall-edge,.wall-target')) found.edges.push(attr(path, 'd'));
  }
  const moveHandles = handles.map((el) => {
    if (el.hasAttribute('cx') && el.hasAttribute('cy') && !el.hasAttribute('transform')) {
      const cx = attr(el, 'cx'),
        cy = attr(el, 'cy');
      return (point) => {
        cx(point.x);
        cy(point.y);
      };
    }
    const base = el.getAttribute('transform') || '',
      move = attr(el, 'transform');
    return (point) => move('translate(' + (point.x - origin.x) + ' ' + (point.y - origin.y) + ') ' + base);
  });
  let changed = false;
  return {
    origin,
    show(point) {
      changed = true;
      nodes.set(nodeId, point);
      for (const { room, polygons, captions } of roomsById.values()) {
        const ring = room.nodeIds.map((id) => nodes.get(id));
        const outline = pairs(ring);
        for (const write of polygons) write(outline);
        if (!captions.length) continue;
        const center = roomCenter(ring);
        const area =
          Math.abs(
            ring.reduce((total, a, i) => {
              const b = ring[(i + 1) % ring.length];
              return total + a.x * b.y - a.y * b.x;
            }, 0),
          ) / 2e6;
        for (const caption of captions) {
          caption.move('translate(' + center.x + ' ' + center.y + ')');
          if (caption.area) caption.area.textContent = num(area, 1) + ' m²';
        }
      }
      for (const { wall, edges, elements: attached } of wallsById.values()) {
        const a = nodes.get(wall.a),
          b = nodes.get(wall.b);
        const path = 'M' + a.x + ' ' + a.y + 'L' + b.x + ' ' + b.y;
        for (const write of edges) write(path);
        const dx = b.x - a.x,
          dy = b.y - a.y,
          len = Math.hypot(dx, dy);
        if (!len) continue;
        for (const item of attached) {
          const t = item.offset / len;
          item.move(
            'translate(' +
              (a.x + t * dx) +
              ' ' +
              (a.y + t * dy) +
              ') rotate(' +
              (Math.atan2(dy, dx) * 180) / Math.PI +
              ')',
          );
        }
      }
      for (const move of moveHandles) move(point);
    },
    restore() {
      if (changed) for (const reset of restore) reset();
      changed = false;
    },
  };
}
