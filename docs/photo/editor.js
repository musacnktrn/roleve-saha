// [codex] ureten: codex
import { esc, uid, safePhoto, downloadFile } from '../ui/base.js';
import { showDialog, closeDialog } from '../ui/dialog.js';
import {
  colors,
  methods,
  types,
  validatePhotoAnnotations,
  markSVG,
  markLabel,
  annotatedPNG,
  exportDimensions,
} from './annotations.js';
import { connectPhotoSurface } from './gestures.js';
export { validatePhotoAnnotations } from './annotations.js';

const hints = {
  select: 'Bir işaret seçin. Sürükleyerek taşıyabilir, uçlarından düzenleyebilirsiniz.',
  ink: 'Parmağınız veya kaleminizle fotoğrafa çizin.',
  arrow: 'Okun başlangıcını ve ucunu seçin veya birinden diğerine sürükleyin.',
  text: 'Yazının başlayacağı noktaya dokunun.',
  dimension: 'Ölçtüğünüz iki ucu işaretleyin, ardından cihazda okuduğunuz değeri girin.',
  pan: 'Yakınlaştırılmış fotoğrafı sürükleyerek gezin.',
};
const names = { select: 'Seç', ...types, pan: 'Gezdir' };
const opts = (rows) =>
  rows.map(([key, name]) => `<option value="${esc(key)}">${esc(name)}</option>`).join('');
const ctl = (key, label) =>
  `<button type="button" class="photo-button" data-pe="${key}">${label}</button>`;

export async function openPhotoEditor(ctx, noteId) {
  const photo = ctx.p?.notes?.find((n) => n.id === noteId)?.photo;
  if (!photo || !safePhoto(photo.data)) throw Error('Notta açılabilir bir fotoğraf bulunamadı.');
  const source = validatePhotoAnnotations(photo);
  const image = new Image();
  image.src = photo.data;
  try {
    await image.decode();
  } catch {
    throw Error('Fotoğraf bu cihazda açılamadı.');
  }
  const w = image.naturalWidth,
    h = image.naturalHeight;
  if (!w || !h) throw Error('Fotoğraf boyutu okunamadı.');
  const body = `
    <div class="photo-editor">
      <div class="photo-tools" role="group" aria-label="İşaretleme araçları">${Object.entries(names)
        .map(
          ([key, label]) =>
            `<button type="button" data-tool="${key}" class="photo-button">${label}</button>`,
        )
        .join('')}</div>
      <div class="photo-stage"><svg data-photo-surface tabindex="0" role="group" aria-label="Fotoğraf ve düzenlenebilir saha işaretleri" preserveAspectRatio="xMidYMid meet">
        <image data-base-photo x="0" y="0" width="${w}" height="${h}"></image><g data-marks></g><g data-preview pointer-events="none"></g><g data-handles></g></svg>
        <div class="photo-zoom">${ctl('out', '−')}<span aria-label="Yakınlaştırma" data-zoom>100%</span>${ctl('in', '+')}${ctl('fit', 'Sığdır')}</div></div>
      <div class="photo-message" aria-live="polite" data-hint></div>
      <div class="photo-controls"><label>İşaret<select data-list aria-label="İşaret seçimi"></select></label><label>Renk<select data-color aria-label="Çizim rengi">${opts(colors)}</select></label>
        <div class="photo-history">${ctl('undo', 'Geri al')}${ctl('redo', 'Yinele')}${ctl('delete', 'Sil')}</div></div>
      <form class="photo-fields" hidden><label data-copy>Yazı<textarea name="text" maxlength="300" rows="2"></textarea></label>
        <label data-raw>Saha ölçüsü<input name="raw" type="text" inputmode="decimal" maxlength="32" placeholder="1,245"></label>
        <label data-unit>Birim<select name="unit">${opts([
          ['m', 'm'],
          ['cm', 'cm'],
          ['mm', 'mm'],
        ])}</select></label>
        <label data-method>Ölçü kaynağı<select name="method">${opts(Object.entries(methods))}</select></label>
        <button type="submit" class="photo-button active">Uygula</button>${ctl('abandon', 'Vazgeç')}</form>
      <p class="photo-error" role="alert"></p>
      <div data-discard class="photo-discard" hidden>Kaydedilmemiş işaretler var. ${ctl('stay', 'Düzenlemeye dön')}${ctl('discard', 'Değişiklikleri at')}</div>
      <div class="photo-footer">${ctl('png', 'İşaretli PNG indir')}<button type="button" class="primary" data-pe="save">İşaretleri kaydet</button></div>
    </div>`;
  return showDialog(
    'Fotoğraf üzerinde işaretle',
    body,
    (dialog) => {
      dialog.classList.add('photo-dialog');
      const find = (selector) => dialog.querySelector(selector);
      const svg = find('[data-photo-surface]'),
        marksLayer = find('[data-marks]'),
        ghost = find('[data-preview]'),
        handles = find('[data-handles]');
      const list = find('[data-list]'),
        color = find('[data-color]'),
        form = find('.photo-fields'),
        err = find('.photo-error');
      find('[data-base-photo]').setAttribute('href', photo.data);
      const button = (id) => find(`[data-pe="${id}"]`),
        drawTools = [...dialog.querySelectorAll('[data-tool]')];
      button('in').setAttribute('aria-label', 'Fotoğrafı yakınlaştır');
      button('out').setAttribute('aria-label', 'Fotoğrafı uzaklaştır');
      const output = exportDimensions(w, h);
      if (output.w !== w || output.h !== h)
        button('png').textContent = `İşaretli PNG · ${output.w} × ${output.h}`;
      let marks = structuredClone(source),
        history = [],
        future = [],
        tool = 'select',
        selectedId = null,
        first = null,
        pending = null,
        typing = false,
        saving = false;
      const getMark = () => marks.find((a) => a.id === selectedId);
      const formMark = () => pending || getMark();
      const isDirty = () =>
        JSON.stringify(marks) !== JSON.stringify(source) || !!pending || !!first || typing;
      const error = (message) => {
        err.textContent = message || '';
      };
      const guarded =
        (fn) =>
        async (...args) => {
          try {
            error('');
            await fn(...args);
          } catch (e) {
            error(e.message || 'İşlem tamamlanamadı.');
          }
        };
      const make = (type, points, fields = {}) => ({
        id: uid(),
        type,
        color: color.value,
        points,
        ...fields,
      });
      const clearDraft = () => {
        first = null;
        pending = null;
        typing = false;
      };
      const defaultHint = () =>
        pending
          ? 'Alanları doldurup Uygula’ya dokunun.'
          : first
            ? 'İkinci noktaya dokunun.'
            : hints[tool];
      function setTool(next) {
        clearDraft();
        tool = next;
        selectedId = null;
        error('');
        surface.cancel();
        refresh();
      }
      function selected(id) {
        clearDraft();
        selectedId = id;
        if (getMark()) color.value = getMark().color;
        refresh();
      }
      function tick(pt, r, attrs = '') {
        return `<circle cx="${pt.x * w}" cy="${pt.y * h}" r="${r}" fill="#193d34" stroke="#fff" stroke-width="${r * 0.32}" ${attrs}/>`;
      }
      function showHandles() {
        const v = getMark(),
          m = svg.getScreenCTM(),
          r = Math.min(w * 0.06, Math.max(1, 7 / (m?.a || 1)));
        if (first) {
          handles.innerHTML = tick(first, r);
          return;
        }
        if (pending) {
          handles.innerHTML = pending.points.map((p) => tick(p, r)).join('');
          return;
        }
        if (tool === 'select' && v) {
          const selectable = v.type === 'ink' ? [] : v.points;
          handles.innerHTML = selectable.map((p, i) => tick(p, r, `data-handle="${i}"`)).join('');
        } else handles.replaceChildren();
      }
      function refresh() {
        marksLayer.innerHTML = marks.map((m) => markSVG(m, w, h)).join('');
        for (const node of drawTools)
          node.setAttribute('aria-pressed', String(node.dataset.tool === tool));
        list.innerHTML =
          '<option value="">İşaret seçin</option>' +
          opts(marks.map((a, i) => [a.id, `${i + 1}. ${markLabel(a).slice(0, 80)}`]));
        list.value = selectedId || '';
        const selected = getMark(),
          entry = formMark(),
          hasFields = entry && ['dimension', 'text'].includes(entry.type);
        form.hidden = !hasFields;
        if (hasFields) {
          for (const [key, label] of [
            ['copy', 'text'],
            ['raw', 'dimension'],
            ['unit', 'dimension'],
            ['method', 'dimension'],
          ])
            find(`[data-${key}]`).hidden = entry.type !== label;
          form.elements.text.value = entry.text || '';
          form.elements.raw.value = entry.raw || '';
          form.elements.unit.value = entry.unit || 'm';
          form.elements.method.value = entry.method || 'manual';
        }
        color.value = (entry || selected)?.color || color.value || colors[0][0];
        button('delete').disabled = !selected;
        button('undo').disabled = !history.length && !first && !pending;
        button('redo').disabled = !future.length;
        find('[data-hint]').textContent = defaultHint();
        showHandles();
      }
      function change(next, chosen = null) {
        validatePhotoAnnotations({ annotations: next });
        history.push(marks);
        if (history.length > 30) history.shift();
        future = [];
        marks = next;
        selectedId = chosen;
        clearDraft();
        refresh();
      }
      function put(v) {
        const idx = marks.findIndex((mark) => mark.id === v.id);
        if (idx < 0) change([...marks, v], v.id);
        else
          change(
            marks.map((mark) => (mark.id === v.id ? v : mark)),
            v.id,
          );
      }
      function begin(type, points) {
        const data =
          type === 'dimension' ? { raw: '', unit: ctx.p.unit || 'm', method: 'manual' } : { text: '' };
        first = null;
        selectedId = null;
        pending = make(type, points, data);
        refresh();
        const input = form.elements[type === 'dimension' ? 'raw' : 'text'];
        input.focus({ preventScroll: true });
      }
      const onPoint = guarded((p, end) => {
        if (pending || typing) throw Error('Önce açık alanı uygulayın veya vazgeçin.');
        if (tool === 'text') {
          begin('text', [p]);
          return;
        }
        if (tool !== 'arrow' && tool !== 'dimension') return;
        if (!first && !end) {
          first = p;
          selectedId = null;
          refresh();
          return;
        }
        const a = end ? p : first,
          b = end || p;
        if (Math.hypot((a.x - b.x) * w, (a.y - b.y) * h) < 0.7)
          throw Error('İkinci uç için farklı bir nokta seçin.');
        first = null;
        if (tool === 'arrow') {
          put(make('arrow', [a, b]));
        } else begin('dimension', [a, b]);
      });
      function preview(mark) {
        ghost.replaceChildren();
        for (const node of marksLayer.children) node.style.visibility = '';
        if (!mark) return;
        if (mark.id)
          for (const node of marksLayer.children)
            if (node.dataset.mark === mark.id) node.style.visibility = 'hidden';
        if (mark.type === 'segment')
          ghost.innerHTML = `<line x1="${mark.points[0].x * w}" y1="${mark.points[0].y * h}" x2="${mark.points[1].x * w}" y2="${mark.points[1].y * h}" stroke="${color.value}" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
        else ghost.innerHTML = markSVG({ id: 'preview', color: color.value, ...mark }, w, h);
      }
      const surface = connectPhotoSurface(svg, {
        w,
        h,
        tool: () => tool,
        selected: getMark,
        blockDrawing: () => !!pending || typing,
        onSelect: selected,
        onPoint,
        onStroke: guarded((points) => put(make('ink', points))),
        onMove: guarded(put),
        onPreview: preview,
        onViewport: (value) => {
          find('[data-zoom]').textContent = `${value}%`;
          showHandles();
        },
      });
      function applyFields() {
        const active = formMark();
        if (!active || form.hidden) return;
        const v = { ...active, color: color.value };
        if (v.type === 'text') v.text = form.elements.text.value.trim();
        else
          Object.assign(v, {
            raw: form.elements.raw.value.trim(),
            unit: form.elements.unit.value,
            method: form.elements.method.value,
          });
        validatePhotoAnnotations({ annotations: [v] });
        if (pending || JSON.stringify(v) !== JSON.stringify(active)) put(v);
        typing = false;
      }
      form.oninput = () => {
        typing = true;
        error('');
      };
      form.onsubmit = guarded((e) => {
        e.preventDefault();
        applyFields();
      });
      for (const each of drawTools)
        each.onclick = () => {
          if (pending || typing) {
            error('Önce açık alanı uygulayın veya vazgeçin.');
            return;
          }
          setTool(each.dataset.tool);
        };
      list.onchange = () => {
        if (pending || typing) {
          list.value = selectedId || '';
          error('Önce açık alanı uygulayın veya vazgeçin.');
          return;
        }
        tool = 'select';
        selected(list.value || null);
      };
      color.onchange = guarded(() => {
        if (pending) {
          pending = { ...pending, color: color.value };
          return;
        }
        const selected = getMark();
        if (selected) {
          if (typing) {
            applyFields();
          } else put({ ...selected, color: color.value });
        }
      });
      const undo = () => {
        if (first || pending) {
          clearDraft();
          refresh();
          return;
        }
        if (history.length) {
          future.push(marks);
          marks = history.pop();
          selectedId = null;
          clearDraft();
          refresh();
        }
      };
      const redo = () => {
        if (future.length) {
          history.push(marks);
          marks = future.pop();
          selectedId = null;
          clearDraft();
          refresh();
        }
      };
      button('undo').onclick = undo;
      button('redo').onclick = redo;
      button('delete').onclick = guarded(() => change(marks.filter((m) => m.id !== selectedId)));
      button('abandon').onclick = () => {
        clearDraft();
        selectedId = null;
        refresh();
      };
      button('in').onclick = () => surface.zoom(1.5);
      button('out').onclick = () => surface.zoom(1 / 1.5);
      button('fit').onclick = surface.reset;
      function requestClose() {
        if (saving) return;
        if (isDirty()) find('[data-discard]').hidden = false;
        else closeDialog();
      }
      find('#dlg-x').onclick = requestClose;
      dialog.oncancel = (e) => {
        e.preventDefault();
        requestClose();
      };
      button('stay').onclick = () => {
        find('[data-discard]').hidden = true;
      };
      button('discard').onclick = () => {
        if (!saving) closeDialog();
      };
      button('png').onclick = guarded(async () => {
        if (pending || typing) applyFields();
        if (first) throw Error('İkinci ucu seçin veya Geri al’a dokunun.');
        const blob = await annotatedPNG(photo, marks);
        const name = String(photo.name || 'Saha fotoğrafı')
          .replace(/\.[^.]+$/, '')
          .replace(/[\\/:*?"<>|]/g, '-');
        downloadFile(blob, `${name} — işaretli.png`);
      });
      button('save').onclick = guarded(async () => {
        if (saving) return;
        if (pending || typing) applyFields();
        if (first) throw Error('İkinci ucu seçin veya Geri al’a dokunun.');
        if (!isDirty()) {
          closeDialog();
          return;
        }
        validatePhotoAnnotations({ annotations: marks });
        saving = true;
        const controls = [...dialog.querySelectorAll('button,input,select,textarea')];
        const disabled = controls.map((c) => c.disabled);
        controls.forEach((c) => (c.disabled = true));
        try {
          await ctx.change('Fotoğraf işaretleri kaydedildi', (project) => {
            const current = project.notes.find((n) => n.id === noteId)?.photo;
            if (
              !current ||
              current.data !== photo.data ||
              JSON.stringify(current.annotations || []) !== JSON.stringify(source)
            )
              throw Error(
                'Fotoğraf başka bir kayıtta değişti. İşaretli PNG’yi indirip güncel kaydı yeniden açabilirsiniz.',
              );
            current.annotations = structuredClone(marks);
          });
          closeDialog();
        } finally {
          saving = false;
          controls.forEach((c, i) => (c.disabled = disabled[i]));
        }
      });
      const key = (e) => {
        if (e.target.closest('input,select,textarea') || saving) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
        }
        if (e.key === 'Delete' && selectedId) {
          e.preventDefault();
          button('delete').click();
        }
      };
      dialog.addEventListener('keydown', key);
      dialog.addEventListener(
        'close',
        () => {
          dialog.removeEventListener('keydown', key);
          surface.cancel();
        },
        { once: true },
      );
      refresh();
    },
    true,
  );
}
