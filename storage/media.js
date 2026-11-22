/* [codex] Content-addressed media. All limits apply to decoded bytes. */
import { StoreError } from './local.js';

export const CHUNK = 256 * 1024;
export const MAX_MEDIA = 40 * 1024 * 1024;
export const MAX_PROJECT_MEDIA = 256 * 1024 * 1024;
export const MAX_METADATA = 24 * 1024 * 1024;
const allowed = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
  'application/pdf',
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
]);
const forbidden = new Set(['__proto__', 'prototype', 'constructor', '$roleveLocalFile']);

function invalid(text) {
  throw new StoreError('INVALID_MEDIA', text);
}

export async function hash(bytes) {
  if (!globalThis.crypto?.subtle)
    throw new StoreError('SECURE_CONTEXT', 'Özel dosya aktarımı için HTTPS veya localhost kullanın.');
  const value = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(value, (v) => v.toString(16).padStart(2, '0')).join('');
}
export function dataURL(type, bytes) {
  if (!allowed.has(type)) invalid('Desteklenmeyen dosya türü.');
  if (typeof bytes.toBase64 === 'function') return 'data:' + type + ';base64,' + bytes.toBase64();
  let text = '';
  for (let i = 0; i < bytes.byteLength; i += 16384)
    text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return 'data:' + type + ';base64,' + btoa(text);
}
function decode64(body) {
  try {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(body);
    const raw = atob(body),
      bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    invalid('Dosya kodlaması okunamadı.');
  }
}
function checkImageType(type, bytes) {
  if (!type.startsWith('image/')) return;
  const text = (i, count) => String.fromCharCode(...bytes.subarray(i, i + count));
  let ok = false;
  if (type === 'image/jpeg') ok = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  else if (type === 'image/png') ok = text(0, 8) === '\x89PNG\r\n\x1a\n';
  else if (type === 'image/gif') ok = ['GIF87a', 'GIF89a'].includes(text(0, 6));
  else if (type === 'image/webp') ok = text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP';
  else if (bytes.length >= 16 && text(4, 4) === 'ftyp') {
    const end = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    const brands = [text(8, 4)];
    for (let i = 16; i + 4 <= Math.min(end, bytes.length, 4096); i += 4) brands.push(text(i, 4));
    const heic = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'];
    const expected =
      type === 'image/avif' ? ['avif', 'avis'] : type === 'image/heic' ? heic : [...heic, 'mif1', 'msf1'];
    ok = end >= 16 && brands.some((b) => expected.includes(b));
  }
  if (!ok) invalid('Fotoğrafın dosya türü ve içeriği uyuşmuyor.');
}
function metadataFits(doc) {
  if (new TextEncoder().encode(JSON.stringify(doc)).length > MAX_METADATA)
    invalid('Dosyalar hariç proje bilgisi 24 MiB sınırını aşıyor.');
}
function validRef(item, field) {
  const r = item.$roleveMedia;
  if (
    field !== 'data' ||
    Object.keys(item).length !== 1 ||
    !r ||
    typeof r.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(r.sha256) ||
    !Number.isSafeInteger(r.size) ||
    r.size < 1 ||
    r.size > MAX_MEDIA ||
    !allowed.has(r.type)
  )
    invalid('Sunucudan geçersiz dosya bildirimi geldi.');
  return r;
}
async function visit(value, fn, depth = 0, key = null) {
  if (depth > 48) invalid('Proje iç içe veri sınırını aşıyor.');
  const stop = await fn(value, key);
  if (stop !== undefined) return stop;
  if (Array.isArray(value)) {
    const arr = [];
    for (const item of value) arr.push(await visit(item, fn, depth + 1));
    return arr;
  }
  if (value && typeof value === 'object') {
    const obj = {};
    for (const [k, v] of Object.entries(value)) {
      if (forbidden.has(k)) invalid('Dosya alanı geçersiz.');
      obj[k] = await visit(v, fn, depth + 1, k);
    }
    return obj;
  }
  return value;
}
export function decodeAssetSource(data) {
  return decode64(data.slice(data.indexOf(',') + 1));
}

export async function packProject(project, { sourcesOnly = false } = {}) {
  const assets = new Map(),
    known = new Map();
  let total = 0;
  const document = await visit(project, async (v, field) => {
    if (v && typeof v === 'object' && '$roleveMedia' in v) invalid('Tanımsız medya başvurusu.');
    if (field !== 'data' || typeof v !== 'string' || v.slice(0, 5).toLowerCase() !== 'data:') return;
    if (known.has(v)) return known.get(v);
    const comma = v.indexOf(',');
    const header = comma >= 0 && comma < 128 && v.slice(0, comma).match(/^data:([^;,]+);base64$/i);
    if (!header || !allowed.has(header[1].toLowerCase())) invalid('Desteklenmeyen dosya türü.');
    if (v.length - comma - 1 > Math.ceil(MAX_MEDIA / 3) * 4) invalid('Bir ek dosya 40 MiB sınırını aşıyor.');
    const bytes = decode64(v.slice(comma + 1));
    if (!bytes.length || bytes.length > MAX_MEDIA) invalid('Bir ek dosya 1 bayt ile 40 MiB arasında olmalı.');
    checkImageType(header[1].toLowerCase(), bytes);
    const sha = await hash(bytes);
    if (!assets.has(sha)) {
      total += bytes.length;
      if (total > MAX_PROJECT_MEDIA) invalid('Bir projede toplam 256 MiB benzersiz ek sınırı var.');
      assets.set(sha, sourcesOnly ? v : bytes);
    }
    const ref = { $roleveMedia: { sha256: sha, size: bytes.length, type: header[1].toLowerCase() } };
    known.set(v, ref);
    return ref;
  });
  metadataFits(document);
  return { document, assets };
}
export async function unpackProject(doc, readFile) {
  const refs = new Map(),
    encodings = new Map();
  let bytesTotal = 0;
  metadataFits(doc);
  // Authenticate the manifest and reject its totals before fetching a single attachment.
  await visit(doc, (v, field) => {
    if (field === 'data' && typeof v === 'string' && v.slice(0, 5).toLowerCase() === 'data:')
      invalid('Sunucu dosyayı doğrulanabilir medya başvurusuyla göndermeli.');
    if (!v || typeof v !== 'object' || !Object.hasOwn(v, '$roleveMedia')) return;
    const r = validRef(v, field),
      present = refs.get(r.sha256);
    if (present && present.size !== r.size) invalid('Sunucu dosya boyutları çelişiyor.');
    if (!present) {
      bytesTotal += r.size;
      if (bytesTotal > MAX_PROJECT_MEDIA) invalid('Proje ekleri 256 MiB sınırını aşıyor.');
      refs.set(r.sha256, { size: r.size, types: new Set([r.type]) });
    } else present.types.add(r.type);
    return v;
  });
  for (const [sha, { size, types }] of refs) {
    const content = new Uint8Array(await readFile(sha));
    if (content.byteLength !== size || (await hash(content)) !== sha)
      invalid('İndirilen dosyanın bütünlüğü uyuşmuyor.');
    for (const type of types) {
      checkImageType(type, content);
      encodings.set(sha + ':' + type, dataURL(type, content));
    }
  }
  return visit(doc, (v) => {
    if (!v || typeof v !== 'object' || !Object.hasOwn(v, '$roleveMedia')) return;
    const r = v.$roleveMedia;
    return encodings.get(r.sha256 + ':' + r.type);
  });
}
