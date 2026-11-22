// [codex] ureten: codex
import { esc, fmt, readMm, uid } from '../ui/base.js';
import { showDialog, closeDialog } from '../ui/dialog.js';
import { inkBrushes, inkColors, inkShapes } from '../ui/sketch.js';
import { connectPhotoSurface } from '../photo/gestures.js';
import { openingDetailMarkup, openingEraserHits, validateOpeningDetail } from './drawing.js';

const shapes = [...inkShapes, ['arc', 'Kemer yayı'], ['oval', 'Oval']];
const toolNames = new Map([...shapes, ['erase', 'Silgi'], ['pan', 'Kaydır']]);
const opts = (values) => values.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
const button = (id, label, css = '') =>
  `<button type="button" class="${css}" data-od-action="${id}">${label}</button>`;
const positive = (v) => Number.isFinite(v) && v > 0;
const fromSurface = (p) => ({x: p.x, y: 1-p.y});

export function openOpeningEditor(ctx, elementId) {
  const element = ctx.p?.elements?.find((e) => e.id === elementId);
  if (!element || !['door', 'window'].includes(element.type)) throw Error('Çizim için bir kapı veya pencere seçin.');
  validateOpeningDetail(element);
  const name = element.name || (element.type === 'door' ? 'Kapı' : 'Pencere');
  const w = element.width, h = element.height, unit = ctx.p.unit || 'm';
  const title = `${name} · Detay çizimi`;
  if (!positive(w) || !positive(h)) {
    return showDialog(title,
      `<p>Detay çizimi için açıklığın sahada ölçülen enini ve yüksekliğini girin.</p>
       <footer><button type="button" class="primary" data-act="edit-element" data-id="${esc(elementId)}">Açıklık ölçülerini düzenle</button></footer>`);
  }
  const source = structuredClone(element.detailStrokes || []);
  const frame = { left:0, right:w, bottom:h, top:0 };
  const dimension = (n) => `${fmt(n, unit)} ${esc(unit)}`;
  const body = `<div class="od-editor">
    <p class="od-size"><strong>${esc(name)}</strong><span>En ${dimension(w)}</span><span>Yükseklik ${dimension(h)}</span></p>
    <div class="od-tools" role="group" aria-label="Açıklık çizim araçları">${[...toolNames].map(([key,label]) =>
      `<button type="button" data-od-tool="${key}" aria-pressed="false">${label}</button>`).join('')}</div>
    <div class="od-stage"><svg data-od-surface role="group" tabindex="0" aria-label="${esc(name)} detayı; solda duvar A yönü, aşağıda açıklığın alt kenarı" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="${w}" height="${h}" fill="#fafbf6"/>
      <g data-od-marks></g><g data-od-preview pointer-events="none"></g>
      <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#49665a" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none"/>
    </svg></div>
    <div class="od-navigation">
      <span class="od-direction">A yönü → B yönü · Alt kenardan yukarı</span>
      <div role="group" aria-label="Görünümü yakınlaştır">${button('out','−')}<output data-od-zoom aria-label="Büyütme">100%</output>${button('in','+') }${button('fit','Sığdır')}</div>
    </div>
    <div class="od-controls">
      <label>Kalem<select data-od-brush>${opts(inkBrushes)}</select></label>
      <label>Renk<select data-od-color>${opts(inkColors)}</select></label>
      <label>Çizgi kalınlığı<select data-od-width>${opts([1,2,4,8,15,30].map((n) => [n,n+' mm']))}</select></label>
      <div class="od-history">${button('undo','Geri al')}${button('redo','Yinele')}</div>
    </div>
    <details class="od-numeric"><summary>Nokta gir ve çizgileri yönet</summary>
      <form data-od-coordinates>
        <label>Noktalar (mm)<textarea rows="3" name="coordinates" aria-describedby="od-coordinate-help" placeholder="0 / 0&#10;150 / 300"></textarea></label>
        <small id="od-coordinate-help">Her satıra A yönündeki kenardan uzaklığı / alt kenardan yüksekliği yazın. Şekiller için karşılıklı iki köşe, düz çizgi için iki uç girin.</small>
        <button type="submit">Noktalarla çiz</button>
      </form>
      <div class="od-line-list"><label>Çizgi<select data-od-list></select></label>${button('delete','Seçili çizgiyi sil')}</div>
    </details>
    <p class="od-status" data-od-status aria-live="polite"></p><p data-od-error class="err" role="alert"></p>
    <div class="od-discard" data-od-discard hidden>Kaydedilmemiş çizgiler var. ${button('stay','Düzenlemeye dön')}${button('discard','Değişiklikleri at')}</div>
    <footer>${button('cancel','Vazgeç','secondary')}${button('save','Detayı kaydet','primary')}</footer>
  </div>`;
  return showDialog(title, body, (dialog) => {
    dialog.classList.add('od-dialog');
    const find = (q) => dialog.querySelector(q);
    const action = (id) => find(`[data-od-action="${id}"]`);
    const svg = find('[data-od-surface]'), list = find('[data-od-list]'), preview = find('[data-od-preview]');
    const status = find('[data-od-status]'), error = find('[data-od-error]'), discard = find('[data-od-discard]');
    const width = find('[data-od-width]'), brush = find('[data-od-brush]'), color = find('[data-od-color]');
    width.value = '4';
    let strokes = source, tool = 'free', surface = null, eraserTrail = [], saving = false;
    const past = [], future = [];
    const asElement = (lines) => ({type:element.type, width:w, height:h, detailStrokes:lines});
    const dirty = () => strokes !== source && JSON.stringify(strokes) !== JSON.stringify(source);
    const render = () => {
      find('[data-od-marks]').innerHTML = openingDetailMarkup(asElement(strokes), frame);
      const selected = list.value;
      list.innerHTML = strokes.length ? opts(strokes.map((s,i) => [s.id, `${i+1} · ${toolNames.get(s.shape)}`])) : opts([['', 'Çizgi yok']]);
      if (strokes.some((s) => s.id === selected)) list.value = selected;
      action('delete').disabled = !strokes.length;
      action('undo').disabled = !past.length;
      action('redo').disabled = !future.length;
      status.textContent = `${strokes.length} detay çizgisi`;
      error.textContent = '';
    };
    const replace = (next) => {
      validateOpeningDetail(asElement(next));
      past.push(strokes);
      if (past.length > 80) past.shift();
      future.length = 0;
      strokes = next;
      render();
    };
    function history(back) {
      if (saving) return;
      surface.cancel();
      const origin = back ? past : future, destination = back ? future : past;
      if (!origin.length) return;
      destination.push(strokes);
      strokes = origin.pop();
      render();
    }
    let penId = null, pressureTotal = 0, pressureCount = 0;
    function samplePressure(e) {
      if (e.pointerId === penId && e.pressure > 0 && e.pressure <= 1) {
        pressureTotal += e.pressure; pressureCount++;
      }
    }
    function clearPressure() { penId = null; pressureTotal = 0; pressureCount = 0; }
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'pen') return;
      clearPressure(); penId = e.pointerId; samplePressure(e);
    }, true);
    svg.addEventListener('pointermove', samplePressure, true);
    const drawn = (points, id) => ({
      id, color:color.value, width:Number((Number(width.value) *
        (brush.value === 'pencil' && pressureCount ? 0.5 + pressureTotal / pressureCount : 1)).toFixed(3)),
      brush:brush.value, shape:tool,
      opacity:brush.value === 'marker' ? 0.42 : brush.value === 'pencil' ? 0.78 : 1,
      points,
    });
    function append(points) {
      if (saving || !shapes.some(([key]) => key === tool)) return;
      try {
        const s = drawn(points,uid());
        replace([...strokes, s]);
        list.value = s.id;
      } catch (e) { error.textContent = e.message; }
    }
    function erase(points) {
      const transform = svg.getScreenCTM();
      const hit = openingEraserHits(asElement(strokes), points, 9 / Math.abs(transform.a));
      if (!hit.size) return;
      const remove = points.length === 1 ? new Set([[...hit].at(-1)]) : hit;
      replace(strokes.filter((s) => !remove.has(s.id)));
    }
    function previewStroke(mark) {
      if (!mark) {
        preview.replaceChildren();
        const last = eraserTrail;
        queueMicrotask(() => { if (last === eraserTrail) eraserTrail = []; });
        return;
      }
      const ps = mark.points.map(fromSurface);
      if (tool === 'erase') {
        if (!eraserTrail.length) eraserTrail.push(ps[0]);
        if (eraserTrail.length < 2999) eraserTrail.push(ps.at(-1));
        else eraserTrail[eraserTrail.length-1] = ps.at(-1);
        const trail = { ...drawn(eraserTrail, 'eraser'), shape:'free', color:'#9c562d', opacity:0.6,
          width:Math.min(1000, 2 / Math.abs(svg.getScreenCTM().a)) };
        preview.innerHTML = openingDetailMarkup(asElement([trail]),frame);
      } else {
        preview.innerHTML = openingDetailMarkup(asElement([drawn(ps, 'preview')]),frame);
      }
    }
    surface = connectPhotoSurface(svg, {
      w, h,
      tool:() => tool === 'pan' ? 'pan' : tool === 'free' ? 'ink' : 'arrow',
      selected:() => null, blockDrawing:() => saving || !discard.hidden,
      onSelect:() => {}, onMove:() => {},
      onStroke:(points) => append(points.map(fromSurface)),
      onPoint:(a,b) => {
        if (saving || !discard.hidden) return;
        if (tool === 'erase') {
          erase(b && eraserTrail.length ? eraserTrail : [fromSurface(a)]);
          eraserTrail = [];
        } else if (b) append([a,b].map(fromSurface));
      },
      onPreview:previewStroke,
      onViewport:(percent) => { find('[data-od-zoom]').textContent = percent+'%'; },
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      svg.addEventListener(event, (e) => { if (e.pointerId === penId) clearPressure(); });
    }
    function choose(next) {
      surface.cancel();
      tool = next;
      for (const b of dialog.querySelectorAll('[data-od-tool]')) b.setAttribute('aria-pressed', String(b.dataset.odTool === tool));
      svg.dataset.mode = tool;
      find('[data-od-coordinates] button').disabled = ['pan','erase'].includes(tool);
    }
    dialog.querySelectorAll('[data-od-tool]').forEach((b) => { b.onclick = () => choose(b.dataset.odTool); });
    find('[data-od-coordinates]').onsubmit = (e) => {
      e.preventDefault();
      if (saving || ['erase','pan'].includes(tool)) return;
      const area = e.currentTarget.elements.coordinates;
      try {
        const points = area.value.trim().split(/\r?\n/).map((row) => {
          const pair = row.split('/');
          if (pair.length !== 2) throw Error('Her satıra X / Y biçiminde iki değer girin.');
          return {x:readMm(pair[0], 'mm') / w, y:readMm(pair[1], 'mm') / h};
        });
        validateOpeningDetail(asElement([drawn(points,'check')]));
        append(points);
        area.value = '';
      } catch (e) { error.textContent = e.message; }
    };
    action('in').onclick = () => surface.zoom(1.5);
    action('out').onclick = () => surface.zoom(1/1.5);
    action('fit').onclick = surface.reset;
    action('undo').onclick = () => history(true);
    action('redo').onclick = () => history(false);
    action('delete').onclick = () => { if (list.value && !saving) replace(strokes.filter((s) => s.id !== list.value)); };
    function requestClose() {
      if (saving) return;
      surface.cancel();
      if (!dirty()) { closeDialog(); return; }
      discard.hidden = false;
      action('stay').focus();
    }
    find('#dlg-x').onclick = requestClose;
    dialog.oncancel = (e) => { e.preventDefault(); requestClose(); };
    action('cancel').onclick = requestClose;
    action('stay').onclick = () => { discard.hidden = true; svg.focus(); };
    action('discard').onclick = () => { if (!saving) closeDialog(); };
    const shortcut = (e) => {
      if (saving || !discard.hidden || e.target.closest('input,textarea,select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); history(!e.shiftKey);
      }
    };
    find('.od-editor').addEventListener('keydown', shortcut);
    action('save').onclick = async () => {
      if (saving) return;
      if (!dirty()) { closeDialog(); return; }
      const controls = [...dialog.querySelectorAll('input,button,textarea,select')];
      const disabled = controls.map((el) => el.disabled);
      saving = true;
      controls.forEach((el) => { el.disabled = true; });
      try {
        await ctx.change('Açıklık detay çizimi kaydedildi', (project) => {
          const current = project.elements.find((e) => e.id === elementId);
          if (!current || current.width !== w || current.height !== h || current.type !== element.type ||
            JSON.stringify(current.detailStrokes || []) !== JSON.stringify(source))
            throw Error('Açıklık değişti. Güncel kaydı açıp yeniden deneyin.');
          validateOpeningDetail({...current, detailStrokes:strokes});
          current.detailStrokes = structuredClone(strokes);
        });
        closeDialog();
      } catch (e) { error.textContent = e.message || 'Çizim kaydedilemedi.'; }
      finally { saving = false; controls.forEach((el,i) => { el.disabled = disabled[i]; }); }
    };
    action('in').setAttribute('aria-label','Yakınlaştır');
    action('out').setAttribute('aria-label','Uzaklaştır');
    choose('free');
    render();
  }, true);
}
