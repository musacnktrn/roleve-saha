// [codex] ureten: codex
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  addAdjacentRoom,
  addElement,
  addFloor,
  addObservation,
  addRoom,
  addZone,
  createProject,
  normalizeProject,
  projectChecks,
  templatePoints,
  validateProject,
} from '../core.js';
import { ceilingOpeningConflicts, roomCeilingInfo, setRoomCeiling } from '../ceiling.js';

function setup(height = null) {
  const p = createProject('Deneme');
  const floor = addFloor(p, { name: 'Birinci', elevation: 3200 });
  const room = addRoom(p, {
    floorId: floor.id,
    name: 'Güney',
    code: '101',
    height,
    points: templatePoints('rect', 4500, 3000),
  });
  return { p, room, floor };
}

test('Kaynaksız eski yükseklik ile bilinmeyen değer ayrı kalır', () => {
  const { p, room } = setup(2700);
  const snapshot = structuredClone(p);
  const old = roomCeilingInfo(p, room.id);
  const early = structuredClone(p);
  delete early.observations;
  assert.equal(roomCeilingInfo(early, room.id).status, 'legacy');
  assert.equal(setRoomCeiling(early, room.id, { height: '2,8', method: 'laser' }).observation.value, 2800);
  assert.equal(old.status, 'legacy');
  assert.equal(old.absoluteZ, 5900);
  assert.equal(old.history.length, 0);
  assert.equal(setRoomCeiling(p, room.id, { height: '270 cm' }).changed, false);
  assert.deepEqual(p, snapshot);
  room.height = null;
  const current = roomCeilingInfo(p, room.id);
  assert.equal(current.status, 'unknown');
  assert.equal(current.absoluteZ, null);
  assert.equal(current.methodLabel, 'Ölçülmedi');
  assert.equal(setRoomCeiling(p, room.id, { height: '' }).changed, false);
  assert.equal(p.observations.length, 0);
});

test('Üç birim, virgül, özgün metin, zaman, mahal referansı ve sayısal z tanıkları', () => {
  for (const [raw, numeric, unit] of [
    ['2,70 m', '2,70', 'm'],
    ['270 cm', '270', 'cm'],
    ['2700 mm', '2700', 'mm'],
  ]) {
    const { p, room, floor } = setup();
    const input = { height: raw, unit: 'm', method: 'laser', visitId: 'saha-1' };
    const { observation: o } = setRoomCeiling(p, room.id, input);
    assert.equal(o.entered, raw);
    assert.equal(o.raw, numeric);
    assert.equal(o.unit, unit);
    assert.equal(o.value, 2700);
    assert.equal(o.localHeightMm, 2700);
    assert.equal(o.method, 'laser');
    assert.equal(o.kind, 'vertical');
    assert.equal(o.purpose, 'room-ceiling');
    assert.equal(o.reference, 'finished-floor-to-room-ceiling');
    assert.equal(o.fieldXYRecorded, false);
    assert.equal(o.roomId, room.id);
    assert.equal(o.floorId, floor.id);
    assert.equal(o.visitId, input.visitId);
    assert.equal(o.witness.a.z, 3200);
    assert.equal(o.witness.b.z, 5900);
    assert.equal(o.witness.a.x, o.witness.b.x);
    assert.equal(o.witness.a.y, o.witness.b.y);
    assert.ok(Number.isFinite(Date.parse(o.date)));
    assert.equal(o.replaces, null);
    assert.equal(roomCeilingInfo(normalizeProject(p), room.id).status, 'measured');
    floor.elevation = 4000;
    assert.equal(roomCeilingInfo(p, room.id).absoluteZ, 6700);
    assert.equal(o.witness.b.z, 5900);
  }
});

test('Aynı okumanın kaynaklandırılması, ayrı tahmin ve telefon ve açık ölçülmedi geçmişi', () => {
  const { p, room } = setup(2500);
  const a = setRoomCeiling(p, room.id, { height: '2,5', method: 'estimate' }).observation;
  assert.equal(roomCeilingInfo(p, room.id).status, 'estimated');
  assert.equal(a.estimated, true);
  const b = setRoomCeiling(p, room.id, { height: '2,5', method: 'iphone' }).observation;
  assert.equal(b.replaces, a.id);
  assert.equal(b.estimated, false);
  assert.equal(roomCeilingInfo(p, room.id).methodLabel, 'Telefon ölçümü');
  const before = structuredClone(p.observations);
  assert.throws(() => setRoomCeiling(p, room.id, { height: ' ' }), /Ölçülmedi/);
  assert.equal(room.height, 2500);
  setRoomCeiling(p, room.id, { unmeasured: true });
  const empty = roomCeilingInfo(p, room.id);
  assert.equal(empty.status, 'unknown');
  assert.equal(empty.current, null);
  assert.equal(empty.last.id, b.id);
  assert.deepEqual(p.observations, before);
  assert.ok(projectChecks(p).some((c) => c.roomId === room.id && c.kind === 'height'));
  assert.equal(setRoomCeiling(p, room.id, { unmeasured: true }).changed, false);
  const c = setRoomCeiling(p, room.id, { height: '260 cm', method: 'tape' }).observation;
  assert.equal(c.replaces, b.id);
  assert.deepEqual(
    roomCeilingInfo(p, room.id).history.map((o) => o.id),
    [c.id, b.id, a.id]
  );
  assert.ok(!projectChecks(p).some((o) => o.roomId === room.id && o.kind === 'height'));
});

test('Komşu mahal, diğer kat ve amaç dışı düşey gözlem düzeltme zincirine girmez', () => {
  const { p, room, floor } = setup();
  const neighbor = addAdjacentRoom(p, {
    roomId: room.id,
    wallId: room.wallIds[1],
    depth: 2200,
    name: 'Kuzey',
    height: 3000,
  });
  const ground = addRoom(p, {
    floorId: p.floors[0].id,
    name: 'Alt kat',
    height: 3500,
    points: templatePoints('rect', 4500, 3500),
  });
  const p1 = setRoomCeiling(p, room.id, { height: '2.65 m', method: 'tape' }).observation;
  const p2 = setRoomCeiling(p, neighbor.id, { height: '3,0 m', method: 'laser' }).observation;
  const other = addObservation(p, {
    a: { nodeId: room.nodeIds[0], z: 3200 },
    b: { nodeId: room.nodeIds[0], z: 3400 },
    roomId: room.id,
    floorId: floor.id,
    raw: '20',
    unit: 'cm',
    kind: 'vertical',
    method: 'laser',
    purpose: 'beam',
  });
  const update = setRoomCeiling(p, room.id, { height: '2.7', method: 'iphone' }).observation;
  assert.equal(update.replaces, p1.id);
  assert.notEqual(update.replaces, p2.id);
  assert.notEqual(update.replaces, other.id);
  assert.equal(roomCeilingInfo(p, room.id).history.length, 2);
  assert.equal(roomCeilingInfo(p, neighbor.id).history.length, 1);
  assert.equal(ground.height, 3500);
  assert.equal(neighbor.height, 3000);
});

test('Kapı, tavan ve kiriş kotları sabit kalır; aynı lento çakışması proje kontrolünde görünür', () => {
  const { p, room } = setup(3200);
  const door = addElement(p, {
    roomId: room.id,
    wallId: room.wallIds[0],
    type: 'door',
    offset: 300,
    width: 900,
    height: 2450,
    sill: 0,
    name: 'Pano kapısı',
  });
  for (const [type, bottom, top] of [
    ['ceiling', 2600, 2850],
    ['beam', 2500, 2900],
  ])
    addZone(p, {
      roomId: room.id,
      floorId: room.floorId,
      type,
      bottom,
      top,
      points: templatePoints('rect', 1800, 1300),
    });
  const originalZones = structuredClone(p.zones),
    originalDoors = structuredClone(p.elements);
  assert.deepEqual(ceilingOpeningConflicts(p, room.id, 2700), []);
  const preview = ceilingOpeningConflicts(p, room.id, 2300);
  assert.equal(preview[0].elementId, door.id);
  assert.equal(preview[0].difference, 150);
  setRoomCeiling(p, room.id, { height: '2,3 m', method: 'laser' });
  assert.doesNotThrow(() => validateProject(p));
  assert.deepEqual(p.zones, originalZones);
  assert.deepEqual(p.elements, originalDoors);
  const conflict = projectChecks(p).find((c) => c.kind === 'opening-head' && c.elementId === door.id);
  assert.equal(conflict.difference, 150);
});

test('Ortak duvarın ters çevrimli iki yüzünde tek kapı, ayrı kiriş ve ayrı genel tavan', () => {
  const { p, room: a, floor } = setup(3200),
    common = a.wallIds[1];
  const door = addElement(p, {
    roomId: a.id,
    wallId: common,
    type: 'door',
    name: 'Ortak kapı',
    offset: 300,
    width: 900,
    height: 2400,
    sill: 0,
  });
  const b = addAdjacentRoom(p, { roomId: a.id, wallId: common, depth: 2000, name: 'B', height: 3200 });
  const off = addRoom(p, {
    floorId: floor.id,
    name: 'Bağımsız',
    height: 3200,
    points: templatePoints('rect', 4500, 3000, { x: 9000, y: 0 }),
  });
  const own = addElement(p, {
    roomId: off.id,
    wallId: off.wallIds[0],
    type: 'window',
    name: 'Bağımsız pencere',
    offset: 400,
    width: 750,
    height: 2200,
    sill: 200,
  });
  const wall = p.walls.find((o) => o.id === common),
    ar = a.wallIds.indexOf(common),
    br = b.wallIds.indexOf(common);
  assert.equal(a.nodeIds[ar], wall.a);
  assert.equal(b.nodeIds[br], wall.b);
  const get = (room, high) =>
    ceilingOpeningConflicts(p, room.id, high).map((c) => [c.elementId, c.difference]);
  assert.deepEqual(get(b, 2000), [[door.id, 400]]);
  assert.deepEqual(get(a, 3200), []);
  assert.deepEqual(get(off, 1800), [[own.id, 600]]);
  const beam = (room, bottom, x, y, width, depth) =>
    addZone(p, {
      roomId: room.id,
      floorId: floor.id,
      type: 'beam',
      bottom,
      top: 2800,
      points: templatePoints('rect', width, depth, { x, y }),
    });
  beam(a, 2350, 4000, 400, 500, 350);
  beam(b, 1800, 4600, 650, 700, 300);
  // Two lower B records lie away from the true B face or away from the real opening span.
  beam(b, 1550, 4510, 670, 90, 160);
  beam(b, 1400, 4600, 2070, 600, 250);
  assert.deepEqual(get(a, 3200), [[door.id, 50]]);
  assert.deepEqual(get(b, 3200), []); // Unknown wall thickness leaves only the general B ceiling certain.
  wall.thickness = 200;
  assert.deepEqual(get(b, 3200), [[door.id, 600]]);
  assert.deepEqual(get(a, 3200), [[door.id, 50]]);
  assert.deepEqual(get(off, 3200), []);
  assert.equal(door.roomId, a.id);
  assert.equal(p.elements.length, 2);
});

test('Hatalı girdi veya proje gözlem bırakmaz; kaynağı bildirilmeyen yeni sayının etiketi açık kalır', () => {
  const { p, room } = setup();
  for (const input of [
    { height: '0', method: 'tape' },
    { height: '-2' },
    { height: '4px' },
    { height: '1.4', method: 'camera' },
    { height: '', method: 'tape' },
  ]) {
    const before = structuredClone(p);
    assert.throws(() => setRoomCeiling(p, room.id, input));
    assert.deepEqual(p, before);
  }
  const o = setRoomCeiling(p, room.id, { height: '2,9' }).observation;
  assert.equal(o.method, 'unspecified');
  assert.equal(roomCeilingInfo(p, room.id).status, 'unattributed');
  p.walls[0].referenceRoomId = 'eksik';
  const before = structuredClone(p);
  assert.throws(() => setRoomCeiling(p, room.id, { height: '3,0', method: 'tape' }));
  assert.deepEqual(p, before);
});

// Runs inside the actual macOS WebKit DOM. All fixtures are made specifically for this test.
async function browserFlow() {
  const G = await import('/geometry/core.js');
  const { geometryAction } = await import('/geometry/actions.js');
  const p = G.createProject('Form kabulü'),
    lower = p.floors[0],
    upper = G.addFloor(p, { name: 'Üst', elevation: 3200 });
  const room = (floor, name, h) =>
    G.addRoom(p, {
      name,
      code: '01',
      floorId: floor.id,
      height: h,
      points: G.templatePoints('rect', 4000, 3500),
    });
  const a = room(lower, 'Alt oda', 2500.1234567),
    b = room(upper, 'Üst oda', null);
  let selection = { floorId: lower.id, roomId: a.id };
  const notices = [];
  const ctx = {
    p,
    get room() {
      return p.rooms.find((r) => r.id === selection.roomId);
    },
    get s() {
      return selection;
    },
    async change(label, fn) {
      const draft = structuredClone(p);
      fn(draft);
      G.validateProject(draft);
      Object.assign(p, draft);
      return true;
    },
    toast(msg) {
      notices.push(msg);
    },
    set(patch) {
      selection = { ...selection, ...patch };
    },
  };
  const q = (s) => document.querySelector(s),
    f = () => q('form'),
    dialog = q('#modal');
  const checks = [];
  const check = (value, label) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
  const put = (key, value) => {
    const el = f().elements.namedItem(key);
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  async function save() {
    f().requestSubmit();
    await wait();
  }
  await geometryAction('edit-room', a.id, ctx);
  put('name', 'Alt mahal');
  await save();
  check(
    p.rooms.find((r) => r.id === a.id).height === 2500.1234567 && p.observations.length === 0,
    'Eski hassas boyut ad değiştirilirken yuvarlanmaz'
  );
  await geometryAction('room-height', b.id, ctx);
  check(
    f().dataset.roomHeight === b.id && q('.intro').textContent.includes('Üst oda'),
    'Açıkça verilen üst kat mahali'
  );
  check(q('[data-ceiling-preview]').textContent.includes('ölçülmedi'), 'Bilinmeyen önizleme');
  put('height', '270 cm');
  put('method', 'laser');
  check(q('[data-ceiling-preview]').textContent.includes('5,9 m'), 'Yerel ve proje kotu');
  q('[data-ceiling-next="beam"]').click();
  check(
    f().dataset.roomHeight === b.id && q('.err').textContent.includes('kaydedin'),
    'Farklı forma geçiş kirli ölçüyü korur'
  );
  q('#dlg-x').click();
  check(!q('[data-ceiling-discard]').hidden, 'Kapatmada değişiklikleri sorar');
  q('[data-ceiling-stay]').click();
  await save();
  check(
    !dialog.open && p.rooms.find((r) => r.id === b.id).height === 2700 && p.observations.length === 1,
    'Form seçili üst odaya kaydetti'
  );
  await geometryAction('edit-room', b.id, ctx);
  put('name', 'Yeni ad');
  await save();
  check(
    p.observations.length === 1 && p.rooms.find((r) => r.id === b.id).name === 'Yeni ad',
    'Yalnız ad değişimi okumayı çoğaltmaz'
  );
  await geometryAction('room-height', b.id, ctx);
  put('unit', 'cm');
  check(f().elements.height.value === '270', 'Görüntü birimini değiştirme yüksekliği dönüştürür');
  put('unmeasured', true);
  await save();
  check(
    !dialog.open && p.rooms.find((r) => r.id === b.id).height === null && p.observations.length === 1,
    'Ölçülmedi gözlemi saklar'
  );
  await geometryAction('room-height', b.id, ctx);
  check(
    q('[data-ceiling-history]').textContent.includes('270 cm') &&
      q('[data-ceiling-history]').textContent.includes('önceki'),
    'Eski ham metni ve önceki ölçüyü gösterir'
  );
  q('[data-ceiling-next="ceiling"]').click();
  check(f().elements.type.value === 'ceiling', 'Kartın tavan bölgesi kısayolu');
  q('#dlg-x').click();
  await geometryAction('add-beam-zone', b.id, ctx);
  check(f().elements.type.value === 'beam', 'Kiriş kısa yolu doğru türü seçti');
  put('bottom', '2,2');
  put('top', '2,5');
  await save();
  check(
    p.zones[0].roomId === b.id && p.zones[0].floorId === upper.id && p.zones[0].type === 'beam',
    'Açıkça verilen üst kat/mahal kirişe kaydoldu'
  );
  await geometryAction('add-zone', '', ctx);
  check(f().elements.type.value === 'platform', 'Mevcut genel bölge varsayılanı');
  q('#dlg-x').click();
  await geometryAction('room-height', 'bulunmuyor', ctx);
  check(!dialog.open && notices.at(-1).includes('bulunamadı'), 'Geçersiz kimlik başka odayı açmadı');
  const owner = p.rooms.find((r) => r.id === a.id),
    common = owner.wallIds[1];
  const door = G.addElement(p, {
    roomId: owner.id,
    wallId: common,
    type: 'door',
    name: 'Ortak kapı',
    offset: 303.096587,
    width: 910.5178266,
    sill: 0.012346,
    height: 2399.987654,
    depth: 123.456789,
    handleHeight: 1098.7654321,
    swing: 'left-in',
    reversedAlongWall: true,
    source: 'laser',
  });
  const adjacent = G.addAdjacentRoom(p, {
    roomId: owner.id,
    wallId: common,
    depth: 2350,
    name: 'Karşı mahal',
    height: 3200,
  });
  const sloped = G.addZone(p, {
    roomId: adjacent.id,
    floorId: lower.id,
    type: 'beam',
    name: 'Eğimli kiriş',
    bottom: 2080.4826234,
    top: 2520.4186456,
    depth: 478.251934,
    method: 'laser',
    points: G.templatePoints('rect', 900.48282, 1200.587978, { x: 4100.987654, y: 240.456789 }),
    slopePoints: [
      { x: 4210.123456, y: 300.234567, z: 1840.345678, method: 'laser' },
      { x: 4630.908765, y: 330.876543, z: 1920.24681, method: 'tape' },
      { x: 4270.902468, y: 1200.86342, z: 1950.24681, method: 'iphone' },
    ],
  });
  await geometryAction('room-height', adjacent.id, ctx);
  put('height', '2000 mm');
  put('method', 'laser');
  check(
    q('[data-ceiling-preview]').textContent.includes('400 mm'),
    'Komşu yüzün genel tavan kartı tam 400 mm aşımı gösterdi'
  );
  await save();
  ctx.set({ floorId: lower.id, roomId: adjacent.id, wallId: common, elementId: door.id });
  await geometryAction('edit-element', door.id, ctx);
  const displayed = q('#opening-levels').textContent;
  check(
    q('#dlg-title').textContent.includes('Karşı mahal') &&
      displayed.includes('400 mm') &&
      displayed.includes('kalınlığı ölçülmedi'),
    'Karşı mahal başlığı, karşı yüzün tavanı ve bilinmeyen duvar kalınlığı'
  );
  put('name', 'Ahşap kapı');
  await save();
  const saved = p.elements.find((e) => e.id === door.id);
  check(
    !dialog.open && selection.roomId === adjacent.id && saved.roomId === owner.id && saved.wallId === common,
    'Kaynak duvar/mahal ve seçili karşı yüz korunur'
  );
  check(
    [
      'offset',
      'sill',
      'height',
      'width',
      'depth',
      'handleHeight',
      'swing',
      'reversedAlongWall',
      'source',
    ].every((k) => door[k] === saved[k]),
    'Ad düzeltmesi açıklık donanımını ve hassas ölçüleri değiştirmez'
  );
  await geometryAction('wall-thickness', common, ctx);
  put('thickness', '200 mm');
  await save();
  check(
    p.walls.find((w) => w.id === common).thickness === 200 && !dialog.open,
    'Duvar kalınlığı seçili ortak duvar formuyla kaydedildi'
  );
  await geometryAction('edit-element', door.id, ctx);
  const current = G.openingLevels(p, saved, adjacent.id);
  check(
    !current.missingWallFace &&
      current.ceiling < 2000 &&
      q('#opening-levels').textContent.includes('Karşı mahal') &&
      !q('#opening-levels').textContent.includes('kalınlığı ölçülmedi'),
    'Ölçülen yüzde eğimli kiriş hesaplanır'
  );
  q('#dlg-x').click();
  const prior = structuredClone(p.zones.find((z) => z.id === sloped.id));
  await geometryAction('zone-info', sloped.id, ctx);
  check(
    !f().elements.slope.disabled && f().elements.slope.value.split('\n').length === 3,
    'Kirişin üç eğim ölçüsü düzenlemeye açıktır'
  );
  put('name', 'Eğimli kiriş B');
  await save();
  const res = p.zones.find((z) => z.id === sloped.id);
  check(
    ['bottom', 'top', 'depth', 'points', 'slopePoints', 'method'].every(
      (k) => JSON.stringify(res[k]) === JSON.stringify(prior[k])
    ),
    'Yalnız ad değişince kiriş eğiminin üç yöntemi, kotları ve plan/derinlik hassasiyeti korunur'
  );
  await geometryAction('zone-info', sloped.id, ctx);
  const rows = f().elements.slope.value.split('\n');
  rows[1] = '4,6309; 0,3309; 1,88';
  put('slope', rows.join('\n'));
  await save();
  const edited = p.zones.find((z) => z.id === sloped.id).slopePoints;
  check(
    edited[1].z === 1880 &&
      edited[1].x === prior.slopePoints[1].x &&
      edited[1].y === prior.slopePoints[1].y &&
      JSON.stringify(edited[0]) === JSON.stringify(prior.slopePoints[0]) &&
      JSON.stringify(edited[2]) === JSON.stringify(prior.slopePoints[2]),
    'Tek kiriş eğim okuması düzenlenince diğer satırların kaynak ve hassasiyeti korunur'
  );
  return { ok: true, checks };
}

test(
  'Gerçek WebKit formunda oda/kat, sayısal giriş, kaynak, kiriş kısayolu, kirli form ve geçmiş',
  { skip: process.platform !== 'darwin' && 'macOS WebKit gerekir', timeout: 65000 },
  async (t) => {
    const app = fileURLToPath(new URL('../../', import.meta.url)),
      tmp = await mkdtemp(path.join(tmpdir(), 'roleve-tavan-'));
    const cli = promisify(execFile),
      exe = path.join(tmp, 'webkit');
    const html =
      '<!doctype html><meta charset="UTF-8"><dialog id="modal"></dialog><output id="toast"></output>' +
      '<script type="module">try{const r=await (' +
      browserFlow.toString() +
      ')();webkit.messageHandlers.done.postMessage(JSON.stringify(r))}' +
      'catch(e){webkit.messageHandlers.done.postMessage(JSON.stringify({ok:false,error:e.message,where:e.stack}))}</script>';
    const server = createServer(async (req, res) => {
      const key = new URL(req.url, 'http://127.0.0.1').pathname;
      if (key === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }
      if (!/^\/[a-z\d/-]+\.js$/.test(key)) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(await readFile(path.join(app, key)));
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    try {
      await cli(
        'swiftc',
        [
          path.join(app, 'geometry/tests/WebKitRunner.swift'),
          '-framework',
          'WebKit',
          '-framework',
          'AppKit',
          '-o',
          exe,
        ],
        { timeout: 30000 }
      );
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { stdout } = await cli(exe, ['http://127.0.0.1:' + server.address().port + '/', '390', '844'], {
        timeout: 31000,
      });
      const report = JSON.parse(stdout);
      assert.equal(report.ok, true);
      assert.ok(report.checks.length >= 25);
      t.diagnostic('WebKit saha kontrolleri ' + JSON.stringify(report.checks));
    } catch (e) {
      throw Error(e.stdout || e.message);
    } finally {
      if (server.listening) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await rm(tmp, { recursive: true, force: true });
    }
  }
);
