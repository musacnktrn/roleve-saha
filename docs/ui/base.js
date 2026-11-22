/* [codex] ureten: codex */
import { parseLength } from '../geometry/measure.js';
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const uid = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint32Array(4)), (x) => x.toString(16).padStart(8, '0')).join(
        '-',
      );
export const dateText = (value) => {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
    : '—';
};
export const num = (value, digits = 2) =>
  Number.isFinite(value) ? value.toLocaleString('tr-TR', { maximumFractionDigits: digits }) : '—';
export const metre = (mm) => (Number.isFinite(mm) ? num(mm / 1000, 3) + ' m' : 'Ölçülmedi');
export const fmt = (mm, unit = 'm') =>
  Number.isFinite(mm)
    ? String(+(mm / ({ m: 1000, cm: 10, mm: 1 }[unit] || 1)).toFixed(4)).replace('.', ',')
    : '';
export function readMm(s, unit = 'm', nullable = false) {
  if (String(s ?? '').trim() === '' && nullable) return null;
  const n = parseLength(s, unit);
  if (!Number.isFinite(n) || Math.abs(n) > 1e8) throw Error('Ölçü aralık dışında.');
  return Math.round(n * 1000) / 1000;
}
const paths = {
  people: 'M3 20v-2c0-4 3-6 7-6s7 2 7 6v2M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0m3-3a3 3 0 0 1 0 6m2 3c3 1 4 3 4 6',
  erase: 'm3 13 10-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-9 10H8l-5-5a2 2 0 0 1 0-3zm4-4 9 8m-4 4h10',
  menu: 'M3 6h18M3 12h18M3 18h18',
  plan: 'M3 3h18v18H3zM3 13h8V3m0 10h4m2 0h4',
  folder: 'M3 7V5h6l2 2h10v13H3z',
  home: 'm2 11 10-8 10 8M5 10v11h14V10',
  chev: 'm8 10 4 4 4-4',
  right: 'm9 6 6 6-6 6',
  left: 'm15 6-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm4 12 5 5 11-11',
  cloud: 'M6 18a4.5 4.5 0 0 1-.6-9A7 7 0 0 1 19 8a5 5 0 0 1-.2 10z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  download: 'M12 3v13m-5-5 5 5 5-5M4 15v6h16v-6',
  undo: 'M4 10h10a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5',
  redo: 'M20 10H10a6 6 0 0 0 0 12M20 10l-5-5m5 5-5 5',
  layers: 'm2 8 10-5 10 5-10 5zM2 12l10 5 10-5M2 16l10 5 10-5',
  cube: 'm3 7 9-5 9 5v10l-9 5-9-5zM3 7l9 5 9-5m-9 5v10',
  wall: 'M3 5h18v14H3zM6 16h12M8 8v5h8V8z',
  section: 'M2 18h20M4 18V8l8-5 8 5v10M4 12h16',
  ceiling: 'M3 4h18v16H3zM6 7h12v10H6z',
  select: 'm5 2 14 11-7 1-3 7z',
  draw: 'm3 18 1-5L16 1l6 6L10 19l-7 2zM14 4l6 6',
  ruler: 'm2 16 14-14 6 6L8 22zM13 5l3 3M9 9l2 2m-6 2 3 3',
  ink: 'M2 18c5-1 4-12 8-12 4 0-3 14 2 13 3-1 3-7 5-7',
  hand: 'M5 13V8a1.5 1.5 0 0 1 3 0v4-7a1.5 1.5 0 0 1 3 0v7-9a1.5 1.5 0 0 1 3 0v9-7a1.5 1.5 0 0 1 3 0v8l1-3c1-2 4-1 3 2l-3 8q-1 2-4 2H11q-3 0-5-3l-3-5q-1-3 2-1z',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  note: 'M4 3h16v13l-5 5H4zM15 21v-6h5M7 8h10M7 12h6',
  fit: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-2 5 6 6',
  settings: 'M3 6h7m4 0h7M3 12h12m4 0h2M3 18h3m4 0h11M10 3v6m5 0v6m-8 0v6',
  close: 'M5 5l14 14M19 5 5 19',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h1m-1 6h1m-1 6h1',
  pin: 'M18 9c0 5-6 12-6 12S6 14 6 9a6 6 0 0 1 12 0zM14 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  dimension: 'M3 5v14m18-14v14M3 12h18m-14-3-3 3 3 3m10-6 3 3-3 3',
  door: 'M5 21V3h14v18M8 21V6l8-1v16m-3-8h1',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-5v5l3 2',
  file: 'M5 2h9l5 5v15H5zM14 2v6h5M8 13h8m-8 4h6',
  archive: 'M3 4h18v5H3zm2 5v12H5V9m4 4h6',
  dots: 'M4 12h1m6 0h1m6 0h1',
  rotate: 'M20 10a8 8 0 1 0-1 7m1-14v7h-7',
  refresh: 'M20 10a8 8 0 0 0-14-4l-3 3M3 3v6h6m-6 5a8 8 0 0 0 14 4l4-4m0 6v-6h-6',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18m6-18v18',
  slab: 'm2 9 13-6 7 4-13 6zM2 9v5l7 5 13-7V7M9 13v6',
  alert: 'm12 2 10 18H2zM12 8v5m0 3v1',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  image: 'M3 3h18v18H3zm0 14 5-6 4 4 4-5 5 7',
  area: 'M4 4h16v16H4zM4 12l8-8M4 18 18 4m-6 16 8-8',
  visit: 'M3 6h18v15H3zm4-4v7m10-7v7M4 11h16',
  copy: 'M8 7h13v14H8zM4 17H2V2h14v2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  trash: 'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15m-9-6v-5m4 5v-5',
  flag: 'M4 22V3m0 1c6-4 10 4 16 0v10c-6 4-10-4-16 0',
  sun: 'M12 2v3m0 14v3M2 12h3m14 0h3m-3-7-2 2M5 19l2-2M5 5l2 2m12 12-2-2m0-5a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
};
export function icon(key, size = 18) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[key] || paths.file}"/></svg>`;
}
export function button(act, label, ic, cls = '', extra = '') {
  return `<button type="button" data-act="${esc(act)}" class="${cls}" ${extra} title="${esc(label)}" aria-label="${esc(label)}">${ic ? icon(ic) : ''}<span>${esc(label)}</span></button>`;
}
export function ib(act, label, ic, extra = '') {
  return button(act, label, ic, 'ib', extra);
}
export function downloadFile(blob, name) {
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function safePhoto(src) {
  return typeof src === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(src);
}
