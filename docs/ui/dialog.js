/* [codex] ureten: codex */
import { esc, icon, safePhoto } from './base.js';
import { validateSections } from './sections.js';
import { validatePhotoAnnotations } from '../photo/annotations.js';
export const dlg = () => document.querySelector('#modal');
let returnTo = null;
export function closeDialog() {
  const d = dlg();
  if (d.open) d.close();
  d.replaceChildren();
  const el = returnTo;
  returnTo = null;
  if (el?.isConnected) el.focus({ preventScroll: true });
}
export function showDialog(title, body, after, wide = false) {
  const d = dlg();
  if (!d.open) returnTo = document.activeElement;
  d.className = wide ? 'wide' : '';
  d.setAttribute('aria-labelledby', 'dlg-title');
  d.innerHTML = `<div class="dialog-head"><h2 id="dlg-title">${esc(title)}</h2><button type="button" id="dlg-x" class="ib" aria-label="Kapat">${icon('close')}</button></div><div class="dialog-body">${body}</div>`;
  if (!d.open) d.showModal();
  d.querySelector('#dlg-x').onclick = closeDialog;
  d.oncancel = (e) => {
    e.preventDefault();
    closeDialog();
  };
  after?.(d);
  return d;
}
export function field(f) {
  const id = 'fd-' + f.key,
    attrs = `id="${esc(id)}" name="${esc(f.key)}" ${f.required ? 'required' : ''} ${f.disabled ? 'disabled' : ''} ${f.maxlength ? `maxlength="${+f.maxlength}"` : ''}`,
    v = f.value ?? '';
  if (f.type === 'check')
    return `<label class="checkfield"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}>${esc(f.label)}</label>`;
  let input = '';
  if (f.choices)
    input = `<select ${attrs}>${f.choices
      .map((choice) => {
        const [k, title] = Array.isArray(choice) ? choice : [choice, choice];
        return `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(title)}</option>`;
      })
      .join('')}</select>`;
  else if (f.type === 'textarea') input = `<textarea ${attrs} rows="3" maxlength="8000">${esc(v)}</textarea>`;
  else if (f.type === 'file')
    input = `<input type="file" ${attrs} accept="${esc(f.accept || 'image/*')}" ${f.capture ? 'capture="environment"' : ''}>`;
  else
    input = `<input type="${f.type === 'password' ? 'password' : f.type === 'date' ? 'date' : 'text'}" ${attrs} ${f.number ? 'inputmode="decimal"' : ''} ${f.type === 'password' ? 'autocomplete="current-password"' : ''} value="${esc(v)}" placeholder="${esc(f.placeholder || '')}">`;
  return `<label class="field ${f.full ? 'full' : ''}" for="${esc(id)}"><span>${esc(f.label)}</span>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
}
export function form(title, fields, submit, onSubmit, { intro = '', extra = '', after, wide = false } = {}) {
  return showDialog(
    title,
    `<form id="edit-form">${intro ? `<p class="intro">${esc(intro)}</p>` : ''}<div class="fields">${fields.map(field).join('')}</div>${extra}<p class="err" role="alert"></p><footer><button type="button" class="secondary cancel">Vazgeç</button><button type="submit" class="primary">${esc(submit)}</button></footer></form>`,
    (d) => {
      const f = d.querySelector('form');
      f.querySelector('.cancel').onclick = closeDialog;
      after?.(f);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const submitter = f.querySelector('[type=submit]');
        if (submitter.disabled) return;
        submitter.disabled = true;
        const error = f.querySelector('.err');
        error.textContent = '';
        try {
          const data = Object.fromEntries(new FormData(f));
          const next = await onSubmit(data, f);
          if (next !== false && f.isConnected) closeDialog();
        } catch (ex) {
          error.textContent = ex.message || 'İşlem tamamlanamadı.';
        } finally {
          submitter.disabled = false;
        }
      };
    },
    wide,
  );
}
export function notify(message) {
  let e = document.querySelector('#toast');
  e.textContent = message;
  e.classList.add('on');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => e.classList.remove('on'), 4600);
}
export async function imageData(file, limit = 1800) {
  if (!file?.size) return null;
  if (file.size > 40 * 1024 * 1024) throw Error('40 MiB altında bir görsel seçin.');
  if (!/^image\/(png|jpeg|webp|gif|avif|heic|heif)$/i.test(file.type))
    throw Error('Fotoğrafı JPEG, PNG veya desteklenen bir kamera biçiminde seçin.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw Error('Bu fotoğraf açılamadı. JPEG veya PNG ile tekrar deneyin.');
    }
    const scale = Math.min(1, limit / Math.max(img.naturalWidth, img.naturalHeight)),
      c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = c.getContext('2d');
    g.fillStyle = 'white';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return {
      name: file.name,
      data: c.toDataURL('image/jpeg', 0.82),
      pixelWidth: c.width,
      pixelHeight: c.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function capturePhoto(file) {
  if (!file?.size) return null;
  const formats = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/avif',
  ]);
  if (!formats.has(file.type) || file.size > 40 * 1024 * 1024)
    throw Error('En fazla 40 MiB boyutunda JPEG, PNG, WebP veya desteklenen kamera görüntüsü seçin.');
  const asData = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('Seçilen fotoğraf okunamadı.'));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = asData;
  try {
    await image.decode();
  } catch {
    throw Error('Bu tarayıcı fotoğrafı görüntüleyemiyor. Kamera ayarından JPEG veya PNG seçin.');
  }
  const preview = await imageData(file, 360);
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return {
      name: file.name,
      data: asData,
      pixelWidth: image.naturalWidth,
      pixelHeight: image.naturalHeight,
      preview: { data: preview.data },
      sourceType: file.type,
    };
  const working = await imageData(file, 2400);
  return {
    ...working,
    preview: { data: preview.data },
    sourceType: file.type,
    original: { name: file.name, data: asData },
  };
}
export function validateExtras(p) {
  validateSections(p);
  const xy = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y);
  if (
    p.customer != null &&
    (!p.customer.id ||
      typeof p.customer.id !== 'string' ||
      typeof p.customer.name !== 'string' ||
      !p.customer.name.trim() ||
      p.customer.name.length > 240)
  )
    throw Error('Proje müşterisi geçersiz.');
  for (const n of p.notes || []) {
    if (n.target && !xy(n.target)) throw Error('Fotoğraftaki bakış noktası geçersiz.');
    if (
      n.gps &&
      (!Number.isFinite(n.gps.latitude) ||
        Math.abs(n.gps.latitude) > 90 ||
        !Number.isFinite(n.gps.longitude) ||
        Math.abs(n.gps.longitude) > 180)
    )
      throw Error('Fotoğrafın coğrafi konumu geçersiz.');
  }
  for (const s of p.strokes || [])
    if (!Array.isArray(s.points) || s.points.some((v) => !xy(v))) throw Error('Çizim noktası geçersiz.');
  for (const n of p.notes || [])
    if (
      (n.anchor &&
        ((!xy(n.anchor) && !['nodeId', 'wallId', 'elementId'].some((k) => typeof n.anchor[k] === 'string')) ||
          (n.anchor.z != null && !Number.isFinite(n.anchor.z)))) ||
      (n.direction != null && (!Number.isFinite(n.direction) || n.direction < 0 || n.direction >= 360)) ||
      (n.photo && !safePhoto(n.photo.data))
    )
      throw Error('Desteklenmeyen fotoğraf.');
  for (const n of p.notes || [])
    if (n.photo) {
      validatePhotoAnnotations(n.photo);
      if (
        (n.photo.preview && !safePhoto(n.photo.preview.data)) ||
        (n.photo.original &&
          !/^data:image\/(?:gif|heic|heif|avif|jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(
            n.photo.original.data || '',
          ))
      )
        throw Error('Fotoğraf eki tanınamadı.');
    }
  for (const u of p.underlays || [])
    if (!safePhoto(u.data) || !xy(u) || ![u.width, u.height].every((v) => Number.isFinite(v) && v > 0))
      throw Error('Altlık resmi veya boyutu geçersiz.');
  if (p.furniture && !Array.isArray(p.furniture)) throw Error('Tefriş listesi geçersiz.');
  for (const f of p.furniture || [])
    if (
      !xy(f) ||
      (f.rotation != null && !Number.isFinite(f.rotation)) ||
      ![f.width, f.depth].every((v) => Number.isFinite(v) && v > 0)
    )
      throw Error('Tefriş ölçüsü geçersiz.');
  return p;
}
