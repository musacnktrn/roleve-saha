/* [codex] Synthetic R7 survey and local File / Blob inputs. No network or credentials. */
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sampleProject } from '../../../ui/demo.js';
import { validateExtras } from '../../../ui/dialog.js';
import { normalizeProject } from '../../../geometry/core.js';
import { createGithubBundle, readGithubBundle, MAX_PART_BYTES, MAX_LEGACY_BYTES } from '../bundle.js';

const digest = (v) => createHash('sha256').update(v).digest('hex');
const fileEntry = (name, blob) => ({ name, blob, size: blob.size });
const asFiles = (files) => files.map(({ name, blob }) => new File([blob], name, { type: blob.type }));
const little =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+r8Y4AAAAASUVORK5CYII=';
let small, large, bundle, manifest, manifestFile, parts;

before(async () => {
  small = sampleProject('dukkan');
  small.customer = { id: 'musteri-r7', name: 'Sentetik Müşteri' };
  small.surveyorName = 'Örnek Sorumlu';
  small.sections = [
    { id: 'kesit-1', name: 'A–A', floorId: small.floors[0].id, a: { x: 0, y: 0 }, b: { x: 2000, y: 1000 } },
  ];
  small.notes.push({
    id: 'arsiv-not',
    text: 'Ölçü, işaret ve özgün fotoğraf',
    photo: {
      name: 'saha.png',
      data: little,
      preview: { data: little },
      annotations: [
        { id: 'yazi', type: 'text', color: '#ffce45', text: 'Kapı', points: [{ x: 0.2, y: 0.3 }] },
      ],
    },
  });
  validateExtras(normalizeProject(small));
  large = structuredClone(small);
  const avif = await readFile(new URL('../../../server/testdata/original.avif', import.meta.url));
  // A valid ISO-BMFF free-space box enlarges the fixture without changing its image.
  const padding = Buffer.alloc(25 * 1024 ** 2 + 41);
  padding.writeUInt32BE(padding.length);
  padding.write('free', 4);
  for (let i = 8; i < padding.length; i += 1024 ** 2)
    padding.fill(Math.floor(i / 1024 ** 2) & 255, i, Math.min(padding.length, i + 1024 ** 2));
  const original = 'data:image/avif;base64,' + Buffer.concat([avif, padding]).toString('base64');
  large.notes[large.notes.length - 1].photo.original = { name: 'tavan.avif', data: original };
  large.notes.push({
    id: 'iki-yerde',
    text: 'Aynı özgün fotoğraf ikinci notta',
    photo: { name: 'saha.png', data: little, original: { name: 'tavan.avif', data: original } },
  });
  large.kaynakNotu = 'Yaklaşık \\ " ← İğne / 🧭\n'.repeat(13000);
  validateExtras(normalizeProject(large));
  bundle = await createGithubBundle(large);
  [manifestFile, ...parts] = bundle.files;
  manifest = JSON.parse(await manifestFile.blob.text());
});

test('tek dosya klasik proje JSON’u, R7 ham ve sarmallı arşivleri geri alınır', async () => {
  const result = await createGithubBundle(small),
    again = await createGithubBundle(small);
  assert.notEqual(result.folder, again.folder);
  assert.notEqual(result.files[0].name, again.files[0].name);
  assert.equal(result.kind, 'single');
  const [file] = result.files;
  assert.equal(file.blob.type, 'application/json');
  assert.match(file.name, /\.roleve\.json$/);
  assert.deepEqual(JSON.parse(await file.blob.text()), small);
  assert.deepEqual(await readGithubBundle(asFiles(result.files)), small);
  for (const value of [small, { project: small }]) {
    const old = new File([JSON.stringify(value, null, 2)], 'Eski Avlu Evi.roleve.json');
    assert.deepEqual(await readGithubBundle([old]), small);
  }
  const bad = new File([JSON.stringify({ ...small, name: 'Değişti' })], file.name);
  await assert.rejects(() => readGithubBundle([bad]), /SHA-256/);
});

test('iki başvuruya bağlı aynı özgün fotoğraf yalnız bir kez taşınır, ölçü/işaret ve fotoğraf baytları aynıdır', async () => {
  assert.equal(bundle.kind, 'multipart');
  assert.ok(parts.length >= 3);
  assert.ok(bundle.files.every((f) => f.size > 0 && f.size <= MAX_PART_BYTES && f.blob.size === f.size));
  assert.equal(manifest.assetCount, 2);
  assert.ok(manifest.totalBytes < 27 * 1024 ** 2);
  const received = await readGithubBundle(asFiles(bundle.files).reverse());
  assert.deepEqual(received, large);
  validateExtras(normalizeProject(received));
  const [from, to] = [large, received].map((p) =>
    Buffer.from(p.notes.at(-1).photo.original.data.split(',')[1], 'base64')
  );
  assert.equal(digest(from), digest(to));
});

test('önceki tek büyük .roleve.json projenin tamamını ve UTF-8 metnini parçalı okuyarak korur', async () => {
  const raw = new File([JSON.stringify({ project: large }, null, 2)], 'Atölye R7.roleve.json');
  assert.ok(raw.size > MAX_PART_BYTES);
  assert.deepEqual(await readGithubBundle([raw]), large);
});

test('eksik, çift, serisi karışık ve içerikleri yanlış dosya adlarıyla seçilmiş parçalar reddedilir', async () => {
  await assert.rejects(() => readGithubBundle([manifestFile, ...parts.slice(1)]), /eksik|fazladan/i);
  await assert.rejects(() => readGithubBundle([manifestFile, ...parts, parts[0]]), /iki kez/);
  const spare = await createGithubBundle(large);
  assert.notEqual(spare.folder, bundle.folder);
  assert.ok(spare.files.every((f) => !bundle.files.some((g) => g.name === f.name)));
  await assert.rejects(
    () => readGithubBundle([manifestFile, spare.files[1], ...parts.slice(1)]),
    /başka sürüm|Eksik/
  );
  await assert.rejects(() => readGithubBundle([...bundle.files, spare.files[0]]), /Farklı sürüm/);
  const swapped = [
    fileEntry(parts[0].name, parts[1].blob),
    fileEntry(parts[1].name, parts[0].blob),
    ...parts.slice(2),
  ];
  await assert.rejects(() => readGithubBundle([manifestFile, ...swapped]), /SHA-256/);
});
async function amended(change) {
  const m = structuredClone(manifest);
  change(m);
  delete m.indexSha256;
  m.indexSha256 = digest(JSON.stringify(m));
  return fileEntry(manifestFile.name, new Blob([JSON.stringify(m)], { type: 'application/json' }));
}
test('manifest sırasını, yolunu, boyutunu veya SHA-256 değerlerini değiştiren paket açılmaz', async () => {
  let changed = structuredClone(manifest);
  changed.parts[0].sha256 = 'f'.repeat(64);
  await assert.rejects(
    () => readGithubBundle([fileEntry(manifestFile.name, new Blob([JSON.stringify(changed)])), ...parts]),
    /Manifestin SHA/
  );
  const outOfOrder = await amended((m) => m.parts.reverse());
  await assert.rejects(() => readGithubBundle([outOfOrder, ...parts]), /sırası/);
  const outside = await amended((m) => {
    m.parts[0].name = '../' + m.parts[0].name;
  });
  await assert.rejects(() => readGithubBundle([outside, ...parts]), /Parça adı/);
  const forged = await amended((m) => {
    m.totalBytes = m.metadataBytes + 256 * 1024 ** 2 + 1;
  });
  await assert.rejects(() => readGithubBundle([forged, ...parts]), /boyutları/);
  const forgedMeta = await amended((m) => {
    m.metadataSha256 = 'c'.repeat(64);
  });
  await assert.rejects(() => readGithubBundle([forgedMeta, ...parts]), /bilgisinin SHA/);
  const wrongId = await amended((m) => {
    m.projectId = 'baska-proje';
  });
  await assert.rejects(() => readGithubBundle([wrongId, ...parts]), /proje kimliği/);
});
test('bozulmuş özgün dosya parçalarının yeni özeti yazılsa bile özgün varlık özeti denetlenir', async () => {
  const end = parts.at(-1),
    bytes = new Uint8Array(await end.blob.arrayBuffer());
  bytes[bytes.length - 1] ^= 24;
  const changed = fileEntry(end.name, new Blob([bytes]));
  const revised = await amended((m) => {
    m.parts.at(-1).sha256 = digest(bytes);
  });
  await assert.rejects(() => readGithubBundle([revised, ...parts.slice(0, -1), changed]), /bütünlüğü/);
});
test('okuma sırasında dosya, parça sayısı, metadata ve fotoğraf sınırları ile güvenli yollar korunur', async () => {
  let read = 0;
  const oversize = {
    size: MAX_LEGACY_BYTES + 1,
    arrayBuffer: () => {
      read++;
    },
    slice: () => {
      read++;
    },
  };
  await assert.rejects(() => readGithubBundle([{ name: 'eski.roleve.json', blob: oversize }]), /512 MiB/);
  assert.equal(read, 0);
  for (const path of ['../x.json', 'C:\\x.json', 'gorev%2fveri.json', '/tmp/a.json'])
    await assert.rejects(() => readGithubBundle([{ name: path, blob: new Blob(['{}']) }]), /güvenli/);
  await assert.rejects(() => readGithubBundle([{ ...manifestFile, webkitRelativePath: '../dosya' }]), /yolu/);
  const huge = {
    ...small,
    notes: [
      {
        id: 'limit',
        photo: { data: 'data:image/png;base64,' + 'A'.repeat(4 * Math.ceil((40 * 1024 ** 2) / 3) + 8) },
      },
    ],
  };
  await assert.rejects(() => createGithubBundle(huge), /40 MiB/);
  const metadata = { ...small, name: 'a'.repeat(24 * 1024 ** 2) };
  await assert.rejects(() => createGithubBundle(metadata), /24 MiB/);
});

test('12 MiB eşiğinde tek arşiv, bir bayt üzerinde medyasız iki parça üretilir', async () => {
  const p = {
    schemaVersion: 1,
    id: 'sinir',
    name: 'Eşik',
    floors: [],
    nodes: [],
    walls: [],
    rooms: [],
    description: '',
  };
  p.description = 'x'.repeat(MAX_PART_BYTES - Buffer.byteLength(JSON.stringify(p)));
  const exact = await createGithubBundle(p);
  assert.equal(exact.kind, 'single');
  assert.equal(exact.files[0].size, MAX_PART_BYTES);
  p.description += 'x';
  const above = await createGithubBundle(p);
  assert.equal(above.kind, 'multipart');
  assert.equal(above.files.length, 3);
  assert.deepEqual(await readGithubBundle(asFiles(above.files).reverse()), p);
});
