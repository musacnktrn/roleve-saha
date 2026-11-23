// [codex] ureten: codex
import {
  MAX_BYTES,
  HEADER_BYTES,
  boundedImage,
  sniffImage,
  checkHeaderDimensions,
  fit,
} from '../photo/codec/format.js';

function asDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(Error('Seçilen dosya okunamadı. Dosyalar uygulamasından tekrar seçebilirsiniz.'));
    reader.readAsDataURL(blob);
  });
}
async function heicPixels(blob, limit) {
  const bytes = await blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../photo/codec/heic-worker.js', import.meta.url));
    let timer;
    const finish = (fn, value) => {
      clearTimeout(timer);
      worker.terminate();
      fn(value);
    };
    timer = setTimeout(
      () =>
        finish(
          reject,
          Error(
            'HEIC görüntüsü bu cihazda zamanında açılamadı. Daha küçük bir kopyayla tekrar deneyin.',
          ),
        ),
      90_000,
    );
    worker.onerror = () =>
      finish(
        reject,
        Error('Yerel HEIC okuyucu açılamadı. Uygulamayı bağlantı varken bir kez açıp yeniden deneyin.'),
      );
    worker.onmessage = ({ data }) => {
      if (data.error) {
        finish(reject, Error(data.error));
        return;
      }
      try {
        boundedImage(data.width, data.height);
        boundedImage(data.sourceWidth, data.sourceHeight);
        if (
          data.width > limit ||
          data.height > limit ||
          data.pixels?.byteLength !== data.width * data.height * 4
        )
          throw Error('HEIC okuyucunun ürettiği görüntü eksik.');
        const canvas = document.createElement('canvas');
        canvas.width = data.width;
        canvas.height = data.height;
        const g = canvas.getContext('2d');
        if (!g) throw Error('Bu cihazda fotoğraf için çizim belleği ayrılamadı.');
        g.putImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0);
        finish(resolve, {
          source: canvas,
          width: data.width,
          height: data.height,
          originalWidth: data.sourceWidth,
          originalHeight: data.sourceHeight,
          decoder: 'libheif',
        });
      } catch (e) {
        finish(reject, e);
      }
    };
    worker.postMessage({ bytes, limit }, [bytes]);
  });
}
async function openFile(file, limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4096)
    throw Error('Fotoğraf hedef boyutu geçersiz.');
  if (!file.size) throw Error('Seçilen fotoğraf dosyası boş.');
  if (file.size > MAX_BYTES) throw Error('40 MiB veya daha küçük bir fotoğraf seçin.');
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const mime = sniffImage(header);
  if (!mime)
    throw Error(
      'Dosya desteklenen bir fotoğraf içermiyor. JPEG, PNG, WebP, GIF, AVIF veya HEIC/HEIF seçin.',
    );
  checkHeaderDimensions(header, mime);
  // Browser-provided MIME may be blank, a generic type, or differ after an OS-level conversion.
  const blob = file.type === mime ? file : file.slice(0, file.size, mime);
  const url = URL.createObjectURL(blob),
    img = new Image();
  img.src = url;
  try {
    let native = true;
    try {
      await img.decode();
    } catch {
      native = false;
    }
    if (native) {
      boundedImage(img.naturalWidth, img.naturalHeight);
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        originalWidth: img.naturalWidth,
        originalHeight: img.naturalHeight,
        decoder: 'native',
        mime,
        blob,
        close: () => URL.revokeObjectURL(url),
      };
    }
    if (mime !== 'image/heic' && mime !== 'image/heif')
      throw Error(
        'Fotoğrafın görüntü verisi bu tarayıcıda okunamadı. Dosyayı yeniden seçin veya JPEG/PNG kopyasını kullanın.',
      );
    URL.revokeObjectURL(url);
    const opened = await heicPixels(blob, limit);
    return {
      ...opened,
      mime,
      blob,
      close: () => {
        opened.source.width = 1;
        opened.source.height = 1;
      },
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}
function jpeg(opened, limit, name) {
  const { width, height } = fit(opened.width, opened.height, limit);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  try {
    const g = c.getContext('2d');
    if (!g) throw Error('Bu cihazda fotoğraf için çizim belleği ayrılamadı.');
    g.fillStyle = 'white';
    g.fillRect(0, 0, width, height);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(opened.source, 0, 0, width, height);
    const data = c.toDataURL('image/jpeg', 0.84);
    if (!data.startsWith('data:image/jpeg;base64,'))
      throw Error('Bu cihazda JPEG görüntüsü üretilemedi.');
    return { name, data, pixelWidth: width, pixelHeight: height };
  } finally {
    c.width = 1;
    c.height = 1;
  }
}
export async function imageData(file, limit = 1800) {
  if (!file) return null;
  const opened = await openFile(file, limit);
  try {
    return jpeg(opened, limit, file.name || 'Saha görüntüsü');
  } finally {
    opened.close();
  }
}
export async function capturePhoto(file) {
  if (!file) return null;
  const opened = await openFile(file, 2400);
  try {
    const data = await asDataURL(opened.blob),
      name = file.name || 'Saha fotoğrafı';
    const preview = { data: jpeg(opened, 360, name).data };
    const info = {
      sourceType: opened.mime,
      sourcePixelWidth: opened.originalWidth,
      sourcePixelHeight: opened.originalHeight,
    };
    if (['image/jpeg', 'image/png', 'image/webp'].includes(opened.mime))
      return { name, data, pixelWidth: opened.width, pixelHeight: opened.height, preview, ...info };
    return { ...jpeg(opened, 2400, name), preview, ...info, original: { name, data } };
  } finally {
    opened.close();
  }
}
