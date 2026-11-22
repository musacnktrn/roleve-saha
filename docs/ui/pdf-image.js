/* [codex] ureten: codex */
export async function pdfImage(file, pageNumber = 1) {
  if (!file || file.size > 35 * 1024 * 1024) throw Error('35 MB altındaki bir PDF seçin.');
  const pdfjs = await import('../assets/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../assets/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const job = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false,
    useWasm: false,
  });
  const pdf = await job.promise;
  try {
    const page = await pdf.getPage(Number(pageNumber)),
      base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 2200 / Math.max(base.width, base.height)),
      viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    return {
      data: canvas.toDataURL('image/jpeg', 0.88),
      name: file.name,
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      pageCount: pdf.numPages,
    };
  } finally {
    await job.destroy();
  }
}
