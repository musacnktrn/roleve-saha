// [codex] ureten: codex
import { esc, readMm } from '../ui/base.js';

export const colors = [
  ['#ffce45', 'Sarı'],
  ['#78efd0', 'Nane'],
  ['#75bcff', 'Mavi'],
  ['#ff8587', 'Mercan'],
  ['#ffffff', 'Beyaz'],
];
export const methods = { manual: 'Şerit metre', laser: 'Lazer', estimate: 'Tahmin' };
export const types = { ink: 'Kalem', arrow: 'Ok', text: 'Yazı', dimension: 'Ölçü' };
const palette = new Set(colors.map(([hex]) => hex));
const pointIsValid = (p) => p && [p.x, p.y].every((a) => Number.isFinite(a) && a >= 0 && a <= 1);
export function validatePhotoAnnotations(photo) {
  const list = photo?.annotations;
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 500)
    throw Error('Bir fotoğrafta en fazla 500 işaret olabilir.');
  const ids = new Set();
  for (const a of list) {
    if (
      !a ||
      typeof a.id !== 'string' ||
      !a.id ||
      a.id.length > 120 ||
      ids.has(a.id) ||
      !Object.hasOwn(types, a.type) ||
      !palette.has(a.color) ||
      !Array.isArray(a.points) ||
      !a.points.every(pointIsValid)
    )
      throw Error('Fotoğraf işaretinin türü, rengi, kimliği veya konumu geçersiz.');
    ids.add(a.id);
    if (
      (a.type === 'ink' && (a.points.length < 2 || a.points.length > 3000)) ||
      (a.type === 'text' && a.points.length !== 1) ||
      (['dimension', 'arrow'].includes(a.type) &&
        (a.points.length !== 2 || (a.points[0].x === a.points[1].x && a.points[0].y === a.points[1].y)))
    ) {
      throw Error('İşaret için farklı ve geçerli noktalar seçin.');
    }
    if (a.type === 'text' && (typeof a.text !== 'string' || !a.text.trim() || a.text.length > 300)) {
      throw Error('Fotoğraf yazısı 1–300 karakter olmalı.');
    }
    if (
      a.type === 'dimension' &&
      (typeof a.raw !== 'string' ||
        a.raw.length > 32 ||
        !['mm', 'cm', 'm'].includes(a.unit) ||
        !Object.hasOwn(methods, a.method) ||
        readMm(a.raw, a.unit) <= 0)
    )
      throw Error('Pozitif bir ölçü, birim ve ölçüm yöntemi girin.');
  }
  return list;
}

export function markLabel(mark) {
  if (mark.type === 'text') return mark.text;
  if (mark.type === 'dimension') return `${mark.raw} ${mark.unit} · ${methods[mark.method]}`;
  return types[mark.type];
}

const n = (v) => Number(v.toFixed(3));
function textDraw(value, x, y, size, color, anchor = 'start') {
  return `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${n(size)}" font-weight="700" stroke="#17251f" stroke-width="${n(size * 0.19)}" stroke-linejoin="round" paint-order="stroke" fill="${color}">${esc(value)}</text>`;
}

export function markSVG(mark, width, height) {
  const size = Math.max(0.5, Math.min(width, height) * 0.006),
    textSize = size * 4.2;
  const points = mark.points.map((p) => ({ x: p.x * width, y: p.y * height }));
  const a = points[0],
    b = points.at(-1);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join(' ');
  let shape = '';
  const stroke = (d, lineSize = size) =>
    `<path d="${d}" stroke="#17251f" stroke-width="${n(lineSize * 1.7)}"/><path d="${d}" stroke="${mark.color}" stroke-width="${n(lineSize)}"/>`;
  if (mark.type === 'text') {
    const lines = mark.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++)
      shape += textDraw(lines[i], a.x, a.y + i * textSize * 1.15, textSize, mark.color);
  } else if (mark.type === 'ink' || !b) {
    shape = stroke(path);
  } else {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (!length) return '';
    const ux = dx / length,
      uy = dy / length;
    if (mark.type === 'arrow') {
      const head = Math.min(size * 5, length * 0.45),
        base = { x: b.x - head * ux, y: b.y - head * uy };
      const headPath = `M${n(base.x - uy * head * 0.5)} ${n(base.y + ux * head * 0.5)} L${n(b.x)} ${n(b.y)} L${n(base.x + uy * head * 0.5)} ${n(base.y - ux * head * 0.5)}`;
      shape = stroke(path + ' ' + headPath);
    } else {
      const tick = (p) =>
        `M${n(p.x - uy * size * 2.1)} ${n(p.y + ux * size * 2.1)} l${n(uy * size * 4.2)} ${n(-ux * size * 4.2)}`;
      shape = stroke([path, tick(a), tick(b)].join(' '), size * 0.78);
      const centerX = (a.x + b.x) / 2,
        centerY = (a.y + b.y) / 2;
      // Clamp labels into the original photo on all four edges, including export.
      const label = markLabel(mark),
        halfWidth = Math.min(width * 0.48, label.length * textSize * 0.31 + size);
      const lx = Math.min(width - halfWidth, Math.max(halfWidth, centerX)),
        ly = Math.max(textSize * 1.15, Math.min(height - size, centerY - size * 2.6));
      shape += textDraw(label, lx, ly, textSize, mark.color, 'middle');
    }
    shape += `<path d="${path}" stroke="transparent" stroke-width="${n(size * 5)}"/>`;
  }
  return `<g data-mark="${esc(mark.id)}" fill="none" stroke-linecap="round" stroke-linejoin="round">${shape}</g>`;
}

export function pointAtImage(svg, clientX, clientY, width, height, clamp = false) {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  const x = p.x / width,
    y = p.y / height;
  if (!clamp && (x < 0 || y < 0 || x > 1 || y > 1)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

export function shiftMark(mark, dx, dy) {
  const xs = mark.points.map((p) => p.x),
    ys = mark.points.map((p) => p.y);
  dx = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), dx));
  dy = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), dy));
  return { ...mark, points: mark.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

export function exportDimensions(width, height) {
  const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(12_000_000 / (width * height)));
  return { w: Math.max(1, Math.floor(width * scale)), h: Math.max(1, Math.floor(height * scale)) };
}

export async function annotatedPNG(photo, marks) {
  validatePhotoAnnotations({ annotations: marks });
  const original = new Image();
  original.src = photo.data;
  await original.decode();
  const { w, h } = exportDimensions(original.naturalWidth, original.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw Error('İşaretli görüntü için çizim alanı açılamadı.');
  g.drawImage(original, 0, 0, w, h);
  if (marks.length) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${marks.map((a) => markSVG(a, w, h)).join('')}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const layer = new Image();
      layer.src = url;
      await layer.decode();
      g.drawImage(layer, 0, 0, w, h);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('İşaretli fotoğraf oluşturulamadı.');
  return blob;
}
