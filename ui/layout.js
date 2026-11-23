/* [codex] ureten: codex */
import { esc, icon, button, ib, num, metre, dateText } from './base.js';
import { verticalToolbar } from './vertical-tools.js';
import { roomArea, roomPoints, wallLength } from '../geometry/core.js';
import { wallName, roomColor, planMarkup, padded, viewStr, currentWallReadings, readingMethod } from './plan.js';
export const modes = [
  ['plan', 'Plan', 'plan'],
  ['elevation', 'Görünüş', 'wall'],
  ['ceiling', 'Tavan', 'ceiling'],
  ['section', 'Kesit', 'section'],
  ['facade', 'Cephe', 'home'],
  ['model', '3B Model', 'cube'],
];
export const elements = {
  door: 'Kapı',
  window: 'Pencere',
  socket: 'Priz',
  switch: 'Anahtar',
  column: 'Kolon',
  beam: 'Kiriş',
  niche: 'Niş',
  vent: 'Menfez',
  drain: 'Gider',
  shaft: 'Şaft',
  fixture: 'Sabit donatı',
};
export const zoneNames = {
  platform: 'Asma kat',
  ceiling: 'Tavan bölgesi',
  void: 'Galeri boşluğu',
  beam: 'Kiriş altı',
  stair: 'Merdiven',
};
const tools = [
  ['select', 'Seç', 'select'],
  ['draw', 'Mahali çiz', 'draw'],
  ['measure', 'Uçtan uca ölç', 'ruler'],
  ['ink', 'Eskiz kalemi', 'ink'],
  ['erase', 'Eskiz silgisi', 'erase'],
  ['pan', 'Gezdir', 'hand'],
];
export const toolLabel = {
  select: 'Seçim',
  draw: 'Mahal çiz',
  measure: 'Ölçü',
  ink: 'Kalem',
  pan: 'Gezdir',
  erase: 'Silgi',
  calibrate: 'Altlık kalibrasyonu',
  sectionline: 'Kesit doğrusu',
  zone: 'Bölge çiz',
  notePin: 'Notun yeri',
  photoLocate: 'Çekim yönü',
};
export const statusLabel = (s) =>
  s?.state === 'synced'
    ? 'Eşitlendi'
    : s?.state === 'pending'
      ? s.pendingFiles?.length
        ? `${s.pendingFiles.length} ek bekliyor`
        : 'Eşitleme bekliyor'
      : s?.state === 'conflict'
        ? 'Sürüm çakışması'
        : 'Cihazda kayıtlı';
function stat(name, value) {
  return `<div><small>${esc(name)}</small><strong>${esc(value)}</strong></div>`;
}
function actionRow(act, text, ic, extra = '') {
  return `<button class="action-row" data-act="${esc(act)}">${icon(ic)}<span>${esc(text)}</span>${extra || icon('right', 14)}</button>`;
}
function brand() {
  return `<span class="brand"><img src="./assets/mark.svg" alt=""><b>Rölöve<span> Saha</span></b></span>`;
}
function top(s) {
  return `<header class="top">${brand()}<span class="top-divider"></span><nav aria-label="Çalışma alanları">${button('editor', 'Çalışma alanı', 'plan', 'toplink ' + (s.page === 'editor' ? 'active' : ''))}${button('projects', 'Projeler', 'folder', 'toplink ' + (s.page === 'projects' ? 'active' : ''))}${button('customers', 'Müşteriler', 'people', 'toplink ' + (s.page === 'customers' ? 'active' : ''))}</nav><div class="top-end">${button('cloud', statusLabel(s.sync), 'cloud', 'cloud-state')}${ib('settings', 'Proje ayarları', 'settings')}</div></header>`;
}
export function customersPage(s, customers, projects) {
  const search = s.customerQuery.toLocaleLowerCase('tr');
  const rows = customers.filter((c) => c.name.toLocaleLowerCase('tr').includes(search));
  return (
    top(s) +
    `<main class="library"><div class="lib-heading"><div><h1>Müşteriler</h1><p>${customers.length} müşteri</p></div>${button('new-customer', 'Yeni müşteri', 'plus', 'primary')}</div><label class="search client-search">${icon('search')}<input id="customer-search" aria-label="Müşterilerde ara" placeholder="Müşteri adıyla ara" value="${esc(s.customerQuery)}"></label><div class="client-list">${rows.map((c) => `<button class="client-card" data-act="client-projects" data-id="${esc(c.id)}"><i>${esc(c.name.trim().slice(0, 1).toLocaleUpperCase('tr'))}</i><span><b>${esc(c.name)}</b><small>${projects.filter((p) => p.customer?.id === c.id).length} proje</small></span>${icon('right')}</button>`).join('') || '<p class="empty">Burada müşterileriniz ve onlara bağlı projeler görünecek.</p>'}</div></main>`
  );
}
export function library(p, s, projects, customers = []) {
  const client = customers.find((c) => c.id === s.customerId);
  const query = (s.query || '').toLocaleLowerCase('tr'),
    filtered = projects.filter(
      (q) =>
        (!client || q.customer?.id === client.id) &&
        !!q.archived === !!s.archived &&
        [q.name, q.location, q.customer?.name, q.surveyorName]
          .join(' ')
          .toLocaleLowerCase('tr')
          .includes(query),
    );
  return (
    top(s) +
    `<main class="library"><div class="lib-heading"><div>${client ? button('customers', 'Müşteriler', 'left', 'text-btn') : ''}<h1>${esc(client?.name || 'Projeler')}</h1><p>${projects.filter((q) => (!client || q.customer?.id === client.id) && !q.archived).length} açık proje</p></div>${button('new-project', 'Yeni proje', 'plus', 'primary')}</div><div class="lib-bar"><div class="seg">${button('list-active', 'Çalışılan', '', 'seg-btn ' + (!s.archived ? 'on' : ''))}${button('list-archived', 'Arşiv', '', 'seg-btn ' + (s.archived ? 'on' : ''))}</div><label class="search">${icon('search')}<input id="library-search" aria-label="Projelerde ara" placeholder="Projelerde ara" value="${esc(s.query)}"></label>${button('import', 'Dosyadan aç', 'upload', 'secondary')}${button('cloud', 'Buluttan aç', 'cloud', 'secondary')}</div><div class="project-grid">${
      filtered
        .map((q) => {
          let v = planMarkup(q, { floorId: q.floors[0]?.id, showUnderlay: false }, true);
          return `<button class="project-card" data-act="open-project" data-id="${esc(q.id)}"><div class="plan-thumb"><svg viewBox="${viewStr(padded(v.bounds))}" aria-hidden="true">${v.html}</svg></div><div class="project-caption"><span class="room-code-label">${esc(q.customer?.name || q.location || 'Rölöve projesi')}</span><h2>${esc(q.name)}</h2><small>${q.floors.length} kat · ${q.rooms.length} mahal · ${dateText(q.updatedAt)}${q.surveyorName ? ' · ' + esc(q.surveyorName) : ''}</small></div></button>`;
        })
        .join('') || `<div class="empty">Bu listede proje yok.</div>`
    }</div></main>`
  );
}
function sidebar(p, s) {
  const rooms = p.rooms.filter((r) => r.floorId === s.floorId),
    pending = p.notes.filter((n) => n.status === 'open').length;
  return `<aside class="sidebar panel ${s.mobilePanel === 'rooms' ? 'shown' : ''}" aria-label="Kat ve mahaller"><div class="panel-head"><div class="eyebrow">${icon('layers', 14)} PROJE AĞACI</div>${ib('close-panel', 'Paneli kapat', 'close', 'data-mobile')}</div>
    <div class="floor-row"><label class="floor-select">${icon('layers', 17)}<select aria-label="Aktif kat" id="floor-select">${p.floors.map((f) => `<option value="${esc(f.id)}" ${f.id === s.floorId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>${ib('add-floor', 'Kat ekle', 'plus')}</div>
    <div class="group-title"><h3>Mahaller</h3><span class="count">${rooms.length}</span>${ib('add-room', 'Mahal ekle', 'plus')}</div>
    <div class="room-list">${rooms.map((r, i) => `<button class="room-item ${r.id === s.roomId ? 'active' : ''}" data-act="room" data-id="${esc(r.id)}" aria-pressed="${r.id === s.roomId}"><i class="room-swatch" style="--room:${roomColor(i)}"></i><span><strong>${esc(r.name)}</strong><small>${esc(r.code)} · ${num(roomArea(p, r.id) / 1e6, 1)} m²</small></span>${r.id === s.roomId ? icon('right', 14) : ''}</button>`).join('') || '<p class="tiny-empty">İlk mahali ekleyin veya çizin.</p>'}</div>
    <div class="side-section"><div class="group-title"><h3>Saha defteri</h3></div>${actionRow('notebook', 'Notlar ve fotoğraflar', 'note', `<small>${p.notes.length}</small>`)}${actionRow('measurements', 'Ölçü listesi', 'ruler', `<small>${p.observations.length}</small>`)}${actionRow('checks', 'Kontrol listesi', 'flag')}${actionRow('visits', 'Ziyaretler', 'visit')}</div>
    <div class="side-footer">${button('add-room', 'Mahal ekle', 'plus', 'secondary block')}${button('more', 'Proje araçları', 'settings', 'text-btn block')}</div></aside>`;
}
function inspector(p, s) {
  const r = p.rooms.find((r) => r.id === s.roomId),
    w = p.walls.find((w) => w.id === s.wallId),
    els = r ? p.elements.filter((e) => e.roomId === r.id || r.wallIds.includes(e.wallId)) : [],
    zones = p.zones.filter((z) => z.roomId === r?.id),
    e = p.elements.find((e) => e.id === s.elementId);
  const readings = currentWallReadings(p);
  function wallRow(id, i) {
    const reading = readings.get(id);
    const source = reading ? readingMethod(reading.method).label : 'Çizim';
    const value = reading ? `${reading.raw} ${reading.unit}` : metre(wallLength(p, id));
    return `<button data-act="wall" data-id="${esc(id)}" class="wall-line ${w?.id === id ? 'active' : ''}"><span class="wall-letter">${wallName(i)}</span><span>Duvar ${wallName(i)}<small>${source}</small></span><b>${esc(value)}</b></button>`;
  }
  let body = r
    ? `<div class="room-kicker"><span class="code-tag">${esc(r.code)}</span><span>Seçili mahal</span></div><h2>${esc(r.name)}</h2><div class="stat-grid">${stat('Net alan', num(roomArea(p, r.id) / 1e6, 2) + ' m²')}<button class="height-stat" data-act="room-height" data-id="${esc(r.id)}" aria-label="Mahal tavan yüksekliğini düzenle"><small>Tavan</small><strong>${esc(Number.isFinite(r.height) ? metre(r.height) : 'Ölçü gir')}</strong></button></div>${button('edit-room', 'Mahal özellikleri', 'settings', 'text-btn small')}
    <section><div class="group-title"><h3>Duvarlar</h3><span class="count">${r.wallIds.length}</span></div><div class="wall-list">${r.wallIds.map(wallRow).join('')}</div></section>`
    : `<div class="empty">Başlamak için bir mahal seçin.</div>`;
  if (w && r) {
    const i = r.wallIds.indexOf(w.id);
    body += `<section><div class="group-title"><h3>Duvar ${wallName(i)}</h3></div><div class="row-wrap">${button('resize-wall', 'Ölçüyü gir', 'dimension', 'secondary')}${button('face', 'Yüzü aç', 'wall', 'secondary')}</div>${actionRow('wall-more', 'Duvar işlemleri', 'dots')}</section>`;
  }
  if (e)
    body += `<section><div class="group-title"><h3>Seçili eleman</h3></div>${actionRow('edit-element', e.name || elements[e.type], 'door')}${['door', 'window'].includes(e.type) ? actionRow('opening-detail', 'Detay çizimi', 'ink') : ''}</section>`;
  if (r)
    body += `<section><div class="group-title"><h3>Açıklıklar ve öğeler</h3>${ib('add-element', 'Öğe ekle', 'plus')}</div>${els.map((e) => `<button class="item-line" data-act="element" data-id="${esc(e.id)}">${icon(e.type === 'window' ? 'wall' : 'door', 15)}<span>${esc(e.name || elements[e.type])}</span><small>${metre(e.width)}</small></button>`).join('') || '<p class="tiny-empty">Henüz öğe eklenmedi.</p>'}</section>
    <section><div class="group-title"><h3>Kot bölgeleri</h3>${ib('add-zone', 'Kot bölgesi ekle', 'plus')}</div>${zones.map((z) => `<button class="item-line" data-act="zone-info" data-id="${esc(z.id)}">${icon('slab', 15)}<span>${esc(z.name || zoneNames[z.type])}</span></button>`).join('') || '<p class="tiny-empty">Tavan, asma kat veya boşluk ekleyin.</p>'}</section>`;
  return `<aside class="inspector panel ${s.mobilePanel === 'detail' ? 'shown' : ''}" aria-label="Seçim özellikleri"><div class="panel-head"><div class="eyebrow">${icon('settings', 14)} ÖZELLİKLER</div>${ib('close-panel', 'Paneli kapat', 'close', 'data-mobile')}</div><div class="inspect-scroll">${body}</div></aside>`;
}
export function layout(p, s) {
  const floor = p.floors.find((f) => f.id === s.floorId);
  return (
    top(s) +
    `<div class="project-head"><div class="head-title">${ib('projects', 'Proje arşivine dön', 'folder')}<div class="title-text"><h1>${esc(p.name)}</h1><div class="subtle">${p.customer?.name ? esc(p.customer.name) + ' <span>/</span> ' : ''}${p.location ? esc(p.location) + ' <span> / </span> ' : ''}${esc(floor?.name || 'Kat yok')}</div></div></div><div class="head-actions"><div class="history">${ib('undo', 'Geri al', 'undo', s.undo ? '' : 'disabled')}${ib('redo', 'Yinele', 'redo', s.redo ? '' : 'disabled')}</div>${button('export', 'Dışa aktar', 'download', 'primary')}${ib('more', 'Diğer işlemler', 'dots')}</div></div>
    <div class="workspace">${sidebar(p, s)}<main class="drawing" id="drawing" tabindex="-1"><div class="views">${modes.map(([key, name, ic]) => button('view', name, ic, 'view ' + (s.mode === key ? 'on' : ''), `data-mode="${key}" aria-pressed="${s.mode === key}"`)).join('')}</div>
    <div class="mobile-ribbon">${button('rooms-panel', 'Kat ve mahaller', 'layers', 'text-btn')}${button('detail-panel', 'Özellikler', 'settings', 'text-btn')}</div>
    ${verticalToolbar(p,s)}
    <div class="drawing-field ${s.grid ? 'grid-bg' : ''}"><div class="drawing-label"><span class="live-dot"></span>${esc(floor?.name)}<span> / </span>${esc(modes.find((v) => v[0] === s.mode)?.[1])}</div>
    ${['plan', 'ceiling'].includes(s.mode) && Number.isFinite(p.northAngle) ? `<div class="north" aria-label="Kuzey ${+p.northAngle} derece"><b>K</b><i style="transform:rotate(${+p.northAngle}deg)"></i></div>` : ''}
    <svg id="viewport" role="img" aria-label="${esc(p.name)} ${esc(s.mode)} çizimi" preserveAspectRatio="xMidYMid meet"></svg>
    <div class="toolbox" aria-label="Çizim araçları">${(s.mode === 'plan'
      ? tools
      : s.mode === 'elevation'
        ? [
            ['select', 'Öğe seç', 'select'],
            ['measure', 'İki noktayı ölç', 'ruler'],
            ['ink', 'Duvarda eskiz', 'ink'],
            ['erase', 'Duvarda silgi', 'erase'],
          ]
        : s.mode === 'model'
          ? [
              ['select', 'Yüz seç', 'select'],
              ['measure', 'Modelde ölç', 'ruler'],
            ]
          : [
              ['select', 'Öğe seç', 'select'],
              ['measure', 'İki noktayı ölç', 'ruler'],
            ]
    )
      .map(([t, l, ic]) =>
        ib('tool', l, ic, `data-tool="${t}" class-ignore="" aria-pressed="${s.tool === t}"`),
      )
      .join(
        '',
      )}${ib('add-note', 'Saha notu ekle', 'note')}${ib('camera', 'Fotoğraf çek veya ekle', 'camera')}</div>
    ${s.mode === 'section' ? '<div class="section-tools">' + button('section-manager', (p.sections || []).find((v) => v.id === s.sectionId)?.name || 'Kesit çizgisi', 'section', 'secondary') + button('section-openings', 'Kapı ve pencereler', 'door', 'secondary') + '</div>' : ''}
    <div id="tool-hint" aria-live="polite"></div><div class="canvas-bottom"><div class="scale-mark" aria-label="Ölçek"><span id="scale-text">1 m</span><i></i></div><div class="zoom">${s.mode === 'model' ? ib('rotate-left', 'Modeli sola döndür', 'left') + ib('rotate-right', 'Modeli sağa döndür', 'rotate') : ''}${ib('zoom-out', 'Uzaklaştır', 'minus')}<span id="zoom-text">100%</span>${ib('zoom-in', 'Yakınlaştır', 'plus')}${ib('fit', 'Çizime sığdır', 'fit')}</div></div></div>
    <div class="canvas-status"><span>${icon('select', 13)}${esc(s.mode === 'model' && s.tool === 'select' ? 'Sürükle · döndür' : toolLabel[s.tool] || 'Seçim')}</span><span>${s.mode === 'plan' ? num(p.rooms.filter((r) => r.floorId === s.floorId).length) + ' mahal' : esc(modes.find((m) => m[0] === s.mode)?.[1])} · ${esc(p.unit)}</span></div></main>${inspector(p, s)}</div>
    ${s.mobilePanel ? '<button class="panel-scrim" aria-label="Paneli kapat" data-act="close-panel"></button>' : ''}`
  );
}
