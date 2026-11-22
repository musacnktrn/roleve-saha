/* Synthetic projects only. Test bridge serves modules at two isolated IndexedDB names. */
export async function run(config) {
  const a = await import('/device-a/storage/store.js');
  const b = await import('/device-b/storage/store.js');
  const checks = [];
  const test = async (phase, name, fn) => {
    const start = performance.now();
    await fn();
    checks.push({ phase, name, ms: Math.round(performance.now() - start) });
  };
  const is = (ok, label) => {
    if (!ok) throw Error(label);
  };
  const code = async (op, expected) => {
    try {
      await op();
    } catch (e) {
      is(e.code === expected, 'expected ' + expected + ', got ' + e.code);
      return;
    }
    throw Error('missing ' + expected);
  };
  const project = {
    id: 'test-plan',
    schemaVersion: 1,
    name: 'Saha Testi',
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
    unit: 'm',
    archived: false,
    toleranceMm: 10,
    floors: [{ id: 'f', name: 'Zemin', elevation: 0 }],
    nodes: [
      { id: 'a', floorId: 'f', x: 0, y: 0 },
      { id: 'b', floorId: 'f', x: 4000, y: 0 },
    ],
    walls: [{ id: 'w', floorId: 'f', a: 'a', b: 'b', thickness: 150 }],
    rooms: [],
    elements: [],
    zones: [],
    observations: [],
    notes: [],
    visits: [],
    strokes: [],
    underlays: [],
  };
  const id = project.id;
  const login = (store, username = 'mimar') =>
    store.loginCloud({ url: location.origin, username, password: config.password });
  let before;
  await test('Ü1', 'Cihazda ilk kayıt, yeniden açma ve başka pencerenin eski kaydını reddetme', async () => {
    await a.saveProject(project, { expectedUpdatedAt: null });
    before = await a.loadProject(id);
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    document.body.append(frame);
    // Independent module realm, same origin, same IndexedDB, as with a second tab.
    const other = await frame.contentWindow.Function("return import('/device-a/storage/store.js')")();
    const stale = await other.loadProject(id);
    await a.saveProject({ ...before, name: 'Saha Testi 2' });
    await code(() => other.saveProject({ ...stale, name: 'Önceki ad' }), 'STALE_LOCAL');
    is((await other.loadProject(id)).name === 'Saha Testi 2', 'reopen');
    is((await b.listProjects()).length === 0, 'second device isolation');
    frame.remove();
  });
  await test('Ü1', 'Tarayıcı yazımı hata verirse proje ve durumu değişmez', async () => {
    const current = await a.loadProject(id);
    const orig = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function () {
        throw new DOMException('storage full', 'QuotaExceededError');
      };
      let failed = false;
      try {
        await a.saveProject({ ...current, name: 'Kayıp' });
      } catch (e) {
        failed = e.name === 'QuotaExceededError';
      }
      is(failed, 'quota');
    } finally {
      IDBObjectStore.prototype.put = orig;
    }
    is((await a.loadProject(id)).name === current.name, 'atomic rollback');
  });
  await test('Ü4', 'İki bağımsız cihaz deposu aynı özel projeyi açar', async () => {
    await login(a);
    await login(b);
    const first = await a.syncProject(id);
    const other = await b.syncProject(id);
    is(first.revision === 1 && other.revision === 1 && other.project.name === 'Saha Testi 2', 'first sync');
  });
  await test(
    'Ü4',
    'Ayrı cihazların kesitleri eski kesitsiz ve boş listeli iki projede de birleşir',
    async () => {
      const { validateSections } = await import('/device-a/ui/sections.js');
      const { equal, mergeProjects } = await import('/device-a/storage/merge.js');
      const first = {
        id: 'cut-aa',
        name: 'Boy kesiti',
        floorId: 'f',
        a: { x: 0, y: 10 },
        b: { x: 3000, y: 10 },
      };
      const second = {
        id: 'cut-bb',
        name: 'En kesiti',
        floorId: 'f',
        a: { x: 20, y: -100 },
        b: { x: 20, y: 2900 },
      };
      for (const legacy of [true, false]) {
        const pid = legacy ? 'kesitsiz-eski' : 'kesit-listeli',
          base = { ...project, id: pid };
        if (!legacy) base.sections = [];
        await a.saveProject(base, { expectedUpdatedAt: null });
        await a.syncProject(pid);
        await b.syncProject(pid);
        const [pa, pb] = await Promise.all([a.loadProject(pid), b.loadProject(pid)]);
        pa.sections = [first];
        pb.sections = [second];
        await Promise.all([a.saveProject(pa), b.saveProject(pb)]);
        await Promise.all([a.syncProject(pid), b.syncProject(pid)]);
        for (const client of [a, b]) {
          const merged = (await client.syncProject(pid)).project;
          validateSections(merged);
          is(
            equal(
              [...merged.sections].sort((x, y) => x.id.localeCompare(y.id)),
              [first, second]
            ),
            'distinct section IDs and geometry survive on both devices'
          );
        }
      }
      const baseline = { ...project, sections: [first] },
        noSections = { ...project },
        edited = { ...project, sections: [first, second] };
      const compatible = mergeProjects(baseline, noSections, edited);
      is(
        !compatible.conflicts.length && equal(compatible.project.sections, [first, second]),
        'old client omission preserves saved sections'
      );
      const deletion = mergeProjects(baseline, { ...project, sections: [] }, edited);
      is(
        !deletion.conflicts.length && equal(deletion.project.sections, [second]),
        'explicit empty list deletes only pre-existing section'
      );
    }
  );
  let dataURL;
  await test('Ü4', 'Kesilen çok parçalı fotoğraf yüklemesi ve yanıt kaybından sonra tek sürüm', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 400;
    const ctx = canvas.getContext('2d'),
      color = ctx.createImageData(400, 400);
    let state = 512;
    for (let i = 0; i < color.data.length; i++) {
      state = (1664525 * state + 1013904223) >>> 0;
      color.data[i] = i % 4 === 3 ? 255 : state >>> 24;
    }
    ctx.putImageData(color, 0, 0);
    dataURL = canvas.toDataURL('image/png');
    is(dataURL.length > 350000, 'multiple chunks');
    let current = await a.loadProject(id);
    current.notes.push({
      id: 'photo',
      status: 'open',
      text: 'Giriş',
      photo: { data: dataURL, name: 'duvar.png' },
    });
    await a.saveProject(current);
    const original = globalThis.fetch;
    let phase = 'chunk',
      firstRequests = 0;
    try {
      globalThis.fetch = async function (url, opts) {
        if (opts?.method === 'PUT' && String(url).includes('/uploads/')) {
          const index = String(url).split('?')[0].split('/').pop();
          if (index === '0') firstRequests++;
          if (index === '1' && phase === 'chunk') {
            phase = 'commit';
            throw Error('interrupted');
          }
        }
        const r = await original(url, opts);
        if (opts?.method === 'PUT' && String(url).endsWith('/api/projects/' + id) && phase === 'commit') {
          phase = 'replay';
          await r.arrayBuffer();
          throw Error('lost ack');
        }
        return r;
      };
      await code(() => a.syncProject(id), 'NETWORK');
      is((await b.listVersions(id)).length === 1, 'partial photo did not publish');
      await code(() => a.syncProject(id), 'NETWORK');
      is((await a.getSyncState(id)).pending, 'lost ACK kept work');
      const retry = await a.syncProject(id);
      is(retry.revision === 2 && firstRequests === 1, 'resume did not repeat first chunk or commit');
    } finally {
      globalThis.fetch = original;
    }
    const other = await b.syncProject(id);
    is(
      other.project.notes.length === 1 && other.project.notes[0].photo.data === dataURL,
      'cross-device photo byte equality'
    );
  });
  await test('Ü4', 'Ayrı yeni notlar korunur, ortak duvar uçları seçim bekler', async () => {
    let pa = await a.loadProject(id),
      pb = await b.loadProject(id);
    pa.notes.push({ id: 'na', text: 'data: saha notu', status: 'open' });
    pb.notes.push({ id: 'nb', text: 'B', status: 'open' });
    await a.saveProject(pa);
    await b.saveProject(pb);
    await a.syncProject(id);
    const merged = await b.syncProject(id);
    is(
      merged.project.notes
        .map((n) => n.id)
        .sort()
        .join(',') === 'na,nb,photo',
      'disjoint notes'
    );
    pa = (await a.syncProject(id)).project;
    pb = await b.loadProject(id);
    pa.nodes[0].x = 120;
    pb.nodes[1].x = 4300;
    await a.saveProject(pa);
    await b.saveProject(pb);
    await a.syncProject(id);
    await code(() => b.syncProject(id), 'CONFLICT');
    const m = await b.getSyncState(id);
    is(m.state === 'conflict' && m.conflicts.some((x) => x.path === '/geometry'), 'physical wall conflict');
    await b.resolveConflict(id, { '/geometry': 'remote' });
    const final = await b.syncProject(id);
    is(final.project.nodes[0].x === 120 && final.project.nodes[1].x === 4000, 'explicit choice');
  });
  await test('Ü4', 'Duvar silinince başka cihazın yeni notu yeniden bağlama listesine alınır', async () => {
    const pa = (await a.syncProject(id)).project,
      pb = (await b.syncProject(id)).project;
    pa.walls = [];
    pb.notes.push({
      id: 'loose',
      text: 'Taşınacak',
      wallId: 'w',
      photo: { name: 'duvar.png', data: dataURL },
    });
    await a.saveProject(pa);
    await b.saveProject(pb);
    await a.syncProject(id);
    const done = await b.syncProject(id),
      note = done.project.notes.find((n) => n.id === 'loose');
    is(
      note.needsRebind === true &&
        !note.wallId &&
        note.formerAnchor.wallId === 'w' &&
        note.photo.data === dataURL,
      'orphan recovery'
    );
  });
  await test('Ü8', 'Geçmiş sürüm okunur, geri dönüş ileri revizyona kaydolur', async () => {
    const p = (await a.syncProject(id)).project;
    const rev = (await a.getSyncState(id)).revision;
    const old = await a.readVersion(id, 1);
    is(!old.notes.length, 'old snapshot');
    await a.restoreVersion(id, 1);
    const newer = await a.syncProject(id);
    is(
      newer.revision === rev + 1 &&
        newer.project.notes.length === 0 &&
        (await a.readVersion(id, rev)).notes.length === p.notes.length,
      'restore'
    );
  });
  await test('Ü8', 'Hesap/rol ile görünürlük, çevrimdışı kopya ve erişim kaldırma', async () => {
    await b.logoutCloud();
    is(!(await b.listProjects()).some((p) => p.id === id), 'offline profile after explicit signout');
    await login(b, 'okuyucu');
    await code(() => b.syncProject(id), 'NOT_FOUND');
    is(!(await b.listCloudProjects()).some((p) => p.id === id), 'private listing');
    await a.shareProject(id, 'okuyucu', 'viewer');
    const c = await import('/device-c/storage/store.js');
    await login(c, 'okuyucu');
    const ro = await c.syncProject(id);
    is(ro.project.id === id, 'download granted');
    await code(() => c.saveProject({ ...ro.project, name: 'edit' }), 'READ_ONLY');
    await a.shareProject(id, 'okuyucu', 'none');
    await code(() => c.syncProject(id), 'NOT_FOUND');
    await c.logoutCloud();
  });
  for (const store of [a, b]) if (store.cloudSession()) await store.logoutCloud();
  await testDialogs(a, project, config, test, is);
  const photo = await testOriginals(a, b, project, config, test, is, code);
  await testTeam(a, b, project, config, test, is, code);
  return { ok: true, checks, photo };
}

async function testDialogs(a, project, config, test, is) {
  const { storageAction } = await import('/device-a/storage/actions.js');
  const id = 'dialog-acceptance';
  let active = await a.saveProject({ ...project, id, name: 'Pencere Testi' }, { expectedUpdatedAt: null });
  const ctx = {
    get p() {
      return active;
    },
    refreshList: async () => {},
    selectProject: async (selected) => {
      active = await a.loadProject(selected);
    },
    toast: () => {},
    refreshProject: async (selected) => {
      active = await a.loadProject(selected);
    },
  };
  const wait = async (fn) => {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const value = await fn();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error('dialog control timed out');
  };
  const query = (sel) => document.querySelector('#modal ' + sel);
  const item = (key) => query('[data-cloud-action="' + key + '"]');
  await test('T6', 'Kayıt konumu, özel hesap girişi, uzaktaki arşiv ve eşitleme durumu', async () => {
    await storageAction('cloud', id, ctx);
    is(query('.dialog-body').textContent.includes('Bu cihazda'), 'offline label');
    is(!query('.dialog-body').textContent.includes('Sunucuda kayıtlı'), 'no false cloud claim');
    item('login').click();
    const dialogForm = await wait(() => query('form'));
    dialogForm.elements.url.value = location.origin;
    dialogForm.elements.username.value = 'mimar';
    dialogForm.elements.password.value = config.password;
    dialogForm.requestSubmit();
    await wait(() => item('sync'));
    item('sync').click();
    await wait(() => item('versions'));
    is(query('.dialog-body').textContent.includes('Sunucuda kayıtlı'), 'cloud acknowledgement');
    item('list').click();
    await wait(() => query('[data-value="' + id + '"]'));
    query('[data-value="' + id + '"]').click();
    await wait(() => item('versions'));
    item('versions').click();
    await wait(() => item('version'));
    item('version').click();
    await wait(() => item('copy'));
    item('copy').click();
    await wait(() => active.id !== id);
    is(active.name.includes('Sürüm 1'), 'version variant opened');
  });
  await test('T6', 'Bağlı projede yeni yerel kayıt pencere açıkken sunucuya ulaşır', async () => {
    const before = await a.loadProject(id);
    await a.saveProject({ ...before, name: 'Otomatik kayıt' });
    window.dispatchEvent(new Event('online'));
    await wait(async () => (await a.listVersions(id)).length === 2);
    is((await a.readVersion(id, 2)).name === 'Otomatik kayıt', 'automatic sync');
  });
  await test('T6', 'Çıkışta açık proje gizlenir ve diğer sekmedeki sunucu oturumu kapanır', async () => {
    active = await a.loadProject(id);
    const frame = document.createElement('iframe');
    frame.hidden = true;
    document.body.append(frame);
    try {
      const other = await frame.contentWindow.Function("return import('/device-a/storage/store.js')")();
      await other.loginCloud({ url: location.origin, username: 'mimar', password: config.password });
      is((await other.loadProject(id)).id === id, 'second tab opened the linked project');
      await storageAction('cloud', id, ctx);
      item('logout').click();
      const confirm = await wait(() => query('form'));
      confirm.requestSubmit();
      await wait(() => !active && !other.cloudSession());
      is(!(await other.loadProject(id)), 'logout cleared other tab access');
    } finally {
      frame.remove();
    }
  });
}

async function testOriginals(a, b, project, config, test, is, expectCode) {
  const { capturePhoto, validateExtras } = await import('/device-a/ui/dialog.js');
  const { equal } = await import('/device-a/storage/merge.js');
  const { hash, packProject, unpackProject, MAX_MEDIA, MAX_PROJECT_MEDIA } = await import(
    '/device-a/storage/media.js'
  );
  const proof = {};
  const login = (store) =>
    store.loginCloud({ url: location.origin, username: 'mimar', password: config.password });
  const blobFor = (canvas, mime) =>
    new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(Error('test image encoding'))), mime)
    );
  await test('Ü1', 'Önceki cihaz veritabanındaki fotoğraflı proje yeni kayıtta korunur', async () => {
    const id = 'old-inline',
      dbName = 'roleve-saha-v1/device-legacy';
    const raw = {
      ...project,
      id,
      notes: [
        {
          id: 'old-note',
          text: 'Eski',
          photo: {
            name: 'giris.gif',
            data: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          },
        },
      ],
    };
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' });
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id,
          project: raw,
          seq: 1,
          dirty: true,
          profile: null,
          base: null,
          request: null,
          conflict: null,
          revision: 0,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const legacy = await import('/device-legacy/storage/store.js');
    const old = await legacy.loadProject(id);
    is(old.notes[0].photo.data === raw.notes[0].photo.data, 'legacy read');
    await legacy.saveProject({ ...old, name: 'Dönüştü' });
    is(
      (await legacy.loadProject(id)).notes[0].photo.data === raw.notes[0].photo.data,
      'legacy blob roundtrip'
    );
  });
  await test(
    'Ü4',
    '40 MiB dosya ve 256 MiB proje bildirimi, SHA başına tek sayım ve sınır aşımı',
    async () => {
      const mib = 1024 ** 2;
      const make = (sha, size) => ({
        data: { $roleveMedia: { sha256: sha.toString(16).padStart(64, '0'), size, type: 'image/avif' } },
      });
      const cap = [...Array(6)].map((_, i) => make(i, 40 * mib));
      cap.push(make(6, 16 * mib));
      const refused = () => {
        throw Error('Dosya istenmemeliydi');
      };
      await expectCode(() => unpackProject({ f: [...cap, make(7, 1)] }, refused), 'INVALID_MEDIA');
      await expectCode(() => unpackProject({ f: [make(9, 40 * mib + 1)] }, refused), 'INVALID_MEDIA');
      await expectCode(() => unpackProject({ f: [make(1, 1), make(1, 2)] }, refused), 'INVALID_MEDIA');
      let reads = 0;
      try {
        await unpackProject({ f: [...cap, ...cap] }, () => {
          reads++;
          throw Error('accepted manifest');
        });
      } catch (e) {
        is(e.message === 'accepted manifest', 'exact cap');
      }
      is(reads === 1 && MAX_MEDIA === 40 * mib && MAX_PROJECT_MEDIA === 256 * mib, 'new upload limits');
      await expectCode(
        () => packProject({ bad: { data: 'data:image/avif;base64,aGVsbG8=' } }),
        'INVALID_MEDIA'
      );
    }
  );
  await test(
    'Ü4',
    'Üç fotoğraf, özgün dosya, önizleme ve işaretlerle 24 MiB üstü iki cihaz gidiş-dönüşü',
    async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2800;
      canvas.height = 2850;
      const context = canvas.getContext('2d'),
        image = context.createImageData(canvas.width, canvas.height),
        pixels = new Uint32Array(image.data.buffer);
      let random = 5001;
      for (let i = 0; i < pixels.length; i++) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        pixels[i] = random | 0xff000000;
      }
      context.putImageData(image, 0, 0);
      const png = await blobFor(canvas, 'image/png');
      canvas.width = canvas.height = 16;
      context.fillStyle = '#31746e';
      context.fillRect(0, 0, 16, 16);
      const jpeg = await blobFor(canvas, 'image/jpeg');
      const avif = await fetch('/fixtures/original.avif').then((r) => r.blob());
      is(png.size > 24 * 1024 ** 2 && png.size < MAX_MEDIA, 'large real PNG size');
      const inputs = [
        new File([png], 'duvar.png', { type: 'image/png' }),
        new File([jpeg], 'kapi.jpg', { type: 'image/jpeg' }),
        new File([avif], 'tavan.avif', { type: 'image/avif' }),
      ];
      const marks = [
        { id: 'yazi', type: 'text', text: 'Taş', color: '#ffce45', points: [{ x: 0.3, y: 0.8 }] },
        {
          id: 'olcu',
          type: 'dimension',
          raw: '1,2',
          unit: 'm',
          method: 'laser',
          color: '#78efd0',
          points: [
            { x: 0.1, y: 0.3 },
            { x: 0.8, y: 0.3 },
          ],
        },
        {
          id: 'ok',
          type: 'arrow',
          color: '#75bcff',
          points: [
            { x: 0.8, y: 0.2 },
            { x: 0.6, y: 0.75 },
          ],
        },
      ];
      const notes = [];
      for (let i = 0; i < inputs.length; i++) {
        const photo = await capturePhoto(inputs[i]);
        photo.annotations = [marks[i]];
        notes.push({ id: 'foto-' + i, text: inputs[i].name, photo });
      }
      const p = { ...project, id: 'saha-original', notes };
      validateExtras(p);
      is(
        !notes[0].photo.original &&
          !notes[1].photo.original &&
          notes[2].photo.original.name === 'tavan.avif' &&
          notes[2].photo.data.startsWith('data:image/jpeg;'),
        'separate original semantics'
      );
      const bytes = async (url) => (await fetch(url)).arrayBuffer();
      const shas = [];
      for (let i = 0; i < inputs.length; i++) {
        const expected = await hash(await inputs[i].arrayBuffer());
        const orig = notes[i].photo.original || notes[i].photo;
        is((await hash(await bytes(orig.data))) === expected, 'original file selection');
        shas.push(expected);
      }
      await login(a);
      await login(b);
      try {
        const local = await a.saveProject(p, { expectedUpdatedAt: null });
        const pending = await a.getSyncState(p.id);
        is(pending.pendingFiles.includes('tavan.avif · özgün'), 'pending original label');
        const ack = await a.syncProject(local.id);
        const remote = (await b.syncProject(p.id)).project;
        validateExtras(remote);
        is(ack.revision === 1 && remote.notes.length === 3, 'one atomic version');
        for (let i = 0; i < inputs.length; i++) {
          const photo = remote.notes[i].photo,
            orig = photo.original || photo;
          is(
            (await hash(await bytes(orig.data))) === shas[i] &&
              photo.data === notes[i].photo.data &&
              photo.preview.data === notes[i].photo.preview.data &&
              equal(photo.annotations, marks.slice(i, i + 1)),
            'photo, preview and annotation roundtrip'
          );
        }
        const packed = await packProject(remote);
        proof.photoCount = inputs.length;
        proof.sourceTypes = inputs.map((f) => f.type);
        proof.uniqueBytes = [...packed.assets.values()].reduce((n, asset) => n + asset.length, 0);
        proof.largestOriginalBytes = png.size;
        proof.originalSHA256 = shas;
        proof.annotationTypes = marks.map((m) => m.type);
      } finally {
        for (const store of [a, b]) if (store.cloudSession()) await store.logoutCloud();
      }
    }
  );
  return proof;
}

async function testTeam(a, b, project, config, test, is, expectCode) {
  const { storageAction } = await import('/device-a/storage/actions.js');
  let shown = null;
  const ctx = {
    get p() {
      return shown;
    },
    toast: () => {},
    refreshList: async () => {},
    selectProject: async (id) => {
      shown = await a.loadProject(id);
    },
    refreshProject: async (id) => {
      shown = await a.loadProject(id);
    },
  };
  const wait = async (fn) => {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const got = await fn();
      if (got) return got;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error('Ekip ekranı kontrolü zaman aşımı.');
  };
  const modal = () => document.querySelector('#modal');
  const row = (key) => modal().querySelector('[data-cloud-action="' + key + '"]');
  const sign = (s, username, password = config.password) =>
    s.loginCloud({ url: location.origin, username, password });
  const name = 'saha-mimari',
    password = config.password + '-A',
    replacement = config.password + '-R',
    pid = 'saha-ekibi-ui';
  await test('Ü1', 'IndexedDB v2 projesi ve eki v3 müşteri defteri açılırken korunur', async () => {
    const id = 'v2-kayit',
      jpg = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('roleve-saha-v1/device-v2', 2);
      request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id,
          token: 'old-token',
          content: {
            id,
            project: { ...project, id, notes: [{ id: 'n-v2', photo: { data: { $roleveLocalFile: 0 } } }] },
            seq: 1,
            profile: null,
            dirty: true,
          },
          files: [new Blob([jpg])],
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const old = await import('/device-v2/storage/store.js');
    const card = await old.createCustomer('Eski cihaz');
    const saved = await old.loadProject(id);
    is(
      saved.notes[0].photo.data === jpg && (await old.listCustomers()).some((c) => c.id === card.id),
      'old v2 intact'
    );
  });
  await test('T6', 'Yönetici üye oluşturur, normal kullanıcı yönetim düğmelerini göremez', async () => {
    await sign(a, 'yonetici');
    await storageAction('cloud', '', ctx);
    row('team').click();
    await wait(() => row('new'));
    row('new').click();
    const f = await wait(() => modal().querySelector('form'));
    f.elements.username.value = name;
    f.elements.password.value = password;
    f.requestSubmit();
    await wait(() => modal().querySelector('[data-value="' + name + '"]'));
    await sign(b, name, password);
    const uiB = await import('/device-b/storage/actions.js');
    await uiB.storageAction('cloud', '', ctx);
    is(!row('team') && !row('work'), 'member has no manager controls');
    await expectCode(() => b.listMembers(), 'ADMIN_REQUIRED');
  });
  let cust;
  await test(
    'Ü4',
    'Çevrimdışı müşteri, bağımsız kart eşitlemesi ve davet edilen üyenin saha işi',
    async () => {
      const fetchReal = window.fetch;
      try {
        window.fetch = (url, options) =>
          String(url).includes('/api/customers') ? Promise.reject(Error('offline')) : fetchReal(url, options);
        cust = await b.createCustomer('Kuzey Mahallesi');
        is(
          (await b.listCustomers()).some((c) => c.id === cust.id),
          'offline card'
        );
      } finally {
        window.fetch = fetchReal;
      }
      is(
        (await b.listCustomers()).some((c) => c.id === cust.id),
        'empty card retry'
      );
      const privateCard = await b.createCustomer('Bağımsız kart');
      const separate = await import('/device-c/storage/store.js');
      await sign(separate, name, password);
      is(
        (await separate.listCustomers()).some((c) => c.id === privateCard.id),
        'empty card second device'
      );
      await separate.logoutCloud();
      await b.saveProject(
        {
          ...project,
          id: pid,
          name: 'Beyaz Ev',
          customer: cust,
          surveyorName: 'Proje sorumlusu',
          visits: [{ id: 'saha-ziyaret', person: 'Beyan edilen kişi' }],
          observations: [
            {
              id: 'saha-olcu',
              a: { x: 0, y: 0 },
              b: { x: 1000, y: 0 },
              value: 1000,
              raw: '1',
              unit: 'm',
              measuredBy: 'Ölçüyü alan kişi',
              recordedBy: 'Başka bir beyan',
            },
          ],
        },
        { expectedUpdatedAt: null }
      );
      await b.syncProject(pid);
      is(
        (await a.listCustomers()).some((c) => c.id === cust.id) &&
          !(await a.listCustomers()).some((c) => c.id === privateCard.id),
        'manager sees project customer only'
      );
      await storageAction('cloud', '', ctx);
      row('work').click();
      await wait(() => row('search'));
      is(
        modal().textContent.includes('Son eşitleyen: ' + name) &&
          modal().textContent.includes('Beyan edilen kişi') &&
          modal().textContent.includes('Sorumlu: Proje sorumlusu') &&
          modal().textContent.includes('Ölçüyü alan kişi') &&
          !modal().textContent.includes('Başka bir beyan') &&
          modal().textContent.includes('1 ziyaret'),
        'trusted writer vs field statement'
      );
      row('search').click();
      const f = await wait(() => modal().querySelector('form'));
      f.elements.q.value = 'Beyaz';
      f.requestSubmit();
      const open = await wait(() => modal().querySelector('[data-value="' + pid + '"]'));
      open.click();
      await wait(() => shown?.id === pid);
      is((await a.getSyncState(pid)).role === 'viewer', 'manager opens employee survey read-only');
      await b.logoutCloud();
      is(
        !(await b.listCustomers()).some((c) => c.id === cust.id) && !(await b.loadProject(pid)),
        'signout removes team project and customer'
      );
      await sign(b, 'yonetici2');
      is(
        !(await b.listCustomers()).some((c) => c.id === cust.id) &&
          !(await b.teamWork()).projects.some((p) => p.id === pid),
        'other manager hidden'
      );
      await expectCode(() => b.syncProject(pid), 'NOT_FOUND');
      await b.logoutCloud();
      await sign(b, 'yonetici');
      is(
        (await b.syncProject(pid)).project.customer.id === cust.id,
        'authorized accounts have distinct local copies on a shared device'
      );
      await b.logoutCloud();
    }
  );
  await test('T6', 'Üye parola değişimi ve hesap kapatma açık oturumları iptal eder', async () => {
    await sign(b, name, password);
    await storageAction('cloud', pid, ctx);
    row('team').click();
    const member = await wait(() => modal().querySelector('[data-value="' + name + '"]'));
    member.click();
    await wait(() => row('reset'));
    row('reset').click();
    const f = await wait(() => modal().querySelector('form'));
    f.elements.password.value = replacement;
    f.requestSubmit();
    await wait(() => row('member'));
    await expectCode(() => b.listCloudProjects(), 'LOGIN_REQUIRED');
    await sign(b, name, replacement);
    row('member').click();
    await wait(() => row('toggle'));
    row('toggle').click();
    const confirm = await wait(() => modal().querySelector('form'));
    confirm.requestSubmit();
    await wait(() => modal().textContent.includes('Erişimi kapalı'));
    await expectCode(() => b.listCloudProjects(), 'LOGIN_REQUIRED');
    await expectCode(() => sign(b, name, replacement), 'LOGIN_FAILED');
    await a.logoutCloud();
  });
}
