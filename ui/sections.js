// [codex] ureten: codex
import { esc, button, fmt, readMm, metre, uid } from './base.js';

export function validateSections(p) {
  if (p.sections === undefined) return;
  if (!Array.isArray(p.sections)) throw Error('Kesit listesi geçersiz.');
  const ids = new Set();
  const floors = new Set(p.floors.map((f) => f.id));
  const point = (a) => a && [a.x, a.y].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e8);
  for (const v of p.sections) {
    if (
      !v ||
      typeof v.id !== 'string' ||
      !v.id ||
      ids.has(v.id) ||
      !floors.has(v.floorId) ||
      typeof v.name !== 'string' ||
      !v.name.trim() ||
      v.name.length > 120 ||
      !point(v.a) ||
      !point(v.b) ||
      Math.hypot(v.a.x - v.b.x, v.a.y - v.b.y) < 1
    )
      throw Error('Kesit için kat, ad ve farklı iki uç gereklidir.');
    ids.add(v.id);
  }
}

export function makeSection(p, floorId, a, b) {
  const names = new Set((p.sections || []).map((c) => c.name));
  let i = 1;
  while (names.has('Kesit ' + i)) i++;
  return { id: uid(), name: 'Kesit ' + i, floorId, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
}

export function sectionOverlay(cut) {
  if (!cut) return '';
  const { a, b } = cut,
    length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return '';
  const ux = (b.x - a.x) / length,
    uy = (b.y - a.y) / length,
    tip = 150;
  const arrows = [a, b]
    .map((pt, i) => {
      const dx = pt.x + uy * tip,
        dy = pt.y - ux * tip;
      return `<path d="M${pt.x},${pt.y}L${dx},${dy}m${-uy * 60 - ux * 45},${ux * 60 - uy * 45}l${uy * 60 + ux * 45},${-ux * 60 + uy * 45}l${-uy * 60 + ux * 45},${ux * 60 + uy * 45}" fill="none" stroke-width="19"/><text x="${dx + 50}" y="${dy - 45}" font-size="115" stroke="none">${i ? 'A′' : 'A'}</text>`;
    })
    .join('');
  return `<g data-section-line="${esc(cut.id)}" pointer-events="none" stroke="#9c4c32" fill="#743c2e"><title>${esc(cut.name)}</title><path d="M${a.x},${a.y}L${b.x},${b.y}" stroke-width="20" stroke-dasharray="140 55 25 55"/>${arrows}</g>`;
}

export function sectionList(ctx, show) {
  const { p, s } = ctx;
  let rows = '';
  for (const f of p.floors) {
    const items = (p.sections || []).filter((c) => c.floorId === f.id);
    if (!items.length) continue;
    rows +=
      `<h3>${esc(f.name)}</h3><div class="cut-list">` +
      items
        .map((c) => {
          const id = `data-id="${esc(c.id)}"`;
          return (
            '<div class="cut-row">' +
            button('section-open', c.name, 'section', 'action-row', id) +
            button('section-edit', 'Düzenle', 'edit', 'secondary', id) +
            '</div>'
          );
        })
        .join('') +
      '</div>';
  }
  const floorName = p.floors.find((f) => f.id === s.floorId)?.name || '';
  show(
    'Proje kesitleri',
    button('section-new', 'Planda yeni kesit çiz', 'plus', 'primary') +
      `<p class="intro">${esc(floorName)} kat planında kesit başlangıcı A ve bitişi B’yi işaretleyin.</p>` +
      rows,
  );
}

export function editSection(ctx, cut, form, select) {
  if (!cut) return;
  const { p } = ctx;
  const coord = (key, label, val) => ({
    key,
    label: `${label} (${p.unit})`,
    value: fmt(val, p.unit),
    number: true,
    required: true,
  });
  form(
    'Kesit çizgisini düzenle',
    [
      { key: 'name', label: 'Kesit adı', value: cut.name, required: true, maxlength: 120, full: true },
      coord('ax', 'A · X', cut.a.x),
      coord('ay', 'A · Y', cut.a.y),
      coord('bx', 'B · X', cut.b.x),
      coord('by', 'B · Y', cut.b.y),
      { key: 'reverse', label: 'Bakış yönünü ters çevir', type: 'check' },
    ],
    'Kesiti kaydet',
    async (d) => {
      const a = { x: readMm(d.ax, p.unit), y: readMm(d.ay, p.unit) },
        b = { x: readMm(d.bx, p.unit), y: readMm(d.by, p.unit) };
      const v = { ...cut, name: d.name.trim(), a: d.reverse ? b : a, b: d.reverse ? a : b };
      await ctx.change('Kesit güncellendi', (q) =>
        Object.assign(
          q.sections.find((c) => c.id === cut.id),
          v,
        ),
      );
      select(v);
    },
    { extra: button('section-delete', 'Bu kesiti sil', 'erase', 'text-btn', `data-id="${esc(cut.id)}"`) },
  );
}

export function openingList(p, s, rows, show) {
  const text = (value) => (Number.isFinite(value) ? metre(value) : 'Ölçülmedi');
  const chosen = (p.sections || []).find((c) => c.id === s.sectionId);
  const items = rows
    .map((v) => {
      const floor = p.floors.find((f) => f.id === v.floorId)?.name || '';
      return `<button class="action-row cut-element" data-act="section-element" data-id="${esc(v.elementId)}"><strong>${esc(v.name)}</strong><small>${esc(floor)} · Alt kot ${text(v.sill)} · Yükseklik ${text(v.height)}</small></button>`;
    })
    .join('');
  show(
    chosen ? chosen.name + ' · Açıklıklar' : 'Kesitteki açıklıklar',
    items ||
      '<p class="intro">Bu çizgi üzerinde kapı veya pencere yok. Kesit çizgisinin uçlarını planda değiştirebilirsiniz.</p>',
  );
}
