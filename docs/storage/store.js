import {
  blankRecord,
  customerRows,
  customerScope,
  editCustomers,
  projectCustomers,
  changeRecord,
  getRecord,
  listProjects,
  loadProject,
  nextTime,
  onOtherTabAccountChange,
  saveProject as saveLocal,
  selectOfflineAccount,
  StoreError,
} from './local.js';
import { equal, mergeProjects } from './merge.js';
import { CHUNK, decodeAssetSource, packProject, unpackProject } from './media.js';
import { normalizeProject, validateProject } from '../geometry/core.js';
function checkedProject(p) {
  return p?.schemaVersion === 1 && p.faceSketches === undefined ? normalizeProject(p) : validateProject(p);
}
export { getSyncState, listProjects, loadProject, removeDeviceCopy, StoreError } from './local.js';
export { mergeProjects } from './merge.js';

let session = null;
const running = new Map();
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const requireId = (id) => {
  if (!idPattern.test(id)) throw new StoreError('INVALID', 'Proje kimliği geçersiz.');
  return id;
};

function normalURL(text) {
  let url;
  try {
    url = new URL(text || location.origin);
  } catch {
    throw new StoreError('INVALID_URL', 'Sunucu adresini kontrol edin.');
  }
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new StoreError('INVALID_URL', 'Sunucu için HTTPS adresi kullanın.');
  return url.href.replace(/\/+$/, '');
}

async function call(s, path, { method = 'GET', json, bytes, raw = false } = {}) {
  const headers = {};
  if (s.token) headers.Authorization = 'Bearer ' + s.token;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (bytes !== undefined) headers['Content-Type'] = 'application/octet-stream';
  let r;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 60000);
  try {
    r = await fetch(s.url + '/api/' + path, {
      method,
      headers,
      body: bytes ?? (json !== undefined ? JSON.stringify(json) : undefined),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: timeout.signal,
    });
    if (!r.ok) {
      let data = {};
      try {
        data = await r.json();
      } catch {}
      if (r.status === 401 && session === s) session = null;
      throw new StoreError(data.code || 'HTTP_ERROR', data.message || 'Sunucu isteği tamamlanamadı.', {
        status: r.status,
      });
    }
    return raw ? await r.arrayBuffer() : await r.json();
  } catch (e) {
    if (e instanceof StoreError) throw e;
    throw new StoreError('NETWORK', 'Sunucuya erişilemedi. Cihazdaki kayıt korunuyor.');
  } finally {
    clearTimeout(timer);
  }
}

export async function loginCloud({ url, username, password }) {
  const address = normalURL(url);
  const result = await call({ url: address }, 'login', { method: 'POST', json: { username, password } });
  if (!result.token || !result.instance || !result.userId || !result.username)
    throw new StoreError('INVALID_SERVER', 'Rölöve sunucusunun oturum yanıtı doğrulanamadı.');
  session = {
    url: address,
    token: result.token,
    username: result.username,
    isAdmin: result.isAdmin === true,
    profile: JSON.stringify([address, result.instance, result.userId]),
  };
  selectOfflineAccount(session.profile);
  scheduleBoundProjects();
  return cloudSession();
}
export function cloudSession() {
  return session ? { url: session.url, username: session.username, isAdmin: session.isAdmin === true } : null;
}
export async function logoutCloud() {
  const old = session;
  session = null;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  selectOfflineAccount(null);
  if (old) await call(old, 'logout', { method: 'POST' });
}
function current() {
  if (!session) throw new StoreError('LOGIN_REQUIRED', 'Özel sunucuda oturum açın.');
  return session;
}
function checkSession(s) {
  if (session !== s) throw new StoreError('LOGIN_REQUIRED', 'Bulut hesabı değişti.');
}
function checkProfile(rec, s) {
  if (rec?.profile && rec.profile !== s.profile)
    throw new StoreError('WRONG_ACCOUNT', 'Bu projenin eşitlendiği hesabı ve sunucuyu açın.');
}
export function listCloudProjects() {
  return call(current(), 'projects');
}
export function listVersions(id) {
  return call(current(), 'projects/' + requireId(id) + '/versions');
}
export function shareProject(id, username, role) {
  return call(current(), 'projects/' + requireId(id) + '/share', {
    method: 'POST',
    json: { username, role },
  });
}
async function download(s, id, revision) {
  const route = 'projects/' + id;
  const result = await call(s, route + (revision === undefined ? '' : '/versions/' + revision));
  const project = await unpackProject(result.document, (sha) =>
    call(s, route + '/media/' + sha, { raw: true })
  );
  if (project?.schemaVersion !== 1 || project.id !== id || !Number.isInteger(result.revision))
    throw new StoreError('INVALID_PROJECT', 'Sunucu proje biçimi doğrulanamadı.');
  return { ...result, project: checkedProject(project) };
}
export async function readVersion(id, revision) {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new StoreError('INVALID', 'Sürüm numarası geçersiz.');
  return (await download(current(), requireId(id), revision)).project;
}
export async function restoreVersion(id, revision) {
  const s = current();
  const local = await getRecord(requireId(id));
  checkProfile(local, s);
  if (!local || local.dirty || local.request || local.conflict)
    throw new StoreError('UNSENT', 'Önce bu projeyi güncel sürümle eşitleyin.');
  const past = await readVersion(id, revision);
  checkSession(s);
  return saveProject(past, { expectedUpdatedAt: local.project.updatedAt });
}
async function sendPending(s, id, request) {
  const route = 'projects/' + id;
  const packed = await packProject(request.project, { sourcesOnly: true });
  let fileIndex = 0;
  for (const [key, source] of packed.assets) {
    fileIndex++;
    const where = route + '/uploads/' + key;
    const status = await call(s, where);
    if (status.complete) continue;
    const bytes = decodeAssetSource(source);
    const present = new Set(status.indices);
    for (let start = 0; start < bytes.length; start += CHUNK) {
      const i = start / CHUNK;
      if (!present.has(i)) {
        await call(s, where + '/' + i + '?size=' + bytes.length, {
          method: 'PUT',
          bytes: bytes.subarray(start, start + CHUNK),
        });
        if (typeof window !== 'undefined')
          window.dispatchEvent(
            new CustomEvent('roleve:upload', {
              detail: {
                id,
                fileIndex,
                count: packed.assets.size,
                percent: Math.round((100 * Math.min(bytes.length, start + CHUNK)) / bytes.length),
              },
            })
          );
      }
    }
  }
  return call(s, route, {
    method: 'PUT',
    json: { base: request.base, op: request.op, document: packed.document },
  });
}
const profileFields = (s, role) => ({ profile: s.profile, username: s.username, server: s.url, role });
const sameRead = (a, b) =>
  a?.seq === b?.seq &&
  a?.revision === b?.revision &&
  a?.request?.op === b?.request?.op &&
  a?.profile === b?.profile &&
  a?.conflict?.remoteRevision === b?.conflict?.remoteRevision;
function conflictError(list) {
  return new StoreError('CONFLICT', 'Aynı proje öğesi iki yerde değişti. Sürümü seçin.', { conflicts: list });
}

async function sync(s, id) {
  const route = 'projects/' + id;
  for (let attempt = 0; attempt < 12; attempt++) {
    checkSession(s);
    const rec = await getRecord(id);
    checkProfile(rec, s);
    if (rec?.request) {
      const sent = rec.request;
      let ack;
      try {
        ack = await sendPending(s, id, sent);
      } catch (e) {
        if (e.code !== 'STALE') throw e;
        await changeRecord(id, (r) => (r?.request?.op === sent.op ? { ...r, request: null } : undefined));
        continue;
      }
      checkSession(s);
      const acknowledged = await changeRecord(id, (r) => {
        if (r?.request?.op !== sent.op) return undefined;
        return {
          ...r,
          ...profileFields(s, ack.role),
          base: sent.project,
          revision: ack.revision,
          request: null,
          dirty: r.seq !== sent.seq,
          conflict: null,
          lastSync: new Date().toISOString(),
        };
      });
      if (!acknowledged || acknowledged.dirty) continue;
      // Replay of a lost acknowledgement can point at an older accepted version.
      continue;
    }
    let remote;
    try {
      const head = await call(s, route + '/head');
      remote =
        rec?.base && head.revision === rec.revision ? { ...head, project: rec.base } : await download(s, id);
    } catch (e) {
      if (e.code !== 'NOT_FOUND' || !rec || rec.revision) throw e;
    }
    checkSession(s);
    if (!remote && !rec) throw new StoreError('NOT_FOUND', 'Proje bulunamadı.');
    if (rec?.conflict && rec.conflict.remoteRevision === remote?.revision)
      throw conflictError(rec.conflict.conflicts);
    if (!rec || !rec.dirty) {
      if (!remote) throw new StoreError('NOT_FOUND', 'Sunucuda proje bulunamadı.');
      let seen = false;
      const saved = await changeRecord(id, (r) => {
        if (!sameRead(r, rec)) return undefined;
        seen = true;
        if (r?.revision === remote.revision && r.profile === s.profile && r.role === remote.role)
          return undefined;
        const project = r ? { ...remote.project, updatedAt: nextTime(r.project.updatedAt) } : remote.project;
        return {
          ...blankRecord(project),
          ...profileFields(s, remote.role),
          base: remote.project,
          revision: remote.revision,
          seq: (r?.seq || 0) + 1,
          dirty: false,
          lastSync: new Date().toISOString(),
        };
      });
      if (seen && saved) return { project: saved.project, revision: saved.revision, state: 'synced' };
      continue;
    }
    if (remote?.role === 'viewer') {
      await changeRecord(id, (r) => (sameRead(r, rec) ? { ...r, ...profileFields(s, 'viewer') } : undefined));
      throw new StoreError(
        'READ_ONLY',
        'Bu hesapta yalnız görüntüleme izni var. Yerel değişikliği paket olarak saklayabilirsiniz.'
      );
    }
    let project = rec.project;
    if (remote && (rec.revision !== remote.revision || !rec.base)) {
      const merged = combineValidated(rec.base, project, remote.project);
      if (merged.conflicts.length) {
        let recorded = false;
        await changeRecord(id, (r) => {
          if (!sameRead(r, rec)) return undefined;
          recorded = true;
          return {
            ...r,
            ...profileFields(s, remote.role),
            conflict: {
              conflicts: merged.conflicts,
              remote: remote.project,
              remoteRevision: remote.revision,
              createdSeq: r.seq,
            },
          };
        });
        if (recorded) throw conflictError(merged.conflicts);
        continue;
      }
      project = merged.project;
    }
    if (remote && equal({ ...project, updatedAt: 0 }, { ...remote.project, updatedAt: 0 })) {
      let adopted = false;
      const saved = await changeRecord(id, (r) => {
        if (!sameRead(r, rec)) return undefined;
        adopted = true;
        return {
          ...r,
          ...profileFields(s, remote.role),
          dirty: false,
          conflict: null,
          base: remote.project,
          revision: remote.revision,
          lastSync: new Date().toISOString(),
        };
      });
      if (adopted) return { project: saved.project, state: 'synced', revision: saved.revision };
      continue;
    }
    await changeRecord(id, (r) => {
      if (!sameRead(r, rec)) return undefined;
      const touched = !equal(r.project, project);
      if (touched) project = { ...project, updatedAt: nextTime(r.project.updatedAt) };
      const seq = touched ? r.seq + 1 : r.seq;
      return {
        ...r,
        ...profileFields(s, remote?.role || 'owner'),
        project,
        seq,
        dirty: true,
        conflict: null,
        request: { op: crypto.randomUUID(), base: remote?.revision || 0, project, seq },
      };
    });
  }
  throw new StoreError('BUSY', 'Proje eşitleme sırasında değişiyor. Biraz sonra yeniden deneyin.');
}
export function syncProject(id) {
  requireId(id);
  const s = current(),
    key = s.profile + '#' + id;
  if (running.has(key)) return running.get(key);
  const work = sync(s, id).finally(() => {
    if (running.get(key) === work) running.delete(key);
  });
  running.set(key, work);
  return work;
}

export async function resolveConflict(id, choices) {
  const s = current();
  const saved = await changeRecord(requireId(id), (r) => {
    checkProfile(r, s);
    if (!r?.conflict || r.conflict.createdSeq !== r.seq)
      throw new StoreError('STALE_LOCAL', 'Çakışma durumunu yeniden eşitleyin.');
    const { project, conflicts } = combineValidated(r.base, r.project, r.conflict.remote, choices);
    if (conflicts.length) throw conflictError(conflicts);
    return {
      ...r,
      project: { ...project, updatedAt: nextTime(r.project.updatedAt) },
      seq: r.seq + 1,
      base: r.conflict.remote,
      revision: r.conflict.remoteRevision,
      request: null,
      conflict: null,
      dirty: true,
    };
  });
  return saved.project;
}

export async function requestPersistentStorage() {
  return !!(await globalThis.navigator?.storage?.persist?.());
}

const timers = new Map();
function announce(id, state, revision) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('roleve:cloud', { detail: { id, state, revision } }));
}
function schedule(id, attempts = 0) {
  if (!session || globalThis.navigator?.onLine === false) return;
  const active = session;
  clearTimeout(timers.get(id));
  const timer = setTimeout(
    async () => {
      timers.delete(id);
      try {
        const rec = await getRecord(id);
        if (
          !rec ||
          session !== active ||
          rec.profile !== active.profile ||
          rec.conflict ||
          (!rec.dirty && !rec.request)
        )
          return;
        const done = await syncProject(id);
        announce(id, done.state, done.revision);
      } catch (error) {
        if (session === active && attempts < 4 && ['NETWORK', 'BUSY'].includes(error.code))
          schedule(id, attempts + 1);
        announce(id, error.code === 'CONFLICT' ? 'conflict' : 'pending');
      }
    },
    attempts ? Math.min(30000, 1500 * 2 ** attempts) : 1400
  );
  timers.set(id, timer);
}
async function scheduleBoundProjects() {
  if (!session) return;
  refreshCustomers(session).catch(() => {});
  try {
    for (const project of await listProjects()) schedule(project.id);
  } catch {
    /* user can retry from the sync panel */
  }
}
export async function saveProject(p, options) {
  p = checkedProject(p);
  await packProject(p, { sourcesOnly: true });
  const saved = await saveLocal(p, options);
  schedule(saved.id);
  return saved;
}
if (typeof window !== 'undefined') {
  onOtherTabAccountChange((profile) => {
    const old = session;
    if (old && old.profile !== profile) {
      session = null;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      call(old, 'logout', { method: 'POST' }).catch(() => {});
    }
    window.dispatchEvent(new CustomEvent('roleve:account'));
  });
  window.addEventListener('online', scheduleBoundProjects);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleBoundProjects();
  });
}

function combineValidated(base, local, remote, choices = {}) {
  if (choices['/project'] === 'local') return { project: checkedProject(local), conflicts: [] };
  if (choices['/project'] === 'remote') return { project: checkedProject(remote), conflicts: [] };
  const merged = mergeProjects(base, local, remote, choices);
  if (merged.conflicts.length) return merged;
  try {
    merged.project = checkedProject(merged.project);
    return merged;
  } catch {
    return {
      project: local,
      conflicts: [
        {
          path: '/project',
          base,
          local,
          remote,
          detail:
            'Kat, mahal veya ölçü bağı birlikte çözülemedi. Bütün proje için bir sürüm seçin. Önce yerel paketi kaydedebilirsiniz.',
        },
      ],
    };
  }
}

const refreshingCustomers = new Map();
function refreshCustomers(s) {
  if (refreshingCustomers.has(s.profile)) return refreshingCustomers.get(s.profile);
  const pending = (async () => {
    for (const row of await customerRows(s.profile))
      if (row.dirty) {
        checkSession(s);
        await call(s, 'customers/' + requireId(row.id), { method: 'PUT', json: { name: row.name } });
        await editCustomers(s.profile, (rows) =>
          rows.map((c) => (c.id === row.id && c.name === row.name ? { ...c, dirty: false } : c))
        );
      }
    const remote = await call(s, 'customers');
    checkSession(s);
    if (!Array.isArray(remote)) throw new StoreError('INVALID_SERVER', 'Müşteri listesi okunamadı.');
    await editCustomers(s.profile, (rows) => {
      const cards = new Map(
        remote.map((c) => [requireId(c.id), { id: c.id, name: customerName(c.name), dirty: false }])
      );
      for (const c of rows) if (c.dirty) cards.set(c.id, c);
      return [...cards.values()];
    });
  })().finally(() => refreshingCustomers.delete(s.profile));
  refreshingCustomers.set(s.profile, pending);
  return pending;
}
function customerName(value) {
  if (typeof value !== 'string') throw new StoreError('INVALID', 'Müşteri adı gerekli.');
  const name = value.normalize('NFC').trim();
  if (!name || [...name].length > 240 || /[\u0000-\u001f\u007f-\u009f]/u.test(name))
    throw new StoreError('INVALID', 'Müşteri adı 1–240 karakter olmalı.');
  return name;
}
export async function listCustomers() {
  const s = session,
    scope = customerScope();
  if (s && s.profile === scope && navigator.onLine !== false) {
    try {
      await refreshCustomers(s);
    } catch (e) {
      if (!['NETWORK', 'LOGIN_REQUIRED'].includes(e.code)) throw e;
    }
  }
  if (scope !== customerScope()) return [];
  const items = new Map();
  for (const c of await projectCustomers()) items.set(c.id, { id: c.id, name: c.name });
  for (const c of await customerRows(scope)) items.set(c.id, { id: c.id, name: c.name });
  if (scope !== customerScope()) return [];
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}
export async function createCustomer(value) {
  const name = customerName(value),
    scope = customerScope();
  let card;
  await editCustomers(scope, (rows) => {
    const known = rows.find((c) => c.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'));
    card = known || { id: crypto.randomUUID(), name, dirty: scope !== 'device' };
    return known ? rows : [...rows, card];
  });
  if (scope !== customerScope()) throw new StoreError('WRONG_ACCOUNT', 'Cihazda seçili hesap değişti.');
  if (session?.profile === scope && navigator.onLine !== false) {
    const s = session;
    try {
      await refreshCustomers(s);
      if ((await customerRows(scope)).some((c) => c.id === card.id && c.dirty)) await refreshCustomers(s);
    } catch (e) {
      if (!['NETWORK', 'LOGIN_REQUIRED'].includes(e.code)) throw e;
    }
  }
  return { id: card.id, name: card.name };
}
export const listMembers = () => call(current(), 'team');
export const createMember = (username, password) =>
  call(current(), 'team', { method: 'POST', json: { username, password } });
export const manageMember = (username, action, password) =>
  call(current(), 'team/members/' + encodeURIComponent(username), {
    method: 'POST',
    json: { action, ...(action === 'reset' ? { password } : {}) },
  });
export const teamWork = (query = '', offset = 0) =>
  call(current(), 'team/work?q=' + encodeURIComponent(query) + '&offset=' + offset);
