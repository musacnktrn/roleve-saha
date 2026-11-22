// [codex] ureten: codex
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePhotoAnnotations as validate,
  markSVG,
  markLabel,
  shiftMark,
  exportDimensions,
} from '../annotations.js';

const point = (x, y) => ({ x, y });
const dim = {
  id: 'a',
  type: 'dimension',
  color: '#ffce45',
  points: [point(0.2, 0.25), point(0.85, 0.75)],
  raw: '1,245',
  unit: 'm',
  method: 'laser',
};
test('Önceki sürümde işaretsiz fotoğraf kabul edilir', () =>
  assert.deepEqual(validate({ name: 'tavan.jpg' }), []));
test('Ham değer ve kayıt yöntemi metinle korunur', () => {
  assert.equal(validate({ annotations: [dim] })[0], dim);
  assert.equal(markLabel(dim), '1,245 m · Lazer');
  assert.equal(markLabel({ ...dim, raw: '1245', unit: 'mm', method: 'estimate' }), '1245 mm · Tahmin');
});
test('Kimlik, sayı ve resim sınırı kontrol edilir', () => {
  for (const points of [
    [point('0.2', 0.2), point(0.3, 0.4)],
    [point(-0.2, 0.1), point(0.4, 0.6)],
    [point(0.1, NaN), point(1, 0.25)],
    [dim.points[0], dim.points[0]],
  ])
    assert.throws(() => validate({ annotations: [{ ...dim, points }] }));
  assert.throws(() => validate({ annotations: [dim, dim] }));
  for (const change of [
    { raw: 'eksi' },
    { raw: '0' },
    { unit: 'ft' },
    { method: 'none' },
    { color: 'transparent' },
    { raw: 1.245 },
    { type: 'unknown' },
  ])
    assert.throws(() => validate({ annotations: [{ ...dim, ...change }] }));
});
test('Noktalar taşımada fotoğraf kenarını geçmez, aralık değişmez', () => {
  const moved = shiftMark(dim, 2, -2);
  assert.deepEqual(
    moved.points.map((p) => [+p.x.toFixed(3), +p.y.toFixed(3)]),
    [
      [0.35, 0],
      [1, 0.5],
    ],
  );
  assert.equal(dim.points[0].x, 0.2);
});
test('Çıktıda ölçünün kendisi ve metin içeriği yazı olarak çizilir', () => {
  assert.match(markSVG(dim, 640, 480), /1,245 m · Lazer/);
  const markup = markSVG(
    { ...dim, type: 'text', points: [point(0.2, 0.4)], text: 'A < B & C' },
    640,
    480,
  );
  assert.ok(markup.includes('A &lt; B &amp; C'));
  assert.throws(() =>
    validate({ annotations: [{ ...dim, type: 'text', points: [point(0.2, 0.4)], text: '' }] }),
  );
});
test('Farklı fotoğraf boyutu aynı normalize konumu korur', () => {
  assert.match(markSVG(dim, 1000, 500), /M200 125 L850 375/);
  assert.match(markSVG(dim, 2000, 1000), /M400 250 L1700 750/);
});
test('Büyük kamera fotoğrafının işaretli kopyası cihazda sınırlı bir çıktı alır', () => {
  const out = exportDimensions(8064, 6048);
  assert.ok(out.w * out.h <= 12_000_000 && out.w <= 4096 && Math.abs(out.w / out.h - 4 / 3) < 0.002);
  assert.deepEqual(exportDimensions(640, 480), { w: 640, h: 480 });
});
