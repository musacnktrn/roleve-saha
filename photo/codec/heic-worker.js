// [codex] ureten: codex
// A fresh classic worker owns the decoder heap for one photo. The UI terminates it after the reply.
const vendor = new URL('../../assets/heic/', self.location.href);
function validateSize(w, h) {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1)
    throw Error('HEIC görüntü boyutu okunamadı.');
  if (w > 32768 || h > 32768 || w * h > 64_000_000)
    throw Error('HEIC fotoğrafı 64 megapiksel veya 32.768 piksel kenar sınırını aşıyor.');
}
function reduceRGBA(input, w, h, limit) {
  const scale = Math.min(1, limit / Math.max(w, h)),
    width = Math.max(1, Math.round(w * scale)),
    height = Math.max(1, Math.round(h * scale));
  if (width === w && height === h) return { width, height, pixels: input };
  // Bilinear reduction in the worker avoids putting a second full-size camera bitmap on a canvas.
  const pixels = new Uint8ClampedArray(width * height * 4),
    sx = w / width,
    sy = h / height;
  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) * sy - 0.5,
      top = Math.floor(fy),
      bottom = Math.min(h - 1, top + 1),
      dy = fy - top;
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) * sx - 0.5,
        left = Math.floor(fx),
        right = Math.min(w - 1, left + 1),
        dx = fx - left;
      const tl = (top * w + left) * 4,
        tr = (top * w + right) * 4,
        bl = (bottom * w + left) * 4,
        br = (bottom * w + right) * 4,
        to = (y * width + x) * 4;
      for (let c = 0; c < 4; c++)
        pixels[to + c] =
          (input[tl + c] * (1 - dx) + input[tr + c] * dx) * (1 - dy) +
          (input[bl + c] * (1 - dx) + input[br + c] * dx) * dy;
    }
  }
  return { width, height, pixels };
}
function openPrimary(lib, bytes) {
  const context = lib.heif_context_alloc();
  if (!context) throw Error('Fotoğraf okuyucusu için bellek ayrılamadı.');
  try {
    // This pinned Emscripten build exposes the public heif_security_limits v4 struct
    // through a WASM32 pointer. Offsets follow the upstream heif_security.h ABI.
    // A 4032×3024 Apple ImageIO grid contains 1538 image items. Bound that case
    // per photo while also shrinking the default pixel, tile and memory budgets.
    const ptr = lib._heif_context_get_security_limits(context.$$.ptr);
    const mem = new DataView(lib.HEAPU8.buffer);
    if (!ptr || ptr + 72 > mem.byteLength || mem.getUint8(ptr) !== 4)
      throw Error('Yerel HEIC bileşeninin sürümü uyumsuz.');
    mem.setBigUint64(ptr + 8, 64_000_000n, true); // max_image_size_pixels
    mem.setBigUint64(ptr + 16, 8_192n, true); // max_number_of_tiles
    mem.setUint32(ptr + 28, 8_192, true); // max_items
    mem.setBigUint64(ptr + 40, 256n * 1024n * 1024n, true); // max_memory_block_size
    mem.setBigUint64(ptr + 64, 512n * 1024n * 1024n, true); // max_total_memory
    const result = lib.heif_context_read_from_memory(context, new Uint8Array(bytes));
    if (result.code !== lib.heif_error_code.heif_error_Ok)
      throw Error('HEIC kapsayıcısı eksik, desteklenmiyor veya cihazın dosya sınırını aşıyor.');
    const handle = lib.heif_js_context_get_primary_image_handle(context);
    if (!handle || handle.code) throw Error('HEIC dosyasında okunabilir bir ana görüntü bulunamadı.');
    const image = new lib.HeifImage(handle);
    return {
      image,
      close() {
        image.free();
        lib.heif_context_free(context);
      },
    };
  } catch (error) {
    lib.heif_context_free(context);
    throw error;
  }
}
self.onmessage = async ({ data }) => {
  let frame;
  try {
    const { bytes, limit } = data;
    if (
      !(bytes instanceof ArrayBuffer) ||
      !bytes.byteLength ||
      bytes.byteLength > 40 * 1024 * 1024 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 4096
    )
      throw Error('HEIC dosya boyutu veya hedef boyutu geçersiz.');
    importScripts(new URL('libheif.js', vendor).href);
    const response = await fetch(new URL('libheif.wasm', vendor));
    if (!response.ok) throw Error('Yerel HEIC bileşeni henüz bu cihaza indirilemedi.');
    const lib = await self.libheif({ wasmBinary: new Uint8Array(await response.arrayBuffer()) });
    frame = openPrimary(lib, bytes);
    const image = frame.image;
    const w = image.get_width(),
      h = image.get_height();
    validateSize(w, h);
    const result = await new Promise((resolve, reject) => {
      image.display({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }, (value) =>
        value ? resolve(value) : reject(Error('HEIC görüntü verisi çözülemedi.')),
      );
    });
    const { width, height, pixels } = reduceRGBA(result.data, w, h, limit);
    self.postMessage({ width, height, sourceWidth: w, sourceHeight: h, pixels: pixels.buffer }, [
      pixels.buffer,
    ]);
  } catch (error) {
    self.postMessage({ error: error?.message || 'Bu HEIC kodlaması çözülemedi.' });
  } finally {
    frame?.close();
  }
};
