/* Atomic local project, upstream checkpoint and pending write. */
export class StoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    Object.assign(this, details);
  }
}

const CACHE = 'projects';
const appPath = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const DB_NAME = 'roleve-saha-v1' + appPath;
const profileKey = DB_NAME + ':offline-account';
let connection;
let offlineAccount;
let lastFiles;
// Some WebKit stores support IndexedDB but reject Blob writes (e.g. ephemeral stores).
let useTextAttachments = false;

export function selectOfflineAccount(profile) {
  offlineAccount = profile;
  lastFiles = null;
  try {
    if (profile) localStorage.setItem(profileKey, profile);
    else localStorage.removeItem(profileKey);
  } catch {
    /* browser may deny persistent settings */
  }
}

export function onOtherTabAccountChange(listener) {
  window.addEventListener('storage', (event) => {
    if (event.storageArea === localStorage && (event.key === profileKey || event.key === null)) {
      if (offlineAccount !== event.newValue) {
        offlineAccount = null;
        lastFiles = null;
      }
      listener(event.newValue);
    }
  });
}

export function activeOfflineProfile() {
  try {
    const current = localStorage.getItem(profileKey);
    if (offlineAccount === undefined) offlineAccount = current;
    return offlineAccount === current ? current : null;
  } catch {
    return offlineAccount || null;
  }
}
function visible(record) {
  const scope = record?.profile || record?.scope;
  return !scope || scope === activeOfflineProfile();
}
const scopedKey = (id, scope) => (scope ? 'account:' + encodeURIComponent(scope) + ':' + id : id);

function unavailable() {
  return new StoreError('NO_LOCAL_STORAGE', 'Bu tarayıcıda cihaz kaydı açılamadı.');
}

function open() {
  if (!globalThis.indexedDB) return Promise.reject(unavailable());
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('customers'))
          db.createObjectStore('customers', { keyPath: 'scope' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        db.onclose = () => {
          connection = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        connection = undefined;
        reject(request.error || unavailable());
      };
      request.onblocked = () => {
        connection = undefined;
        reject(new StoreError('DB_BLOCKED', 'Diğer açık Rölöve sekmesini kapatın.'));
      };
    });
  return connection;
}

async function transaction(mode, action, storeName = CACHE) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result;
    let error;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(error || tx.error || new StoreError('LOCAL_WRITE', 'Cihaza kayıt tamamlanamadı.'));
    const fail = (e) => {
      error = e;
      try {
        tx.abort();
      } catch {
        reject(e);
      }
    };
    try {
      action(
        tx.objectStore(storeName),
        (v) => {
          result = v;
        },
        fail
      );
    } catch (e) {
      fail(e);
    }
  });
}

async function readRaw(id) {
  const key = scopedKey(id, activeOfflineProfile());
  return transaction('readonly', (store, set) => {
    const pick = (next) => {
      const req = store.get(next);
      req.onsuccess = () => {
        const raw = req.result;
        if (raw && visible(raw.content || raw)) set(raw);
        else if (next !== id) pick(id);
        else set(null);
      };
    };
    pick(key);
  });
}

// Version 1 stored data URLs inline. Version 2 puts each distinct attachment in an IndexedDB Blob,
// shared by the local snapshot, cloud checkpoint and persisted operation in the same atomic record.
function mapFields(value, change, field = null, seen = new WeakMap()) {
  const result = change(value, field);
  if (result !== undefined) return result;
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [k, v] of Object.entries(value)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype')
      throw new StoreError('INVALID', 'Geçersiz proje alanı.');
    copy[k] = mapFields(v, change, k, seen);
  }
  return copy;
}
function compact(record, priorFiles, asText) {
  const files = [],
    values = [],
    byValue = new Map();
  const content = mapFields(record, (value, field) => {
    if (field !== 'data' || typeof value !== 'string' || value.slice(0, 5).toLowerCase() !== 'data:') return;
    let index = byValue.get(value);
    if (index === undefined) {
      index = files.length;
      byValue.set(value, index);
      values.push(value);
      files.push(asText ? value : (priorFiles.get(value) || new Blob([value], { type: 'text/plain;charset=us-ascii' })));
    }
    return { $roleveLocalFile: index };
  });
  const token = crypto.randomUUID();
  return {
    raw: { id: scopedKey(record.id, record.profile || record.scope), token, content, files },
    cache: { token, values },
  };
}
async function expand(raw, field) {
  if (!raw?.content) return { record: field ? raw?.[field] : raw, byValue: new Map() };
  const source = field ? raw.content[field] : raw.content;
  const values = lastFiles?.token === raw.token ? lastFiles.values : [];
  const byValue = new Map();
  const needed = new Set();
  const identify = (v, key) =>
    key === 'data' && v && typeof v === 'object' && Object.hasOwn(v, '$roleveLocalFile');
  mapFields(source, (v, key) => {
    if (identify(v, key)) {
      needed.add(v.$roleveLocalFile);
      return v;
    }
  });
  for (const index of needed) {
    const file = raw.files[index];
    if (!Number.isInteger(index) || (typeof file !== 'string' && !(file instanceof Blob)))
      throw new StoreError('LOCAL_MEDIA', 'Cihazdaki ek dosya okunamadı.');
    if (values[index] === undefined) values[index] = typeof file === 'string' ? file : await file.text();
    byValue.set(values[index], file);
  }
  lastFiles = { token: raw.token, values };
  return {
    record: mapFields(source, (v, key) => (identify(v, key) ? values[v.$roleveLocalFile] : undefined)),
    byValue,
  };
}
export async function getRecord(id) {
  return (await expand(await readRaw(id))).record;
}

function comparisonToken(raw) {
  if (!raw) return null;
  return raw.token || JSON.stringify([raw.seq, raw.revision, raw.request?.op, raw.conflict?.remoteRevision]);
}
export async function changeRecord(id, change) {
  const apply = async () => {
    const profile = activeOfflineProfile();
    const prior = await readRaw(id),
      { record, byValue } = await expand(prior);
    const next = change(record);
    if (next === undefined) return record;
    let packed = next === null ? null : compact(next, byValue, useTextAttachments);
    const target = packed?.raw.id || prior?.id || scopedKey(id, profile);
    const priorKey = prior?.id || target;
    const write = () => transaction('readwrite', (store, set, fail) => {
      const previous = store.get(priorKey),
        destination = priorKey !== target ? store.get(target) : null;
      const commit = () => {
        try {
          if (profile !== activeOfflineProfile())
            throw new StoreError('WRONG_ACCOUNT', 'Cihazda seçili hesap değişti.');
          if (comparisonToken(previous.result) !== comparisonToken(prior) || destination?.result)
            throw new StoreError('STALE_LOCAL', 'Proje başka bir sekmede değişti. Güncel projeyi açın.');
          if (packed) store.put(packed.raw);
          if (!packed || priorKey !== target) store.delete(priorKey);
          set(next);
        } catch (e) {
          fail(e);
        }
      };
      (destination || previous).onsuccess = commit;
    });
    let saved;
    try {
      saved = await write();
    } catch (error) {
      const blobFailure = error?.name === 'DataCloneError' || /preparing blob|blob\/file|blob urls are not yet supported/i.test(error?.message || '');
      if (!blobFailure || !packed?.raw.files.some(file => file instanceof Blob)) throw error;
      // The first transaction aborted. Reuse the same proposed change and repeat the token/account check.
      packed = compact(next, byValue, true);
      saved = await write();
      useTextAttachments = true;
    }
    lastFiles = packed?.cache;
    return saved;
  };
  return globalThis.navigator?.locks ? navigator.locks.request(DB_NAME + ':' + id, apply) : apply();
}

export const nextTime = (old) => new Date(Math.max(Date.now(), (Date.parse(old) || 0) + 1)).toISOString();

export function blankRecord(project) {
  return {
    id: project.id,
    project,
    seq: 1,
    dirty: true,
    request: null,
    conflict: null,
    scope: activeOfflineProfile(),
    profile: null,
    username: null,
    server: null,
    revision: 0,
    base: null,
    role: null,
    lastSync: null,
  };
}

export async function listProjects() {
  const rows = await transaction('readonly', (store, set) => {
    const request = store.getAll();
    request.onsuccess = () => set(request.result);
  });
  const records = [];
  for (const raw of rows)
    if (visible(raw.content || raw)) records.push((await expand(raw, 'project')).record);
  return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function loadProject(id) {
  const raw = await readRaw(id);
  return raw && visible(raw.content || raw) ? (await expand(raw, 'project')).record : null;
}

export async function saveProject(project, options = {}) {
  if (
    !project ||
    project.schemaVersion !== 1 ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(project.id) ||
    typeof project.name !== 'string' ||
    !project.name.trim()
  )
    throw new StoreError('INVALID', 'Proje biçimi veya adı geçersiz.');
  project = structuredClone(project);
  const rec = await changeRecord(project.id, (previous) => {
    if (!visible(previous))
      throw new StoreError('WRONG_ACCOUNT', 'Bu kayıt başka bir çevrimdışı çalışma alanına ait.');
    if (previous?.role === 'viewer') throw new StoreError('READ_ONLY', 'Bu projede görüntüleme izniniz var.');
    const expected = Object.hasOwn(options, 'expectedUpdatedAt')
      ? options.expectedUpdatedAt
      : project.updatedAt;
    if (previous && expected !== previous.project.updatedAt) {
      throw new StoreError('STALE_LOCAL', 'Proje başka bir sekmede değişti. Güncel projeyi açın.');
    }
    if (!previous && Object.hasOwn(options, 'expectedUpdatedAt') && expected != null)
      throw new StoreError('STALE_LOCAL', 'Bu cihazdaki proje kaldırıldı.');
    const snapshot = { ...project, updatedAt: nextTime(previous?.project.updatedAt) };
    if (!previous) return blankRecord(snapshot);
    return { ...previous, project: snapshot, dirty: true, seq: previous.seq + 1, conflict: null };
  });
  return rec.project;
}

export async function getSyncState(id) {
  const r = await getRecord(id);
  if (!r || !visible(r)) return null;
  const files = (p) =>
    [
      ...(p?.notes || []).flatMap(({ photo }) =>
        photo
          ? [
              photo.original ? { ...photo, name: (photo.name || 'Fotoğraf') + ' · çalışma kopyası' } : photo,
              photo.original && { ...photo.original, name: (photo.original.name || 'Fotoğraf') + ' · özgün' },
              photo.preview && { ...photo.preview, name: (photo.name || 'Fotoğraf') + ' · önizleme' },
            ]
          : []
      ),
      ...(p?.underlays || []).map((f) => ({ name: f.name || 'Altlık', data: f.data })),
    ].filter((f) => f?.data);
  const previous = new Set(files(r.base).map((f) => f.data));
  const waiting = [];
  if (r.dirty || r.request)
    for (const f of files(r.project))
      if (!previous.has(f.data)) {
        waiting.push(f);
        previous.add(f.data);
      }
  return {
    pendingFiles: waiting.map((f) => f.name || 'Fotoğraf'),
    state: r.conflict ? 'conflict' : !r.profile ? 'local' : r.dirty || r.request ? 'pending' : 'synced',
    pending: !!(r.dirty || r.request),
    revision: r.revision,
    username: r.username,
    server: r.server,
    role: r.role,
    lastSync: r.lastSync,
    conflicts: r.conflict?.conflicts || [],
  };
}

export async function removeDeviceCopy(id, { force = false } = {}) {
  await changeRecord(id, (r) => {
    if (!visible(r)) throw new StoreError('WRONG_ACCOUNT', 'Bu kopya başka bir çalışma alanına ait.');
    if (r && (r.dirty || r.request || r.conflict) && !force)
      throw new StoreError(
        'UNSENT',
        'Cihazdaki güncel çalışma buluta aktarılmamış. Önce proje paketini saklayın.'
      );
    return null;
  });
}

export const customerScope = () => activeOfflineProfile() || 'device';
export const customerRows = (scope) =>
  transaction(
    'readonly',
    (store, set) => {
      const req = store.get(scope);
      req.onsuccess = () => set(req.result?.rows || []);
    },
    'customers'
  );
export const editCustomers = (scope, change) =>
  transaction(
    'readwrite',
    (store, set, fail) => {
      const req = store.get(scope);
      req.onsuccess = () => {
        try {
          const rows = change(req.result?.rows || []);
          store.put({ scope, rows });
          set(rows);
        } catch (e) {
          fail(e);
        }
      };
    },
    'customers'
  );
export async function projectCustomers() {
  return transaction('readonly', (store, set) => {
    const req = store.getAll();
    req.onsuccess = () =>
      set(
        req.result
          .map((raw) => raw.content || raw)
          .filter(visible)
          .map((rec) => rec.project?.customer)
          .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
      );
  });
}
