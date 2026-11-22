// [codex] ureten: codex
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleProject } from '../ui/demo.js';
import { readMm } from '../ui/base.js';
import { photoPin, bearingOnPlan, photoViewPoint } from '../ui/photo-placement.js';
import { observationScope } from '../ui/survey.js';
import { planMarkup } from '../ui/plan.js';
import { layout, statusLabel } from '../ui/layout.js';
import * as G from '../geometry/core.js';
test('T1 · Ü3 · Başka katta tekrarlanan gözlem ilk saha ölçüsünün mahal ve yüzüne bağlı kalır', () => {
  const p = sampleProject(),
    oldRoom = p.rooms[0],
    newFloor = G.addFloor(p, { name: 'Üst', elevation: 3100 });
  const newRoom = G.addRoom(p, {
    name: 'Üst oda',
    floorId: newFloor.id,
    points: G.templatePoints('rect', 4000, 3000),
  });
  const old = { roomId: oldRoom.id, floorId: oldRoom.floorId, wallId: oldRoom.wallIds[0] };
  assert.deepEqual(observationScope(p, { nodeId: oldRoom.nodeIds[0] }, old, newRoom, newFloor.id), old);
  assert.deepEqual(
    observationScope(
      p,
      { floorId: newFloor.id, roomId: newRoom.id, x: 100, y: 0, z: 3100 },
      null,
      oldRoom,
      oldRoom.floorId,
    ),
    { floorId: newFloor.id, roomId: newRoom.id, wallId: null },
  );
});
test('Ü2 · Son okuma görünürken özgün değer ve birim ölçü defterinde kalır', () => {
  const p = sampleProject(),
    r = p.rooms[0],
    a = { nodeId: r.nodeIds[0] },
    b = { nodeId: r.nodeIds[1] };
  const record = { roomId: r.id, floorId: r.floorId, raw: '5,21', unit: 'm', a, b, kind: 'plan' };
  const old = G.addObservation(p, record),
    latest = G.addObservation(p, { ...record, raw: '5,40', replaces: old.id });
  const v = planMarkup(p, { floorId: r.floorId, roomId: r.id, anchorFn: G.resolveAnchor }).html;
  assert.ok(v.includes(`data-obs="${latest.id}"`));
  assert.ok(!v.includes(`data-obs="${old.id}"`));
  assert.deepEqual(
    p.observations.map((o) => o.raw),
    ['5,21', '5,40'],
  );
  assert.equal(readMm('428,5 cm', 'm'), 4285);
});
test('T4 · Ölçülmemiş kuzey ve bekleyen eşitlemenin okunur durumu', () => {
  const p = sampleProject(),
    s = { floorId: p.floors[0].id, roomId: p.rooms[0].id, mode: 'plan' };
  assert.ok(!layout(p, s).includes('class="north"'));
  p.northAngle = 27;
  assert.ok(layout(p, s).includes('rotate(27deg)'));
  assert.ok(!layout(p, { ...s, mode: 'elevation' }).includes('class="north"'));
  assert.equal(statusLabel({ state: 'pending', pending: true }), 'Eşitleme bekliyor');
});
test('Çekim konumu ve bakış iki ayrı noktadır; zemin, duvar ve tavan fotoğrafı planda iğne olarak bulunur', () => {
  const p = sampleProject(),
    r = p.rooms[0];
  const camera = photoViewPoint(p, r.floorId, { x: 1200, y: 1200 }),
    target = photoViewPoint(p, r.floorId, { x: 1700, y: 1200 }, { room: r.id });
  assert.equal(camera.roomId, r.id);
  assert.equal(target.floorId, r.floorId);
  assert.equal(bearingOnPlan(camera, target), 90);
  assert.equal(bearingOnPlan(camera, { x: camera.x, y: camera.y - 10 }), 0);
  assert.throws(() => bearingOnPlan(camera, camera));
  for (const surface of ['floor', 'wall', 'ceiling']) {
    const n = { id: surface, surface, anchor: camera, target, direction: 90, photo: {} };
    assert.match(photoPin(n), /class="photo-pin"/);
    assert.ok(photoPin(n).includes('rotate(90)'));
    assert.ok(photoPin(n).includes('L500 0'));
  }
});
