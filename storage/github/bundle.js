/* [codex] Portable private-repository transfer. The caller handles files and GitHub's own UI. */
import {
  MAX_MEDIA,
  MAX_METADATA,
  MAX_PROJECT_MEDIA,
  decodeAssetSource,
  hash,
  packProject,
  unpackProject,
} from '../media.js';
import { readClassic } from './classic.js';

export const MAX_PART_BYTES = 12 * 1024 ** 2;
export const MAX_LEGACY_BYTES = 512 * 1024 ** 2;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_PAYLOAD = MAX_METADATA + MAX_PROJECT_MEDIA;
const MAX_PARTS = Math.ceil(MAX_PAYLOAD / MAX_PART_BYTES);
const FORMAT = 'roleve-saha/github-dosya';
const MANIFEST_SUFFIX = '.roleve-manifest.json';
const digestPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const classicName = /^roleve-paket-\d{8}T\d{6}Z-[0-9a-f-]{36}\.([0-9a-f]{64})\.roleve\.json$/;
const enc = new TextEncoder();

function requireValue(condition, message) {
  if (!condition) throw Error(message);
}
function identity(doc) {
  requireValue(
    doc &&
      doc.schemaVersion === 1 &&
      typeof doc.id === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(doc.id) &&
      typeof doc.name === 'string' &&
      doc.name.trim() &&
      ['floors', 'nodes', 'walls', 'rooms'].every((key) => Array.isArray(doc[key])),
    'Dosyada desteklenen bir rölöve projesi bulunamadı.'
  );
  return doc;
}
function folderName(date, id) {
  return 'roleve-paket-' + date.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') + '-' + id;
}
const partName = (folder, index) => folder + '.part-' + String(index).padStart(3, '0') + '.bin';
const entry = (name, blob) => ({ name, blob, size: blob.size });
const digestBlob = async (blob) => hash(await blob.arrayBuffer());
async function jsonFile(blob) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer()));
  } catch {
    throw Error('Dosya geçerli UTF-8 proje JSON’u içermiyor.');
  }
}
function versionId() {
  const c = globalThis.crypto;
  requireValue(
    c?.subtle && c.getRandomValues,
    'Dosya doğrulaması için uygulamayı HTTPS veya localhost üzerinden açın.'
  );
  if (c.randomUUID) return c.randomUUID();
  const a = c.getRandomValues(new Uint8Array(16));
  a[6] = (a[6] & 15) | 64;
  a[8] = (a[8] & 63) | 128;
  const hex = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
function walk(value, visit, depth = 0) {
  requireValue(depth <= 48, 'Proje iç içe veri sınırını aşıyor.');
  if (!value || typeof value !== 'object') return;
  if (visit(value)) return;
  for (const child of Object.values(value)) walk(child, visit, depth + 1);
}
function indexMedia(doc, metadataBytes) {
  const sizes = new Map();
  let total = 0;
  walk(doc, (item) => {
    if (!Object.hasOwn(item, '$roleveMedia')) return false;
    const ref = item.$roleveMedia;
    requireValue(
      ref &&
        typeof ref.sha256 === 'string' &&
        digestPattern.test(ref.sha256) &&
        Number.isSafeInteger(ref.size) &&
        ref.size > 0 &&
        ref.size <= MAX_MEDIA,
      'Arşivde geçersiz ek dosya bildirimi var.'
    );
    const prior = sizes.get(ref.sha256);
    requireValue(prior === undefined || prior === ref.size, 'Aynı dosyanın boyut bildirimleri farklı.');
    if (prior === undefined) {
      total += ref.size;
      requireValue(total <= MAX_PROJECT_MEDIA, 'Proje ekleri 256 MiB sınırını aşıyor.');
      sizes.set(ref.sha256, ref.size);
    }
    return true;
  });
  let offset = metadataBytes;
  const offsets = new Map();
  for (const sha of [...sizes.keys()].sort()) {
    const size = sizes.get(sha);
    offsets.set(sha, { offset, size });
    offset += size;
  }
  return { offsets, total: offset };
}
function fitsClassic(project, doc, metadataBytes) {
  let adjust = 0,
    aloneTooLarge = false;
  const lengths = new Map();
  function compare(raw, packed) {
    if (!packed || typeof packed !== 'object') return;
    if (Object.hasOwn(packed, '$roleveMedia')) {
      if (raw.length > MAX_PART_BYTES) {
        aloneTooLarge = true;
        return;
      }
      // Generated data URLs are ASCII; JSON escaping is counted for older archive strings too.
      if (!lengths.has(raw)) lengths.set(raw, JSON.stringify(raw).length);
      adjust += lengths.get(raw) - JSON.stringify(packed).length;
      return;
    }
    for (const key of Object.keys(packed)) {
      if (aloneTooLarge) return;
      compare(raw[key], packed[key]);
    }
  }
  compare(project, doc);
  return !aloneTooLarge && metadataBytes + adjust <= MAX_PART_BYTES;
}
export async function createGithubBundle(project) {
  identity(project);
  const id = versionId(),
    createdAt = new Date().toISOString(),
    folder = folderName(createdAt, id);
  const { document, assets } = await packProject(project, { sourcesOnly: true });
  const metadata = new Blob([JSON.stringify(document)], { type: 'application/json' });
  if (fitsClassic(project, document, metadata.size)) {
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
    if (blob.size <= MAX_PART_BYTES) {
      const digest = await digestBlob(blob);
      return {
        kind: 'single',
        versionId: id,
        folder,
        files: [entry(folder + '.' + digest + '.roleve.json', blob)],
      };
    }
  }
  const slices = [metadata];
  for (const sha of [...assets.keys()].sort()) slices.push(new Blob([decodeAssetSource(assets.get(sha))]));
  const payload = new Blob(slices),
    files = [],
    parts = [];
  requireValue(payload.size <= MAX_PAYLOAD, 'Proje veri sınırını aşıyor.');
  for (let offset = 0, index = 1; offset < payload.size; offset += MAX_PART_BYTES, index++) {
    const blob = payload.slice(
      offset,
      Math.min(payload.size, offset + MAX_PART_BYTES),
      'application/octet-stream'
    );
    const name = partName(folder, index);
    files.push(entry(name, blob));
    parts.push({ index, name, size: blob.size, sha256: await digestBlob(blob) });
  }
  const catalog = {
    format: FORMAT,
    version: 1,
    versionId: id,
    createdAt,
    projectId: project.id,
    metadataBytes: metadata.size,
    metadataSha256: await digestBlob(metadata),
    totalBytes: payload.size,
    assetCount: assets.size,
    parts,
  };
  const manifest = { ...catalog, indexSha256: await hash(enc.encode(JSON.stringify(catalog))) };
  const file = new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' });
  requireValue(file.size <= MAX_MANIFEST_BYTES, 'Manifest boyutu sınırı aşıldı.');
  return {
    kind: 'multipart',
    versionId: id,
    folder,
    files: [entry(folder + MANIFEST_SUFFIX, file), ...files],
  };
}
function safeFiles(input) {
  const list = input?.[Symbol.iterator] && typeof input !== 'string' ? input : [input];
  const files = new Map();
  for (const item of list) {
    const name = item?.name,
      blob = item?.blob || item;
    requireValue(
      typeof name === 'string' &&
        name.length > 0 &&
        name.length <= 255 &&
        !name.startsWith('.') &&
        !/[\\/:\x00-\x1f\x7f]/.test(name) &&
        !/%(?:2f|5c|2e)/i.test(name),
      'Dosya adı güvenli bir proje dosyası adı olmalı.'
    );
    const relative = item.webkitRelativePath;
    if (relative)
      requireValue(
        !relative.includes('\\') &&
          !relative.startsWith('/') &&
          relative.split('/').every((s) => s && s !== '.' && s !== '..') &&
          !/%(?:2f|5c|2e)/i.test(relative),
        'Dosya yolu geçersiz.'
      );
    requireValue(
      blob &&
        Number.isSafeInteger(blob.size) &&
        blob.size > 0 &&
        typeof blob.slice === 'function' &&
        typeof blob.arrayBuffer === 'function',
      'Dosya boş veya okunamıyor.'
    );
    requireValue(!files.has(name), 'Aynı adlı dosya iki kez seçildi.');
    files.set(name, blob);
    requireValue(files.size <= MAX_PARTS + 1, 'Tek bir proje sürümünün dosyalarını seçin.');
  }
  requireValue(files.size > 0, 'Önce proje dosyalarını seçin.');
  return files;
}
function exactKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((k) => Object.hasOwn(value, k))
  );
}
async function verifyManifest(m, name, files) {
  requireValue(
    exactKeys(m, [
      'format',
      'version',
      'versionId',
      'createdAt',
      'projectId',
      'metadataBytes',
      'metadataSha256',
      'totalBytes',
      'assetCount',
      'parts',
      'indexSha256',
    ]) &&
      m.format === FORMAT &&
      m.version === 1 &&
      typeof m.versionId === 'string' &&
      uuidPattern.test(m.versionId) &&
      typeof m.createdAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.createdAt) &&
      Number.isFinite(Date.parse(m.createdAt)) &&
      new Date(m.createdAt).toISOString() === m.createdAt &&
      typeof m.projectId === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(m.projectId),
    'Proje manifesti desteklenmiyor.'
  );
  const folder = folderName(m.createdAt, m.versionId);
  requireValue(name === folder + MANIFEST_SUFFIX, 'Manifest adı ve sürüm kimliği uyuşmuyor.');
  requireValue(
    Number.isSafeInteger(m.metadataBytes) &&
      m.metadataBytes > 0 &&
      m.metadataBytes <= MAX_METADATA &&
      Number.isSafeInteger(m.totalBytes) &&
      m.totalBytes >= m.metadataBytes &&
      m.totalBytes - m.metadataBytes <= MAX_PROJECT_MEDIA &&
      Number.isSafeInteger(m.assetCount) &&
      m.assetCount >= 0 &&
      m.assetCount <= m.totalBytes - m.metadataBytes &&
      typeof m.metadataSha256 === 'string' &&
      digestPattern.test(m.metadataSha256) &&
      typeof m.indexSha256 === 'string' &&
      digestPattern.test(m.indexSha256),
    'Manifestteki dosya boyutları veya özetleri geçersiz.'
  );
  const count = Math.ceil(m.totalBytes / MAX_PART_BYTES);
  requireValue(
    Array.isArray(m.parts) && m.parts.length === count && count <= MAX_PARTS && files.size === count + 1,
    'Parça kümesi eksik veya fazladan dosya içeriyor.'
  );
  const { indexSha256, ...unsigned } = m;
  requireValue(
    (await hash(enc.encode(JSON.stringify(unsigned)))) === indexSha256,
    'Manifestin SHA-256 doğrulaması başarısız.'
  );
  const ordered = [];
  for (let i = 0; i < count; i++) {
    const part = m.parts[i],
      expected = partName(folder, i + 1);
    requireValue(
      exactKeys(part, ['index', 'name', 'size', 'sha256']) &&
        part.index === i + 1 &&
        part.name === expected &&
        part.size === Math.min(MAX_PART_BYTES, m.totalBytes - i * MAX_PART_BYTES) &&
        typeof part.sha256 === 'string' &&
        digestPattern.test(part.sha256),
      'Parça adı, sırası veya boyutu manifestle uyuşmuyor.'
    );
    const file = files.get(expected);
    requireValue(file?.size === part.size, 'Eksik veya başka sürüme ait parça var.');
    ordered.push(file);
  }
  for (let i = 0; i < count; i++)
    requireValue(
      (await digestBlob(ordered[i])) === m.parts[i].sha256,
      'Parça ' + (i + 1) + ' SHA-256 doğrulamasından geçmedi.'
    );
  return new Blob(ordered);
}
export async function readGithubBundle(input) {
  const files = safeFiles(input),
    manifests = [...files.keys()].filter((n) => n.endsWith(MANIFEST_SUFFIX));
  if (!manifests.length) {
    requireValue(
      files.size === 1,
      'Her sürümü ayrı seçin; çok parçalı aktarımda manifest dosyası da gereklidir.'
    );
    const [[name, file]] = files;
    requireValue(/\.(?:json|roleve)$/i.test(name), 'Parçaları açmak için aynı sürümün manifestini de seçin.');
    requireValue(file.size <= MAX_LEGACY_BYTES, 'Tek eski JSON dosyası için 512 MiB okuma sınırı var.');
    const modern = classicName.exec(name);
    if (/^roleve-paket-\d{8}T\d{6}Z-[0-9a-f-]{36}\./.test(name))
      requireValue(
        modern && file.size <= MAX_PART_BYTES && (await digestBlob(file)) === modern[1],
        'Tek dosya adı veya SHA-256 doğrulaması geçersiz.'
      );
    if (file.size > MAX_PART_BYTES) return identity(await readClassic(file));
    const raw = await jsonFile(file),
      p = identity(raw?.schemaVersion === 1 ? raw : raw?.project);
    await packProject(p, { sourcesOnly: true });
    return p;
  }
  requireValue(manifests.length === 1, 'Farklı sürümlerin manifestleri birlikte seçilemez.');
  const name = manifests[0],
    manifest = files.get(name);
  requireValue(manifest.size <= MAX_MANIFEST_BYTES, 'Manifest boyutu sınırı aşıldı.');
  const m = await jsonFile(manifest),
    payload = await verifyManifest(m, name, files);
  const header = payload.slice(0, m.metadataBytes);
  requireValue(
    (await digestBlob(header)) === m.metadataSha256,
    'Proje bilgisinin SHA-256 doğrulaması başarısız.'
  );
  const doc = identity(await jsonFile(header));
  requireValue(doc.id === m.projectId, 'Manifest ve proje kimliği uyuşmuyor.');
  const { offsets, total } = indexMedia(doc, m.metadataBytes);
  requireValue(
    total === m.totalBytes && offsets.size === m.assetCount,
    'Manifestte bildirilen ekler ile veri uzunluğu uyuşmuyor.'
  );
  return unpackProject(doc, (sha) => {
    const part = offsets.get(sha);
    return payload.slice(part.offset, part.offset + part.size).arrayBuffer();
  });
}
