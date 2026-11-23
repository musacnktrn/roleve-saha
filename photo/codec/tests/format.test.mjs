// [codex] ureten: codex
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sniffImage, fit, boundedImage, checkHeaderDimensions } from '../format.js';
const enc = new TextEncoder();
const sample = (name) =>
  new Uint8Array(readFileSync(new URL('../../../server/testdata/' + name, import.meta.url)));
test('Birincil ve uyumlu HEIC ve AVIF markaları gerçek dosyada tanınır', () => {
  for (const [name, type] of [
    ['original.heic', 'image/heic'],
    ['original.avif', 'image/avif'],
  ]) {
    const b = sample(name);
    assert.equal(sniffImage(b), type);
    assert.doesNotThrow(() => checkHeaderDimensions(b, type));
  }
  const b = sample('original.heic');
  b.set(enc.encode('mif1'), 8);
  assert.equal(sniffImage(b), 'image/heic');
  b.set(enc.encode('mif1'), 32);
  assert.equal(sniffImage(b), 'image/heif');
});
test('Desteklenen raster imzaları ve desteklenmeyen içerik', () => {
  for (const [b, type] of [
    [Uint8Array.of(255, 216, 255, 224), 'image/jpeg'],
    [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), 'image/png'],
    [enc.encode('GIF89a'), 'image/gif'],
    [enc.encode('RIFF....WEBP'), 'image/webp'],
    [enc.encode('picture.HEIC'), null],
    [enc.encode('<svg></svg>'), null],
    [new Uint8Array(0), null],
  ])
    assert.equal(sniffImage(b), type);
});
test('Sınırlı meta alanları ve JPEG SOF eksenleri büyük bitmapleri ayırır', () => {
  const sampleHeic = sample('original.heic'),
    index = Buffer.from(sampleHeic).indexOf('ispe') + 8;
  assert.ok(index > 7);
  new DataView(sampleHeic.buffer).setUint32(index, 100_000);
  assert.throws(() => checkHeaderDimensions(sampleHeic, 'image/heic'), /64 mega/);
  const jpg = Uint8Array.of(255, 216, 255, 192, 0, 8, 8, 0x03, 0xe8, 0xff, 0xff, 1);
  assert.throws(() => checkHeaderDimensions(jpg, 'image/jpeg'), /64 mega/);
  for (const [w, h] of [
    [0, 3],
    [NaN, 2],
    [65535, 1],
    [9000, 9000],
  ])
    assert.throws(() => boundedImage(w, h));
  boundedImage(8064, 6048);
  assert.deepEqual(fit(8064, 6048, 2400), { width: 2400, height: 1800 });
});
test('Eksik kutu ve tanımsız video kapsayıcısı fotoğraf gibi alınmaz', () => {
  const b = sample('original.heic');
  assert.equal(sniffImage(b.subarray(0, 20)), null);
  const box = Uint8Array.of(0, 0, 0, 20, ...enc.encode('ftypmp42'), 0, 0, 0, 0, ...enc.encode('mp42'));
  assert.equal(sniffImage(box), null);
});
