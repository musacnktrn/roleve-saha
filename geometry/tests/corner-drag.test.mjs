/* [codex] ureten: codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { draggedCorner } from '../../ui/corner-drag.js';
import { beginCornerDrag } from '../../ui/corner-drag.js';
import { createProject, addRoom, addAdjacentRoom, templatePoints } from '../core.js';

test('Dönüşümlü planda tutuş ofseti ve ölçülmüş kesirli köşe korunur', () => {
  const origin = { x: 103.125, y: -85.75 },
    grab = { x: 115.45, y: -41.125 };
  assert.deepEqual(draggedCorner(origin, grab, grab), origin);
  const p = draggedCorner(origin, grab, { x: 252.55, y: 41.125 });
  assert.ok(Math.abs(p.x - 240.225) < 1e-10);
  assert.equal(p.y, -3.5);
});

test('Canlı önizleme iki komşu mahal ve bağlantılı tüm duvarları değiştirir, iptal tam geri alır', () => {
  const p = createProject(),
    r = addRoom(p, { points: templatePoints('rect', 4300, 3500) });
  addAdjacentRoom(p, { roomId: r.id, wallId: r.wallIds[1], depth: 1200 });
  const id = r.nodeIds[1],
    n = p.nodes.find((v) => v.id === id);
  class Element {
    constructor(tag, idKey, id, values = {}) {
      this.tagName = tag;
      this.dataset = { [idKey]: id };
      this.attrs = { ...values };
    }
    hasAttribute(k) {
      return Object.hasOwn(this.attrs, k);
    }
    getAttribute(k) {
      return this.hasAttribute(k) ? this.attrs[k] : null;
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    }
    removeAttribute(k) {
      delete this.attrs[k];
    }
    querySelectorAll() {
      return [];
    }
  }
  const handle = new Element('circle', 'node', id, { cx: String(n.x), cy: String(n.y) });
  const rooms = p.rooms.map(
    (room, i) => new Element('polygon', 'room', room.id, { points: 'original-' + i }),
  );
  const walls = p.walls.map((wall, i) => new Element('path', 'wall', wall.id, { d: 'original-' + i }));
  const svg = {
    querySelectorAll(sel) {
      if (sel === '[data-node]') return [handle];
      return sel.startsWith('.room') ? rooms : walls;
    },
  };
  const original = JSON.stringify(p),
    preview = beginCornerDrag(svg, p, id);
  preview.show({ x: 5010, y: 125 });
  assert.equal(handle.getAttribute('cx'), '5010');
  assert.equal(handle.getAttribute('cy'), '125');
  assert.ok(rooms.every((el) => el.getAttribute('points').includes('5010,125')));
  assert.deepEqual(
    walls.map((el) => !el.getAttribute('d').startsWith('original')),
    p.walls.map((w) => w.a === id || w.b === id),
  );
  assert.equal(JSON.stringify(p), original);
  preview.restore();
  preview.restore();
  assert.equal(handle.getAttribute('cx'), String(n.x));
  assert.ok(
    [...rooms, ...walls].every((el) =>
      (el.getAttribute('points') || el.getAttribute('d')).startsWith('original'),
    ),
  );
});

// The macOS integration runs the production plan and pointer handlers inside WKWebView.
// Inputs are DOM PointerEvents with the named pointerType. Physical iPad/Pencil acceptance is separate.
async function browserSuite(mods) {
  const { wireCanvas, asWorld, createProject, addRoom, addAdjacentRoom, templatePoints, planMarkup } = mods;
  const checks = [];
  function expect(value, text) {
    if (!value) throw Error(text);
  }
  const near = (a, b) => a && b && Math.hypot(a.x - b.x, a.y - b.y) < 0.001;
  function fixture(tool = 'select', pencilOnly = false) {
    document.body.replaceChildren();
    const p = createProject('Saha');
    const room = addRoom(p, {
      name: 'Salon',
      points: templatePoints('rect', 360, 230, { x: 100.25, y: 90.5 }),
    });
    addAdjacentRoom(p, { roomId: room.id, wallId: room.wallIds[1], depth: 140, name: 'Hol' });
    const nodeId = room.nodeIds[1],
      node = p.nodes.find((n) => n.id === nodeId);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    let box = { x: 0, y: 0, w: 800, h: 550 },
      anchor = null;
    const log = { taps: [], moves: [], preview: [], photo: [], ink: [], pan: [] };
    svg.setAttribute('viewBox', '0 0 800 550');
    svg.innerHTML = planMarkup(p, { floorId: room.floorId, roomId: room.id, showDims: false }).html;
    const target = svg.querySelector('[data-node="' + nodeId + '"]');
    const zone = document.createElementNS(svg.namespaceURI, 'rect');
    for (const [k, v] of Object.entries({
      x: 500,
      y: 270,
      width: 220,
      height: 150,
      fill: '#ffe',
      'data-room': 'view-target',
    }))
      zone.setAttribute(k, v);
    svg.append(zone);
    wireCanvas(svg, {
      getProject: () => p,
      getPhotoStart: () => anchor,
      getTool: () => tool,
      getBox: () => box,
      pencilOnly: () => pencilOnly,
      setBox: (newBox) => {
        log.pan.push(newBox);
        box = newBox;
        svg.setAttribute('viewBox', [box.x, box.y, box.w, box.h].join(' '));
      },
      onZoom: () => {},
      onTap: (v, t) => {
        log.taps.push({ v, t });
        if (tool === 'photoLocate') anchor = anchor ? null : v;
      },
      onDragNode: (id, v) => log.moves.push({ id, v }),
      onInk: (points) => log.ink.push(points),
      onPhotoPreview: (a, b) => log.preview.push([a, b]),
      onPhotoDrag: (a, at, b, bt) => log.photo.push({ a, at, b, bt }),
    });
    const client = (pt) => new DOMPoint(pt.x, pt.y).matrixTransform(svg.getScreenCTM());
    function fire(name, kind, id, point, element = svg, button = 0) {
      const up = name === 'pointerup' || name === 'pointercancel' || name === 'pointerleave';
      const e = new PointerEvent(name, {
        bubbles: true,
        cancelable: true,
        pointerId: id,
        pointerType: kind,
        button,
        buttons: up ? 0 : 1,
        pressure: kind === 'pen' ? 0.65 : 0,
        clientX: point.x,
        clientY: point.y,
      });
      element.dispatchEvent(e);
      return asWorld(svg, e.clientX, e.clientY, false);
    }
    const roomPaths = () =>
      [...svg.querySelectorAll('polygon.room')].map((el) => el.getAttribute('points'));
    return { p, room, nodeId, node, svg, target, log, client, fire, roomPaths, getAnchor: () => anchor };
  }
  for (const kind of ['touch', 'pen', 'mouse']) {
    const f = fixture('select', true),
      origin = { x: f.node.x, y: f.node.y };
    const start = f.client(origin),
      grab = { x: start.x + 8, y: start.y + 3 },
      end = { x: grab.x + 25, y: grab.y + 16 };
    const outline = f.roomPaths(),
      db = JSON.stringify(f.p);
    const from = f.fire('pointerdown', kind, 1, grab, f.target),
      moved = f.fire('pointermove', kind, 1, end);
    expect(
      f.roomPaths().every((v, i) => v !== outline[i]),
      kind + ' iki oda hareket etmedi.',
    );
    const handle = f.target.matches('circle') ? f.target : f.target.querySelector('.node-handle');
    const center = new DOMPoint(handle.cx.baseVal.value, handle.cy.baseVal.value)
      .matrixTransform(handle.getScreenCTM())
      .matrixTransform(f.svg.getScreenCTM().inverse());
    expect(
      near(center, { x: origin.x + moved.x - from.x, y: origin.y + moved.y - from.y }),
      'Canlı tutamaç ile tahmini köşe ayrıldı.',
    );
    expect(f.log.moves.length === 0 && JSON.stringify(f.p) === db, 'Önizleme kalıcı kayda dokundu.');
    const to = f.fire('pointerup', kind, 1, end);
    f.fire('pointerup', kind, 1, end);
    expect(
      f.log.moves.length === 1 &&
        f.log.moves[0].id === f.nodeId &&
        near(f.log.moves[0].v, { x: origin.x + to.x - from.x, y: origin.y + to.y - from.y }),
      kind + ' tutuş atladı veya birden çok kez kaydetti.',
    );
    expect(
      f.roomPaths().every((v, i) => v === outline[i]),
      'Önizleme temizlenmedi.',
    );
    f.fire('pointerdown', kind, 2, start, f.target);
    f.fire('pointerup', kind, 2, start);
    expect(
      f.log.taps.length === 1 && f.log.taps[0].t.node === f.nodeId && f.log.moves.length === 1,
      'Dokunma sürüklemeye dönüştü.',
    );
    checks.push(kind + ' ile ofsetli tutuş, iki odalı canlı önizleme, tek bırakış ve dokunarak seçim.');
  }
  for (const name of ['pointercancel', 'lostpointercapture']) {
    const f = fixture(),
      a = f.client(f.node),
      b = { x: a.x + 38, y: a.y + 13 },
      before = f.roomPaths();
    f.fire('pointerdown', 'touch', 1, a, f.target);
    f.fire('pointermove', 'touch', 1, b);
    f.fire(name, 'touch', 1, b);
    f.fire('pointerup', 'touch', 1, b);
    expect(
      !f.log.moves.length && !f.log.taps.length && JSON.stringify(before) === JSON.stringify(f.roomPaths()),
      name + ' sonrası kayıt kaldı.',
    );
    checks.push(name + ' ile köşe önizlemesi ve kayıt iptal edildi.');
  }
  {
    const f = fixture(),
      a = f.client(f.node),
      b = { x: a.x + 30, y: a.y + 15 },
      c = { x: a.x + 65, y: a.y + 6 },
      before = f.roomPaths();
    f.fire('pointerdown', 'touch', 1, a, f.target);
    f.fire('pointermove', 'touch', 1, b);
    f.fire('pointerdown', 'touch', 2, c);
    f.fire('pointermove', 'touch', 2, { x: c.x + 35, y: c.y + 7 });
    f.fire('pointerdown', 'touch', 3, c);
    f.fire('pointerup', 'touch', 3, c);
    f.fire('pointerup', 'touch', 1, b);
    f.fire('pointerup', 'touch', 2, c);
    expect(
      f.log.pan.length &&
        !f.log.moves.length &&
        !f.log.taps.length &&
        JSON.stringify(before) === JSON.stringify(f.roomPaths()),
      'Yakınlaştırma köşeyi kaydetti.',
    );
    checks.push('İkinci parmak sürüklemeyi yakınlaştırmaya çevirdi, üçüncü temas köşe kaydetmedi.');
  }
  {
    const f = fixture(),
      a = f.client(f.node),
      b = { x: a.x + 30, y: a.y + 5 };
    f.fire('pointerdown', 'pen', 1, a, f.target);
    f.fire('pointerdown', 'touch', 2, b);
    f.fire('pointermove', 'pen', 1, b);
    f.fire('pointerup', 'touch', 2, b);
    f.fire('pointerup', 'pen', 1, b);
    expect(f.log.moves.length === 1 && !f.log.pan.length, 'Avuç kalem sürüklemesini kesti.');
    checks.push('Kalem sürüklemesindeki avuç teması yok sayıldı.');
  }
  {
    const f = fixture('select', true),
      a = f.client({ x: 300, y: 160 }),
      b = { x: a.x + 25, y: a.y + 12 };
    f.fire('pointerdown', 'touch', 1, a);
    f.fire('pointermove', 'touch', 1, b);
    f.fire('pointerup', 'touch', 1, b);
    expect(
      f.log.pan.length && !f.log.moves.length && !f.log.taps.length,
      'Kalem tercihiyle boş alan parmak kaydırmasını korumadı.',
    );
    checks.push('Kalem tercihi etkinken boş alandaki parmak planı kaydırdı.');
  }
  {
    const f = fixture(),
      a = f.client(f.node),
      b = { x: a.x + 32, y: a.y + 16 };
    f.fire('pointerdown', 'mouse', 1, a, f.target);
    f.fire('pointerup', 'mouse', 1, b);
    expect(
      f.log.moves.length === 1 && !f.log.taps.length,
      'Birleşen pointermove olayı olmayan bırakış dokunmaya dönüştü.',
    );
    checks.push('Ara hareket olayı birleştiğinde son bırakış koordinatı köşeyi bir kez kaydetti.');
  }
  {
    const f = fixture('photoLocate', true),
      a = f.client(f.node),
      b = f.client({ x: 575, y: 330 });
    f.fire('pointerdown', 'touch', 11, a, f.target);
    f.fire('pointerup', 'touch', 11, a);
    const origin = f.getAnchor();
    expect(origin, 'Kalem tercihinde parmak fotoğraf konumunu seçemedi.');
    for (const kind of ['pen', 'mouse']) {
      f.fire('pointermove', kind, 9, b);
      const last = f.log.preview.at(-1);
      expect(near(last[0], origin) && !!last[1], 'İlk noktadan hover yönü eksik.');
      f.fire('pointerleave', kind, 9, b);
      expect(
        f.log.preview.at(-1).every((v) => v === null),
        'Hover temizlenmedi.',
      );
    }
    f.fire('pointerdown', 'touch', 12, { x: b.x - 30, y: b.y - 20 });
    f.fire('pointermove', 'touch', 12, b);
    expect(near(f.log.preview.at(-1)[0], origin), 'Parmak hedefine sürüklerken ilk konum değişti.');
    f.fire('pointerup', 'touch', 12, b);
    expect(
      f.log.taps.length === 2 && f.log.taps[1].t.room === 'view-target' && !f.log.photo.length,
      'İkinci seçim hedef yerine yeni başlangıç açtı.',
    );
    checks.push(
      'Fotoğraf konumu parmakla seçildi, fare/kalem hover ve parmak sürüklemesi ilk konumdan hedefi gösterdi.',
    );
  }
  {
    const f = fixture('photoLocate', true),
      a = f.client(f.node),
      b = f.client({ x: 580, y: 330 });
    f.fire('pointerdown', 'touch', 1, a, f.target);
    f.fire('pointermove', 'touch', 1, b);
    const pair = f.log.preview.at(-1);
    expect(pair.every(Boolean), 'Tek harekette fotoğraf yönü görünmedi.');
    f.fire('pointerup', 'touch', 1, b);
    expect(
      f.log.photo.length === 1 &&
        !f.log.taps.length &&
        f.log.photo[0].at.node === f.nodeId &&
        f.log.photo[0].bt.room === 'view-target',
      'Tek harekette fotoğraf konum/hedef bağı eksik.',
    );
    expect(
      near(f.log.photo[0].a, pair[0]) && near(f.log.photo[0].b, pair[1]),
      'Önizleme ve fotoğraf uçları farklı.',
    );
    checks.push(
      'Tek parmak hareketi fotoğrafın konumunu, bakış yönünü ve gerçek bırakış hedefini kaydetti.',
    );
  }
  {
    const f = fixture('photoLocate', true),
      a = f.client(f.node),
      b = f.client({ x: 580, y: 330 }),
      target = f.svg.querySelector('[data-room="view-target"]');
    f.fire('pointerdown', 'touch', 1, a, f.target);
    f.fire('pointerup', 'touch', 1, a);
    f.fire('pointerdown', 'touch', 2, b, target);
    f.fire('pointerup', 'touch', 2, b);
    expect(
      f.log.taps.length === 2 &&
        f.log.taps[0].t.node === f.nodeId &&
        f.log.taps[1].t.room === 'view-target' &&
        !f.log.photo.length &&
        !f.getAnchor(),
      'İki bağımsız dokunuş kamerayı tamamlamadı.',
    );
    checks.push('İki ayrı parmak dokunuşu önce konumu, sonra bakış hedefini seçti.');
  }
  for (const cancel of ['pointercancel', 'lostpointercapture', 'pinch']) {
    const f = fixture('photoLocate'),
      a = f.client(f.node),
      b = f.client({ x: 575, y: 330 });
    f.fire('pointerdown', 'touch', 1, a, f.target);
    f.fire('pointermove', 'touch', 1, b);
    if (cancel === 'pinch') f.fire('pointerdown', 'touch', 2, b);
    else f.fire(cancel, 'touch', 1, b);
    f.fire('pointerup', 'touch', 1, b);
    if (cancel === 'pinch') f.fire('pointerup', 'touch', 2, b);
    expect(
      !f.log.photo.length && !f.log.taps.length && f.log.preview.at(-1).every((v) => v === null),
      'Fotoğrafta iptal edilen harekette kayıt kaldı.',
    );
    checks.push(cancel + ' ile yarım fotoğraf vektörü kayda düşmedi.');
  }
  {
    const f = fixture('ink', true),
      a = f.client(f.node),
      b = f.client({ x: 500, y: 200 });
    f.fire('pointerdown', 'touch', 1, a);
    f.fire('pointermove', 'touch', 1, b);
    f.fire('pointerup', 'touch', 1, b);
    expect(f.log.pan.length && !f.log.ink.length, 'Kalem aracında parmakla kaydırma tercihi değişti.');
    f.fire('pointerdown', 'pen', 2, a);
    f.fire('pointermove', 'pen', 2, b);
    f.fire('pointerup', 'pen', 2, b);
    expect(f.log.ink.length === 1, 'Kalem aracı çizmedi.');
    checks.push('Kalem aracında parmak gezinme ve kalem çizme tercihi korundu.');
  }
  return checks;
}

const root = fileURLToPath(new URL('../../', import.meta.url)),
  run = promisify(execFile);
test(
  'macOS WebKit üzerinde gerçek SVG planı ve PointerEvent senaryoları',
  { skip: process.platform !== 'darwin', timeout: 95000 },
  async (t) => {
    const html =
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%}body>svg{display:block;width:100%;height:100%;touch-action:none}.plan-lens{position:absolute;pointer-events:none}</style><script type="module">' +
      'import {wireCanvas,asWorld} from "/ui/gestures.js";import {createProject,addRoom,addAdjacentRoom,templatePoints} from "/geometry/core.js";import {planMarkup} from "/ui/plan.js";' +
      'try{const checks=await (' +
      browserSuite.toString() +
      ')({wireCanvas,asWorld,createProject,addRoom,addAdjacentRoom,templatePoints,planMarkup});webkit.messageHandlers.done.postMessage(JSON.stringify({ok:true,width:innerWidth,height:innerHeight,checks}));}catch(e){webkit.messageHandlers.done.postMessage(JSON.stringify({ok:false,error:e.message,stack:e.stack}));}</script><body></body>';
    const scratch = await mkdtemp(path.join(tmpdir(), 'roleve-corner-')),
      program = path.join(scratch, 'webkit');
    const server = createServer(async (req, res) => {
      if (req.url === '/test') {
        res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
        res.end(html);
        return;
      }
      const rel = new URL(req.url, 'http://localhost').pathname;
      if (!/^\/(?:ui|geometry|openings|photo|views)\/[a-z0-9_/-]+\.js$/i.test(rel)) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const file = await readFile(path.join(root, rel));
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(file);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    try {
      await run(
        'swiftc',
        [
          path.join(root, 'geometry/tests/WebKitRunner.swift'),
          '-o',
          program,
          '-framework',
          'WebKit',
          '-framework',
          'AppKit',
        ],
        { timeout: 40000 },
      );
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      for (const [width, height] of [
        [1024, 768],
        [390, 844],
      ]) {
        await t.test(width + ' × ' + height, async (t) => {
          let text;
          try {
            ({ stdout: text } = await run(
              program,
              ['http://127.0.0.1:' + server.address().port + '/test', String(width), String(height)],
              { timeout: 35000 },
            ));
          } catch (e) {
            throw Error((e.stdout || '') + ' ' + (e.stderr || e.message));
          }
          const result = JSON.parse(text);
          assert.equal(result.ok, true);
          assert.equal(result.width, width);
          assert.equal(result.height, height);
          assert.equal(result.checks.length, 16);
          for (const item of result.checks) t.diagnostic(item);
        });
      }
    } finally {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
