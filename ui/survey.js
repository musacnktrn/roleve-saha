/* [codex] ureten: codex */
import * as G from '../geometry/core.js';
import { esc, icon, button, ib, metre, num, fmt, readMm, uid, dateText, safePhoto } from './base.js';
import { form, showDialog, closeDialog, notify, capturePhoto } from './dialog.js';
import { wallName } from './plan.js';
export const measureKinds = [
  ['plan', 'Planda uçtan uca'],
  ['diagonal', 'Diyagonal'],
  ['perpendicular', 'Yüze dik uzaklık'],
  ['x', 'X izdüşümü'],
  ['y', 'Y izdüşümü'],
  ['vertical', 'Düşey'],
  ['spatial', 'Gerçek 3B mesafe'],
  ['level', 'Kot farkı'],
];
const methods = [
  ['manual', 'Şerit metre'],
  ['laser', 'Lazer · elle giriş'],
  ['scan', 'Tarama'],
  ['estimate', 'Fotoğraf / tahmin'],
  ['model', 'Modelden hesap'],
];
export function anchorsFor(p, r) {
  if (!r) return [];
  const out = [];
  r.nodeIds.forEach((id, i) => out.push({ nodeId: id, label: `${r.code} · Köşe ${i + 1}` }));
  r.wallIds.forEach((id, i) => {
    let w = p.walls.find((w) => w.id === id);
    for (const side of ['inside', 'outside', 'axis']) {
      if (side !== 'inside' && w?.thickness == null) continue;
      out.push({
        wallId: id,
        roomId: r.id,
        t: 0.5,
        side,
        label: `Duvar ${wallName(i)} · ${side === 'inside' ? 'iç yüz' : side === 'outside' ? 'dış yüz' : 'aks'} ortası`,
      });
    }
  });
  p.elements
    .filter((e) => r.wallIds.includes(e.wallId))
    .forEach((e) => {
      for (const [at, side] of [
        ['start', 'başlangıç'],
        ['end', 'bitiş'],
        ['center', 'merkez'],
      ])
        out.push({ elementId: e.id, at, roomId: e.roomId, label: `${e.name} · ${side}` });
    });
  return out;
}
export function anchorLabel(p, a) {
  return (
    a?.label ||
    p.elements.find((e) => e.id === a?.elementId)?.name ||
    (a?.nodeId ? 'Köşe' : a?.wallId ? 'Duvar noktası' : 'Tanık noktası')
  );
}
export function observationScope(p, first, previous, selectedRoom, selectedFloor) {
  if (previous)
    return {
      roomId: previous.roomId || null,
      floorId: previous.floorId || null,
      wallId: previous.wallId || null,
    };
  const element = p.elements.find((e) => e.id === first?.elementId),
    wall = p.walls.find((w) => w.id === (first?.wallId || element?.wallId)),
    node = p.nodes.find((n) => n.id === first?.nodeId);
  const f = first?.floorId || node?.floorId || wall?.floorId || selectedFloor;
  const candidates = p.rooms.filter(
    (r) =>
      r.floorId === f && (!node || r.nodeIds.includes(node.id)) && (!wall || r.wallIds.includes(wall.id)),
  );
  const r =
    candidates.find((r) => r.id === (first?.roomId || element?.roomId)) ||
    candidates.find((r) => r.id === selectedRoom?.id) ||
    (candidates.length === 1 ? candidates[0] : null);
  return { floorId: f, roomId: r?.id || null, wallId: wall?.id || null };
}
export function observationForm(ctx, initialA = null, initialB = null, old = null) {
  const { p, s } = ctx;
  const origin = observationScope(p, initialA, old, ctx.room, s.floorId),
    room = p.rooms.find((r) => r.id === origin.roomId) || (!old && !initialA ? ctx.room : null),
    all = anchorsFor(p, room);
  [initialA, initialB].forEach((a) => {
    if (a) all.unshift(a);
  });
  if (all.length < 2) {
    notify('Önce iki nokta seçin veya bir mahal ekleyin.');
    return;
  }
  const select = all.map((a, i) => [i, anchorLabel(p, a)]),
    ix = (a) => Math.max(0, all.indexOf(a));
  const first = initialA ? ix(initialA) : 0,
    second = initialB ? ix(initialB) : 1;
  const kind0 = old?.kind || (s.mode === 'model' ? 'spatial' : 'plan');
  let dist = null;
  try {
    dist = G.measure(p, all[first], all[second], kind0);
  } catch {}
  form(
    old ? 'Ölçüyü yeniden kaydet' : 'Uçtan uca ölçü',
    [
      { key: 'a', label: 'Başlangıç ucu', choices: select, value: first },
      { key: 'b', label: 'Bitiş ucu', choices: select, value: second },
      {
        key: 'kind',
        label: 'Ölçü türü',
        choices: measureKinds.some(([k]) => k === kind0)
          ? measureKinds
          : [[kind0, kind0 === 'wall' ? 'Duvar boyu' : 'Önceki ölçü türü · ' + kind0], ...measureKinds],
        value: kind0,
      },
      {
        key: 'method',
        label: 'Ölçü kaynağı',
        choices:
          old?.method && !methods.some(([k]) => k === old.method)
            ? [[old.method, old.method === 'tape' ? 'Şerit metre' : old.method], ...methods]
            : methods,
        value: old?.method || (s.mode === 'model' ? 'model' : 'manual'),
      },
      {
        key: 'raw',
        label: 'Okunan değer',
        number: true,
        value: old?.raw || (s.mode === 'model' && dist != null ? fmt(dist, p.unit) : ''),
      },
      { key: 'unit', label: 'Birim', choices: ['m', 'cm', 'mm'], value: old?.unit || p.unit },
      {
        key: 'note',
        label: 'Ölçü notu',
        full: true,
        value: old?.note || '',
        placeholder: 'Örn. Sol söveden kolon yüzüne',
      },
      {
        key: 'device',
        label: 'Cihaz okuma dosyası (isteğe bağlı)',
        type: 'file',
        accept: '.json,application/json',
        full: true,
        hint: 'Desteklenen aktarım biçimi: deviceId, readingId, raw ve unit. Ölçünün iki ucunu yukarıda seçin.',
      },
      { key: 'shape', label: 'Diyagonal ile dörtgeni şekillendir', type: 'check' },
      { key: 'again', label: 'Sonraki ölçüde başlangıç ucunu koru', type: 'check' },
    ],
    'Ölçüyü kaydet',
    async (d) => {
      const a = all[+d.a],
        b = all[+d.b];
      if (d.a === d.b || a === b) throw Error('Farklı iki uç seçin.');
      let device = null;
      if (d.device?.size) {
        if (d.device.size > 24000) throw Error('Tek okumalık bir aktarım dosyası seçin.');
        try {
          device = JSON.parse(await d.device.text());
        } catch {
          throw Error('Cihaz okuma dosyası açılamadı.');
        }
        if (
          !device ||
          !['deviceId', 'readingId', 'raw', 'unit'].every((k) => typeof device[k] === 'string') ||
          !['m', 'cm', 'mm'].includes(device.unit)
        )
          throw Error('Cihaz, okuma kimliği, ham değer ve birim gerekli.');
        if (d.shape) throw Error('Cihaz okumasını kaydettikten sonra geometriye uygulayın.');
        d.raw = device.raw;
        d.unit = device.unit;
        d.method = 'laser';
      }
      const v = readMm(d.raw, d.unit);
      if (v < 0 && d.kind !== 'level') throw Error('Uzunluk negatif olamaz.');
      await ctx.change('Ölçü kaydedildi', (q) => {
        if (d.shape) {
          if (!room || !a.nodeId || !b.nodeId || d.kind !== 'diagonal')
            throw Error('Şekillendirme için aynı dörtgenin iki çapraz köşesini ve Diyagonal türünü seçin.');
          G.reshapeDiagonal(q, room.id, a.nodeId, b.nodeId, v);
        }
        const record = {
          ...observationScope(p, a, old, room, s.floorId),
          kind: d.kind,
          a,
          b,
          raw: d.raw,
          unit: d.unit,
          value: v,
          method: d.method,
          note: d.note,
          date: new Date().toISOString(),
          visitId: activeVisit(q)?.id || null,
          replaces: old?.id,
        };
        if (device)
          G.recordDeviceReading(q, { ...record, deviceId: device.deviceId, readingId: device.readingId });
        else G.addObservation(q, record);
      });
      ctx.set({ tool: d.again ? 'measure' : 'select', anchors: d.again ? [a] : [], mobilePanel: '' });
    },
    {
      intro: [p.floors.find((f) => f.id === origin.floorId)?.name, room?.name].filter(Boolean).join(' / '),
      extra: '<div class="preview-box" id="measure-preview"></div>',
      after: (f) => {
        const preview = () => {
          const a = all[+f.elements.a.value],
            b = all[+f.elements.b.value],
            k = f.elements.kind.value,
            u = f.elements.unit.value;
          try {
            const v = G.measure(p, a, b, k);
            f.querySelector('#measure-preview').textContent = 'Çizimden hesaplanan: ' + fmt(v, u) + ' ' + u;
            if (f.elements.method.value === 'model') f.elements.raw.value = fmt(v, u);
          } catch (err) {
            f.querySelector('#measure-preview').textContent = err.message;
          }
        };
        const unit = f.elements.unit;
        let previous = unit.value;
        unit.addEventListener('change', () => {
          try {
            if (f.elements.raw.value)
              f.elements.raw.value = fmt(readMm(f.elements.raw.value, previous), unit.value);
          } catch {}
          previous = unit.value;
        });
        for (const key of ['a', 'b', 'kind', 'unit', 'method'])
          f.elements[key].addEventListener('change', preview);
        preview();
      },
    },
  );
}
export function activeVisit(p) {
  return p.visits
    .slice()
    .reverse()
    .find((v) => v.status !== 'done');
}
export function notebook(ctx) {
  const { p } = ctx;
  showDialog(
    'Saha defteri',
    `<div class="row-wrap">${button('add-note', 'Not ekle', 'plus', 'primary')}${button('place-photo', 'Çekim yerini ve bakışı seç', 'camera', 'secondary')}${button('pin-note', 'Planda not bırak', 'pin', 'secondary')}${button('ink-mode', 'Kalemle yaz', 'ink', 'secondary')}</div><div class="menu-grid later">${
      p.notes
        .slice()
        .reverse()
        .map(
          (n) =>
            `<button class="dlg-row" data-act="note-info" data-id="${esc(n.id)}">${safePhoto(n.photo?.data) ? `<img alt="Saha fotoğrafı" src="${safePhoto(n.photo.preview?.data) ? n.photo.preview.data : n.photo.data}">` : icon('note')}<span class="info"><strong>${esc(n.text || 'Saha fotoğrafı')}</strong><small>${esc(p.rooms.find((r) => r.id === n.roomId)?.name || 'Genel not')} · ${dateText(n.date)}${n.scene === 'exterior' ? ' · Dış çekim' : ''}${n.place ? ' · ' + esc(n.place) : ''}${n.photo ? ' · ' + esc(surfaces[n.surface] || 'Fotoğraf') : ''} · ${n.status === 'done' ? 'Tamamlandı' : 'Açık'}</small></span></button>`,
        )
        .join('') || '<p class="empty">Bu projedeki ilk saha notunu ekleyebilirsiniz.</p>'
    }</div>`,
  );
}
export const surfaces = {
  wall: 'Duvar',
  ceiling: 'Tavan',
  floor: 'Zemin',
  facade: 'Cephe',
  detail: 'Detay',
  general: 'Genel',
};
export function noteForm(ctx, existing = null, newAnchor = null, opts = {}) {
  const { p, s, room, wall } = ctx,
    initialRoom = opts.target ? opts.target.roomId : (existing?.roomId ?? room?.id),
    initialWall = opts.target ? opts.target.wallId : (existing?.wallId ?? wall?.id),
    allRooms = [['', 'Genel not'], ...p.rooms.map((r) => [r.id, `${r.code} · ${r.name}`])];
  form(
    opts.photoFirst ? 'Saha fotoğrafı' : existing ? 'Notu düzenle' : 'Saha notu',
    [
      { key: 'roomId', label: 'Mahal', choices: allRooms, value: initialRoom ?? '' },
      {
        key: 'wallId',
        label: 'Duvar',
        choices: [['', 'Genel'], ...(room?.wallIds || []).map((v, i) => [v, 'Duvar ' + wallName(i)])],
        value: initialWall || '',
      },
      {
        key: 'side',
        label: 'Yüz',
        choices: [
          ['inside', 'İç yüz'],
          ['outside', 'Dış yüz'],
        ],
        value: existing?.side || s.side || 'inside',
      },
      {
        key: 'status',
        label: 'Durum',
        choices: [
          ['open', 'Açık'],
          ['remeasure', 'Tekrar ölç'],
          ['unavailable', 'Erişilemedi'],
          ['done', 'Tamamlandı'],
        ],
        value: existing?.status || 'open',
      },
      {
        key: 'text',
        label: 'Not',
        type: 'textarea',
        full: true,
        value: existing?.text || '',
        placeholder: 'Neyi, nereden ölçtünüz?',
      },
      {
        key: 'scene',
        label: 'Çekim yeri',
        choices: [
          ['interior', 'Yapı içi'],
          ['exterior', 'Yapı dışı / çevre'],
        ],
        value: opts.scene || existing?.scene || 'interior',
      },
      {
        key: 'place',
        label: 'Çekim yerinin tarifi',
        full: true,
        value: existing?.place || '',
        maxlength: 240,
        placeholder: 'Örn. Karşı kaldırım, girişin 3 m solu',
      },
      {
        key: 'surface',
        label: 'Hangi yüz çekildi?',
        choices: Object.entries(surfaces),
        value: opts.surface || existing?.surface || 'general',
      },
      {
        key: 'direction',
        label: 'Planda bakış yönü (°)',
        number: true,
        value: opts.direction ?? existing?.direction ?? '',
        hint: 'Planın üstü 0°, sağı 90°. İki noktadan da seçilebilir.',
      },
      { key: 'latitude', label: 'Enlem (isteğe bağlı)', number: true, value: existing?.gps?.latitude ?? '' },
      {
        key: 'longitude',
        label: 'Boylam (isteğe bağlı)',
        number: true,
        value: existing?.gps?.longitude ?? '',
      },
      { key: 'photo', label: 'Galeriden veya dosyadan seç', type: 'file', accept: 'image/*,.heic,.heif,.avif', full: true },
      ...(opts.photoFirst
        ? [{ key: 'camera', label: 'Kamerayla çek', type: 'file', capture: true, full: true }]
        : []),
      ...(opts.photoFirst
        ? [{ key: 'openPhoto', label: 'Kaydedince fotoğraf üzerinde çalış', type: 'check', value: true }]
        : []),
    ],
    'Kaydet',
    async (d) => {
      const direction =
        String(d.direction).trim() === '' ? null : Number(String(d.direction).replace(',', '.'));
      if (direction !== null && (!Number.isFinite(direction) || direction < 0 || direction >= 360))
        throw Error('Bakış yönünü 0–359,99° arasında girin.');
      if (d.camera?.size && d.photo?.size) throw Error('Kamera veya galeriden tek fotoğraf seçin.');
      const file = d.camera?.size ? d.camera : d.photo;
      const photo = file?.size ? await capturePhoto(file) : existing?.photo;
      if (opts.photoFirst && !photo) throw Error('Kamerayı kullanın veya galeriden bir fotoğraf seçin.');
      if (!String(d.text).trim() && !photo) throw Error('Bir not yazın veya fotoğraf ekleyin.');
      const latText = String(d.latitude || '').trim(),
        lonText = String(d.longitude || '').trim();
      let gps = null;
      if (latText || lonText) {
        const latitude = Number(latText.replace(',', '.')),
          longitude = Number(lonText.replace(',', '.'));
        if (
          !latText ||
          !lonText ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 ||
          Math.abs(longitude) > 180
        )
          throw Error('Geçerli bir enlem ve boylam çifti girin.');
        gps = { latitude, longitude };
      }
      const noteId = existing?.id || uid();
      await ctx.change(photo ? 'Saha fotoğrafı kaydedildi' : 'Saha notu kaydedildi', (q) => {
        const r = q.rooms.find((r) => r.id === d.roomId),
          w = r?.wallIds.includes(d.wallId) ? d.wallId : null;
        const n = {
          ...existing,
          id: noteId,
          roomId: r?.id || null,
          floorId: r?.floorId || s.floorId,
          wallId: w,
          side: d.side,
          text: d.text.trim(),
          photo: photo || undefined,
          status: d.status,
          date: new Date().toISOString(),
          visitId: activeVisit(q)?.id || null,
        };
        n.scene = d.scene;
        n.place = d.place.trim();
        n.gps = gps;
        n.surface = d.surface;
        n.direction = direction;
        if (opts.target && direction === opts.direction) n.target = opts.target;
        else if (opts.target || existing?.direction !== direction) delete n.target;
        if (existing && existing.wallId !== w) {
          delete n.t;
          delete n.anchor;
        }
        if (newAnchor) n.anchor = newAnchor;
        if (w && n.anchor) {
          const wall = q.walls.find((v) => v.id === w),
            a = q.nodes.find((v) => v.id === wall.a),
            b = q.nodes.find((v) => v.id === wall.b);
          const dx = b.x - a.x,
            dy = b.y - a.y;
          n.t = Math.min(
            1,
            Math.max(0, ((n.anchor.x - a.x) * dx + (n.anchor.y - a.y) * dy) / (dx * dx + dy * dy)),
          );
        }
        if (existing?.rebind && w) delete n.rebind;
        const idx = q.notes.findIndex((row) => row.id === n.id);
        if (idx >= 0) q.notes[idx] = n;
        else q.notes.push(n);
      });
      if (photo && d.openPhoto) await ctx.openPhoto(noteId);
    },
    {
      extra:
        (opts.photoFirst || existing?.photo
          ? '<div class="form-tools"><button type="button" class="secondary" data-gps>Bu cihazın konumunu ekle</button><small data-gps-status role="status"></small></div>'
          : '') +
        (existing?.photo && safePhoto(existing.photo.data)
          ? `<img class="note-full" alt="Saha fotoğrafı" src="${existing.photo.data}">`
          : '') +
        (existing
          ? `<div class="form-tools">${existing.photo ? button('photo-edit', 'Fotoğrafı işaretle ve ölç', 'draw', 'primary', `data-id="${esc(existing.id)}"`) + button('place-photo', 'Çekim noktası ve bakış', 'camera', 'secondary', `data-id="${esc(existing.id)}"`) + button('original-photo', existing.photo.sourceType ? 'Özgün fotoğrafı indir' : 'Kayıtlı fotoğrafı indir', 'download', 'secondary', `data-id="${esc(existing.id)}"`) : ''}${button('go-note', 'Plandaki yerine git', 'pin', 'secondary', `data-id="${esc(existing.id)}"`)}${button('pin-note', 'İğneyi yerleştir', 'pin', 'secondary', `data-id="${esc(existing.id)}"`)}</div>`
          : ''),
      after: (f) => {
        const geo = f.querySelector('[data-gps]');
        if (geo)
          geo.onclick = () => {
            const status = f.querySelector('[data-gps-status]');
            if (!navigator.geolocation) {
              status.textContent = 'Konum özelliği yok. İsterseniz elle girin.';
              return;
            }
            geo.disabled = true;
            status.textContent = 'Konum bekleniyor…';
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                geo.disabled = false;
                f.elements.latitude.value = pos.coords.latitude.toFixed(6);
                f.elements.longitude.value = pos.coords.longitude.toFixed(6);
                status.textContent =
                  'Cihaz doğruluğu yaklaşık ' + Math.round(pos.coords.accuracy) + ' m. Kaydet ile onaylayın.';
              },
              () => {
                geo.disabled = false;
                status.textContent = 'Konum alınamadı. Yer tarifini veya koordinatları elle girebilirsiniz.';
              },
              { maximumAge: 10000, timeout: 12000, enableHighAccuracy: true },
            );
          };
        const update = () => {
          const r = p.rooms.find((r) => r.id === f.elements.roomId.value);
          f.elements.wallId.innerHTML =
            `<option value="">Genel</option>` +
            (r?.wallIds || [])
              .map((id, i) => `<option value="${esc(id)}">${esc('Duvar ' + wallName(i))}</option>`)
              .join('');
        };
        f.elements.roomId.onchange = update;
        update();
        f.elements.wallId.value = initialWall || '';
      },
    },
  );
}
export function visits(ctx) {
  const { p } = ctx;
  showDialog(
    'Saha ziyaretleri',
    `<div class="row-wrap">${button('new-visit', 'Ziyaret aç', 'plus', 'primary')}${button('checks', 'Kontrol listesi', 'flag', 'secondary')}</div><div class="menu-grid later">${
      p.visits
        .slice()
        .reverse()
        .map(
          (v) =>
            `<div class="dlg-row">${icon('visit')}<span class="info"><strong>${esc(v.name)}</strong><small>${dateText(v.date)} · ${esc(v.person ? 'Ölçen: ' + v.person : v.instrument || 'Saha')}${v.recordedBy ? ' · Kaydı giren: ' + esc(v.recordedBy) : ''} · ${v.status === 'done' ? 'Tamamlandı' : 'Açık'}</small></span>${v.status === 'done' ? '' : ib('end-visit', 'Ziyareti bitir', 'check', `data-id="${esc(v.id)}"`)}</div>`,
        )
        .join('') || '<p class="empty">Henüz ziyaret açılmadı.</p>'
    }</div>`,
  );
}
export function newVisit(ctx) {
  form(
    'Yeni ziyaret',
    [
      {
        key: 'name',
        label: 'Ziyaret adı',
        required: true,
        full: true,
        maxlength: 100,
        value: 'Saha ziyareti',
      },
      { key: 'person', label: 'Sahada ölçüyü alan kişi', value: ctx.p.surveyorName || '' },
      { key: 'instrument', label: 'Araç', choices: ['Şerit metre', 'Lazer', 'Telefon', 'Diğer'] },
    ],
    'Ziyareti aç',
    async (d) =>
      ctx.change('Ziyaret açıldı', (q) =>
        q.visits.push({ ...d, id: uid(), date: new Date().toISOString(), status: 'open' }),
      ),
  );
}
export function checks(ctx) {
  const { p } = ctx,
    c = G.projectChecks(p).filter((v) => v.kind !== 'note'),
    notes = p.notes.filter((n) => n.status !== 'done');
  showDialog(
    'Saha kontrol listesi',
    `<p class="intro">${c.length} geometri kontrolü · ${notes.length} açık not</p><div class="menu-grid">${c.map((v, i) => `<button class="dlg-row" data-act="check-item" data-id="${esc(v.id)}">${icon('ruler')}<span class="info"><strong>${esc(v.message)}</strong><small>${esc(p.rooms.find((r) => r.id === v.roomId)?.name || 'Proje')}</small></span></button>`).join('')}${notes.map((n) => `<button class="dlg-row" data-act="note-info" data-id="${esc(n.id)}">${icon('flag')}<span class="info">${esc(n.text || n.photo?.name || 'Saha notu')}</span></button>`).join('') || (!c.length ? '<p class="empty">Açık kontrol kaydı yok.</p>' : '')}</div><div class="form-tools">${button('add-note', 'Eksik ölçü notu ekle', 'plus', 'secondary')}</div>`,
  );
}
export function measurementList(ctx) {
  const { p } = ctx;
  showDialog(
    'Ölçü defteri',
    `<div class="row-wrap">${button('measure-form', 'Uçları listeden seç', 'ruler', 'primary')}${button('chain', 'Zincir kontrolü', 'dimension', 'secondary')}</div><div class="menu-grid later">${
      p.observations
        .slice()
        .reverse()
        .map(
          (o) =>
            `<button data-act="observation" data-id="${esc(o.id)}" class="dlg-row">${icon('dimension')}<span class="info"><strong>${esc(o.note || measureKinds.find(([k]) => k === o.kind)?.[1] || 'Ölçü')} · ${esc(o.raw)} ${esc(o.unit)}</strong><small>${esc(anchorLabel(p, o.a))} → ${esc(anchorLabel(p, o.b))} · ${esc(methods.find(([k]) => k === o.method)?.[1] || o.method)}${p.observations.some((v) => v.replaces === o.id) ? ' · önceki okuma' : ''}</small></span></button>`,
        )
        .join('') ||
      '<p class="empty">İki ucu planda seçerek veya listeden belirleyerek ilk ölçüyü kaydedin.</p>'
    }</div>`,
  );
}
export function chainForm(ctx) {
  const { p } = ctx;
  if (p.observations.length < 3) {
    notify('En az iki parça ölçüsü ve bir toplam ölçüsü kaydedin.');
    return;
  }
  const choices = p.observations.map((o) => [
    o.id,
    `${anchorLabel(p, o.a)} → ${anchorLabel(p, o.b)} · ${o.raw} ${o.unit}`,
  ]);
  form(
    'Zincir kapanması',
    [
      { key: 'total', label: 'Doğrudan toplam', choices, full: true },
      ...p.observations.map((o, i) => ({ key: o.id, label: 'Parça · ' + choices[i][1], type: 'check' })),
    ],
    'Farkı göster',
    (d, f) => {
      const parts = p.observations.map((o) => o.id).filter((id) => d[id] && id !== d.total);
      const v = G.chainClosure(p, parts, d.total);
      f.querySelector('.preview-box').textContent =
        `Toplam − parçalar: ${num(v.difference, 2)} mm · ${v.withinTolerance ? 'Tolerans içinde' : 'Tekrar ölç'} · Tolerans ${v.tolerance} mm`;
      return false;
    },
    { extra: '<div class="preview-box" aria-live="polite"></div>' },
  );
}
