/* [codex] ureten: codex */
import * as G from './geometry/core.js';
import * as DB from './storage/store.js';
import { renderView, sectionOpenings } from './views/render.js';
import { wireOrbit } from './ui/orbit.js';
import { makeSection, sectionList, editSection, openingList } from './ui/sections.js';
import {
  inkSettings,
  inkColors,
  inkBrushes,
  inkShapes,
  defaultInk,
  brushPath,
  addSketch,
  hitSketches,
  faceFrame,
} from './ui/sketch.js';
import { openVerticalDetails, openVerticalChecks } from './ui/vertical-tools.js';
import { bearingOnPlan, photoViewPoint, photoAimMarkup } from './ui/photo-placement.js';
import { sampleProject } from './ui/demo.js';
import { layout, library, customersPage } from './ui/layout.js';
import { modes, toolLabel } from './ui/layout.js';
import { planMarkup, padded, viewStr, pairs, wallName, boxOf, roomCenter } from './ui/plan.js';
import { wireCanvas, zoomBox, asWorld } from './ui/gestures.js';
import { esc, uid, metre, num, fmt, readMm, button, icon, ib, downloadFile } from './ui/base.js';
import { dlg, form, showDialog, closeDialog, notify, validateExtras } from './ui/dialog.js';
import {
  anchorsFor,
  anchorLabel,
  observationForm,
  noteForm,
  notebook,
  visits,
  newVisit,
  checks,
  measurementList,
  surveyMethodLabel,
  chainForm,
  activeVisit,
} from './ui/survey.js';

const prefKey = 'roleve-ui:' + location.pathname.replace(/(?:index\.html)?\/?$/, '');
function pref(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(prefKey + key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function remember(key, v) {
  try {
    localStorage.setItem(prefKey + key, JSON.stringify(v));
  } catch {}
}
const s = {
  page: 'editor',
  floorId: null,
  roomId: null,
  wallId: null,
  elementId: null,
  zoneId: null,
  nodeId: null,
  mode: 'plan',
  tool: 'select',
  draft: [],
  anchors: [],
  mobilePanel: '',
  side: 'inside',
  yaw: 35,
  pitch: 28,
  isolate: false,
  ink: inkSettings(pref('ink', defaultInk)),
  showDims: pref('dims', true),
  showNotes: true,
  showUnderlay: true,
  grid: pref('grid', true),
  pencilOnly: pref('pencilOnly', false),
  leftHand: pref('leftHand', false),
  query: '',
  archived: false,
  customerId: '',
  customerQuery: '',
};
let p,
  projects = [],
  customers = [],
  undo = [],
  redo = [],
  busy = false,
  failedDraft = null,
  box = null,
  baseBox = null,
  observer = null,
  lastSvg = null,
  refreshAfterDialog = null;
const viewBoxes = new Map();
function viewKey() {
  return [
    p?.id,
    s.floorId,
    s.mode,
    ['elevation', 'section', 'model', 'facade'].includes(s.mode)
      ? [s.wallId, s.roomId, s.side, s.yaw, s.pitch, s.facadeSide, JSON.stringify(s.sectionLine)]
      : null,
  ].join('/');
}
const shell = document.querySelector('#shell');
const item = (rows, id) => rows?.find((x) => x.id === id);
const room = () => item(p?.rooms, s.roomId),
  wall = () => item(p?.walls, s.wallId),
  element = () => item(p?.elements, s.elementId);
function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      notify(error.message || 'İşlem tamamlanamadı.');
      console.warn('Rölöve işlemi', error.name, error.code || '');
    }
  };
}
function baseSelection(proj, floorId) {
  const f = item(proj.floors, floorId) || proj.floors[0];
  const cuts = (proj.sections || []).filter((c) => c.floorId === f?.id);
  const cut = cuts.find((v) => v.id === pref('cut:' + proj.id + ':' + f?.id, null)) || cuts[0];
  return {
    floorId: f?.id,
    roomId: proj.rooms.find((r) => r.floorId === f?.id)?.id || null,
    wallId: null,
    elementId: null,
    nodeId: null,
    zoneId: null,
    mode: 'plan',
    tool: 'select',
    draft: [],
    anchors: [],
    mobilePanel: '',
    side: 'inside',
    sectionId: cut?.id || null,
    sectionLine: cut ? { a: cut.a, b: cut.b } : null,
    sectionY: undefined,
    roomDraft: null,
    zoneDraft: null,
    photoContext: null,
  };
}
function set(patch) {
  const prior = viewKey();
  if (box) viewBoxes.set(prior, { ...box });
  if (patch.floorId && patch.floorId !== s.floorId) {
    box = null;
    Object.assign(s, baseSelection(p, patch.floorId));
  }
  if (patch.mode && patch.mode !== s.mode) {
    box = null;
    s.anchors = [];
    s.draft = [];
    s.tool = 'select';
  }
  if (Object.hasOwn(patch, 'roomId') && patch.roomId !== s.roomId)
    Object.assign(s, { wallId: null, elementId: null, zoneId: null, nodeId: null });
  Object.assign(s, patch);
  if(s.mode==='elevation' && room() && !room().wallIds.includes(s.wallId)) s.wallId=room().wallIds[0] || null;
  if (prior !== viewKey()) box = viewBoxes.get(viewKey()) || null;
  rememberDraft();
  render();
}
function rememberDraft() {
  if (!p) return;
  try {
    const key = prefKey + ':draft:' + p.id;
    if (
      (s.draft.length || s.anchors.length) &&
      ['draw', 'zone', 'measure', 'calibrate', 'sectionline', 'photoLocate'].includes(s.tool)
    )
      sessionStorage.setItem(
        key,
        JSON.stringify({
          draft: s.draft,
          anchors: s.anchors,
          tool: s.tool,
          roomDraft: s.roomDraft,
          zoneDraft: s.zoneDraft,
          roomId: s.roomId,
          floorId: s.floorId,
          underlayId: s.underlayId,
          photoContext: s.photoContext,
          mode: s.mode,
          stamp: p.updatedAt,
        }),
      );
    else sessionStorage.removeItem(key);
  } catch {}
}
function setupProject(q, resume = false) {
  p = validateExtras(G.normalizeProject(q));
  Object.assign(s, baseSelection(p), { page: 'editor' });
  box = null;
  undo = [];
  redo = [];
  failedDraft = null;
  remember('last', p.id);
  if (resume)
    try {
      const d = JSON.parse(sessionStorage.getItem(prefKey + ':draft:' + p.id));
      if (d && d.stamp === p.updatedAt && item(p.floors, d.floorId)) Object.assign(s, d);
    } catch {}
}
async function refreshList() {
  projects = (await DB.listProjects()).sort((a, b) => String(b.updatedAt).localeCompare(a.updatedAt));
  const rows = await DB.listCustomers();
  customers = Array.from(
    new Map(
      [...projects.map((p) => p.customer).filter(Boolean), ...rows].map((row) => [row.id, row]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return projects;
}
async function selectProject(id) {
  if (busy) throw Error('Kayıt tamamlanıyor.');
  const q = await DB.loadProject(id);
  if (!q) throw Error('Proje bu cihazda bulunamadı.');
  setupProject(q, true);
  s.sync = await DB.getSyncState(p.id);
  await refreshList();
  closeDialog();
  render();
}
async function refreshProject(id) {
  const q = id ? await DB.loadProject(id) : null;
  if (!q) {
    await refreshList();
    if (projects[0]) return selectProject(projects[0].id);
    p = null;
    s.sync = null;
    s.page = 'projects';
    closeDialog();
    render();
    return;
  }
  if (q.id !== p?.id) return selectProject(q.id);
  const changed = p.updatedAt !== q.updatedAt;
  p = validateExtras(G.normalizeProject(q));
  if (changed) {
    undo = [];
    redo = [];
    if (!item(p.floors, s.floorId)) Object.assign(s, baseSelection(p));
    if (!room()) s.roomId = p.rooms.find((r) => r.floorId === s.floorId)?.id || null;
    if (!wall()) s.wallId = null;
    if (!element()) s.elementId = null;
    s.draft = [];
    s.anchors = [];
    rememberDraft();
  }
  s.sync = await DB.getSyncState(q.id);
  await refreshList();
  render();
}
async function cloudChange(id) {
  if (id !== p?.id) return;
  if (busy || dlg().open) {
    refreshAfterDialog = id;
    return;
  }
  await refreshProject(id);
}
async function commit(label, draft, { history = true } = {}) {
  validateExtras(draft);
  G.validateProject(draft);
  const before = p;
  let saved;
  try {
    saved = await DB.saveProject(draft, { expectedUpdatedAt: before.updatedAt });
  } catch (e) {
    failedDraft = draft;
    throw Error(e.message + ' · Proje araçlarından taslağı dışa alabilirsiniz.');
  }
  if (history) {
    undo.push(before);
    if (undo.length > 20) undo.shift();
    redo = [];
  }
  if (s.mode !== 'plan') {
    const heightChanged = item(before.rooms,s.roomId)?.height !== item(saved.rooms,s.roomId)?.height;
    const wasFit = box && baseBox && ['x','y','w','h'].every(k=>Math.abs(box[k]-baseBox[k])<0.02);
    if (heightChanged || wasFit) { box = null; viewBoxes.delete(viewKey()); }
  }
  p = saved;
  failedDraft = null;
  s.sync = await DB.getSyncState(p.id);
  if (!item(p.floors, s.floorId)) Object.assign(s, baseSelection(p));
  if (!room()) s.roomId = p.rooms.find((r) => r.floorId === s.floorId)?.id || null;
  if (!wall()) s.wallId = null;
  if (!element()) s.elementId = null;
  rememberDraft();
  render();
  if (label) notify(label);
  return p;
}
async function change(label, apply) {
  if (busy) throw Error('Önceki kayıt tamamlanıyor.');
  if (!p) throw Error('Önce proje açın.');
  busy = true;
  try {
    const draft = structuredClone(p);
    await apply(draft);
    const recorder = DB.cloudSession()?.username || null;
    for (const key of ['visits', 'notes', 'observations', 'strokes', 'faceSketches', 'sections']) {
      const prior = new Set((p[key] || []).map((v) => v.id));
      for (const v of draft[key] || []) {
        if (prior.has(v.id)) continue;
        if (recorder && !v.recordedBy) v.recordedBy = recorder;
        if (['notes', 'observations'].includes(key) && !v.measuredBy) {
          const visit = draft.visits.find((row) => row.id === v.visitId);
          if (visit?.person) v.measuredBy = visit.person;
        }
      }
    }
    return await commit(label, draft);
  } finally {
    busy = false;
  }
}
async function historyAction(forward) {
  const stack = forward ? redo : undo;
  if (!stack.length || busy) return;
  busy = true;
  const target = stack.at(-1),
    current = p;
  try {
    await commit(forward ? 'Değişiklik yinelendi' : 'Son değişiklik geri alındı', structuredClone(target), {
      history: false,
    });
    stack.pop();
    (forward ? undo : redo).push(current);
    render();
  } finally {
    busy = false;
  }
}
function ctx() {
  const projectId = p?.id,
    stamp = p?.updatedAt;
  const changeHere = (label, fn) => {
    if (p?.id !== projectId || p.updatedAt !== stamp)
      throw Error('Bu form açıldıktan sonra proje değişti. Güncel kaydı açıp yeniden deneyin.');
    return change(label, fn);
  };
  return {
    p,
    s,
    room: room(),
    wall: wall(),
    element: element(),
    set,
    change: changeHere,
    openOpeningDetail: (id) => dispatch('opening-detail', id),
    openPhoto: (id) => dispatch('photo-edit', id),
    toast: notify,
    refreshList,
    refreshProject,
    selectProject,
    importArchive,
  };
}
function applyBox(v) {
  box = v;
  const svg = lastSvg;
  if (!svg) return;
  svg.setAttribute('viewBox', viewStr(v));
  const z = document.getElementById('zoom-text');
  if (z && baseBox) z.textContent = Math.round((baseBox.w / v.w) * 100) + '%';
  const m = svg.getScreenCTM(),
    mark = document.querySelector('.scale-mark');
  if (!m || !mark) return;
  mark.hidden = s.mode !== 'plan';
  if (s.mode === 'plan') {
    let seg = 1000;
    while (seg * m.a > 112) seg /= 2;
    while (seg * m.a < 32) seg *= 2;
    mark.querySelector('i').style.width = Math.max(1, seg * m.a) + 'px';
    mark.querySelector('span').textContent = metre(seg);
  }
}
function zoom(f, anchor) {
  if (box) applyBox(zoomBox(box, f, anchor));
}
function drawPhotoGuide(origin = null, target = null) {
  const layer = lastSvg?.querySelector('#draft-layer');
  if (!layer || s.tool !== 'photoLocate') return;
  const camera = s.draft[0] || origin;
  layer.innerHTML = camera ? photoAimMarkup(camera, target, lastSvg.getScreenCTM()?.a || 1) : '';
}
function renderDraft() {
  if (!lastSvg) return;
  const g = lastSvg.querySelector('#draft-layer');
  if (s.tool === 'photoLocate') drawPhotoGuide();
  else if (g) {
    const points = s.draft.length
      ? s.draft
      : s.anchors
          .map((a) => {
            try {
              return G.resolveAnchor(p, a);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
    g.innerHTML =
      `<polyline points="${pairs(points)}" fill="none" stroke="#9b5a2d" stroke-width="26" stroke-dasharray="80 36"/>` +
      points
        .map(
          (v, i) =>
            `<circle cx="${+v.x}" cy="${+v.y}" r="75" fill="#ebbb81" stroke="#734323" stroke-width="24"/><text x="${v.x + 100}" y="${v.y - 90}" font-size="145" fill="#713e22">${i + 1}</text>`,
        )
        .join('');
  }
  const h = document.querySelector('#tool-hint');
  if (!h) return;
  const controls = (k, t) => `<button data-act="${k}">${t}</button>`;
  let hint = '';
  if (s.tool === 'draw' || s.tool === 'zone')
    hint = `${s.tool === 'draw' ? 'Mahal' : 'Bölge'} · ${s.draft.length} köşe ${controls('add-coordinate', 'X / Y')}${s.draft.length ? controls('pop-point', 'Geri') : ''}${s.draft.length >= 3 ? controls('finish-polygon', 'Kapat ve kaydet') : ''}`;
  if (s.tool === 'measure')
    hint = `${s.anchors.length ? 'Bitiş ucunu seç' : 'Başlangıç ucunu seç'} ${s.anchors.length ? controls('pop-point', 'Ucu değiştir') : ''}${controls('measure-form', 'Listeden seç')}`;
  if (s.tool === 'photoLocate')
    hint =
      (s.draft.length ? 'Bakış yönü · Baktığın yere dokun veya sürükle.' : 'Kameranın yerine dokun veya oradan bakış yönüne sürükle.') +
      (s.draft.length ? ' ' + controls('pop-point', 'İlk noktayı değiştir') : '') +
      ' ' +
      controls('add-coordinate', 'X / Y');
  if (s.tool === 'notePin') hint = 'Notun veya fotoğrafın yerini planda seçin.';
  if (s.tool === 'calibrate')
    hint = `${s.draft.length ? 'İkinci referans noktasını seç' : 'Altlıkta ilk referans noktasını seç'} ${s.draft.length ? controls('pop-point', 'Geri') : ''}`;
  if (s.tool === 'sectionline')
    hint =
      (s.draft.length ? 'Kesit bitişi B' : 'Kesit başlangıcı A') +
      ' ' +
      controls('add-coordinate', 'X / Y') +
      (s.draft.length ? controls('pop-point', 'Geri') : '');
  if (s.tool === 'ink')
    hint = `<i class="ink-swatch" style="background:${s.ink.color}"></i>${inkBrushes.find((v) => v[0] === s.ink.brush)[1]} · ${inkShapes.find((v) => v[0] === s.ink.shape)[1]} ${controls('ink-settings', 'Kalemler ve renkler')}`;
  if (s.tool === 'erase') hint = 'Silmek istediğiniz eskiz çizgisine dokunun veya üzerinden geçin.';
  if (hint) hint += ' ' + controls('exit-tool', s.tool === 'photoLocate' ? 'Vazgeç' : 'Bitti');
  h.innerHTML = hint;
}
function render() {
  observer?.disconnect();
  lastSvg = null;
  document.body.classList.toggle('left-handed', s.leftHand);
  if (s.page === 'customers') {
    shell.innerHTML = customersPage(s, customers, projects);
    const field = shell.querySelector('#customer-search');
    field.oninput = () => {
      s.customerQuery = field.value;
      render();
      const next = shell.querySelector('#customer-search');
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    };
    return;
  }
  if (s.page === 'projects' || !p) {
    shell.innerHTML = library(p, s, projects, customers);
    const q = shell.querySelector('#library-search');
    q.oninput = () => {
      s.query = q.value;
      render();
      const n = shell.querySelector('#library-search');
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    };
    return;
  }
  if (s.sectionId) {
    const cut = item(p.sections, s.sectionId);
    if (cut) s.sectionLine = { a: cut.a, b: cut.b };
    else {
      s.sectionId = null;
      s.sectionLine = null;
    }
  }
  s.undo = undo.length;
  s.redo = redo.length;
  const prevScroll = {
    a: shell.querySelector('.sidebar')?.scrollTop || 0,
    b: shell.querySelector('.inspector')?.scrollTop || 0,
  };
  shell.innerHTML = layout(p, s);
  shell.querySelector('.sidebar').scrollTop = prevScroll.a;
  shell.querySelector('.inspector').scrollTop = prevScroll.b;
  shell.querySelector('#floor-select').onchange = (e) => set({ floorId: e.target.value });
  const verticalSelect=shell.querySelector('[data-vertical-select]');
  if(verticalSelect) verticalSelect.onchange=()=>{
    if(verticalSelect.dataset.verticalSelect==='room') selectRoom(verticalSelect.value);
    else set({wallId:verticalSelect.value,elementId:null,zoneId:null,tool:'select',anchors:[],draft:[]});
  };
  const svg = shell.querySelector('#viewport');
  lastSvg = svg;
  const wireDrawing = (onTap, onDragNode) =>
    wireCanvas(svg, {
      onTap: onTap ? guard(onTap) : () => {},
      getProject: () => p,
      getPhotoStart: () => s.tool === 'photoLocate' ? s.draft[0] ?? null : null,
      onPhotoPreview: (origin, target) => {
        if (svg === lastSvg && s.tool === 'photoLocate') drawPhotoGuide(origin, target);
      },
      onPhotoDrag: guard(async (start, startTarget, end, endTarget) => {
        if (svg !== lastSvg || s.tool !== 'photoLocate') return;
        if (!s.draft.length) await addPhotoPoint(start, startTarget);
        if (s.tool === 'photoLocate') await addPhotoPoint(end, endTarget);
      }),
      onDragNode: onDragNode ? guard(onDragNode) : () => {},
      onInk: guard(saveInk),
      onZoom: zoom,
      getTool: () => s.tool,
      getBox: () => box,
      setBox: applyBox,
      pencilOnly: () => s.pencilOnly,
      onPen: () => {
        if (pref('pencilOnly', null) === null) {
          s.pencilOnly = true;
          remember('pencilOnly', true);
        }
      },
      previewInk: (pts, tool) => {
        if (tool === 'erase')
          return {
            points: pts,
            color: '#aa5048',
            width: Math.max(8, 12 / (svg.getScreenCTM()?.a || 1)),
            opacity: 0.5,
          };
        if (tool === 'ink')
          return {
            points: brushPath(pts, s.ink.shape),
            color: s.ink.color,
            width: s.ink.width * (s.ink.brush === 'marker' ? 2.6 : 1),
            opacity: s.ink.brush === 'marker' ? 0.45 : 1,
          };
      },
    });
  if (s.mode === 'plan') {
    const v = planMarkup(p, { ...s, anchorFn: G.resolveAnchor });
    baseBox = padded(v.bounds);
    svg.innerHTML = v.html;
    applyBox(box || baseBox);
    wireDrawing(planTap, nodeDrag);
  } else {
    const paintView = (keepZoom = false) => {
      const previous = baseBox,
        current = box;
      const v = renderView(svg, p, {
        ...s,
        anchors: s.anchors
          .map((a) => {
            try {
              return G.resolveAnchor(p, a);
            } catch {
              return null;
            }
          })
          .filter(Boolean),
        onPick: ['ink', 'erase'].includes(s.tool) ? undefined : guard(viewPick),
      });
      const b = v?.bounds;
      const vb = svg.viewBox.baseVal;
      baseBox =
        vb.width > 0
          ? { x: vb.x, y: vb.y, w: vb.width, h: vb.height }
          : { x: b?.x || 0, y: b?.y || 0, w: b?.width || 6000, h: b?.height || 4000 };
      if (keepZoom && previous && current) {
        const f = baseBox.w / previous.w;
        applyBox({
          x: baseBox.x + baseBox.w / 2 + (current.x - previous.x - previous.w / 2) * f,
          y: baseBox.y + baseBox.h / 2 + (current.y - previous.y - previous.h / 2) * f,
          w: current.w * f,
          h: current.h * f,
        });
      } else applyBox(box || baseBox);
    };
    paintView();
    if (s.mode === 'model') {
      svg.setAttribute(
        'aria-description',
        'Sürükleyerek döndürün, iki parmağınızla yakınlaştırın veya kaydırın.',
      );
      const rotate = (dx, dy) => {
        s.yaw = (((s.yaw + dx * 0.42) % 360) + 360) % 360;
        s.pitch = Math.min(80, Math.max(5, s.pitch + dy * 0.35));
        paintView(true);
      };
      wireOrbit(svg, { rotate, getBox: () => box, setBox: applyBox });
    }
    svg.onwheel = (e) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, asWorld(svg, e.clientX, e.clientY));
    };
    if (s.mode === 'elevation' && ['ink', 'erase'].includes(s.tool)) wireDrawing();
  }
  observer = new ResizeObserver(() => {
    if (lastSvg === svg && box) applyBox(box);
  });
  observer.observe(svg);
  renderDraft();
}
async function saveInk(points) {
  if (s.tool === 'erase') {
    const ids = new Set(hitSketches(p, s, points, 10 / (lastSvg?.getScreenCTM()?.a || 1)));
    if (!ids.size) {
      notify('Silginin altında eskiz çizgisi yok.');
      return;
    }
    const key = s.mode === 'elevation' ? 'faceSketches' : 'strokes';
    return change('Eskiz çizgisi silindi', (q) => (q[key] = q[key].filter((v) => !ids.has(v.id))));
  }
  if (points.length < 2) return;
  let sampled = points.filter(
    (v, i) => i === 0 || i === points.length - 1 || i % Math.max(1, Math.ceil(points.length / 2500)) === 0,
  );
  await change(s.mode === 'elevation' ? 'Duvar eskizi kaydedildi' : 'Plan eskizi kaydedildi', (q) =>
    addSketch(q, s, sampled, s.ink),
  );
}
async function nodeDrag(id, point) {
  const node = item(p.nodes, id);
  if (!node || node.x === point.x && node.y === point.y) return;
  await change('Köşe taşındı', (draft) => G.moveNode(draft, id, point));
}
function floorRoomForWall(id) {
  return room()?.wallIds.includes(id)
    ? room()
    : p.rooms.find((r) => r.floorId === s.floorId && r.wallIds.includes(id));
}
function pickElement(id) {
  const e = item(p.elements, id);
  if (e)
    set({
      roomId: floorRoomForWall(e.wallId)?.id || e.roomId,
      elementId: id,
      wallId: e.wallId,
      nodeId: null,
    });
}
function trySnap(v) {
  const m = lastSvg?.getScreenCTM(),
    radius = m ? 12 / m.a : 120;
  let nearest = null,
    best = radius;
  for (const n of p.nodes) {
    if (n.floorId !== s.floorId) continue;
    const d = Math.hypot(n.x - v.x, n.y - v.y);
    if (d < best) {
      best = d;
      nearest = n;
    }
  }
  return nearest;
}
function addAnchor(a) {
  if (!s.anchors.length) {
    s.anchors = [a];
    rememberDraft();
    render();
    return;
  }
  const second = a,
    first = s.anchors[0];
  observationForm(ctx(), first, second);
}
function measurementTap(v, t) {
  const node = t.node ? item(p.nodes, t.node) : trySnap(v);
  if (node) {
    const r =
      p.rooms.find((r) => r.id === s.roomId && r.nodeIds.includes(node.id)) ||
      p.rooms.find((r) => r.nodeIds.includes(node.id));
    addAnchor({
      nodeId: node.id,
      label: `${r?.code || ''} · Köşe ${(r?.nodeIds.indexOf(node.id) ?? 0) + 1}`,
    });
    return;
  }
  if (t.element) {
    const e = item(p.elements, t.element);
    if (e) {
      form(
        'Ölçü ucunu seç',
        [
          {
            key: 'at',
            label: e.name,
            choices: [
              ['start', 'Başlangıç kenarı'],
              ['end', 'Bitiş kenarı'],
              ['center', 'Merkez'],
            ],
          },
        ],
        'Ucu seç',
        (d) => {
          closeDialog();
          addAnchor({
            elementId: e.id,
            at: d.at,
            roomId: e.roomId,
            label: e.name + ' · ' + { start: 'başlangıç', end: 'bitiş', center: 'merkez' }[d.at],
          });
        },
      );
      return;
    }
  }
  if (t.wall) {
    const w = item(p.walls, t.wall),
      a = item(p.nodes, w.a),
      b = item(p.nodes, w.b),
      r = floorRoomForWall(w.id),
      dx = b.x - a.x,
      dy = b.y - a.y;
    const fraction = Math.max(0, Math.min(1, ((v.x - a.x) * dx + (v.y - a.y) * dy) / (dx * dx + dy * dy)));
    const faces = [
      ['inside', 'İç yüz'],
      ['outside', 'Dış yüz'],
      ['axis', 'Aks'],
    ];
    form(
      'Duvar üzerindeki uç',
      [
        { key: 'side', label: 'Yüz', choices: faces },
        {
          key: 'pos',
          label: `Duvar başlangıcından (${p.unit})`,
          value: fmt(fraction * G.wallLength(p, w.id), p.unit),
          number: true,
        },
      ],
      'Ucu seç',
      (d) => {
        const tv = readMm(d.pos, p.unit) / G.wallLength(p, w.id);
        if (tv < 0 || tv > 1) throw Error('Nokta duvar sınırının dışında.');
        const anchor = {
          wallId: w.id,
          roomId: r.id,
          side: d.side,
          t: tv,
          label: `${r.code} · Duvar ${wallName(r.wallIds.indexOf(w.id))} / ${faces.find((f) => f[0] === d.side)[1]}`,
        };
        closeDialog();
        addAnchor(anchor);
      },
    );
    return;
  }
  addAnchor({
    ...v,
    z: item(p.floors, s.floorId)?.elevation || 0,
    label: `Tanık ${metre(v.x)} / ${metre(v.y)}`,
  });
}
async function planTap(v, t) {
  if (s.tool === 'photoLocate') {
    await addPhotoPoint(v, t);
    return;
  }
  if (s.tool === 'notePin') {
    const r = t.room ? item(p.rooms, t.room) : t.wall ? floorRoomForWall(t.wall) : room();
    const existing = s.notePinId ? item(p.notes, s.notePinId) : null;
    set({ tool: 'select', roomId: r?.id || null, wallId: t.wall || null, notePinId: null });
    const c = ctx();
    noteForm(c, existing, { ...v, floorId: s.floorId, z: item(p.floors, s.floorId)?.elevation || 0 });
    return;
  }
  if (s.tool === 'measure') {
    measurementTap(v, t);
    return;
  }
  if (['draw', 'zone', 'calibrate', 'sectionline'].includes(s.tool)) {
    const n = s.tool === 'calibrate' ? null : trySnap(v);
    const point = n ? { x: n.x, y: n.y } : v;
    if (
      ['draw', 'zone'].includes(s.tool) &&
      s.draft.length >= 3 &&
      Math.hypot(point.x - s.draft[0].x, point.y - s.draft[0].y) <
        Math.max(60, 12 / (lastSvg.getScreenCTM()?.a || 1))
    ) {
      finishPolygon();
      return;
    }
    await addDraft(point);
    return;
  }
  if (t.note) {
    const n = item(p.notes, t.note);
    if (n?.photo) await dispatch('photo-edit', n.id);
    else if (n) noteForm(ctx(), n);
    return;
  }
  if (t.obs) {
    showObservation(t.obs);
    return;
  }
  if (t.node) {
    set({ nodeId: t.node });
    return;
  }
  if (t.zone) {
    set({ zoneId: t.zone, roomId: t.room || s.roomId });
    await dispatch('zone-info', t.zone);
    return;
  }
  if (t.element) {
    pickElement(t.element);
    return;
  }
  if (t.wall) {
    set({ roomId: floorRoomForWall(t.wall)?.id, wallId: t.wall, elementId: null, nodeId: null });
    return;
  }
  if (t.room) set({ roomId: t.room, wallId: null, elementId: null, nodeId: null });
}
async function viewPick(hit) {
  const e = item(p.elements, hit.elementId),
    w = item(p.walls, hit.wallId || e?.wallId),
    r = item(p.rooms, hit.roomId || e?.roomId),
    floorId = hit.floorId || r?.floorId || w?.floorId || s.floorId;
  if (s.tool === 'measure' && hit.anchor) {
    addAnchor({ ...hit.anchor, ...(hit.anchor.z===null ? {unmeasuredZ:true} : {}), floorId, roomId: r?.id || hit.anchor.roomId });
    return;
  }
  if (s.tool === 'select' && r && (hit.roomHeight || (hit.heightZone && hit.zoneId))) {
    const cut = s.mode === 'section' ? {sectionId:s.sectionId,sectionLine:s.sectionLine} : {};
    set({floorId, ...cut, mode:s.mode, roomId:r.id, wallId:w?.id || null, zoneId:hit.zoneId || null, elementId:null});
    await dispatch(hit.roomHeight ? 'room-height' : 'zone-info',hit.roomHeight ? r.id : hit.zoneId);
    return;
  }
  if (e) {
    const cut = s.mode === 'section' ? { sectionId: s.sectionId, sectionLine: s.sectionLine } : {};
    set({
      floorId,
      ...cut,
      roomId: r?.id || floorRoomForWall(e.wallId)?.id,
      wallId: e.wallId,
      elementId: e.id,
      mode: s.mode,
    });
    if (s.tool === 'select' && (hit.sectionOpening || s.mode==='elevation')) await dispatch('edit-element', e.id);
    return;
  }
  const patch = { floorId, mode: s.mode };
  if (hit.roomId) patch.roomId = hit.roomId;
  if (hit.wallId) patch.wallId = hit.wallId;
  if (hit.zoneId) patch.zoneId = hit.zoneId;
  if (Object.keys(patch).length) set(patch);
}
async function addPhotoPoint(point, target = {}) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw Error('Çekim noktası geçersiz.');
  const xyz = photoViewPoint(p, s.floorId, point, target, room()?.id);
  if (!s.draft.length) {
    s.draft = [xyz];
    rememberDraft();
    renderDraft();
    return;
  }
  const a = s.draft[0];
  if (Math.hypot(a.x - xyz.x, a.y - xyz.y) < 1) {
    renderDraft();
    notify('Bakış yönü için çekim noktasından farklı bir yer seç.');
    return;
  }
  const direction = bearingOnPlan(a, xyz),
    previous = s.photoContext?.noteId ? item(p.notes, s.photoContext.noteId) : null;
  const targetRoom = item(p.rooms, xyz.roomId),
    scene = s.photoContext?.scene || (!a.roomId ? 'exterior' : 'interior'),
    surface =
      scene === 'exterior'
        ? 'facade'
        : target.wall || target.element
          ? 'wall'
          : previous?.surface || 'general';
  set({
    tool: 'select',
    roomId: targetRoom?.id || room()?.id,
    wallId: xyz.wallId,
    photoContext: null,
    draft: [],
    mobilePanel: '',
  });
  noteForm(ctx(), previous, a, { target: xyz, direction, photoFirst: true, surface, scene });
}
async function addDraft(pt) {
  if (s.tool === 'photoLocate') return addPhotoPoint(pt);
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) throw Error('Nokta geçersiz.');
  if (s.draft.length && Math.hypot(pt.x - s.draft.at(-1).x, pt.y - s.draft.at(-1).y) < 1) return;
  if (s.draft.length >= 2000) throw Error('Konturda en fazla 2.000 nokta olabilir.');
  if (s.tool === 'calibrate' && s.draft.length >= 2) s.draft.length = 1;
  s.draft.push(pt);
  rememberDraft();
  renderDraft();
  if (s.draft.length === 2 && s.tool === 'sectionline') {
    const [a, b] = s.draft;
    const cut = makeSection(p, s.floorId, a, b);
    try {
      await change('Kesit projeye kaydedildi', (q) => (q.sections ??= []).push(cut));
    } catch (e) {
      s.draft = [a];
      rememberDraft();
      renderDraft();
      throw e;
    }
    selectCut(cut);
    return;
  }
  if (s.draft.length >= 2 && s.tool === 'calibrate') {
    const [a, b] = s.draft;
    const u = item(p.underlays, s.underlayId);
    if (!u) return;
    form(
      'Altlık ölçeğini doğrula',
      [
        { key: 'length', label: `Gerçek uzunluk (${p.unit})`, required: true, number: true },
        { key: 'check', label: 'Yalnız kontrol et', type: 'check' },
      ],
      'Uygula',
      async (d) => {
        const actual = readMm(d.length, p.unit),
          current = Math.hypot(b.x - a.x, b.y - a.y);
        if (actual <= 0 || current < 1) throw Error('Farklı iki referans ve pozitif uzunluk gerekli.');
        if (d.check) {
          await change('İkinci referans kontrolü kaydedildi', (q) => {
            item(q.underlays, u.id).verification = {
              actual,
              current,
              error: current - actual,
              date: new Date().toISOString(),
            };
          });
          notify('İkinci referans farkı: ' + metre(current - actual));
        } else {
          const k = actual / current;
          await change('Altlık ölçeği güncellendi', (q) => {
            const l = item(q.underlays, u.id);
            l.x = a.x + (l.x - a.x) * k;
            l.y = a.y + (l.y - a.y) * k;
            l.width *= k;
            l.height *= k;
            l.calibration = { a, b, actual, date: new Date().toISOString() };
          });
        }
        box = null;
        set({ tool: 'select', draft: [] });
      },
      { intro: 'Birinci nokta sabit kalır. Altlık büyütülür veya küçültülür. Mahal geometrisi korunur.' },
    );
  }
}
function finishPolygon() {
  if (s.draft.length < 3) throw Error('En az üç köşe seçin.');
  const pts = structuredClone(s.draft),
    isRoom = s.tool === 'draw',
    rd = s.roomDraft || {},
    zd = s.zoneDraft || {};
  G.assertPolygon(pts, isRoom ? 'Mahal' : 'Bölge');
  form(
    isRoom ? 'Mahal konturunu kaydet' : 'Kot bölgesini kaydet',
    [
      {
        key: 'name',
        label: 'Ad',
        required: true,
        full: true,
        value: isRoom ? rd.name || 'Yeni mahal' : zd.name || 'Yeni bölge',
      },
    ],
    'Kaydet',
    async (d) => {
      let rid = s.roomId,
        zid = null;
      await change(isRoom ? 'Mahal kaydedildi' : 'Bölge kaydedildi', (q) => {
        if (isRoom) {
          rid = G.addRoom(q, { ...rd, name: d.name, floorId: s.floorId, points: pts }).id;
        } else {
          if (zd.replaceId) {
            const z = item(q.zones, zd.replaceId);
            if (!z) throw Error('Bölge bulunamadı.');
            Object.assign(z, zd, { name: d.name, points: pts });
            delete z.replaceId;
            zid = z.id;
          } else
            zid = G.addZone(q, {
              type: 'platform',
              ...zd,
              name: d.name,
              roomId: zd.roomId || rid,
              points: pts,
            }).id;
        }
      });
      box = null;
      set({ roomId: rid, zoneId: zid, tool: 'select', draft: [], roomDraft: null, zoneDraft: null });
    },
    {
      intro: `${pts.length} köşe · ${num(
        Math.abs(
          pts.reduce((a, v, i) => {
            let z = pts[(i + 1) % pts.length];
            return a + v.x * z.y - z.x * v.y;
          }, 0),
        ) / 2e6,
        2,
      )} m²`,
    },
  );
}
function showObservation(id) {
  const o = item(p.observations, id);
  if (!o) return;
  let calc = 'Çözülmedi';
  try {
    calc = o.purpose==='room-ceiling' ? metre(item(p.rooms,o.roomId)?.height) : metre(G.measure(p, o.a, o.b, o.kind));
  } catch {}
  showDialog(
    'Ölçü kaydı',
    `<div class="stat-grid"><div><small>Kaydedilen okuma</small><strong>${esc(o.raw)} ${esc(o.unit)}</strong></div><div><small>Mevcut model</small><strong>${esc(calc)}</strong></div></div>
  <p class="info-line">${esc(anchorLabel(p, o.a))} → ${esc(anchorLabel(p, o.b))}</p><p class="detail-copy">${esc(o.note || '')}${o.measuredBy ? ' · Sahada ölçen: ' + esc(o.measuredBy) : ''}${o.recordedBy ? ' · Kaydı giren: ' + esc(o.recordedBy) : ''} · ${esc(surveyMethodLabel(o.method))} · ${esc(o.date?.slice(0, 10))}</p><div class="form-tools">${button('repeat-obs', 'Yeniden ölç', 'ruler', 'primary', `data-id="${esc(id)}"`)}</div>`,
  );
}

async function createNew(q) {
  q = validateExtras(G.normalizeProject(q));
  const saved = await DB.saveProject(q, { expectedUpdatedAt: null });
  await selectProject(saved.id);
  return saved;
}
function customerField(id) {
  return {
    key: 'customer',
    label: 'Müşteri',
    choices: [
      ['', 'Müşterisiz proje'],
      ...customers.map((c) => [c.id, c.name]),
      ['__new', 'Yeni müşteri oluştur…'],
    ],
    value: id || '',
    full: true,
  };
}
async function selectedCustomer(d) {
  if (!d.customer) return null;
  if (d.customer === '__new') {
    const name = String(d.newCustomer || '').trim();
    if (!name) throw Error('Yeni müşterinin adını girin.');
    return DB.createCustomer(name);
  }
  const c = customers.find((v) => v.id === d.customer);
  if (!c) throw Error('Müşteri bulunamadı.');
  return { id: c.id, name: c.name };
}
function customerFields(form) {
  const toggle = () => {
    form.elements.newCustomer.closest('label').hidden = form.elements.customer.value !== '__new';
  };
  form.elements.customer.addEventListener('change', toggle);
  toggle();
}
function newProject() {
  const related = customers.find((c) => c.id === s.customerId);
  form(
    'Yeni rölöve projesi',
    [
      {
        key: 'name',
        label: 'Proje adı',
        full: true,
        required: true,
        maxlength: 120,
        placeholder: 'Örn. Çınar Sokak Dairesi',
      },
      customerField(related?.id),
      { key: 'newCustomer', label: 'Yeni müşterinin adı', full: true, maxlength: 120 },
      {
        key: 'surveyor',
        label: 'Rölöveyi alacak kişi',
        value: DB.cloudSession()?.username || '',
        maxlength: 120,
      },
      { key: 'location', label: 'Konum veya proje kodu', full: true, maxlength: 180 },
      { key: 'unit', label: 'Ölçü birimi', choices: ['m', 'cm', 'mm'] },
      {
        key: 'template',
        label: 'Başlangıç',
        choices: [
          ['blank', 'Boş plan'],
          ['konut', 'Beş mahalli örnek plan'],
          ['dukkan', 'Asma katlı dükkân'],
        ],
      },
    ],
    'Projeyi oluştur',
    async (d) => {
      const q = d.template === 'blank' ? G.createProject(d.name) : sampleProject(d.template);
      q.name = d.name.trim();
      q.location = d.location.trim();
      q.unit = d.unit;
      q.customer = await selectedCustomer(d);
      q.surveyorName = d.surveyor.trim();
      q.createdBy = DB.cloudSession()?.username || null;
      if (d.template === 'blank') q.sample = false;
      await createNew(q);
      notify('Proje bu cihazda oluşturuldu.');
    },
    { after: customerFields },
  );
}
async function importArchive(raw) {
  const q = validateExtras(G.normalizeProject(raw.project || raw));
  if (await DB.loadProject(q.id)) {
    q.id = uid();
    q.name += ' · İçe aktarılan kopya';
  }
  await createNew(q);
  closeDialog();
  notify('Arşiv açıldı.');
}
function importProject() {
  form(
    'Proje dosyasından aç',
    [
      {
        key: 'file',
        label: 'Rölöve proje arşivi',
        type: 'file',
        accept: '.json,.roleve,application/json',
        required: true,
        full: true,
      },
    ],
    'Projeyi aç',
    async (d) => {
      if (!d.file?.size) throw Error('İçe aktarmak için bir proje arşivi seçin.');
      let content;
      try {
        content = await d.file.text();
      } catch {
        throw Error(
          'Cihaz dosyayı okuyamadı. Dosyalar uygulamasında indirilmiş olduğunu ve kullanılabilir alanı kontrol edin.',
        );
      }
      let raw;
      try {
        raw = JSON.parse(content);
      } catch {
        throw Error('Dosya geçerli bir proje JSON’u içermiyor.');
      }
      await importArchive(raw);
    },
    {
      intro:
        'Cihazınızdan, iCloud Drive veya bağlı dosya sağlayıcınızdan seçin. Önceden açılan bir projenin arşivi ayrı kopyaya alınır.',
    },
  );
}
function settings() {
  if (!p) {
    newProject();
    return;
  }
  form(
    'Proje ayarları',
    [
      { key: 'name', label: 'Proje adı', value: p.name, required: true, maxlength: 120, full: true },
      customerField(p.customer?.id),
      { key: 'newCustomer', label: 'Yeni müşterinin adı', full: true, maxlength: 120 },
      { key: 'surveyor', label: 'Rölöve sorumlusu', value: p.surveyorName || '', maxlength: 120 },
      { key: 'location', label: 'Konum veya proje kodu', value: p.location, full: true, maxlength: 180 },
      { key: 'unit', label: 'Görünen birim', choices: ['m', 'cm', 'mm'], value: p.unit },
      { key: 'tolerance', label: 'Kontrol toleransı (mm)', number: true, value: p.toleranceMm },
      {
        key: 'north',
        label: 'Planda kuzey açısı (°)',
        number: true,
        value: p.northAngle ?? '',
        hint: 'Üst yön 0°, sağ yön 90°. Ölçülmediyse boş bırakın.',
      },
      { key: 'pencilOnly', label: 'Parmak gezdirsin, kalem çizsin', type: 'check', value: s.pencilOnly },
      { key: 'leftHand', label: 'Kalem araçlarını sağa al', type: 'check', value: s.leftHand },
      { key: 'grid', label: 'Çizim ızgarasını göster', type: 'check', value: s.grid },
      { key: 'dims', label: 'Plan üzerinde ölçüleri göster', type: 'check', value: s.showDims },
    ],
    'Ayarları kaydet',
    async (d) => {
      const tol = readMm(d.tolerance, 'mm');
      if (tol < 0) throw Error('Tolerans negatif olamaz.');
      const north = String(d.north).trim() === '' ? null : Number(String(d.north).replace(',', '.'));
      if (north !== null && (!Number.isFinite(north) || north < 0 || north >= 360))
        throw Error('Kuzey açısı 0 ile 360° arasında olmalı.');
      const customer = await selectedCustomer(d);
      await change('Ayarlar kaydedildi', (q) =>
        Object.assign(q, {
          customer,
          surveyorName: d.surveyor.trim(),
          name: d.name.trim(),
          location: d.location.trim(),
          unit: d.unit,
          toleranceMm: tol,
          northAngle: north,
        }),
      );
      for (const k of ['grid', 'pencilOnly', 'leftHand', 'dims']) remember(k, !!d[k]);
      set({ grid: !!d.grid, pencilOnly: !!d.pencilOnly, leftHand: !!d.leftHand, showDims: !!d.dims });
    },
    { after: customerFields },
  );
}
function menu() {
  const options = [
    ['add-room', 'Mahal ekle', 'plus'],
    ['add-floor', 'Kat ekle', 'layers'],
    ['add-element', 'Kapı, pencere veya donatı', 'door'],
    ['add-zone', 'Tavan, asma kat veya boşluk', 'slab'],
    ['measure-form', 'Ölçü uçlarını listeden seç', 'dimension'],
    ['underlay', 'PDF veya görsel altlık', 'image'],
    ['section-manager', 'Proje kesitleri', 'section'],
    ['view-settings', 'Kesit, cephe ve 3B ayarları', 'cube'],
    ['duplicate-room', 'Mahali çoğalt / aynala', 'copy'],
    ['align-floor', 'Katları iki referansla hizala', 'layers'],
    ['new-branch', 'Ayrı çalışma sürümü oluştur', 'copy'],
    ['new-visit', 'Saha ziyareti aç', 'visit'],
    ['versions', 'Bulut sürüm geçmişi', 'clock'],
    ['archive-project', p.archived ? 'Arşivden geri al' : 'Projeyi arşivle', 'archive'],
    ['import', 'Proje arşivi aç', 'upload'],
    ['settings', 'Proje ayarları', 'settings'],
  ];
  if (failedDraft)
    options.unshift(
      ['rescue', 'Kaydedilemeyen taslağı indir', 'download'],
      ['reload-project', 'Güncel cihaz kaydını aç', 'refresh'],
    );
  showDialog(
    'Proje araçları',
    '<div class="menu-grid">' + options.map(([a, l, i]) => button(a, l, i, 'action-row')).join('') + '</div>',
  );
}
function selectCut(v) {
  closeDialog();
  remember('cut:' + p.id + ':' + v.floorId, v.id);
  set({
    floorId: v.floorId,
    mode: 'section',
    sectionId: v.id,
    sectionLine: { a: v.a, b: v.b },
    tool: 'select',
    draft: [],
    anchors: [],
    mobilePanel: '',
  });
}
function selectRoom(id) {
  const r = item(p.rooms, id);
  if (!r) return;
  set({ roomId: id, wallId: null, floorId: r.floorId, elementId: null, nodeId: null, mobilePanel: '' });
}
function activeElementHasTextInput() {
  return !!document.activeElement?.closest('input,textarea,select,[contenteditable=true]');
}
async function dispatch(act, id = '', el = null) {
  if (act === 'customers') {
    await refreshList();
    closeDialog();
    set({ page: 'customers', customerQuery: '', mobilePanel: '' });
    return;
  }
  if (act === 'new-customer') {
    form(
      'Yeni müşteri',
      [{ key: 'name', label: 'Müşteri veya firma adı', required: true, maxlength: 120, full: true }],
      'Müşteriyi kaydet',
      async (d) => {
        const c = await DB.createCustomer(d.name.trim());
        await refreshList();
        set({ page: 'projects', customerId: c.id, query: '', archived: false });
        notify('Müşteri kaydedildi.');
      },
    );
    return;
  }
  if (act === 'client-projects') {
    await refreshList();
    set({ page: 'projects', customerId: id, query: '', archived: false });
    return;
  }
  if (act === 'new-project') {
    await refreshList();
    newProject();
    return;
  }
  if (act === 'import') {
    importProject();
    return;
  }
  if (act === 'projects') {
    await refreshList();
    closeDialog();
    set({ page: 'projects', query: '', customerId: '', mobilePanel: '' });
    return;
  }
  if (act === 'open-project') {
    await selectProject(id);
    return;
  }
  if (act === 'editor') {
    if (p) {
      closeDialog();
      set({ page: 'editor' });
    } else newProject();
    return;
  }
  if (act === 'list-archived' || act === 'list-active') {
    set({ archived: act === 'list-archived' });
    return;
  }
  if (['cloud', 'cloud-sync', 'versions', 'team-login'].includes(act)) {
    const { storageAction } = await import('./storage/actions.js');
    await storageAction(act, id, ctx());
    return;
  }
  if (!p) {
    newProject();
    return;
  }
  const c = ctx();
  if (
    [
      'add-room',
      'edit-room',
      'room-height',
      'add-ceiling-zone',
      'add-beam-zone',
      'add-floor',
      'resize-wall',
      'wall-more',
      'wall-thickness',
      'add-element',
      'edit-element',
      'add-zone',
      'zone-info',
      'align-floor',
      'duplicate-room',
      'node-edit',
    ].includes(act)
  ) {
    const { geometryAction } = await import('./geometry/actions.js');
    await geometryAction(act, id, c);
    return;
  }
  if (['export', 'view-settings', 'underlay'].includes(act)) {
    const { viewAction } = await import('./views/actions.js');
    await viewAction(act, id, c);
    return;
  }
  switch (act) {
    case 'opening-detail': {
      const { openOpeningEditor } = await import('./openings/editor.js');
      await openOpeningEditor(c, id || s.elementId);
      break;
    }
    case 'section-manager':
      sectionList(c, showDialog);
      break;
    case 'section-new':
      closeDialog();
      set({ mode: 'plan', tool: 'sectionline', draft: [], anchors: [], mobilePanel: '' });
      break;
    case 'section-open': {
      const cut = item(p.sections, id);
      if (cut) selectCut(cut);
      break;
    }
    case 'section-edit':
      editSection(c, item(p.sections, id), form, selectCut);
      break;
    case 'section-delete': {
      const cut = item(p.sections, id);
      if (!cut) break;
      form(
        'Kesiti sil',
        [],
        'Kesiti sil',
        async () => {
          await c.change('Kesit silindi', (q) => {
            q.sections = q.sections.filter((v) => v.id !== id);
          });
          if (s.sectionId === id) {
            const other = (p.sections || []).find((v) => v.floorId === s.floorId);
            if (other) selectCut(other);
            else set({ sectionId: null, sectionLine: null });
          }
        },
        { intro: cut.name + ' proje kesitlerinden kaldırılacak.' },
      );
      break;
    }
    case 'section-openings':
      openingList(p, s, sectionOpenings(p, s), showDialog);
      break;
    case 'section-element': {
      const hit = sectionOpenings(p, s).find((v) => v.elementId === id);
      if (hit) {
        closeDialog();
        if (s.tool !== 'select') set({ tool: 'select', anchors: [] });
        await viewPick({ ...hit, sectionOpening: true });
      }
      break;
    }
    case 'more':
      menu();
      break;
    case 'rescue':
      if (failedDraft)
        downloadFile(
          new Blob([JSON.stringify(failedDraft)], { type: 'application/json' }),
          'Kurtarilan-taslak.roleve.json',
        );
      break;
    case 'reload-project':
      await selectProject(p.id);
      break;
    case 'new-branch':
      form(
        'Yeni çalışma sürümü',
        [{ key: 'name', label: 'Sürüm adı', value: p.name + ' · Revizyon', required: true, full: true }],
        'Kopyayı aç',
        async (d) => {
          const q = structuredClone(p);
          q.sourceProject = { id: q.id, revision: q.updatedAt };
          q.id = uid();
          q.name = d.name.trim();
          q.createdAt = new Date().toISOString();
          q.archived = false;
          await createNew(q);
        },
      );
      break;
    case 'archive-project':
      form(
        p.archived ? 'Projeyi geri al' : 'Projeyi arşivle',
        [],
        p.archived ? 'Geri al' : 'Arşivle',
        async () => {
          await change('Proje durumu güncellendi', (q) => (q.archived = !q.archived));
          await refreshList();
          set({ page: 'projects', archived: p.archived });
        },
        { intro: p.name + ' projesi proje listesindeki ilgili sekmeye taşınacak.' },
      );
      break;
    case 'settings':
      await refreshList();
      settings();
      break;
    case 'room':
      selectRoom(id);
      break;
    case 'wall':
      set({ wallId: id, elementId: null, nodeId: null });
      break;
    case 'element':
      pickElement(id);
      await dispatch('edit-element', id);
      break;
    case 'face':
      set({ mode: 'elevation', mobilePanel: '', tool: 'select' });
      break;
    case 'view':
      set({ mode: el.dataset.mode, mobilePanel: '', tool: 'select', draft: [], anchors: [] });
      break;
    case 'close-panel':
      set({ mobilePanel: '' });
      break;
    case 'vertical-checks':
      openVerticalChecks(p,s);
      break;
    case 'vertical-fix-room':
    case 'vertical-fix-zone':
    case 'vertical-fix-wall':
    case 'vertical-fix-element': {
      const zone=act==='vertical-fix-zone' && item(p.zones,id);
      const obj=act==='vertical-fix-element' && item(p.elements,id);
      const wall=act==='vertical-fix-wall' && item(p.walls,id);
      const target=item(p.rooms,el?.dataset.roomId || zone?.roomId || obj?.roomId || id);
      if (!target || target.floorId!==s.floorId || (obj && !target.wallIds.includes(obj.wallId)) ||
          (wall && !target.wallIds.includes(wall.id))) break;
      closeDialog();
      set({roomId:target.id, mode:obj||wall?'elevation':zone?'ceiling':s.mode, wallId:obj?.wallId||wall?.id||null,
        elementId:obj?.id||null,zoneId:zone?.id||null,side:'inside',tool:'select',anchors:[],draft:[],mobilePanel:''});
      await dispatch(obj?'edit-element':zone?'zone-info':wall?'wall-thickness':'room-height',id);
      break;
    }
    case 'vertical-details':
      openVerticalDetails(p,s);
      break;
    case 'flip-wall-face':
      closeDialog();
      set({side:s.side==='outside'?'inside':'outside',tool:'select',anchors:[],elementId:null});
      break;
    case 'shared-wall-room': {
      const next=item(p.rooms,id);
      if (next?.wallIds.includes(s.wallId)) {
        closeDialog();
        set({roomId:next.id,wallId:s.wallId,side:'inside',mode:'elevation',tool:'select',anchors:[],elementId:null,mobilePanel:''});
      }
      break;
    }
    case 'rooms-panel':
      set({ mobilePanel: 'rooms' });
      break;
    case 'detail-panel':
      set({ mobilePanel: 'detail' });
      break;
    case 'tool':
      if (s.mode === 'elevation' && ['ink', 'erase'].includes(el.dataset.tool) && !faceFrame(p, s))
        throw Error('Önce bir mahal ve duvar seçin.');
      set({
        tool: el.dataset.tool,
        draft: [],
        anchors: [],
        roomDraft: null,
        zoneDraft: null,
        mobilePanel: '',
      });
      break;
    case 'ink-settings':
      form(
        'Eskiz kalemleri',
        [
          { key: 'brush', label: 'Kalem türü', choices: inkBrushes, value: s.ink.brush },
          { key: 'shape', label: 'Çizim biçimi', choices: inkShapes, value: s.ink.shape },
          { key: 'color', label: 'Renk', choices: inkColors, value: s.ink.color },
          {
            key: 'width',
            label: 'Plan / görünüşte iz kalınlığı',
            choices: [
              [10, 'İnce'],
              [25, 'Orta'],
              [55, 'Kalın'],
              [90, 'Çok kalın'],
            ],
            value: s.ink.width,
          },
        ],
        'Kalemi kullan',
        (d) => {
          const settings = inkSettings(d);
          remember('ink', settings);
          set({ ink: settings, tool: 'ink' });
        },
        {
          intro:
            s.mode === 'elevation'
              ? 'Çizim bu mahaldeki seçili duvar yüzüne kaydedilir.'
              : 'Çizim bu katın eskiz katmanına kaydedilir.',
        },
      );
      break;
    case 'ink-mode':
      closeDialog();
      set({ mode: 'plan', tool: 'ink' });
      break;
    case 'zoom-in':
      zoom(1 / 1.22);
      break;
    case 'zoom-out':
      zoom(1.22);
      break;
    case 'rotate-left':
    case 'rotate-right':
      box = null;
      set({ yaw: (((s.yaw + (act === 'rotate-left' ? -15 : 15)) % 360) + 360) % 360 });
      break;
    case 'fit':
      if (baseBox) applyBox({ ...baseBox });
      break;
    case 'undo':
      await historyAction(false);
      break;
    case 'redo':
      await historyAction(true);
      break;
    case 'measurements':
      measurementList(c);
      break;
    case 'measure-form':
      observationForm(c, s.anchors[0] || null);
      break;
    case 'observation':
      showObservation(id);
      break;
    case 'repeat-obs': {
      const o = item(p.observations, id);
      if (o?.purpose === 'room-ceiling' && item(p.rooms,o.roomId)) await dispatch('room-height',o.roomId);
      else if (o) observationForm(c, o.a, o.b, o);
      break;
    }
    case 'chain':
      chainForm(c);
      break;
    case 'visits':
      visits(c);
      break;
    case 'new-visit':
      newVisit(c);
      break;
    case 'end-visit':
      form(
        'Saha ziyaretini bitir',
        [],
        'Ziyareti kapat',
        async () => {
          await change('Ziyaret kaydedildi', (q) => {
            const v = item(q.visits, id);
            if (!v) throw Error('Ziyaret bulunamadı.');
            Object.assign(v, {
              status: 'done',
              end: new Date().toISOString(),
              openNotes: q.notes.filter((n) => n.status !== 'done').length,
              measurementCount: q.observations.filter((o) => o.visitId === id).length,
            });
          });
        },
        {
          intro: `${G.projectChecks(p).filter((x) => x.kind !== 'note').length} geometri kontrolü ve ${p.notes.filter((n) => n.status !== 'done').length} açık not bulunuyor. Bunlar bir sonraki ziyaret için korunur.`,
        },
      );
      break;
    case 'checks':
      checks(c);
      break;
    case 'check-item': {
      const x = G.projectChecks(p).find((v) => v.id === id);
      if (x) {
        const r = item(p.rooms, x.roomId);
        closeDialog();
        set({
          floorId: r?.floorId || s.floorId,
          roomId: x.roomId || s.roomId,
          wallId: x.wallId || null,
          mode: 'plan',
          mobilePanel: matchMedia('(max-width:980px)').matches ? 'detail' : '',
        });
        notify(x.message);
      }
      break;
    }
    case 'notebook':
      notebook(c);
      break;
    case 'camera':
      showDialog(
        'Saha fotoğrafı',
        '<div class="menu-grid">' +
          button('place-photo', 'Planda çekim yerini ve bakış yönünü seç', 'pin', 'action-row') +
          button('place-exterior', 'Yapı dışından cephe veya çevre çekimi', 'home', 'action-row') +
          button('photo-now', 'Seçili mahalde fotoğraf çek veya ekle', 'camera', 'action-row') +
          '</div>',
      );
      break;
    case 'photo-now':
      noteForm(c, null, null, {
        photoFirst: true,
        surface:
          s.mode === 'ceiling'
            ? 'ceiling'
            : s.mode === 'facade'
              ? 'facade'
              : wall() || s.mode === 'elevation'
                ? 'wall'
                : 'general',
      });
      break;
    case 'place-exterior':
    case 'place-photo': {
      const note = item(p.notes, id);
      closeDialog();
      set({
        floorId: note?.floorId || s.floorId,
        mode: 'plan',
        tool: 'photoLocate',
        draft: [],
        anchors: [],
        photoContext: {
          noteId: id || null,
          scene: act === 'place-exterior' ? 'exterior' : null,
        },
        mobilePanel: '',
      });
      break;
    }
    case 'photo-edit': {
      const { openPhotoEditor } = await import('./photo/editor.js');
      await openPhotoEditor(ctx(), id);
      break;
    }
    case 'original-photo': {
      const n = item(p.notes, id);
      if (n?.photo) {
        const f = n.photo.original || n.photo;
        const data = await (await fetch(f.data)).blob();
        downloadFile(data, f.name || 'Saha-fotografi');
      }
      break;
    }
    case 'pin-note':
      closeDialog();
      set({ mode: 'plan', tool: 'notePin', notePinId: id || null, anchors: [], draft: [], mobilePanel: '' });
      break;
    case 'go-note': {
      const n = item(p.notes, id);
      if (n) {
        closeDialog();
        set({
          floorId: n.floorId,
          roomId: n.roomId,
          wallId: n.wallId,
          mode: 'plan',
          tool: 'select',
          mobilePanel: '',
        });
        if (n.anchor && box) {
          const a = n.anchor;
          applyBox({ ...box, x: a.x - box.w / 2, y: a.y - box.h / 2 });
        }
      }
      break;
    }
    case 'note-info':
      noteForm(c, item(p.notes, id));
      break;
    case 'add-note':
      noteForm(c);
      break;
    case 'exit-tool':
      set({ tool: 'select', draft: [], anchors: [], roomDraft: null, zoneDraft: null });
      break;
    case 'pop-point':
      if (s.tool === 'measure') s.anchors.pop();
      else s.draft.pop();
      rememberDraft();
      renderDraft();
      break;
    case 'finish-polygon':
      finishPolygon();
      break;
    case 'add-coordinate':
      form(
        'Köşe koordinatı',
        [
          { key: 'x', label: `X (${p.unit})`, value: fmt(s.draft.at(-1)?.x ?? 0, p.unit), number: true },
          { key: 'y', label: `Y (${p.unit})`, value: fmt(s.draft.at(-1)?.y ?? 0, p.unit), number: true },
        ],
        'Köşeyi ekle',
        (d) => addDraft({ x: readMm(d.x, p.unit), y: readMm(d.y, p.unit) }),
      );
      break;
  }
}
document.addEventListener(
  'click',
  guard(async (e) => {
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled) {
      await dispatch(el.dataset.act, el.dataset.id || '', el);
    }
  }),
);
document.addEventListener(
  'keydown',
  guard(async (e) => {
    if (dlg().open || activeElementHasTextInput() || !p) return;
    const pin = document.activeElement?.closest('[data-note]');
    if (pin && ['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      const n = item(p.notes, pin.dataset.note);
      if (n?.photo) await dispatch('photo-edit', n.id);
      else if (n) noteForm(ctx(), n);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      await historyAction(e.shiftKey);
      return;
    }
    if (e.key === 'Escape') {
      set({ tool: 'select', anchors: [], draft: [], mobilePanel: '' });
      return;
    }
    if (s.page !== 'editor' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') {
      zoom(1 / 1.22);
      return;
    }
    if (e.key === '-') {
      zoom(1.22);
      return;
    }
    if (e.key.toLowerCase() === 'v') set({ tool: 'select' });
    if (e.key.toLowerCase() === 'm') set({ tool: 'measure', anchors: [] });
    if (e.key.toLowerCase() === 'n') noteForm(ctx());
  }),
);
window.addEventListener(
  'roleve:cloud',
  guard((e) => cloudChange(e.detail?.id)),
);
window.addEventListener(
  'roleve:account',
  guard(async () => {
    refreshAfterDialog = null;
    closeDialog();
    await refreshProject(p?.id);
  }),
);
dlg().addEventListener(
  'close',
  guard(async () => {
    const id = refreshAfterDialog;
    refreshAfterDialog = null;
    if (id) await cloudChange(id);
  }),
);
async function start() {
  await refreshList();
  const last =
    projects.find((q) => q.id === pref('last', null) && !q.archived) || projects.find((q) => !q.archived);
  if (last) {
    setupProject(last, true);
    s.sync = await DB.getSyncState(last.id);
  } else if (!projects.length) {
    const q = sampleProject();
    const saved = await DB.saveProject(q, { expectedUpdatedAt: null });
    setupProject(saved);
    s.sync = await DB.getSyncState(saved.id);
    await refreshList();
  } else {
    s.page = 'projects';
    s.archived = true;
  }
  render();
  if (location.hash === '#ekip' && location.hostname.endsWith('-8794.app.github.dev')) {
    await dispatch('team-login');
  }
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register('./sw.js', { scope: './', updateViaCache: 'none' })
      .catch(() => notify('Çevrimdışı açılış hazırlanamadı. Bağlantıyı kontrol edin.'));
  }
}
start().catch((e) => {
  shell.innerHTML = `<main class="library"><h1>Rölöve Saha</h1><p class="info-line">${esc(e.message)}</p><button class="secondary" onclick="location.reload()">Yeniden aç</button></main>`;
});
