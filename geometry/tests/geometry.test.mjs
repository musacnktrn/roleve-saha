// [codex] ureten: codex
import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../core.js';
import { buildSolids, doorSwing, indexProject } from '../../views/model.js';
import { openingStrokePoints } from '../../openings/drawing.js';

function openingDrawing(id = 'detail-a') {
  return {
    id,
    shape: 'line',
    brush: 'pen',
    color: '#245fa6',
    width: 8,
    opacity: 1,
    points: [
      { x: 0.125, y: 0.25 },
      { x: 0.75, y: 0.875 },
    ],
  };
}
test('Ü3 · Kesit kimliğiyle düzenlenen ortak açıklık aynı mahalde kalır, ölçüler 2B/3B ve donanım kotunu günceller', () => {
  const { p, r } = fixture(),
    wallId = r.wallIds[0],
    other = g.addAdjacentRoom(p, { roomId: r.id, wallId, depth: 2000 });
  const e = g.addElement(p, {
    type: 'window',
    floorId: r.floorId,
    roomId: r.id,
    wallId,
    offset: 500,
    width: 1000,
    sill: 800,
    height: 1200,
    detailStrokes: [openingDrawing()],
  });
  const id = e.id;
  g.updateElement(p, id, {
    roomId: other.id,
    width: 1600,
    sill: 950,
    height: 1350,
    hardware: 'Mandal',
    handleHeight: 450,
  });
  assert.equal(p.elements.length, 1);
  assert.equal(e.id, id);
  assert.equal(e.roomId, r.id);
  assert.equal(e.hardware, 'Mandal');
  assert.equal(e.handleHeight, 450);
  assert.equal(g.openingLevels(p, e).headZ, 2300);
  assert.equal(g.resolveAnchor(p, { elementId: id, at: 'end', vertical: 'top' }).x, 2100);
  const glass = buildSolids(indexProject(p), {}).find((s) => s.elementId === id);
  assert.ok(glass);
  assert.equal(Math.max(...glass.faces.flat().map((point) => point.z)), 2300);
  assert.deepEqual(
    openingStrokePoints(e.detailStrokes[0]).map((pt) => [pt.x * e.width, pt.y * e.height]),
    [
      [200, 337.5],
      [1200, 1181.25],
    ]
  );
  assert.throws(() => g.updateElement(p, id, { handleHeight: 1400 }), /Kol/);
  assert.equal(e.handleHeight, 450);
  assert.throws(() => g.updateElement(p, id, { type: 'socket' }), /kapı veya pencere/);
});
test('Ü5 · Dar bir eğik tavan açıklığın iki ucundan uzakta olsa bile gerçek alt kot sınırını belirler', () => {
  const { p, r } = fixture();
  p.floors[0].elevation = 3600;
  const narrow = g.templatePoints('rect', 300, 800, { x: 1300, y: 0 });
  g.addZone(p, {
    roomId: r.id,
    type: 'ceiling',
    points: narrow,
    slopePoints: [
      { x: 1300, y: 0, z: 2200 },
      { x: 1600, y: 0, z: 2400 },
      { x: 1300, y: 800, z: 2350 },
    ],
  });
  const e = g.addElement(p, {
    type: 'door',
    roomId: r.id,
    wallId: r.wallIds[0],
    offset: 500,
    width: 3000,
    height: 2050,
    sill: 50,
    swing: 'right-out',
  });
  assert.ok(Math.abs(g.openingLevels(p, e).ceiling - 2200) < 1e-8);
  assert.equal(g.openingLevels(p, e).headZ, 5700);
  assert.throws(() => g.updateElement(p, e.id, { height: 2180 }), /30 mm/);
  assert.equal(e.height, 2050);
  assert.doesNotThrow(() => g.updateElement(p, e.id, { height: 2150 }));
  assert.doesNotThrow(() => g.updateElement(p, e.id, { offset: 500, width: 500, height: 2500 }));
  assert.equal(g.openingLevels(p, e).ceiling, 3200);
});
test('Ü3 · Ölçülmeyen yükseklik boş kalır, eski arşivdeki gerçek çelişki kaynağı saklanır', () => {
  const { p, r } = fixture();
  r.height = null;
  const e = g.addElement(p, {
    type: 'door',
    roomId: r.id,
    wallId: r.wallIds[0],
    offset: 200,
    width: 850,
    sill: null,
    height: null,
  });
  assert.deepEqual(g.openingLevels(p, e), {
    floorZ: 0,
    sill: null,
    head: null,
    ceiling: null,
    sillZ: null,
    headZ: null,
    ceilingZ: null,
  });
  g.updateElement(p, e.id, { height: 4000 });
  assert.equal(g.openingLevels(p, e).head, null);
  g.updateElement(p, e.id, { sill: 0 });
  r.height = 3000;
  const imported = g.normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(imported.elements[0].height, 4000);
  assert.equal(g.projectChecks(imported).find((row) => row.kind === 'opening-head').difference, 1000);
  g.updateElement(imported, e.id, { hardware: 'Sürgü' });
  assert.equal(imported.elements[0].height, 4000);
  assert.throws(() => g.updateElement(imported, e.id, { height: 3500 }), /500 mm/);
});
test('Ü2 · Duvar ters yönde birleştiğinde menteşe ve asimetrik detay aynı fiziksel kenarı izler', () => {
  const { p, r } = fixture(),
    s = g.splitWall(p, r.wallIds[0], 0.5);
  const rev = p.walls.find((w) => w.id === s.rightId);
  [rev.a, rev.b] = [rev.b, rev.a];
  const e = g.addElement(p, {
    type: 'door',
    roomId: r.id,
    wallId: rev.id,
    offset: 350,
    width: 900,
    sill: 0,
    height: 2100,
    swing: 'right-out',
    detailStrokes: [openingDrawing()],
  });
  const oldId = e.id,
    oldStroke = e.detailStrokes[0].id;
  g.mergeWalls(p, s.leftId, s.rightId);
  assert.equal(e.id, oldId);
  assert.equal(e.detailStrokes[0].id, oldStroke);
  assert.equal(e.offset, 2750);
  assert.deepEqual(e.detailStrokes[0].points, [
    { x: 0.875, y: 0.25 },
    { x: 0.25, y: 0.875 },
  ]);
  assert.deepEqual(doorSwing(e), { atStart: true, direction: -1 });
});
test('Ü8 · Aynalanan şablonda açıklık detayı ve menteşe fiziksel yönü korur, kopya bağımsızdır', () => {
  const { p, r } = fixture(),
    w = r.wallIds[0];
  const e = g.addElement(p, {
    type: 'door',
    roomId: r.id,
    wallId: w,
    offset: 1000,
    width: 800,
    sill: 40,
    height: 2000,
    swing: 'left-in',
    detailStrokes: [openingDrawing()],
  });
  const copy = g.duplicateRoom(p, r.id, { mirrorX: true, offset: { x: 11000, y: 0 } });
  const clone = p.elements.find((v) => v.roomId === copy.id);
  assert.notEqual(e.id, clone.id);
  assert.notEqual(e.detailStrokes[0].id, clone.detailStrokes[0].id);
  const projectX = (el) => {
    const [a, b] = g.wallEnds(p, el.wallId);
    return (
      a.x +
      ((b.x - a.x) * (el.offset + el.width * el.detailStrokes[0].points[0].x)) / g.wallLength(p, el.wallId)
    );
  };
  assert.equal(projectX(e) + projectX(clone), 11000);
  const hingeX = (el) => {
    const [a, b] = g.wallEnds(p, el.wallId);
    return (
      a.x +
      ((b.x - a.x) * (el.offset + (doorSwing(el).atStart ? 0 : el.width))) / g.wallLength(p, el.wallId)
    );
  };
  assert.equal(hingeX(e) + hingeX(clone), 11000);
  clone.detailStrokes[0].points[0].y = 1;
  assert.equal(e.detailStrokes[0].points[0].y, 0.25);
});
test('Ü8 · Kayıtlı kesit çizgileri kendi katlarıyla döner ve sabit katın çizgisi korunur', () => {
  const { p, r } = fixture(),
    second = g.addFloor(p, { name: 'Üst', elevation: 3500 });
  p.sections = [
    { id: 'aa', name: 'A–A', floorId: r.floorId, a: { x: 20, y: 50 }, b: { x: 1020, y: 50 } },
    { id: 'bb', name: 'B–B', floorId: second.id, a: { x: 30, y: 90 }, b: { x: 450, y: 80 } },
  ];
  const secondBefore = structuredClone(p.sections[1]);
  g.alignFloorXY(p, r.floorId, { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 200, y: 500 }, { x: 200, y: 1500 });
  assert.equal(p.sections[0].id, 'aa');
  assert.deepEqual(p.sections[0].a, { x: 150, y: 520 });
  assert.ok(Math.abs(p.sections[0].b.x - 150) < 1e-8);
  assert.equal(p.sections[0].b.y, 1520);
  assert.deepEqual(p.sections[1], secondBefore);
});
test('Ü1 · Birim son eki ve ilk girilen yazı korunur, taşan sayı reddedilir', () => {
  const p = g.createProject();
  const o = g.addObservation(p, { a: { x: 0, y: 0 }, b: { x: 350, y: 0 }, raw: '35,0 cm', unit: 'm' });
  assert.deepEqual([o.entered, o.raw, o.unit, o.value], ['35,0 cm', '35,0', 'cm', 350]);
  assert.doesNotThrow(() => g.validateProject(p));
  assert.throws(() => g.parseLength('9'.repeat(90), 'm'));
});
test('Ü2 · Tek köşeyi karşı kenarın arkasına geçirmek duvar yüzlerini değiştirmez', () => {
  const p = g.createProject();
  const r = g.addRoom(p, {
    points: [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 0, y: 2000 },
    ],
  });
  assert.throws(() => g.moveNode(p, r.nodeIds[2], { x: 0, y: -2000 }), /ters/);
  assert.equal(g.roomPoints(p, r.id)[2].y, 2000);
});
test('Ü3 · Ölçü satırında komşu olmayan odanın duvarı reddedilir', () => {
  const p = g.createProject();
  const a = g.addRoom(p, { points: g.templatePoints('rect', 2000, 2000) }),
    b = g.addRoom(p, { points: g.templatePoints('rect', 1000, 1000, { x: 5000, y: 0 }) });
  assert.throws(
    () =>
      g.addObservation(p, {
        roomId: a.id,
        wallId: b.wallIds[0],
        a: { nodeId: a.nodeIds[0] },
        b: { nodeId: a.nodeIds[1] },
        raw: '2',
        unit: 'm',
      }),
    /uyuşmuyor/
  );
  assert.equal(p.observations.length, 0);
});
test('Ü8 · Kat hizalama kayıtlı altlığın yönü, ölçeği, referansları ve tefrişle birlikte taşınır', () => {
  const p = g.createProject(),
    floorId = p.floors[0].id;
  const r = g.addRoom(p, { points: g.templatePoints('rect', 3000, 4000) });
  p.furniture = [{ id: 'chair', roomId: r.id, x: 200, y: 0, width: 500, depth: 500, rotation: 10 }];
  p.notes.push({
    id: 'pinned-photo',
    roomId: r.id,
    anchor: { x: 500, y: 0, z: 950, floorId },
    text: 'Pencere detayı',
  });
  p.underlays.push({
    id: 'sheet',
    floorId,
    x: 100,
    y: 0,
    width: 3000,
    height: 4000,
    rotation: -5,
    calibration: { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, actual: 1000 },
  });
  g.alignFloorXY(p, floorId, { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1000 });
  const sheet = p.underlays[0],
    chair = p.furniture[0];
  assert.ok(Math.abs(sheet.x) < 1e-8);
  assert.equal(sheet.y, 100);
  assert.equal(sheet.width, 3000);
  assert.equal(sheet.rotation, 85);
  assert.ok(Math.abs(sheet.calibration.b.x) < 1e-8);
  assert.equal(sheet.calibration.b.y, 1000);
  assert.ok(Math.abs(chair.x) < 1e-8);
  assert.equal(chair.y, 200);
  assert.equal(chair.rotation, 100);
  const photo = p.notes[0].anchor;
  assert.ok(Math.abs(photo.x) < 1e-8);
  assert.equal(photo.y, 500);
  assert.equal(photo.z, 950);
  assert.equal(photo.floorId, floorId);
});
const fixture = () => {
  const p = g.createProject('Ölçüm'),
    r = g.addRoom(p, { name: 'Salon', points: g.templatePoints('rect', 4000, 3000), height: 3200 });
  return { p, r };
};
test('Ü5 · Dördüncü eğim ölçüsü model yüzeyine katılır ve artık toleransı görünür', () => {
  const { p, r } = fixture();
  const pts = g.templatePoints('rect', 2000, 1000);
  const z = g.addZone(p, {
    roomId: r.id,
    type: 'ceiling',
    points: pts,
    slopePoints: pts.map((point, i) => ({ ...point, z: i === 2 ? 3400 : 3000 })),
  });
  assert.equal(g.zoneSurfaceAt(z, { x: 1000, y: 500 }), 3100);
  assert.equal(g.projectChecks(p).find((issue) => issue.kind === 'slope').difference, 100);
});
test('Ü8 · Şablonun boşluğu kopyalanan platformu, açıklık bölünmüş doğru parçayı izler', () => {
  const { p, r } = fixture(),
    floor = g.addFloor(p, { name: 'Kat', elevation: 3500 });
  const slab = g.addZone(p, {
    roomId: r.id,
    type: 'platform',
    points: g.templatePoints('rect', 2000, 2000),
    bottom: 2400,
    top: 2600,
  });
  g.addZone(p, {
    roomId: r.id,
    type: 'void',
    points: g.templatePoints('rect', 500, 500),
    targetZoneId: slab.id,
  });
  g.addElement(p, { roomId: r.id, type: 'window', offset: 2500, width: 1000, wallId: r.wallIds[0] });
  g.addRoom(p, { floorId: floor.id, points: g.templatePoints('rect', 2000, 1000, { x: 0, y: -1000 }) });
  const copy = g.duplicateRoom(p, r.id, { floorId: floor.id, offset: { x: 0, y: 0 } });
  assert.equal(copy.wallIds.length, 5);
  const z = p.zones.filter((row) => row.roomId === copy.id),
    el = p.elements.find((e) => e.roomId === copy.id);
  assert.equal(z.find((z) => z.type === 'void').targetZoneId, z.find((z) => z.type === 'platform').id);
  const a = g.resolveAnchor(p, { elementId: el.id, at: 'start' });
  assert.equal(a.x, 2500);
  assert.equal(a.y, 0);
  assert.throws(() =>
    g.addZone(p, {
      roomId: copy.id,
      type: 'void',
      points: g.templatePoints('rect', 200, 300),
      targetZoneId: slab.id,
    })
  );
});
test('Ü1 · Ondalık giriş, ayrı birimler ve işaretli kot', () => {
  assert.equal(g.parseLength('4,285', 'm'), 4285);
  assert.equal(g.parseLength('428,5 cm', 'm'), 4285);
  assert.equal(g.formatLength(4285, 'm'), '4,285');
  assert.equal(g.parseLength('-0,25 m'), -250);
  for (const s of ['4,28.5', 'Infinity', '', '1m2', '1e300']) assert.throws(() => g.parseLength(s));
});
test('Ü1 · Proje kimlikleri, bilinmeyen yükseklik ve JSON turu', () => {
  const p = g.createProject('A');
  assert.equal(p.floors[0].elevation, 0);
  assert.equal(p.rooms.length, 0);
  const r = g.addRoom(p, { points: g.templatePoints('L', 6000, 7000) });
  assert.equal(r.height, null);
  assert.equal(p.walls[0].thickness, null);
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  assert.notEqual(p.id, g.createProject().id);
});
test('Ü1 · Bağlı köşe ve bağımsız serbest referans', () => {
  const { p, r } = fixture();
  assert.equal(g.measure(p, { nodeId: r.nodeIds[0] }, { nodeId: r.nodeIds[2] }, 'diagonal'), 5000);
  assert.equal(g.measure(p, { x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 4000 }, 'spatial'), 5000);
  assert.throws(() => g.measure(p, { x: 0, y: 0 }, { x: 0, y: 0, z: 2500 }, 'vertical'));
});
test('Ü2 · Sabit uç, dikdörtgen ve ortak duvar kararlılığı', () => {
  const { p, r } = fixture(),
    id = r.wallIds[1];
  const nb = g.addAdjacentRoom(p, { roomId: r.id, wallId: id, depth: 2000, name: 'Hol' });
  assert.equal(p.walls.length, 7);
  assert.ok(nb.wallIds.includes(id));
  const res = g.resizeWall(p, r.wallIds[0], 4500, { fixed: 'a' });
  assert.equal(g.wallLength(p, id), 3000);
  assert.equal(g.roomArea(p, r.id), 13500000);
  assert.ok(res.roomIds.includes(nb.id));
  assert.equal(r.wallIds[1], id);
  g.setWallLock(p, r.wallIds[0], true);
  const before = JSON.stringify(p);
  assert.throws(() => g.resizeWall(p, r.wallIds[0], 4600), /kilit/);
  assert.equal(JSON.stringify(p), before);
});
test('Ü2 · Eğimli dörtgen çapraz ile çözülür, ölçülmemiş kenarlar değişmez', () => {
  const { p, r } = fixture(),
    ls = r.wallIds.map((id) => g.wallLength(p, id));
  g.reshapeDiagonal(p, r.id, r.nodeIds[0], r.nodeIds[2], 4700);
  assert.ok(
    Math.abs(g.measure(p, { nodeId: r.nodeIds[0] }, { nodeId: r.nodeIds[2] }, 'diagonal') - 4700) < 0.001
  );
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(g.wallLength(p, r.wallIds[i]) - ls[i]) < 0.001);
  const before = JSON.stringify(p);
  assert.throws(() => g.reshapeDiagonal(p, r.id, r.nodeIds[0], r.nodeIds[2], 9000));
  assert.equal(JSON.stringify(p), before);
});
test('Ü2 · L, U, koridor ve yanlış serbest çevrim', () => {
  for (const kind of ['L', 'U', 'corridor']) {
    const p = g.createProject();
    g.addRoom(p, { points: g.templatePoints(kind, 5000, 6000) });
    g.validateProject(p);
  }
  const { p } = fixture(),
    before = JSON.stringify(p);
  assert.throws(() =>
    g.addRoom(p, {
      points: [
        { x: 0, y: 0 },
        { x: 1e3, y: 1e3 },
        { x: 1e3, y: 0 },
        { x: 0, y: 1e3 },
      ],
    })
  );
  assert.equal(JSON.stringify(p), before);
});
test('Ü2 · Ortak duvarda böl/birleştir, ters oda yönü ve kararlı id', () => {
  const { p, r } = fixture(),
    id = r.wallIds[1],
    neighbour = g.addAdjacentRoom(p, { roomId: r.id, wallId: id, depth: 2500 });
  const before = g.roomArea(p, neighbour.id);
  const split = g.splitWall(p, id, 0.4);
  assert.equal(split.leftId, id);
  assert.equal(r.wallIds.length, 5);
  assert.equal(neighbour.wallIds.length, 5);
  g.mergeWalls(p, split.leftId, split.rightId);
  g.validateProject(p);
  assert.equal(r.wallIds.length, 4);
  assert.equal(neighbour.wallIds.length, 4);
  assert.equal(g.roomArea(p, neighbour.id), before);
});
test('Ü3 · İki yüze tek açıklık ve alt/üst kot', () => {
  const { p, r } = fixture(),
    w = p.walls[0],
    nb = g.addAdjacentRoom(p, { roomId: r.id, wallId: w.id, depth: 2100 });
  w.thickness = 200;
  const e = g.addElement(p, {
    roomId: r.id,
    wallId: w.id,
    type: 'window',
    offset: 500,
    width: 1200,
    height: 1400,
    sill: 800,
    name: 'P1',
  });
  assert.deepEqual(g.resolveAnchor(p, { elementId: e.id, at: 'end', vertical: 'top' }), {
    x: 1700,
    y: 0,
    z: 2200,
  });
  assert.deepEqual(g.resolveAnchor(p, { wallId: w.id, roomId: nb.id, t: 0.5, side: 'inside' }), {
    x: 2000,
    y: -200,
    z: 0,
  });
  assert.deepEqual(g.resolveAnchor(p, { wallId: w.id, roomId: nb.id, t: 0.5, side: 'outside' }), {
    x: 2000,
    y: 0,
    z: 0,
  });
  const other = g.addElement(p, {
    roomId: r.id,
    wallId: w.id,
    type: 'socket',
    offset: 450,
    width: 0,
    sill: 380,
    height: 0,
    side: 'inside',
  });
  assert.equal(g.resolveAnchor(p, { elementId: other.id }).z, 380);
  assert.equal(p.elements.filter((x) => x.type === 'window').length, 1);
});
test('Ü3 · Açıklık, fotoğraf iğnesi ve ölçü bölündükten sonra eski konumunda', () => {
  const { p, r } = fixture(),
    w = r.wallIds[0];
  const e = g.addElement(p, {
    roomId: r.id,
    wallId: w,
    type: 'door',
    offset: 2600,
    width: 850,
    height: 2000,
    sill: 0,
  });
  const a = { wallId: w, t: 0.8 },
    b = { nodeId: r.nodeIds[2] };
  const o = g.addObservation(p, {
    roomId: r.id,
    wallId: w,
    a,
    b,
    kind: 'diagonal',
    raw: '2,7',
    unit: 'm',
    method: 'tape',
  });
  const before = g.resolveAnchor(p, o.a);
  p.notes.push({ id: 'pin1', roomId: r.id, wallId: w, t: 0.8, text: 'Fotoğraf', status: 'done' });
  const split = g.splitWall(p, w, 0.5);
  assert.equal(e.wallId, split.rightId);
  assert.equal(e.offset, 600);
  assert.equal(p.notes[0].wallId, split.rightId);
  assert.deepEqual(g.resolveAnchor(p, o.a), before);
  assert.equal(o.witness.sourceA.wallId, w);
  assert.equal(o.witness.sourceA.t, 0.8);
  const snapshot = JSON.stringify(p);
  assert.throws(() => g.splitWall(p, split.rightId, 0.5), /açıklık/);
  assert.equal(JSON.stringify(p), snapshot);
  g.mergeWalls(p, split.leftId, split.rightId);
  assert.equal(e.wallId, w);
  assert.equal(e.offset, 2600);
  assert.equal(p.notes[0].t, 0.8);
  assert.deepEqual(g.resolveAnchor(p, o.a), before);
  assert.throws(() => g.resizeWall(p, w, 2800), /sığmıyor/);
});
test('Ü3 · Zincir ve doğrudan ölçü: +20 mm ile yetim uçları karıştırma', () => {
  const { p, r } = fixture();
  const xs = [0, 750, 1650, 4210],
    anchors = xs.map((x, i) => ({ x, y: 0, label: 'A' + i }));
  const obs = (a, b, raw) =>
    g.addObservation(p, { roomId: r.id, kind: 'distance', a, b, raw, unit: 'mm', method: 'laser' });
  const parts = xs.slice(1).map((x, i) => obs(anchors[i], anchors[i + 1], String(x - xs[i])).id);
  const total = obs(anchors[0], anchors[3], '4230');
  assert.equal(g.chainClosure(p, parts, total.id).difference, 20);
  assert.equal(g.chainClosure(p, parts, total.id).withinTolerance, false);
  const separated = obs({ x: 750, y: 0, label: 'Başka yüz' }, anchors[2], '900');
  assert.throws(() => g.chainClosure(p, [parts[0], separated.id, parts[2]], total.id));
  assert.equal(p.observations.length, 5);
  assert.ok(g.projectChecks(p).some((c) => c.observationId === total.id && c.difference === 20));
});
test('Ü3 · Ölçülmemiş dış yüz kaynağı ve yeniden okuma', () => {
  const { p, r } = fixture(),
    w = r.wallIds[0],
    a = { wallId: w, t: 0, side: 'outside', roomId: r.id },
    b = { nodeId: r.nodeIds[1] };
  const o = g.addObservation(p, {
    a,
    b,
    kind: 'distance',
    roomId: r.id,
    raw: '4,23',
    unit: 'm',
    method: 'laser',
  });
  assert.equal(o.witness.a, null);
  g.validateProject(p);
  assert.ok(g.projectChecks(p).some((c) => c.kind === 'anchor' && c.observationId === o.id));
  const newer = g.addObservation(p, {
    a,
    b,
    roomId: r.id,
    kind: 'distance',
    raw: '4.24',
    unit: 'm',
    method: 'laser',
    replaces: o.id,
  });
  assert.equal(p.observations.length, 2);
  assert.equal(newer.replaces, o.id);
  assert.ok(!g.projectChecks(p).some((c) => c.observationId === o.id));
});
test('Ü3 · Aynı isim verilen farklı uçlar birleştirilmez; 35 cm yüzler arasıdır', () => {
  const { p, r } = fixture(),
    w = p.walls[0];
  const add = (a, b, raw) =>
    g.addObservation(p, {
      roomId: r.id,
      a,
      b,
      raw,
      unit: 'cm',
      kind: 'distance',
      method: 'tape',
      note: 'Balkon genişliği',
    });
  const o1 = add({ x: 0, y: 15, label: 'Mermer ucu' }, { x: 1215, y: 15, label: 'Ön pencere' }, '121,5');
  const o2 = add({ x: 30, y: 30, label: 'Eşik' }, { x: 1150, y: 30, label: 'Boru' }, '112');
  const gap = add({ x: 25, y: 0, label: 'Kolon yüzü' }, { x: 375, y: 0, label: 'Pencere duvarı' }, '35');
  assert.equal(gap.value, 350);
  assert.equal(w.thickness, null);
  assert.notEqual(o1.id, o2.id);
  assert.deepEqual(
    p.observations.map((o) => o.value),
    [1215, 1120, 350]
  );
});
test('Ü5 · Kat, döşeme ve net yükseklik ayrı; galeri izdüşümü', () => {
  const p = g.createProject(),
    f = g.addFloor(p, { name: 'Ara kot', elevation: 1000 }),
    r = g.addRoom(p, {
      name: 'Dükkân',
      floorId: f.id,
      points: g.templatePoints('rect', 6000, 4000),
      height: 5400,
    });
  g.addZone(p, {
    roomId: r.id,
    type: 'platform',
    name: 'Asma kat',
    points: g.templatePoints('rect', 3000, 4000),
    bottom: 2630,
    top: 2850,
  });
  assert.deepEqual(g.verticalProfile(p, r.id, { x: 500, y: 500 }).clear, [
    { bottom: 1000, top: 3630, height: 2630 },
    { bottom: 3850, top: 6400, height: 2550 },
  ]);
  assert.equal(g.verticalProfile(p, r.id, { x: 4500, y: 500 }).clear[0].height, 5400);
  g.addZone(p, {
    roomId: r.id,
    type: 'void',
    points: g.templatePoints('rect', 500, 1000),
    bottom: 2630,
    top: 2850,
  });
  assert.equal(g.verticalProfile(p, r.id, { x: 200, y: 200 }).platforms.length, 0);
  assert.equal(g.verticalProfile(p, r.id, { x: 200, y: 200 }).floorOpen, false);
  assert.equal(g.verticalProfile(p, r.id, { x: 200, y: 200 }).clear[0].height, 5400);
});
test('Ü5 · Eğimli tavanın ölçülü üç noktası ve yetersiz örnek', () => {
  const { p, r } = fixture();
  const z = g.addZone(p, {
    roomId: r.id,
    type: 'ceiling',
    points: g.templatePoints('rect', 4000, 3000),
    slopePoints: [
      { x: 0, y: 0, z: 2500 },
      { x: 4000, y: 0, z: 2900 },
      { x: 0, y: 3000, z: 2800 },
    ],
    bottom: 2500,
    top: 2550,
  });
  assert.equal(g.zoneSurfaceAt(z, { x: 2000, y: 1500 }), 2850);
  assert.equal(g.verticalProfile(p, r.id, { x: 2000, y: 1500 }).ceilingZ, 2850);
  assert.equal(g.zoneSurfaceAt({ ...z, slopePoints: z.slopePoints.slice(0, 2) }, { x: 0, y: 0 }), null);
  assert.throws(() =>
    g.addZone(p, {
      ...z,
      slopePoints: [
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 1, z: 2 },
        { x: 2, y: 2, z: 3 },
      ],
    })
  );
});
test('Ü5 · Üst ölçüm dünya kotu ve negatif kot farkı', () => {
  const p = g.createProject(),
    f = g.addFloor(p, { name: 'Bodrum', elevation: -2600 });
  const r = g.addRoom(p, { floorId: f.id, points: g.templatePoints('rect', 4000, 3000), height: null });
  const a = { nodeId: r.nodeIds[0] },
    b = { nodeId: r.nodeIds[0], z: -4300 };
  assert.equal(g.measure(p, a, b, 'vertical'), 1700);
  assert.equal(g.measure(p, a, b, 'elevation'), -1700);
  assert.equal(g.verticalProfile(p, r.id, { x: 10, y: 10 }).clear[0].height, null);
});
test('Ü8 · Eski v1 ve bozuk arşiv, başka oda referansı', () => {
  const { p, r } = fixture(),
    legacy = structuredClone(p);
  delete legacy.strokes;
  delete legacy.underlays;
  assert.deepEqual(g.normalizeProject(legacy).strokes, []);
  const bad = structuredClone(p);
  bad.nodes[0].x = Infinity;
  assert.throws(() => g.normalizeProject(bad));
  const cross = structuredClone(p);
  cross.rooms[0].nodeIds[0] = 'başka-projeden';
  assert.throws(() => g.normalizeProject(cross));
  assert.throws(() => g.normalizeProject({ ...p, schemaVersion: 2 }));
  const unsafe = JSON.parse(JSON.stringify({ ...p, extra: JSON.parse('{"__proto__":{"polluted":true}}') }));
  assert.throws(() => g.normalizeProject(unsafe));
  assert.equal({}.polluted, undefined);
  assert.throws(() =>
    g.addObservation(p, {
      roomId: r.id,
      raw: '1',
      a: { nodeId: r.nodeIds[0], wallId: r.wallIds[0] },
      b: { x: 10, y: 20 },
    })
  );
});
test('Ü8 · İki noktalı altlık kalibrasyonu ve bağımsız ikinci kontrol', () => {
  const cal = g.calibrateUnderlay(
    { x: 10, y: 10 },
    { x: 110, y: 10 },
    4000,
    { x: 1000, y: 500 },
    Math.PI / 2
  );
  const target = g.underlayPoint(cal, { x: 110, y: 10 });
  assert.ok(Math.abs(target.x - 1000) < 0.001);
  assert.equal(target.y, 4500);
  assert.equal(
    g.checkCalibration(cal, { x: 10, y: 10 }, { x: 10, y: 60 }, 2020, 10).withinTolerance,
    false
  );
  assert.equal(g.checkCalibration(cal, { x: 10, y: 10 }, { x: 10, y: 60 }, 2000, 10).withinTolerance, true);
});
test('Ü8 · Bağımsız oda şablonu, ayna, ayrı ölçü kaydı', () => {
  const { p, r } = fixture(),
    wallId = r.wallIds[0];
  g.addElement(p, {
    roomId: r.id,
    wallId,
    type: 'window',
    offset: 250,
    width: 1000,
    sill: 900,
    height: 1300,
  });
  g.addObservation(p, {
    roomId: r.id,
    a: { nodeId: r.nodeIds[0] },
    b: { nodeId: r.nodeIds[1] },
    raw: '4',
    unit: 'm',
  });
  const copy = g.duplicateRoom(p, r.id, {
    floorId: r.floorId,
    offset: { x: 12000, y: 500 },
    angleDeg: 90,
    mirrorX: true,
  });
  assert.notEqual(copy.id, r.id);
  assert.equal(g.roomArea(p, r.id), g.roomArea(p, copy.id));
  assert.equal(p.observations.length, 1);
  assert.equal(p.elements.length, 2);
  assert.notEqual(p.elements[0].wallId, p.elements[1].wallId);
  g.resizeWall(p, copy.wallIds[0], 4500);
  assert.equal(g.wallLength(p, wallId), 4000);
});
test('Ü8 · Kat hizalamada kat, kot, iz, köşeler ve ölçüm geçmişi korunur', () => {
  const { p, r } = fixture(),
    f = g.addFloor(p, { name: 'Üst kat', elevation: 3330 });
  const upper = g.duplicateRoom(p, r.id, { floorId: f.id, offset: { x: 500, y: 500 } });
  const o = g.addObservation(p, {
    floorId: f.id,
    roomId: upper.id,
    a: { x: 500, y: 500 },
    b: { x: 4500, y: 500 },
    raw: '4',
    unit: 'm',
  });
  const rec = g.alignFloorXY(
    p,
    f.id,
    { x: 500, y: 500 },
    { x: 4500, y: 500 },
    { x: 0, y: 0 },
    { x: 0, y: 4000 }
  );
  assert.equal(rec.residualMm, 0);
  assert.equal(g.resolveAnchor(p, { nodeId: upper.nodeIds[0] }).z, 3330);
  const live = p.observations.find((row) => row.id === o.id);
  assert.deepEqual(live.a, { x: 0, y: 0 });
  assert.deepEqual(live.witness.a, { x: 500, y: 500 });
  assert.throws(() =>
    g.alignFloorXY(p, f.id, { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 0 }, { x: 500, y: 0 })
  );
});
test('Ü8 · Yüz odalı arşivde plan ve son odanın alanı korunur', () => {
  const p = g.createProject();
  for (let i = 0; i < 100; i++)
    g.addRoom(p, {
      points: g.templatePoints('rect', 4000, 3000, { x: 5000 * (i % 10), y: 4000 * Math.floor(i / 10) }),
    });
  const read = g.normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(read.rooms.length, 100);
  assert.equal(g.roomArea(read, read.rooms[99].id), 12e6);
});
test('Ü9 · Kiriş ve yay yüksekliğinden daire, ölçülü uçlar sabit', () => {
  const { p, r } = fixture(),
    w = r.wallIds[0];
  const curve = g.arcFromSagitta(p, w, 2000, 16);
  assert.equal(curve.radius, 2000);
  assert.ok(Math.abs(curve.arcLength - Math.PI * 2000) < EPSILON);
  assert.ok(Math.abs(curve.points[8].y - 2000) < EPSILON);
  assert.deepEqual(curve.points[0], { x: 0, y: 0 });
  assert.deepEqual(curve.points.at(-1), { x: 4000, y: 0 });
  const large = g.arcFromSagitta(p, w, -3000, 16);
  assert.ok(Math.abs(large.points[8].y + 3000) < EPSILON);
});
const EPSILON = 0.00001;
test('Ü2 · İki kısa odanın aynı uzun koridora bitişmesi ortak duvarı tekilleştirir', () => {
  const p = g.createProject();
  const long = g.addRoom(p, { points: g.templatePoints('rect', 6000, 2000) });
  const first = g.addRoom(p, { points: g.templatePoints('rect', 2000, 2500, { x: 0, y: 2000 }) });
  const second = g.addRoom(p, { points: g.templatePoints('rect', 4000, 2500, { x: 2000, y: 2000 }) });
  assert.equal(long.nodeIds.length, 5);
  assert.ok(long.wallIds.includes(first.wallIds[0]));
  assert.ok(long.wallIds.includes(second.wallIds[0]));
  assert.equal(g.roomArea(p, long.id), 12000000);
  g.validateProject(p);
});
test('Ü2 · Bölme noktasına taşan ölçülü kapı varsa yeni oda işlemi tümüyle geri alınır', () => {
  const p = g.createProject(),
    r = g.addRoom(p, { points: g.templatePoints('rect', 6000, 2000) });
  g.addElement(p, { roomId: r.id, wallId: r.wallIds[2], type: 'door', offset: 3700, width: 900 });
  const before = JSON.stringify(p);
  assert.throws(
    () => g.addRoom(p, { points: g.templatePoints('rect', 2000, 2500, { x: 0, y: 2000 }) }),
    /açıklık/
  );
  assert.equal(JSON.stringify(p), before);
});
test('Ü5 · Çakışan döşeme boşlukları yalnız bir kez, platform kesisi kendi kotunda düşülür', () => {
  const { p, r } = fixture();
  const rect = (x, y, w, h) => g.templatePoints('rect', w, h, { x, y });
  g.addZone(p, { roomId: r.id, type: 'platform', points: rect(0, 0, 4000, 3000), bottom: 2000, top: 2200 });
  g.addZone(p, { roomId: r.id, type: 'void', points: rect(0, 0, 1000, 1000), bottom: -200, top: 0 });
  g.addZone(p, { roomId: r.id, type: 'void', points: rect(500, 0, 1000, 1000), bottom: -200, top: 0 });
  g.addZone(p, { roomId: r.id, type: 'void', points: rect(2000, 900, 500, 200), bottom: 2000, top: 2200 });
  assert.deepEqual(g.surveyAreas(p, r.id), {
    footprint: 12000000,
    floorSlab: 10500000,
    voidArea: 1500000,
    platform: 11900000,
  });
});
test('Ü9 · Aynı lazer okuma kimliği yeniden ulaştığında tek kayıt', () => {
  const { p, r } = fixture(),
    packet = {
      deviceId: 'test-lazer',
      readingId: 'test-paket',
      roomId: r.id,
      raw: '4,00',
      unit: 'm',
      a: { nodeId: r.nodeIds[0] },
      b: { nodeId: r.nodeIds[1] },
    };
  const first = g.recordDeviceReading(p, packet);
  const second = g.recordDeviceReading(p, packet);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.observation.id, second.observation.id);
  assert.equal(p.observations.length, 1);
  assert.throws(() => g.recordDeviceReading(p, { ...packet, raw: '4,05' }), /farklı/);
});

function faceInk(r, points, data = {}) {
  return {
    id: g.newId('sample'),
    roomId: r.id,
    floorId: r.floorId,
    wallId: r.wallIds[0],
    side: 'inside',
    brush: 'pencil',
    shape: 'free',
    color: '#314239',
    width: 18,
    opacity: 0.78,
    points,
    ...data,
  };
}
test('Ü1 · Eski ham v1 arşivi plan izini aynen tutar ve görünüş listesini boş açar', () => {
  const { p, r } = fixture();
  p.strokes.push({
    id: 'legacy-ink',
    floorId: r.floorId,
    roomId: r.id,
    points: [
      { x: -125, y: 75 },
      { x: 150, y: 100 },
    ],
  });
  delete p.faceSketches;
  const persisted = JSON.stringify(p),
    input = JSON.parse(persisted);
  assert.doesNotThrow(() => g.validateProject(input));
  const read = g.normalizeProject(input);
  assert.deepEqual(read.strokes, input.strokes);
  assert.deepEqual(read.faceSketches, []);
  assert.equal(JSON.stringify(input), persisted);
  assert.throws(() => g.normalizeProject({ ...input, faceSketches: null }), /kayıt listesi/);
});
test('Ü3 · Görünüş eskizinde mahal, duvar, yüz, ölçü sınırı ve kalem stili doğrulanır', () => {
  const { p, r } = fixture(),
    other = g.addRoom(p, { points: g.templatePoints('rect', 1000, 1000, { x: 6000, y: 0 }) });
  const good = faceInk(r, [
    { x: 0, y: 250 },
    { x: 4000, y: 700 },
  ]);
  p.faceSketches.push(good);
  assert.doesNotThrow(() => g.validateProject(p));
  for (const patch of [
    { roomId: other.id },
    { wallId: 'kayıp' },
    { side: 'axis' },
    { points: [{ x: 4001, y: 0 }] },
    { points: [{ x: 0, y: -1 }] },
    { width: -1 },
    { opacity: 2 },
    { color: 'javascript:0' },
    { points: [] },
  ]) {
    assert.throws(() => g.normalizeProject({ ...p, faceSketches: [{ ...good, ...patch }] }));
  }
  assert.throws(() => g.resizeWall(p, r.wallIds[0], 3500), /Görünüş eskizi/);
  assert.equal(g.wallLength(p, r.wallIds[0]), 4000);
});
test('Ü2 · Dikdörtgen mobilya eskizi sınırda kırpılır ve birleşince özgün vektör, basınç ve uç etiketlerini geri alır', () => {
  const { p, r } = fixture(),
    wallId = r.wallIds[0];
  const original = faceInk(
    r,
    [
      { x: 500, y: 400, pressure: 0.2, label: 'Baş' },
      { x: 3500, y: 400, pressure: 0.8 },
      { x: 3500, y: 1300, pressure: 1 },
      { x: 500, y: 1300, pressure: 0.6 },
      { x: 500, y: 400, pressure: 0.2, label: 'Son' },
    ],
    { side: 'outside', shape: 'rect' }
  );
  const saved = structuredClone(original);
  p.faceSketches.push(original);
  const split = g.splitWall(p, wallId, 0.5);
  assert.deepEqual(
    p.faceSketches.map((v) => v.wallId),
    [split.leftId, split.rightId, split.leftId]
  );
  assert.equal(p.faceSketches[0].points.at(-1).pressure, 0.5);
  assert.equal(p.faceSketches[1].points[0].x, 0);
  assert.deepEqual(
    p.faceSketches[1].points.map((v) => [v.x, v.y]),
    [
      [0, 400],
      [1500, 400],
      [1500, 1300],
      [0, 1300],
    ]
  );
  assert.equal(p.faceSketches[0].id, saved.id);
  assert.equal(new Set(p.faceSketches.map((v) => v.id)).size, 3);
  for (const ink of p.faceSketches)
    for (const key of ['color', 'brush', 'shape', 'opacity', 'side', 'width'])
      assert.equal(ink[key], saved[key]);
  g.mergeWalls(p, split.leftId, split.rightId);
  assert.equal(p.faceSketches.length, 1);
  assert.equal(p.faceSketches[0].id, saved.id);
  assert.deepEqual(p.faceSketches[0].points, saved.points);
  assert.equal(p.faceSketches[0].side, 'outside');
  g.validateProject(p);
});
test('Ü2 · Ters yönlü duvar birleşince görünüş X değeri fiziksel A yönüne çevrilir', () => {
  const { p, r } = fixture(),
    split = g.splitWall(p, r.wallIds[0], 0.5);
  const right = p.walls.find((w) => w.id === split.rightId);
  [right.a, right.b] = [right.b, right.a];
  const ink = faceInk(
    r,
    [
      { x: 250, y: 1150, label: 'Baş' },
      { x: 750, y: 980, label: 'Son' },
    ],
    { wallId: right.id, side: 'outside' }
  );
  p.faceSketches.push(ink);
  g.validateProject(p);
  g.mergeWalls(p, split.leftId, split.rightId);
  assert.deepEqual(ink.points, [
    { x: 3750, y: 1150, label: 'Baş' },
    { x: 3250, y: 980, label: 'Son' },
  ]);
  assert.equal(ink.wallId, split.leftId);
  assert.equal(ink.side, 'outside');
});
test('Ü3 · Kesim doğrusu üzerindeki düşey iz tek kalır, silinmiş orta parça yeniden çizilmez', () => {
  const { p, r } = fixture();
  const line = faceInk(r, [
    { x: 2000, y: 100 },
    { x: 2000, y: 800 },
  ]);
  const crossing = faceInk(r, [
    { x: 500, y: 200 },
    { x: 3300, y: 500 },
    { x: 500, y: 700 },
  ]);
  p.faceSketches.push(line, crossing);
  const split = g.splitWall(p, r.wallIds[0], 0.5);
  assert.equal(p.faceSketches.length, 4);
  assert.equal(p.faceSketches[0].wallId, split.leftId);
  p.faceSketches = p.faceSketches.filter((sk) => sk.wallId !== split.rightId);
  g.mergeWalls(p, split.leftId, split.rightId);
  assert.equal(p.faceSketches.length, 3);
  assert.deepEqual(p.faceSketches[0].points, [
    { x: 2000, y: 100 },
    { x: 2000, y: 800 },
  ]);
  assert.ok(p.faceSketches.slice(1).every((sk) => sk.points.every((pt) => pt.x <= 2000)));
});
test('Ü8 · Katla birlikte fotoğrafın iki noktası, tek bakış açısı ve plan izi döner, görünüşün yerel ölçüleri korunur', () => {
  const { p, r } = fixture(),
    otherFloor = g.addFloor(p, { name: 'Sabit kat', elevation: 3550 });
  const wallId = r.wallIds[0],
    door = g.addElement(p, { roomId: r.id, wallId, type: 'door', offset: 1000, width: 800 });
  const cam = {
    id: 'camera',
    roomId: r.id,
    floorId: r.floorId,
    anchor: { x: 100, y: 150, floorId: r.floorId, wallId, roomId: r.id },
    target: { x: 1300, y: 150, z: 1200, floorId: r.floorId, wallId, roomId: r.id, elementId: door.id },
    direction: 5,
  };
  p.notes.push(
    cam,
    { id: 'direction-only', floorId: r.floorId, direction: 315 },
    { id: 'other', floorId: otherFloor.id, direction: 28 }
  );
  p.strokes.push({
    id: 'old-plan',
    floorId: r.floorId,
    points: [
      { x: 100, y: 0 },
      { x: 200, y: 20 },
    ],
  });
  const ink = faceInk(r, [
    { x: 300, y: 250 },
    { x: 800, y: 750 },
  ]);
  p.faceSketches.push(ink);
  const local = structuredClone(ink);
  g.validateProject(p);
  g.alignFloorXY(
    p,
    r.floorId,
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 500 },
    { x: 1000, y: 1500 }
  );
  const n = p.notes[0];
  assert.deepEqual(
    [
      Math.round(n.anchor.x),
      Math.round(n.anchor.y),
      Math.round(n.target.x),
      Math.round(n.target.y),
      n.target.z,
      n.direction,
    ],
    [850, 600, 850, 1800, 1200, 180]
  );
  assert.equal(p.notes[1].direction, 45);
  assert.equal(p.notes[2].direction, 28);
  assert.deepEqual(p.faceSketches[0], local);
  assert.deepEqual(p.strokes[0].points[0], { x: 1000, y: 600 });
});
test('Ü3 · Kamera noktasındaki t biçimsiz duvar ve öğe bağlamı, duvar bölünürken ve birleşirken geçerli kalır', () => {
  const { p, r } = fixture(),
    wallId = r.wallIds[0],
    el = g.addElement(p, { roomId: r.id, wallId, type: 'window', offset: 2600, width: 700 });
  p.notes.push({
    id: 'shot',
    roomId: r.id,
    floorId: r.floorId,
    wallId,
    t: 0.8,
    anchor: { x: 800, y: 0, wallId, roomId: r.id },
    target: { x: 2800, y: 0, z: 950, wallId, roomId: r.id, elementId: el.id },
  });
  const split = g.splitWall(p, wallId, 0.5),
    n = p.notes[0];
  assert.equal(n.anchor.wallId, split.leftId);
  assert.equal(n.target.wallId, split.rightId);
  assert.equal(n.target.x, 2800);
  assert.equal(n.target.t, undefined);
  g.mergeWalls(p, split.leftId, split.rightId);
  assert.equal(n.target.wallId, wallId);
  assert.equal(n.target.x, 2800);
  g.validateProject(p);
});
