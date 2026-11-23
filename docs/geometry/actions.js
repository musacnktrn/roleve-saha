// [codex] ureten: codex
import {
  addAdjacentRoom,
  addElement,
  addFloor,
  addObservation,
  addRoom,
  addZone,
  alignFloorXY,
  arcFromSagitta,
  duplicateRoom,
  formatLength,
  mergeWalls,
  moveNode,
  newId,
  openingLevels,
  parseLength,
  reshapeDiagonal,
  resizeWall,
  roomPoints,
  setWallLock,
  splitWall,
  surveyAreas,
  templatePoints,
  updateElement,
  validateProject,
  wallLength,
  zoneSurfaceAt,
} from './core.js';
import { button, esc, fmt, icon, metre } from '../ui/base.js';
import { closeDialog, form, showDialog } from '../ui/dialog.js';
import { elements as elementLabels, zoneNames as zoneLabels } from '../ui/layout.js';
import { activeVisit } from '../ui/survey.js';
import { ceilingMethods, ceilingMethodLabel, ceilingOpeningConflicts, roomCeilingInfo, setRoomCeiling } from './ceiling.js';

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const edgeName = (i) => (i < chars.length ? chars[i] : String(i + 1));
const options = (object) => Object.entries(object);
const text = (key, label, value = '', required = false) => ({
  key,
  label,
  value,
  required,
  maxlength: 120,
});
const select = (key, label, choices, value) => ({ key, label, choices, value });
const check = (key, label, value = false) => ({ key, label, type: 'check', value });
const length = (key, title, mm, u, required = true) => ({
  key,
  label: title + ' (' + u + ')',
  value: fmt(mm, u),
  number: true,
  required,
});
function mm(d, key, u, nullable = false) {
  const v = String(d[key] ?? '').trim();
  return !v && nullable ? null : parseLength(v, u);
}
// The editing field displays a rounded value. A name or note change must preserve the surveyed precision.
function editedMm(data, key, unit, original, nullable = true) {
  if (Number.isFinite(original) && data[key] === fmt(original, unit)) return original;
  return mm(data, key, unit, nullable);
}
const number = (raw, title) => {
  const v = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v) || !Number.isFinite(Number(v)))
    throw Error(title + ' için sayı girin.');
  return Number(v);
};
function wallList(p, r) {
  return r.wallIds.map((id, i) => [id, 'Duvar ' + edgeName(i) + ' · ' + metre(wallLength(p, id))]);
}
function selectedRoom(ctx) {
  return (
    ctx.room ||
    ctx.p.rooms.find((r) => r.id === ctx.s.roomId) ||
    ctx.p.rooms.find((r) => r.floorId === ctx.s.floorId)
  );
}
function selectedWall(ctx, r) {
  const w = ctx.wall?.id || ctx.s.wallId;
  return r.wallIds.includes(w) ? w : r.wallIds[0];
}
function patchRoom(ctx, r, extra = {}) {
  ctx.set({
    roomId: r.id,
    floorId: r.floorId,
    wallId: null,
    elementId: null,
    zoneId: null,
    nodeId: null,
    tool: 'select',
    draft: [],
    ...extra,
  });
}
function extent(points) {
  const xx = points.map((n) => n.x),
    yy = points.map((n) => n.y);
  return { left: Math.min(...xx), right: Math.max(...xx), top: Math.min(...yy), bottom: Math.max(...yy) };
}
// Hide and disable fields outside the selected branch, so their native validation never blocks submission.
function fieldVisibility(f, visible) {
  for (const [key, on] of Object.entries(visible)) {
    const el = f.elements.namedItem(key);
    if (!el) continue;
    el.disabled = !on;
    const box = el.closest('label');
    if (box) {
      box.hidden = !on;
      box.style.display = on ? '' : 'none';
    }
  }
}
function menu(title, entries, details = '') {
  return showDialog(
    title,
    details +
      entries
        .map(
          ([key, label, ico]) =>
            '<button type="button" class="item-line" data-geo="' +
            esc(key) +
            '">' +
            icon(ico || 'right', 18) +
            '<span>' +
            esc(label) +
            '</span>' +
            icon('right', 15) +
            '</button>'
        )
        .join(''),
    (d) => {
      for (const btn of d.querySelectorAll('[data-geo]'))
        btn.onclick = entries.find((item) => item[0] === btn.dataset.geo)[3];
    }
  );
}
async function save(ctx, label, apply, after) {
  let result;
  const ok = await ctx.change(label, (q) => {
    result = apply(q);
  });
  if (ok === false) return false;
  after?.(result);
  return true;
}
function showAddRoom(ctx, r, initialKind = 'rect') {
  const p = ctx.p,
    u = p.unit,
    floorId = ctx.s.floorId || p.floors[0].id;
  const nodes = p.nodes.filter((n) => n.floorId === floorId);
  const start = nodes.length
    ? { x: Math.max(...nodes.map((n) => n.x)) + 500, y: Math.min(...nodes.map((n) => n.y)) }
    : { x: 0, y: 0 };
  const shapes = [
    ['rect', 'Dikdörtgen'],
    ['l', 'L oda'],
    ['u', 'U oda'],
    ['corridor', 'Koridor'],
    ['free', 'Köşeleri planda çiz'],
  ];
  if (r) shapes.push(['adjacent', 'Ortak duvara bitişik']);
  const fields = [
    text('name', 'Mahal adı', '', true),
    text('code', 'Mahal kodu', String(p.rooms.length + 1).padStart(2, '0')),
    select('shape', 'Başlangıç', shapes, initialKind),
  ];
  if (r) fields.push(select('wallId', 'Ortak duvar', wallList(p, r), selectedWall(ctx, r)));
  fields.push(
    length('width', 'En', 4000, u),
    length('depth', 'Derinlik', 3000, u),
    length('x', 'Başlangıç X', start.x, u),
    length('y', 'Başlangıç Y', start.y, u),
    length('height', 'Net tavan yüksekliği', null, u, false)
  );
  return form(
    'Mahal ekle',
    fields,
    'Devam',
    async (d) => {
      const data = { name: d.name.trim(), code: d.code.trim(), floorId, height: mm(d, 'height', u, true) };
      if (!data.name) throw Error('Mahal adı girin.');
      if (data.height != null && data.height <= 0) throw Error('Net yükseklik sıfırdan büyük olmalı.');
      if (d.shape === 'free') {
        ctx.set({ mode: 'plan', tool: 'draw', draft: [], roomDraft: data, mobilePanel: null });
        return;
      }
      return save(
        ctx,
        'Mahal eklendi',
        (q) => {
          if (d.shape === 'adjacent')
            return addAdjacentRoom(q, {
              ...data,
              roomId: r.id,
              wallId: d.wallId,
              depth: mm(d, 'depth', u),
            });
          return addRoom(q, {
            ...data,
            points: templatePoints(d.shape, mm(d, 'width', u), mm(d, 'depth', u), {
              x: mm(d, 'x', u),
              y: mm(d, 'y', u),
            }),
          });
        },
        (out) => patchRoom(ctx, out, { mode: 'plan' })
      );
    },
    {
      after: (f) => {
        const shape = f.elements.namedItem('shape');
        const update = () => {
          const templ = !['free', 'adjacent'].includes(shape.value);
          fieldVisibility(f, {
            wallId: shape.value === 'adjacent',
            width: templ,
            depth: shape.value !== 'free',
            x: templ,
            y: templ,
          });
        };
        shape.addEventListener('change', update);
        update();
      },
    }
  );
}
function ceilingHistory(info) {
  if (!info.history.length) return '<p class="tiny-empty" data-ceiling-history>Önceki tavan ölçüsü yok.</p>';
  const rows = info.history.map((o) => {
    const instant = new Date(o.date);
    const date = Number.isFinite(instant.getTime())
      ? instant.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
      : 'Tarih bilinmiyor';
    const entered = o.entered || o.raw + ' ' + o.unit;
    const original = /(mm|cm|m)$/i.test(entered) ? entered : entered + ' ' + o.unit;
    return (
      '<li>' +
      esc(original) +
      ' · ' +
      esc(ceilingMethodLabel(o.method)) +
      ' · ' +
      esc(date) +
      (o.id === info.current?.id ? ' · güncel' : ' · önceki') +
      '</li>'
    );
  });
  return (
    '<details data-ceiling-history><summary>Tavan ölçü geçmişi (' +
    rows.length +
    ')</summary><ol>' +
    rows.join('') +
    '</ol></details>'
  );
}

function showEditRoom(ctx, r, heightOnly = false) {
  const p = ctx.p,
    unit = p.unit,
    info = roomCeilingInfo(p, r.id);
  const shownHeight = (u) => (r.height == null ? '' : formatLength(r.height, u));
  const identity = heightOnly
    ? []
    : [text('name', 'Mahal adı', r.name, true), text('code', 'Mahal kodu', r.code)];
  const actions = heightOnly
    ? '<button type="button" class="secondary" data-ceiling-next="ceiling">Tavan bölgesi ekle</button> ' +
      '<button type="button" class="secondary" data-ceiling-next="beam">Kiriş altı ekle</button>'
    : '<button type="button" class="secondary" id="room-copy">' +
      icon('layers', 16) +
      ' Şablondan çoğalt</button>';
  const areas = heightOnly ? null : surveyAreas(p, r.id);
  const area = areas
    ? '<p class="intro">Plan ' +
      esc((areas.footprint / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 2 })) +
      ' m² · Döşeme ' +
      esc((areas.floorSlab / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 2 })) +
      ' m²</p>'
    : '';
  const extra =
    '<div class="preview-box" data-ceiling-preview aria-live="polite"></div>' +
    ceilingHistory(info) +
    area +
    '<div class="form-tools">' +
    actions +
    '</div>' +
    '<div class="preview-box" data-ceiling-discard hidden>Kaydedilmemiş değişiklikler var. ' +
    '<button type="button" class="secondary" data-ceiling-stay>Düzenlemeye dön</button> ' +
    '<button type="button" class="secondary" data-ceiling-abandon>Değişiklikleri at</button></div>';
  return form(
    heightOnly ? 'Genel tavan yüksekliği' : 'Mahal bilgileri',
    [
      ...identity,
      {
        key: 'height',
        label: 'Bitmiş zeminden net tavan yüksekliği',
        value: shownHeight(unit),
        number: true,
        maxlength: 48,
        placeholder: '2,70 m',
        hint: '2,70 m, 270 cm veya 2700 mm girebilirsiniz.',
      },
      select(
        'unit',
        'Ölçü birimi',
        [
          ['m', 'm'],
          ['cm', 'cm'],
          ['mm', 'mm'],
        ],
        unit
      ),
      select('method', 'Ölçüm yöntemi', [['', 'Yöntem belirtilmedi'], ...ceilingMethods], ''),
      check('unmeasured', 'Ölçülmedi olarak kaydet'),
    ],
    heightOnly ? 'Yüksekliği kaydet' : 'Kaydet',
    async (d) => {
      const unchangedReading = !d.unmeasured && !d.method && d.height === shownHeight(d.unit);
      if (unchangedReading && (heightOnly || (d.name?.trim() === r.name && d.code?.trim() === r.code)))
        return;
      return save(
        ctx,
        heightOnly
          ? d.unmeasured
            ? 'Tavan yüksekliği ölçülmedi olarak işaretlendi'
            : 'Tavan yüksekliği güncellendi'
          : 'Mahal bilgileri güncellendi',
        (q) => {
          const current = q.rooms.find((row) => row.id === r.id);
          if (!current) throw Error('Mahal bulunamadı.');
          if (!heightOnly) {
            if (!d.name.trim()) throw Error('Mahal adı girin.');
            current.name = d.name.trim();
            current.code = d.code.trim();
          }
          const outcome = unchangedReading
            ? { changed: false }
            : setRoomCeiling(q, r.id, { ...d, visitId: activeVisit(q)?.id });
          validateProject(q);
          return outcome.changed ? ceilingOpeningConflicts(q, r.id, current.height) : [];
        },
        (conflicts) => {
          if (conflicts.length) ctx.toast(conflicts[0].message + ' Kontrol listesine eklendi.');
        }
      );
    },
    {
      intro:
        [info.floor.name, r.code, r.name].filter(Boolean).join(' / ') +
        ' · Kat bitmiş zemin proje kotu ' +
        metre(info.floor.elevation) +
        '.',
      extra,
      after: (f) => {
        f.dataset.roomHeight = r.id;
        const field = (name) => f.elements.namedItem(name);
        const height = field('height'),
          method = field('method'),
          units = field('unit'),
          unknown = field('unmeasured');
        const preview = f.querySelector('[data-ceiling-preview]'),
          discard = f.querySelector('[data-ceiling-discard]');
        const state = () => JSON.stringify([...new FormData(f)]);
        const initial = state();
        let lastUnit = unit;
        function update() {
          height.disabled = method.disabled = units.disabled = unknown.checked;
          if (unknown.checked) {
            preview.textContent =
              'Genel tavan ölçülmedi olarak kaydedilecek. Önceki ölçüler geçmişte görünür.';
            return;
          }
          if (!height.value.trim()) {
            preview.textContent = 'Genel net yükseklik ve proje tavan kotu ölçülmedi.';
            return;
          }
          try {
            const v = parseLength(height.value, units.value);
            if (v <= 0) throw Error('Net yükseklik sıfırdan büyük olmalı.');
            const label = method.value
              ? ceilingMethodLabel(method.value)
              : info.height != null && Math.abs(v - info.height) < 0.00001
                ? info.methodLabel
                : 'Yöntem belirtilmedi';
            const conflicts = ceilingOpeningConflicts(p, r.id, v);
            preview.textContent =
              'Genel net yükseklik ' +
              metre(v) +
              ' · Proje tavan kotu ' +
              metre(info.floor.elevation + v) +
              ' · ' +
              label +
              '.' +
              (conflicts.length
                ? ' ' + conflicts.map((c) => c.message).join(' ') + ' Kontrol listesinde görünür.'
                : '');
          } catch (e) {
            preview.textContent = e.message;
          }
        }
        units.addEventListener('change', () => {
          if (!unknown.checked && r.height != null && height.value === shownHeight(lastUnit))
            height.value = shownHeight(units.value);
          lastUnit = units.value;
          update();
        });
        f.addEventListener('input', update);
        f.addEventListener('change', update);
        function next(fn) {
          if (state() === initial) {
            fn();
            return;
          }
          f.querySelector('.err').textContent =
            'Diğer işleme geçmeden önce değişiklikleri kaydedin veya Vazgeç ile çıkın.';
        }
        f.querySelectorAll('[data-ceiling-next]').forEach((b) => {
          b.onclick = () => next(() => zoneDialog(ctx, r, null, b.dataset.ceilingNext));
        });
        const copy = f.querySelector('#room-copy');
        if (copy) copy.onclick = () => next(() => showDuplicate(ctx, r));
        const dialog = f.closest('dialog');
        const requestClose = () => {
          if (f.querySelector('[type="submit"]').disabled) return;
          if (state() === initial) {
            closeDialog();
            return;
          }
          discard.hidden = false;
          discard.querySelector('[data-ceiling-stay]').focus();
        };
        dialog.querySelector('#dlg-x').onclick = requestClose;
        dialog.oncancel = (e) => {
          e.preventDefault();
          requestClose();
        };
        f.querySelector('.cancel').onclick = requestClose;
        discard.querySelector('[data-ceiling-stay]').onclick = () => {
          discard.hidden = true;
          (unknown.checked ? unknown : height).focus();
        };
        discard.querySelector('[data-ceiling-abandon]').onclick = closeDialog;
        update();
      },
    }
  );
}
function showDuplicate(ctx, r) {
  const u = ctx.p.unit,
    box = extent(roomPoints(ctx.p, r.id));
  return form(
    'Mahali çoğalt',
    [
      text('name', 'Yeni mahal adı', r.name + ' kopya', true),
      select(
        'floorId',
        'Hedef kat',
        ctx.p.floors.map((f) => [f.id, f.name]),
        r.floorId
      ),
      length('x', 'X yönünde öteleme', box.right - box.left + 500, u),
      length('y', 'Y yönünde öteleme', 0, u),
      { ...text('angle', 'Döndürme açısı (°)', '0'), number: true },
      check('mirror', 'X yönünde aynala'),
    ],
    'Çoğalt',
    (d) =>
      save(
        ctx,
        'Mahal çoğaltıldı',
        (q) =>
          duplicateRoom(q, r.id, {
            name: d.name.trim(),
            floorId: d.floorId,
            offset: { x: mm(d, 'x', u), y: mm(d, 'y', u) },
            angleDeg: number(d.angle, 'Açı'),
            mirrorX: !!d.mirror,
          }),
        (out) => patchRoom(ctx, out, { mode: 'plan' })
      ),
    {
      intro: 'Açıklıklar ve kot bölgeleri yeni kimliklerle çoğaltılır. Saha ölçüleri kaynak mahalde kalır.',
    }
  );
}
function addFloorDialog(ctx) {
  const u = ctx.p.unit;
  return form(
    'Kat ekle',
    [text('name', 'Kat adı', '', true), length('elevation', 'Bitmiş döşeme kotu', null, u)],
    'Katı ekle',
    (d) =>
      save(
        ctx,
        'Kat eklendi',
        (q) => addFloor(q, { name: d.name.trim(), elevation: mm(d, 'elevation', u) }),
        (f) => {
          ctx.set({
            floorId: f.id,
            roomId: null,
            wallId: null,
            zoneId: null,
            elementId: null,
            nodeId: null,
            draft: [],
            tool: 'select',
            mode: 'plan',
          });
        }
      ),
    { intro: 'Projede tanımladığın ±0,00 düzlemine göre kotu gir.' }
  );
}
function resizeDialog(ctx, r, wid) {
  const p = ctx.p,
    u = p.unit,
    w = p.walls.find((el) => el.id === wid),
    before = wallLength(p, wid);
  const ownerIndex = r.wallIds.indexOf(wid),
    first = r.nodeIds[ownerIndex] === w.a;
  const aNo = first ? ownerIndex : (ownerIndex + 1) % r.nodeIds.length,
    bNo = first ? (ownerIndex + 1) % r.nodeIds.length : ownerIndex;
  const source = [
    ['tape', 'Şerit metre'],
    ['laser', 'Lazer'],
    ['iphone', 'Telefon ölçümü'],
    ['estimate', 'Tahmin'],
  ];
  return form(
    'Duvar ölçüsü',
    [
      length('value', 'Ölçülen uzunluk', before, u),
      select(
        'mode',
        'Ölçünün etkisi',
        [
          ['shape', 'Planı şekillendir'],
          ['check', 'Kontrol ölçüsü olarak kaydet'],
        ],
        w.locked ? 'check' : 'shape'
      ),
      select(
        'fixed',
        'Sabit uç',
        [
          ['a', 'Köşe ' + (aNo + 1) + ' (A)'],
          ['b', 'Köşe ' + (bNo + 1) + ' (B)'],
        ],
        'a'
      ),
      select('method', 'Ölçüm aracı', source, 'tape'),
      check('lock', 'Uygulanan uzunluğu kilitle', w.locked),
    ],
    'Ölçüyü kaydet',
    async (d) => {
      const value = mm(d, 'value', u);
      const saved = await save(
        ctx,
        'Duvar ölçüsü kaydedildi',
        (q) => {
          if (d.mode === 'shape') resizeWall(q, wid, value, { fixed: d.fixed, lock: !!d.lock });
          return addObservation(q, {
            roomId: r.id,
            floorId: r.floorId,
            wallId: wid,
            kind: 'wall',
            a: { nodeId: w.a },
            b: { nodeId: w.b },
            raw: d.value,
            unit: u,
            method: d.method,
          });
        },
        () => ctx.set({ roomId: r.id, wallId: wid })
      );
      return saved;
    },
    {
      intro: 'Duvar ' + edgeName(ownerIndex) + ' · ' + r.name,
      extra: '<output class="intro" id="resize-preview" aria-live="polite"></output>',
      after: (f) => {
        const out = f.querySelector('#resize-preview'),
          sourcePoints = roomPoints(p, r.id);
        function preview() {
          const mode = f.elements.namedItem('mode').value;
          fieldVisibility(f, { fixed: mode === 'shape', lock: mode === 'shape' });
          try {
            const value = parseLength(f.elements.namedItem('value').value, u);
            if (mode === 'check') {
              out.textContent =
                'Çizim ' + metre(before) + ' · Ölçü farkı ' + formatLength(value - before, 'mm') + ' mm';
              return;
            }
            const q = structuredClone(p),
              result = resizeWall(q, wid, value, {
                fixed: f.elements.namedItem('fixed').value,
                lock: f.elements.namedItem('lock').checked,
              });
            const afterPoints = roomPoints(q, r.id),
              bounds = extent([...sourcePoints, ...afterPoints]),
              bw = bounds.right - bounds.left,
              bh = bounds.bottom - bounds.top,
              pad = Math.max(bw, bh) * 0.09 || 1;
            const coords = (pts) => pts.map((v) => v.x + ',' + v.y).join(' ');
            const roomsText = result.roomIds
              .map((id) => p.rooms.find((item) => item.id === id)?.name)
              .filter(Boolean)
              .join(', ');
            out.innerHTML =
              '<svg role="img" aria-label="Mevcut ve önerilen oda çevresi" style="display:block;width:100%;height:78px" viewBox="' +
              [bounds.left - pad, bounds.top - pad, bw + 2 * pad, bh + 2 * pad].join(' ') +
              '"><polygon points="' +
              coords(sourcePoints) +
              '" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/><polygon points="' +
              coords(afterPoints) +
              '" fill="#ad6a361a" stroke="#a65531" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>' +
              esc('Etkilenen mahal: ' + roomsText);
          } catch (e) {
            out.textContent = e.message;
          }
        }
        f.addEventListener('input', preview);
        f.addEventListener('change', preview);
        preview();
      },
    }
  );
}
function nodeDialog(ctx, r, id) {
  const p = ctx.p,
    u = p.unit,
    initial = id || ctx.s.nodeId || r.nodeIds[0];
  const n = p.nodes.find((e) => e.id === initial);
  if (!n) throw Error('Bir köşe seçin.');
  const fields = [
    select(
      'nodeId',
      'Köşe',
      r.nodeIds.map((nid, i) => [nid, String(i + 1)]),
      initial
    ),
    length('x', 'X', n.x, u),
    length('y', 'Y', n.y, u),
    check('lock', 'Köşeyi bu konumda kilitle', n.locked),
  ];
  return form(
    'Köşe konumu',
    fields,
    'Uygula',
    (d) =>
      save(
        ctx,
        'Köşe güncellendi',
        (q) => {
          const target = q.nodes.find((el) => el.id === d.nodeId);
          if (!d.lock) target.locked = false;
          moveNode(q, d.nodeId, { x: mm(d, 'x', u), y: mm(d, 'y', u) });
          q.nodes.find((el) => el.id === d.nodeId).locked = !!d.lock;
        },
        () => ctx.set({ nodeId: d.nodeId })
      ),
    {
      after: (f) => {
        f.elements.namedItem('nodeId').onchange = () => {
          const target = p.nodes.find((e) => e.id === f.elements.namedItem('nodeId').value);
          f.elements.namedItem('x').value = fmt(target.x, u);
          f.elements.namedItem('y').value = fmt(target.y, u);
          f.elements.namedItem('lock').checked = !!target.locked;
        };
      },
    }
  );
}
function wallThicknessDialog(ctx, r, wid) {
  const w = ctx.p.walls.find((item) => item.id === wid),
    u = ctx.p.unit;
  return form(
    'Bitmiş yüzler arası kalınlık',
    [length('thickness', 'Kalınlık', w.thickness, u, false)],
    'Kaydet',
    (d) =>
      save(ctx, 'Duvar kalınlığı güncellendi', (q) => {
        q.walls.find((edge) => edge.id === wid).thickness = editedMm(d, 'thickness', u, w.thickness);
        validateProject(q);
      }),
    { intro: r.name + ' · Duvar ' + edgeName(r.wallIds.indexOf(wid)) }
  );
}
function wallMenu(ctx, r, wid) {
  const p = ctx.p,
    u = p.unit,
    w = p.walls.find((el) => el.id === wid),
    len = wallLength(p, wid);
  return menu('Duvar ' + edgeName(r.wallIds.indexOf(wid)), [
    ['resize', 'Uzunluk ve kontrol ölçüsü', 'dimension', () => resizeDialog(ctx, r, wid)],
    ['thick', 'Duvar kalınlığı', 'wall', () => wallThicknessDialog(ctx,r,wid)],
    [
      'lock',
      w.locked ? 'Duvar kilidini kaldır' : 'Duvar boyunu kilitle',
      'lock',
      () =>
        form(
          w.locked ? 'Duvar kilidini kaldır' : 'Duvar boyunu kilitle',
          [],
          w.locked ? 'Kilidi kaldır' : 'Kilitle',
          () => save(ctx, 'Duvar kilidi güncellendi', (q) => setWallLock(q, wid, !w.locked)),
          { intro: metre(len) }
        ),
    ],
    [
      'split',
      'Duvarı ikiye böl',
      'plus',
      () =>
        form(
          'Duvarı böl',
          [length('offset', 'A ucundan bölme mesafesi', len / 2, u)],
          'Böl',
          (d) =>
            save(
              ctx,
              'Duvar bölündü',
              (q) => splitWall(q, wid, mm(d, 'offset', u) / wallLength(q, wid)),
              (out) => ctx.set({ wallId: out.leftId, nodeId: out.nodeId })
            ),
          {
            intro:
              'A konumu ' +
              metre(p.nodes.find((n) => n.id === w.a).x) +
              ' / ' +
              metre(p.nodes.find((n) => n.id === w.a).y) +
              '.',
          }
        ),
    ],
    [
      'merge',
      'Doğrusal komşuyla birleştir',
      'layers',
      () => {
        const pair = wallList(p, r).filter(([id]) => {
          const edge = p.walls.find((el) => el.id === id);
          return id !== wid && (edge.a === w.a || edge.a === w.b || edge.b === w.a || edge.b === w.b);
        });
        form(
          'Duvarları birleştir',
          [select('other', 'İkinci duvar', pair, pair[0]?.[0])],
          'Birleştir',
          (d) =>
            save(
              ctx,
              'Duvarlar birleştirildi',
              (q) => mergeWalls(q, wid, d.other),
              (out) => ctx.set({ wallId: out.wallId, nodeId: null })
            ),
          { intro: 'Aynı çizgi üzerindeki iki parçayı seç.' }
        );
      },
    ],
    ['adjacent', 'Bitişik mahal ekle', 'home', () => showAddRoom(ctx, r, 'adjacent')],
    ['diagonal', 'Çaprazla dörtgeni şekillendir', 'ruler', () => diagonalDialog(ctx, r)],
    ['curve', 'Ölçülü yay hesabı', 'dimension', () => arcDialog(ctx, r, wid)],
    ['node', 'Köşe koordinatları', 'select', () => nodeDialog(ctx, r, w.a)],
  ]);
}
function diagonalDialog(ctx, r) {
  if (r.nodeIds.length !== 4) {
    ctx.toast('Bu işlem dört köşeli bir mahalde kullanılabilir.');
    return;
  }
  const p = ctx.p,
    u = p.unit;
  form(
    'Çapraz ölçüyle şekillendir',
    [
      select(
        'pair',
        'Köşe çifti',
        [
          ['0', '1 → 3'],
          ['1', '2 → 4'],
        ],
        '0'
      ),
      length('distance', 'Çapraz', null, u),
      select(
        'method',
        'Ölçüm aracı',
        [
          ['laser', 'Lazer'],
          ['tape', 'Şerit metre'],
        ],
        'laser'
      ),
    ],
    'Uygula',
    (d) =>
      save(ctx, 'Çapraz ölçü uygulandı', (q) => {
        const i = Number(d.pair),
          a = r.nodeIds[i],
          b = r.nodeIds[(i + 2) % 4];
        reshapeDiagonal(q, r.id, a, b, mm(d, 'distance', u));
        addObservation(q, {
          roomId: r.id,
          floorId: r.floorId,
          a: { nodeId: a },
          b: { nodeId: b },
          kind: 'diagonal',
          raw: d.distance,
          unit: u,
          method: d.method,
        });
      }),
    { intro: 'İlk köşe ve dört kenar uzunluğu sabittir.' }
  );
}
function arcDialog(ctx, r, wid) {
  const p = ctx.p,
    u = p.unit;
  form(
    'Kavisli duvar ölçüsü',
    [
      length('h', 'Dik yay yüksekliği', null, u),
      select(
        'direction',
        'Çizgiye göre taraf',
        [
          ['1', 'Sağ normal (+)'],
          ['-1', 'Sol normal (−)'],
        ],
        '1'
      ),
    ],
    'Ölçüyü not et',
    (d) =>
      save(ctx, 'Yay ölçüsü kaydedildi', (q) => {
        const arc = arcFromSagitta(q, wid, mm(d, 'h', u) * Number(d.direction));
        q.notes.push({
          id: newId('arc'),
          roomId: r.id,
          wallId: wid,
          date: new Date().toISOString(),
          status: 'done',
          arc: { chord: arc.chord, sagitta: arc.sagitta, radius: arc.radius, arcLength: arc.arcLength },
          text:
            'Yay ölçüsü • Kiriş ' +
            metre(arc.chord) +
            ' • Ok ' +
            metre(arc.sagitta) +
            ' • Yarıçap ' +
            metre(arc.radius) +
            ' • Yay uzunluğu ' +
            metre(arc.arcLength),
        });
      }),
    {
      intro:
        'Hesap iki uç ve kiriş ortasından alınan dik mesafe ile yapılır. Sonuç duvara bağlı saha notuna yazılır.',
    }
  );
}

function elementDialog(ctx, r, existing, faceRoom = r) {
  const p = ctx.p,
    u = p.unit,
    wallId = existing?.wallId || selectedWall(ctx, r);
  const choice = existing?.type || 'door';
  const openType = (t) => t === 'door' || t === 'window';
  const viewingRoom = (wid) => (faceRoom.wallIds.includes(wid) ? faceRoom : r);
  const read = (d, key, nullable = true) => editedMm(d, key, u, existing?.[key], nullable);
  const swingChoice =
    existing?.reversedAlongWall && existing.swing
      ? existing.swing.replace(/^(left|right)/, (m) => (m === 'left' ? 'right' : 'left'))
      : existing?.swing;
  let modified = false,
    openAfterSave = false;
  const fields = [
    select('type', 'Öğe türü', options(elementLabels), choice),
    text('name', 'Öğe adı', existing?.name),
    select('wallId', 'Bağlı duvar', wallList(p, r), wallId),
    select(
      'side',
      'Yüz',
      [
        ['inside', r.name + ' içinden'],
        ['outside', 'Karşı yüzden'],
      ],
      existing?.side || 'inside'
    ),
    length('offset', 'A ucundan başlangıç kenarı', existing?.offset ?? 0, u),
    length('width', 'Genişlik', existing?.width, u, false),
    length('sill', 'Bitmiş zeminden alt kot', existing?.sill, u, false),
    length('height', 'Yükseklik', existing?.height, u, false),
    length('depth', 'Derinlik', existing?.depth, u, false),
    select(
      'swing',
      'Kapı açılımı',
      [
        ['', 'Ölçülmedi'],
        ['left', 'Sol menteşe · eski kısa kayıt'],
        ['right', 'Sağ menteşe · eski kısa kayıt'],
        ['left-in', 'Sol menteşe · içeri'],
        ['right-in', 'Sağ menteşe · içeri'],
        ['left-out', 'Sol menteşe · dışarı'],
        ['right-out', 'Sağ menteşe · dışarı'],
      ],
      swingChoice || ''
    ),
    { ...text('hardware', 'Kol, kilit ve diğer donanım', existing?.hardware || ''), maxlength: 500 },
    length('handleHeight', 'Kol/mandal kotu (eşikten)', existing?.handleHeight, u, false),
  ];
  return form(
    existing
      ? faceRoom.id === r.id
        ? 'Öğe bilgileri'
        : 'Öğe bilgileri · ' + faceRoom.name
      : 'Açıklık veya öğe ekle',
    fields,
    existing ? 'Kaydet' : 'Ekle',
    async (d) => {
      const shouldOpen = openAfterSave;
      openAfterSave = false;
      if (shouldOpen && (!(read(d, 'width') > 0) || !(read(d, 'height') > 0))) {
        throw Error('Detaya çizmek için açıklığın ölçülen genişliğini ve yüksekliğini gir.');
      }
      let savedId;
      const ok = await save(
        ctx,
        existing ? 'Öğe güncellendi' : 'Öğe eklendi',
        (q) => {
          const sameSwing =
            existing?.type === d.type &&
            d.wallId === existing.wallId &&
            (d.type !== 'door' || (d.swing || '') === (swingChoice || ''));
          const data = {
            roomId: r.id,
            wallId: d.wallId,
            type: d.type,
            name: d.name.trim() || elementLabels[d.type],
            side: d.side,
            offset: read(d, 'offset', false),
            width: read(d, 'width') ?? 0,
            sill: read(d, 'sill'),
            height: read(d, 'height'),
            depth: read(d, 'depth'),
            swing: d.type === 'door' ? (sameSwing ? (existing.swing ?? null) : d.swing || null) : null,
            reversedAlongWall: sameSwing ? existing.reversedAlongWall : false,
            hardware: openType(d.type) ? d.hardware.trim() || null : null,
            handleHeight: openType(d.type) ? read(d, 'handleHeight') : null,
          };
          if (!existing) return addElement(q, data);
          return updateElement(q, existing.id, data);
        },
        (item) => {
          savedId = item.id;
          const selected = viewingRoom(item.wallId);
          ctx.set({
            elementId: item.id,
            roomId: selected.id,
            floorId: selected.floorId,
            wallId: item.wallId,
            zoneId: null,
          });
        }
      );
      if (ok && shouldOpen && savedId && ctx.openOpeningDetail) {
        await ctx.openOpeningDetail(savedId);
        return false;
      }
      return ok;
    },
    {
      intro:
        (faceRoom.id === r.id ? r.name : faceRoom.name + ' yüzü · Açıklık kaydı ' + r.name) +
        ' · Kotları bu katın bitmiş döşemesine göre gir. Ölçülmeyen alanları boş bırak.' +
        (faceRoom.id === r.id
          ? ''
          : ' Ofset ve menteşe ' + r.name + ' mahalindeki duvarın A → B yönüne göre gösterilir.'),
      extra:
        '<p id="opening-levels" class="intro" aria-live="polite"></p>' +
        (existing
          ? button(
              'opening-detail',
              'Kapı/pencere detayına çiz',
              'draw',
              'secondary',
              'id="opening-ink" data-id="' + esc(existing.id) + '"'
            )
          : '<button type="button" id="opening-ink" class="secondary">' +
            icon('draw', 16) +
            ' Kaydet ve kapı/pencere detayına çiz</button>'),
      after: (f) => {
        const type = f.elements.namedItem('type'),
          wallInput = f.elements.namedItem('wallId'),
          hint = document.createElement('small');
        f.elements.namedItem('offset').parentElement.append(hint);
        const levels = f.querySelector('#opening-levels'),
          ink = f.querySelector('#opening-ink');
        const labelFor = (key, label) => {
          f.elements.namedItem(key).closest('label').querySelector('span').textContent =
            label + ' (' + u + ')';
        };
        ink.addEventListener('click', (event) => {
          if (existing && !modified) return;
          event.preventDefault();
          event.stopPropagation();
          if (!ctx.openOpeningDetail || !f.reportValidity()) return;
          openAfterSave = true;
          f.requestSubmit();
        });
        const levelsText = () => {
          if (!openType(type.value)) {
            levels.textContent = '';
            return;
          }
          const inputs = Object.fromEntries(new FormData(f));
          try {
            const selected = viewingRoom(wallInput.value);
            const info = openingLevels(
              p,
              {
                roomId: r.id,
                wallId: wallInput.value,
                sill: read(inputs, 'sill'),
                height: read(inputs, 'height'),
                offset: read(inputs, 'offset') ?? 0,
                width: read(inputs, 'width') ?? 0,
              },
              selected.id
            );
            const head =
              info.head == null
                ? 'Lento kotu için eşik ve yükseklik gerekli.'
                : 'Lento ' + metre(info.head) + ' · Proje kotu ' + metre(info.headZ) + '.';
            const roof = info.missingWallFace
              ? info.ceiling == null
                ? 'Mahal genel tavanı ölçülmedi.'
                : 'Mahal genel tavan yüksekliği ' + metre(info.ceiling) + '.'
              : info.ceiling == null
                ? 'Tavan kotu ölçülmedi.'
                : 'Bu açıklık üzerindeki en düşük tavan/kiriş altı ' + metre(info.ceiling) + '.';
            const clash =
              info.head != null && info.ceiling != null && info.head > info.ceiling + 0.00001
                ? ' Lento ' + formatLength(info.head - info.ceiling, 'mm') + ' mm aşıyor.'
                : '';
            const missing = info.missingWallFace
              ? ' Ortak duvar kalınlığı ölçülmedi. Bu yüzdeki yerel tavan veya kiriş altı henüz kontrol edilemiyor.'
              : '';
            levels.textContent = selected.name + ' · ' + head + ' ' + roof + clash + missing;
          } catch (error) {
            levels.textContent = error.message;
          }
        };
        const update = () => {
          const opening = openType(type.value);
          fieldVisibility(f, { swing: type.value === 'door', hardware: opening, handleHeight: opening });
          ink.hidden = !opening;
          ink.style.display = opening ? '' : 'none';
          labelFor(
            'sill',
            type.value === 'window'
              ? 'Parapet / denizlik alt kotu'
              : type.value === 'door'
                ? 'Kapı eşiği kotu'
                : 'Bitmiş zeminden alt kot'
          );
          labelFor('height', opening ? 'Eşikten lentoya açıklık yüksekliği' : 'Yükseklik');
          f.elements.namedItem('width').required = opening;
          const w = p.walls.find((v) => v.id === wallInput.value),
            a = p.nodes.find((v) => v.id === w.a);
          hint.textContent =
            'A: X ' + metre(a.x) + ' / Y ' + metre(a.y) + ' · Duvar ' + metre(wallLength(p, w.id));
          levelsText();
        };
        type.addEventListener('change', update);
        wallInput.addEventListener('change', update);
        f.addEventListener('input', () => {
          modified = true;
          levelsText();
        });
        f.addEventListener('change', () => {
          modified = true;
        });
        update();
      },
    }
  );
}
const slopeLine = (pt, unit) => [pt.x, pt.y, pt.z].map((v) => fmt(v, unit)).join('; ');
function parseSlope(value, unit, prior = []) {
  if (!String(value || '').trim()) return [];
  const lines = prior.map((pt) => slopeLine(pt, unit)),
    used = new Set();
  return String(value)
    .trim()
    .split(/\r?\n/)
    .map((line, i) => {
      const same =
        lines[i] === line && !used.has(i) ? i : lines.findIndex((s, index) => s === line && !used.has(index));
      if (same !== -1) {
        used.add(same);
        return structuredClone(prior[same]);
      }
      const items = line
        .trim()
        .split(/[;\t]+/)
        .map((s) => s.trim());
      if (items.length !== 3 || items.some((v) => !v))
        throw Error(i + 1 + '. satırda X; Y; alt kot bekleniyor.');
      const sameXY = prior[i] && items[0] === fmt(prior[i].x, unit) && items[1] === fmt(prior[i].y, unit);
      const x = sameXY ? prior[i].x : parseLength(items[0], unit);
      const y = sameXY ? prior[i].y : parseLength(items[1], unit);
      const z = parseLength(items[2], unit);
      return { x, y, z };
    });
}
function zoneDialog(ctx, r, existing, initialType = 'platform') {
  const p = ctx.p,
    u = p.unit,
    points = roomPoints(p, r.id),
    bb = extent(existing?.points || points);
  const shapes = [
    ['rect', 'Dikdörtgen'],
    ['room', 'Bütün mahal'],
    ['draw', 'Serbest sınır çiz'],
  ];
  if (existing) shapes.unshift(['keep', 'Mevcut sınır']);
  const fields = [
    select('type', 'Bölge türü', options(zoneLabels), existing?.type || initialType),
    text('name', 'Bölge adı', existing?.name),
    select('shape', 'Plan sınırı', shapes, existing ? 'keep' : 'rect'),
    length('x', 'Başlangıç X', bb.left, u),
    length('y', 'Başlangıç Y', bb.top, u),
    length('width', 'En', bb.right - bb.left, u),
    length('depth', 'Derinlik', existing ? bb.bottom - bb.top : (bb.bottom - bb.top) / 2, u),
    length('bottom', 'Alt yüz kotu', existing?.bottom, u, false),
    length('top', 'Üst yüz kotu', existing?.top, u, false),
    select(
      'targetZoneId',
      'Boşluğun kestiği döşeme',
      [
        ['', 'Kot aralığına giren döşemeler'],
        ...p.zones
          .filter((z) => z.roomId === r.id && z.type === 'platform' && z.id !== existing?.id)
          .map((z) => [z.id, z.name || 'Platform']),
      ],
      existing?.targetZoneId || ''
    ),
    {
      key: 'slope',
      type: 'textarea',
      full: true,
      label: 'Eğim ölçüleri (' + u + ')',
      value: (existing?.slopePoints || []).map((pt) => slopeLine(pt, u)).join('\n'),
      hint: 'Her satıra X; Y; alt kot. Düzlem için aynı doğru üzerinde olmayan üç nokta.',
    },
    { ...text('risers', 'Rıht adedi', existing?.risers || ''), number: true },
    length('headroom', 'Ölçülen baş kurtarma', existing?.headroom, u, false),
    select(
      'ascending',
      'Çıkış doğrultusu',
      [
        ['', 'Ölçülmedi'],
        ['+x', '+X'],
        ['-x', '−X'],
        ['+y', '+Y'],
        ['-y', '−Y'],
      ],
      existing?.ascending || ''
    ),
  ];
  return form(
    existing
      ? 'Kot bölgesini düzenle'
      : initialType === 'ceiling'
        ? 'Tavan bölgesi ekle'
        : initialType === 'beam'
          ? 'Kiriş altı ekle'
          : 'Kot bölgesi ekle',
    fields,
    'Uygula',
    async (d) => {
      const bottom = editedMm(d, 'bottom', u, existing?.bottom),
        top = editedMm(d, 'top', u, existing?.top);
      if (bottom != null && top != null && top < bottom) throw Error('Üst kot, alt kotun altında.');
      const data = {
        roomId: r.id,
        floorId: r.floorId,
        type: d.type,
        name: d.name.trim() || zoneLabels[d.type],
        bottom,
        top,
        targetZoneId: d.type === 'void' ? d.targetZoneId || null : null,
        slopePoints: ['ceiling', 'beam'].includes(d.type)
          ? parseSlope(d.slope, u, existing?.slopePoints || [])
          : d.type === existing?.type
            ? structuredClone(existing.slopePoints || [])
            : [],
      };
      if (data.slopePoints.length >= 3) zoneSurfaceAt(data, data.slopePoints[0]);
      if (d.type === 'stair') {
        data.risers = d.risers ? number(d.risers, 'Rıht') : null;
        if (data.risers != null && (!Number.isInteger(data.risers) || data.risers < 1))
          throw Error('Pozitif bir rıht adedi girin.');
        data.headroom = editedMm(d, 'headroom', u, existing?.headroom);
        data.ascending = d.ascending || null;
      }
      if (d.shape === 'draw') {
        if (existing) data.replaceId = existing.id;
        ctx.set({
          floorId: r.floorId,
          roomId: r.id,
          mode: 'plan',
          tool: 'zone',
          draft: [],
          zoneDraft: data,
          mobilePanel: null,
        });
        return;
      }
      if (d.shape === 'keep') data.points = structuredClone(existing.points);
      else if (d.shape === 'room') data.points = points.map(({ x, y }) => ({ x, y }));
      else
        data.points = templatePoints(
          'rect',
          editedMm(d, 'width', u, bb.right - bb.left, false),
          editedMm(d, 'depth', u, existing ? bb.bottom - bb.top : (bb.bottom - bb.top) / 2, false),
          {
            x: editedMm(d, 'x', u, bb.left, false),
            y: editedMm(d, 'y', u, bb.top, false),
          }
        );
      return save(
        ctx,
        existing ? 'Kot bölgesi güncellendi' : 'Kot bölgesi eklendi',
        (q) => {
          if (!existing) return addZone(q, data);
          const z = q.zones.find((row) => row.id === existing.id);
          Object.assign(z, data);
          validateProject(q);
          return z;
        },
        (z) => ctx.set({ floorId: r.floorId, roomId: r.id, zoneId: z.id, elementId: null, tool: 'select' })
      );
    },
    {
      intro:
        'Üst ve alt kotlar ' +
        p.floors.find((f) => f.id === r.floorId).name +
        ' bitmiş zeminine göre girilir.',
      after: (f) => {
        const shape = f.elements.namedItem('shape'),
          type = f.elements.namedItem('type');
        const update = () => {
          const rect = shape.value === 'rect',
            stair = type.value === 'stair';
          fieldVisibility(f, {
            x: rect,
            y: rect,
            width: rect,
            depth: rect,
            slope: ['ceiling', 'beam'].includes(type.value),
            targetZoneId: type.value === 'void',
            risers: stair,
            headroom: stair,
            ascending: stair,
          });
        };
        for (const e of [shape, type]) e.addEventListener('change', update);
        update();
      },
    }
  );
}
function alignDialog(ctx) {
  const p = ctx.p,
    u = p.unit,
    floorId = ctx.s.floorId || p.floors[0]?.id;
  const pts = p.nodes.filter((n) => n.floorId === floorId);
  if (pts.length < 2) {
    ctx.toast('Hizalama için katta en az iki köşe gerekli.');
    return;
  }
  const choices = pts.map((n, i) => [n.id, 'Köşe ' + (i + 1) + ' · ' + metre(n.x) + ' / ' + metre(n.y)]);
  return form(
    'Katı iki referansla hizala',
    [
      select('fromA', 'Bu kattaki A', choices, pts[0].id),
      select('fromB', 'Bu kattaki B', choices, pts[1].id),
      length('ax', 'A hedef X', pts[0].x, u),
      length('ay', 'A hedef Y', pts[0].y, u),
      length('bx', 'B hedef X', pts[1].x, u),
      length('by', 'B hedef Y', pts[1].y, u),
    ],
    'Hizala',
    (d) =>
      save(ctx, 'Kat referansları hizalandı', (q) =>
        alignFloorXY(
          q,
          floorId,
          p.nodes.find((n) => n.id === d.fromA),
          p.nodes.find((n) => n.id === d.fromB),
          { x: mm(d, 'ax', u), y: mm(d, 'ay', u) },
          { x: mm(d, 'bx', u), y: mm(d, 'by', u) }
        )
      ),
    {
      intro:
        'Hedef koordinatları proje referansında gir. Mesafeler kontrol edilir; kattaki çizim öteleme ve dönüşle hizalanır.',
    }
  );
}

export async function geometryAction(act, id, ctx) {
  if (act === 'add-floor') {
    addFloorDialog(ctx);
    return true;
  }
  if (act === 'align-floor') {
    alignDialog(ctx);
    return true;
  }
  if (act === 'add-room') {
    showAddRoom(ctx, selectedRoom(ctx));
    return true;
  }
  if (
    ![
      'edit-room',
      'room-height',
      'duplicate-room',
      'node-edit',
      'resize-wall',
      'wall-more',
      'wall-thickness',
      'add-element',
      'edit-element',
      'add-zone',
      'add-ceiling-zone',
      'add-beam-zone',
      'zone-info',
    ].includes(act)
  )
    return false;
  const p = ctx.p;
  const z = act === 'zone-info' ? p.zones.find((row) => row.id === (id || ctx.s.zoneId)) : null;
  const e =
    act === 'edit-element'
      ? p.elements.find((row) => row.id === (id || ctx.element?.id || ctx.s.elementId))
      : null;
  if ((act === 'zone-info' && !z) || (act === 'edit-element' && !e)) {
    ctx.toast('Önce düzenlenecek öğeyi seç.');
    return true;
  }
  const explicitRoom = id && ['edit-room', 'room-height', 'add-ceiling-zone', 'add-beam-zone'].includes(act);
  const r =
    e || z
      ? p.rooms.find((item) => item.id === (e || z).roomId)
      : explicitRoom
        ? p.rooms.find((item) => item.id === id)
        : selectedRoom(ctx);
  if (!r) {
    if (explicitRoom) {
      ctx.toast('Seçilen mahal bu projede bulunamadı.');
      return true;
    }
    ctx.toast('Önce bir mahal ekle.');
    showAddRoom(ctx, null);
    return true;
  }
  const w = r.wallIds.includes(id) ? id : selectedWall(ctx, r);
  if (act === 'wall-thickness' && id && !r.wallIds.includes(id)) {
    ctx.toast('Bu duvar seçili mahale ait değil.');
    return true;
  }
  const selectedFace =
    act === 'edit-element' && ['door', 'window'].includes(e.type)
      ? p.rooms.find((item) => item.id === (ctx.s.roomId || ctx.room?.id) && item.wallIds.includes(e.wallId))
      : null;
  const actions = {
    'edit-room': () => showEditRoom(ctx, r),
    'room-height': () => showEditRoom(ctx, r, true),
    'duplicate-room': () => showDuplicate(ctx, r),
    'node-edit': () => nodeDialog(ctx, r, r.nodeIds.includes(id) ? id : null),
    'resize-wall': () => resizeDialog(ctx, r, w),
    'wall-more': () => wallMenu(ctx, r, w),
    'wall-thickness': () => wallThicknessDialog(ctx, r, w),
    'add-element': () => elementDialog(ctx, r, null),
    'edit-element': () => elementDialog(ctx, r, e, selectedFace || r),
    'add-zone': () => zoneDialog(ctx, r, null),
    'add-ceiling-zone': () => zoneDialog(ctx, r, null, 'ceiling'),
    'add-beam-zone': () => zoneDialog(ctx, r, null, 'beam'),
    'zone-info': () => zoneDialog(ctx, r, z),
  };
  actions[act]();
  return true;
}
