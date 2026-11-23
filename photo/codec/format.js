// [codex] ureten: codex
export const MAX_BYTES = 40 * 1024 * 1024;
export const MAX_PIXELS = 64_000_000;
export const MAX_SIDE = 32_768;
export const HEADER_BYTES = 128 * 1024;
const hevcBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const genericBrands = new Set(['heif', 'mif1', 'miaf', 'msf1']);
const av1Brands = new Set(['avif', 'avis']);
export function boundedImage(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw Error('Fotoğrafın boyutları okunamadı.');
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS)
    throw Error(
      'Bu görüntü 64 megapiksel veya 32.768 piksel kenar sınırını aşıyor. Daha küçük bir kopya seçin.',
    );
}
const code = (b, i, n = 4) => String.fromCharCode(...b.subarray(i, i + n));
const uint16 = (b, i) => b[i] * 256 + b[i + 1];
const uint32 = (b, i) => b[i] * 16777216 + b[i + 1] * 65536 + b[i + 2] * 256 + b[i + 3];
const uint24le = (b, i) => b[i] + b[i + 1] * 256 + b[i + 2] * 65536;
function boxAt(b, i, end) {
  if (i + 8 > end) return null;
  let size = uint32(b, i),
    start = i + 8;
  if (size === 1) {
    if (i + 16 > end || uint32(b, i + 8) > 0) return null;
    size = uint32(b, i + 12);
    start += 8;
  }
  if (size === 0) size = end - i;
  if (size < start - i) return null;
  return { type: code(b, i + 4), start, end: i + size };
}
function bmffType(b) {
  for (let i = 0; i + 8 <= b.length; ) {
    const box = boxAt(b, i, b.length);
    if (!box || box.end > b.length) return null;
    if (box.type === 'ftyp') {
      if (box.end - box.start < 8 || (box.end - box.start) % 4) return null;
      const brands = [code(b, box.start)];
      for (let j = box.start + 8; j + 4 <= box.end; j += 4) brands.push(code(b, j));
      if (brands.some((v) => av1Brands.has(v))) return 'image/avif';
      if (brands.some((v) => hevcBrands.has(v))) return 'image/heic';
      return brands.some((v) => genericBrands.has(v)) ? 'image/heif' : null;
    }
    if (!['free', 'skip', 'wide'].includes(box.type)) return null;
    i = box.end;
  }
  return null;
}
export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) return 'image/png';
  if (['GIF87a', 'GIF89a'].includes(code(b, 0, 6))) return 'image/gif';
  if (code(b, 0) === 'RIFF' && code(b, 8) === 'WEBP') return 'image/webp';
  return bmffType(b);
}
function bmffDimensions(b, offset, end, level = 0) {
  for (let i = offset; i + 8 <= end; ) {
    const box = boxAt(b, i, end);
    if (!box) return;
    const stop = Math.min(box.end, end);
    if (level === 3 && box.type === 'ispe' && stop - box.start >= 12)
      boundedImage(uint32(b, box.start + 4), uint32(b, box.start + 8));
    // Only inspect the fixed metadata path; media bytes, EXIF, thumbnails and JPEG segments are never scanned as boxes.
    if (box.type === ['meta', 'iprp', 'ipco'][level]) {
      const child = box.start + (box.type === 'meta' ? 4 : 0);
      if (child < stop) bmffDimensions(b, child, stop, level + 1);
    }
    i = box.end;
  }
}
export function checkHeaderDimensions(b, mime) {
  if (mime === 'image/png' && b.length >= 24 && code(b, 12) === 'IHDR')
    boundedImage(uint32(b, 16), uint32(b, 20));
  if (mime === 'image/gif' && b.length >= 10) boundedImage(b[6] + 256 * b[7], b[8] + 256 * b[9]);
  if (mime === 'image/webp' && b.length >= 30) {
    const mode = code(b, 12);
    if (mode === 'VP8X') boundedImage(1 + uint24le(b, 24), 1 + uint24le(b, 27));
    if (mode === 'VP8L' && b[20] === 47)
      boundedImage(
        1 + b[21] + ((b[22] & 63) << 8),
        1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 15) << 10),
      );
    if (mode === 'VP8 ' && b[23] === 157 && b[24] === 1 && b[25] === 42)
      boundedImage((b[26] + 256 * b[27]) & 16383, (b[28] + 256 * b[29]) & 16383);
  }
  if (mime === 'image/jpeg') {
    for (let i = 2; i + 4 <= b.length; ) {
      if (b[i] !== 255) return;
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 0xd9 || marker === 0xda) return;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const len = uint16(b, i);
      if (len < 2 || i + len > b.length) return;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && len >= 8) {
        boundedImage(uint16(b, i + 5), uint16(b, i + 3));
        return;
      }
      i += len;
    }
  }
  if (['image/heic', 'image/heif', 'image/avif'].includes(mime)) bmffDimensions(b, 0, b.length);
}
export function fit(width, height, limit) {
  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
