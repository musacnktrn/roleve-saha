// [codex] ureten: codex. x follows wall A→B, y rises from sill to lintel.
const shapes = new Set(['free', 'line', 'rect', 'arc', 'oval']);
const brushes = new Set(['pen', 'pencil', 'marker']);
const fraction = (n) => Number.isFinite(n) && n >= 0 && n <= 1;
const positive = (n) => Number.isFinite(n) && n > 0;
const round = (n) => Number(n.toFixed(6));
const escapeId = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function validateOpeningDetail(element) {
  if (element.detailStrokes === undefined) return element;
  const strokes = element.detailStrokes;
  if (!Array.isArray(strokes) || strokes.length > 2500) throw Error('Açıklık detay çizgileri geçersiz.');
  if (strokes.length && !['window', 'door'].includes(element.type))
    throw Error('Detay çizgilerini kapı veya pencereye bağlayın.');
  const ids = new Set();
  for (const s of strokes) {
    if (!s || typeof s.id !== 'string' || !s.id.trim() || s.id.length > 160 || ids.has(s.id))
      throw Error('Açıklık detay çizgisinin kimliği geçersiz veya yinelenmiş.');
    ids.add(s.id);
    if (!shapes.has(s.shape) || !brushes.has(s.brush) || typeof s.color !== 'string' ||
      !/^#[\da-f]{6}$/i.test(s.color) || !positive(s.width) || s.width > 1000 ||
      !positive(s.opacity) || s.opacity > 1) throw Error('Açıklık detay çizgisinin biçimi geçersiz.');
    if (!Array.isArray(s.points) || s.points.length < 2 || s.points.length > 3000 ||
      (s.shape !== 'free' && s.points.length !== 2) ||
      s.points.some((p) => !p || !fraction(p.x) || !fraction(p.y)))
      throw Error('Detay noktalarını kapı veya pencere sınırı içinde verin.');
  }
  return element;
}

// Straight and freehand strokes store their actual vertices. A shape stores
// its two opposite corners. The arc is the upper half of an ellipse.
export function openingStrokePoints(stroke) {
  const [a, b] = stroke.points;
  if (stroke.shape === 'line' || stroke.shape === 'free') return stroke.points;
  if (stroke.shape === 'rect') return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
  const low = Math.min(a.y, b.y), high = Math.max(a.y, b.y);
  const radiusX = (right - left) / 2, centerX = left + radiusX;
  const oval = stroke.shape === 'oval';
  const radiusY = (high - low) / (oval ? 2 : 1), centerY = oval ? low + radiusY : low;
  const count = oval ? 64 : 32;
  return Array.from({length: count + 1}, (_, i) => {
    const angle = Math.PI - i * Math.PI / 32;
    return { x: round(centerX + radiusX * Math.cos(angle)), y: round(centerY + radiusY * Math.sin(angle)) };
  });
}

export function openingDetailMarkup(element, frame) {
  if (!element?.detailStrokes?.length || !positive(element.width) || !positive(element.height) || !frame) return '';
  validateOpeningDetail(element);
  const {left, right, bottom, top} = frame;
  if (![left, right, bottom, top].every(Number.isFinite)) return '';
  const w = Math.abs(right-left), h = Math.abs(top-bottom);
  if (!w || !h) return '';
  const x = Math.min(left, right), y = Math.min(top, bottom);
  const widthScale = Math.sqrt(w / element.width * (h / element.height));
  const marks = element.detailStrokes.map((s) => {
    const points = openingStrokePoints(s).map((p) =>
      round(left + (right-left) * p.x) + ',' + round(bottom + (top-bottom) * p.y)).join(' ');
    return `<polyline data-opening-stroke="${escapeId(s.id)}" points="${points}" fill="none" stroke="${s.color}" stroke-width="${round(s.width * widthScale)}" opacity="${s.opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" overflow="hidden" pointer-events="none">${marks.join('')}</svg>`;
}

function pointDistance(p, a, b) {
  const dx = b.x-a.x, dy = b.y-a.y;
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy) / (dx*dx+dy*dy || 1)));
  return Math.hypot(p.x-a.x-t*dx, p.y-a.y-t*dy);
}

function nearSegments(a, b, c, d, radius) {
  if (Math.max(a.x,b.x)+radius < Math.min(c.x,d.x) || Math.max(c.x,d.x)+radius < Math.min(a.x,b.x) ||
    Math.max(a.y,b.y)+radius < Math.min(c.y,d.y) || Math.max(c.y,d.y)+radius < Math.min(a.y,b.y)) return false;
  const cross = (i,j,k) => (j.x-i.x)*(k.y-i.y)-(j.y-i.y)*(k.x-i.x);
  if (cross(a,b,c)*cross(a,b,d) < 0 && cross(c,d,a)*cross(c,d,b) < 0) return true;
  return Math.min(pointDistance(a,c,d), pointDistance(b,c,d), pointDistance(c,a,b), pointDistance(d,a,b)) <= radius;
}

export function openingEraserHits(element, trail, radiusMm) {
  const mm = (p) => ({ x:p.x*element.width, y:p.y*element.height });
  const path = trail.map(mm);
  if (path.length === 1) path.push(path[0]);
  const ends = path.slice(1);
  const hit = new Set();
  for (const stroke of element.detailStrokes || []) {
    const vertices = openingStrokePoints(stroke).map(mm);
    if (vertices.slice(1).some((b,i) => ends.some((d,j) =>
      nearSegments(vertices[i], b, path[j], d, radiusMm + stroke.width / 2)))) hit.add(stroke.id);
  }
  return hit;
}
