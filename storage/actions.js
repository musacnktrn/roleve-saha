import {
  cloudSession,
  getSyncState,
  listCloudProjects,
  listVersions,
  listMembers,
  createMember,
  manageMember,
  teamWork,
  loginCloud,
  logoutCloud,
  loadProject,
  readVersion,
  removeDeviceCopy,
  requestPersistentStorage,
  resolveConflict,
  restoreVersion,
  saveProject,
  shareProject,
  syncProject,
} from './store.js';
import { closeDialog, form, showDialog } from '../ui/dialog.js';
import { dateText, downloadFile, esc, icon, uid } from '../ui/base.js';

const names = {
  local: 'Bu cihazda',
  pending: 'Değişiklikler sunucuya aktarılacak',
  synced: 'Sunucuda kayıtlı',
  conflict: 'Seçim bekleyen değişiklik',
};
const roles = { owner: 'Sahip', viewer: 'Görüntüleyici', editor: 'Düzenleyici' };
const groups = {
  floors: 'Kat',
  rooms: 'Mahaller',
  walls: 'Duvarlar',
  nodes: 'Köşeler',
  elements: 'Mimari öğeler',
  zones: 'Kot bölgeleri',
  observations: 'Ölçüler',
  notes: 'Notlar',
  strokes: 'Kalem izleri',
  faceSketches: 'Duvar eskizleri',
  visits: 'Ziyaretler',
  underlays: 'Altlıklar',
};
let sameOriginAvailable;
if (typeof window !== 'undefined')
  window.addEventListener('roleve:upload', (event) => {
    const progress = document.querySelector('#modal [data-cloud-progress]');
    const p = event.detail;
    if (progress?.dataset.cloudProgress === p.id)
      progress.textContent = 'Dosya ' + p.fileIndex + ' / ' + p.count + ' · %' + p.percent;
  });

function row(id, title, symbol, value = '') {
  return (
    '<button type="button" class="action-row" data-cloud-action="' +
    esc(id) +
    '" data-value="' +
    esc(value) +
    '">' +
    icon(symbol) +
    '<span>' +
    esc(title) +
    '</span>' +
    icon('right') +
    '</button>'
  );
}
function message(text) {
  return '<p class="intro">' + esc(text) + '</p>';
}
function menu(title, body, click) {
  const dialog = showDialog(title, body + '<p class="err" role="alert"></p>', (d) => {
    let busy = false;
    d.onclick = async (event) => {
      const node = event.target.closest('[data-cloud-action]');
      if (!node || !d.contains(node)) return;
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      busy = true;
      node.disabled = true;
      const error = d.querySelector('.err');
      if (error) error.textContent = '';
      try {
        await click(node.dataset.cloudAction, node.dataset.value);
      } catch (e) {
        if (error?.isConnected) error.textContent = e.message || 'İşlem tamamlanamadı.';
      } finally {
        busy = false;
        node.disabled = false;
      }
    };
  });
  return dialog;
}
async function sameOriginAPI() {
  if (sameOriginAvailable !== undefined) return sameOriginAvailable;
  try {
    const response = await fetch(location.origin + '/api/health', {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(1600),
    });
    sameOriginAvailable = response.ok && (await response.json()).service === 'roleve-saha';
  } catch {
    sameOriginAvailable = false;
  }
  return sameOriginAvailable;
}
async function login(id, ctx) {
  const state = id ? await getSyncState(id) : null;
  const codespace = location.protocol === 'https:' && location.hostname.endsWith('-8794.app.github.dev');
  const fallback = state?.server || ((await sameOriginAPI()) ? location.origin : '');
  form(
    codespace ? 'Ekip hesabıyla giriş' : 'Özel sunucuya bağlan',
    [
      ...(codespace ? [] : [{
        key: 'url',
        label: 'Sunucu adresi',
        required: true,
        value: fallback,
        placeholder: 'https://rolove.ornek.com',
        full: true,
      }]),
      { key: 'username', label: 'Kullanıcı adı', required: true, value: state?.username || '', full: true },
      { key: 'password', label: 'Parola', type: 'password', required: true, full: true },
    ],
    'Oturum aç',
    async ({ url, username, password }, f) => {
      await loginCloud({ url: codespace ? location.origin : url, username, password });
      f.querySelector('[name=password]').value = '';
      await ctx.refreshList?.();
      if (ctx.p && !(await loadProject(ctx.p.id))) await ctx.refreshProject?.(ctx.p.id);
      await panel(id, ctx);
      return false;
    },
    { intro: 'Ölçü ve fotoğraflar seçtiğin özel sunucuda saklanır. Hesabı sunucu yöneticisi açar.' }
  );
}

function archiveFile(p) {
  const filename = (p.name || 'Roleve').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 100);
  downloadFile(
    new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }),
    filename + '.roleve.json'
  );
}
async function localArchive(id) {
  const p = id && (await loadProject(id));
  if (!p) throw Error('Önce bir yerel proje açın.');
  archiveFile(p);
}

async function afterSync(id, ctx) {
  let saved;
  try {
    saved = await syncProject(id);
  } catch (e) {
    if (e.code === 'CONFLICT') return chooseConflicts(id, ctx, e.conflicts);
    throw e;
  }
  if (ctx.p?.id === id) await ctx.refreshProject?.(id);
  else {
    await ctx.refreshList?.();
    await ctx.selectProject?.(id);
  }
  ctx.toast?.('Sunucu onayı alındı · Sürüm ' + saved.revision);
  await panel(id, ctx);
}

function variantSummary(value) {
  if (value == null) return 'Bu sürümde yok';
  if (typeof value !== 'object') return String(value).slice(0, 120);
  return value.name || value.text || value.raw || value.type || 'Öğe verisi';
}
function geometrySummary(base, item) {
  if (!item?.nodes) return variantSummary(item);
  const old = new Map((base?.nodes || []).map((n) => [n.id, n]));
  const fields = item.nodes
    .filter((n) => !old.has(n.id) || old.get(n.id).x !== n.x || old.get(n.id).y !== n.y)
    .slice(0, 3);
  return fields.length
    ? fields.map((n) => String(n.id).slice(-6) + ' → ' + n.x + ' / ' + n.y + ' mm').join(', ')
    : (item.rooms?.length || 0) + ' mahal, ' + (item.walls?.length || 0) + ' duvar';
}
function chooseConflicts(id, ctx, list) {
  const fields = list.map((c, i) => {
    const geometry = c.path === '/geometry';
    const summary = (p) => (geometry ? geometrySummary(c.base, p) : variantSummary(p));
    const title = geometry
      ? 'Bağlı duvar ve köşe geometrisi'
      : groups[c.path.split('/')[1]] || 'Proje bilgisi';
    return {
      key: 'c' + i,
      label: title,
      full: true,
      required: true,
      choices: [
        ['', 'Sürümü seç'],
        ['local', 'Bu cihaz · ' + summary(c.local)],
        ['remote', 'Sunucu · ' + summary(c.remote)],
      ],
      hint: c.detail || 'Önceki değer · ' + summary(c.base),
    };
  });
  form(
    'Değişiklikleri karşılaştır',
    fields,
    'Seçimleri uygula',
    async (data) => {
      const choices = Object.fromEntries(list.map((c, i) => [c.path, data['c' + i]]));
      await resolveConflict(id, choices);
      await afterSync(id, ctx);
      return false;
    },
    {
      intro:
        'Her fark için kullanılacak sürümü seç. Önceki sunucu sürümleri geçmişten açılabilir. Geometri seçiminde bağlı duvarlar, köşeler ve öğeler birlikte uygulanır.',
    }
  );
}

async function cloudList(ctx) {
  const rows = await listCloudProjects();
  const items = rows
    .map((p) =>
      row('open', p.name + ' · ' + (roles[p.role] || p.role) + ' · Sürüm ' + p.revision, 'folder', p.id)
    )
    .join('');
  menu(
    'Sunucudaki projeler',
    items || message('Bu hesapta kayıtlı veya paylaşılmış proje yok.'),
    actAndValue
  );
  async function actAndValue(action, id) {
    if (action === 'open') await afterSync(id, ctx);
  }
}

function changedTypes(old, latest) {
  return Object.entries(groups).flatMap(([key, label]) => {
    const before = new Map((old[key] || []).map((e) => [e.id, e]));
    const after = new Map((latest[key] || []).map((e) => [e.id, e]));
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))
    ).length;
    return changed ? [label + ' · ' + changed] : [];
  });
}
async function versionDetails(id, revision, ctx) {
  const past = await readVersion(id, revision);
  const current = await loadProject(id);
  const changes = current ? changedTypes(past, current) : [];
  const body =
    message(
      [
        past.name,
        (past.rooms || []).length + ' mahal',
        (past.observations || []).length + ' ölçü',
        (past.notes || []).length + ' not',
      ].join(' · ')
    ) +
    (current
      ? message(
          changes.length ? 'Bu cihazla farklar · ' + changes.join(', ') : 'Öğe listeleri bu cihazla aynı.'
        )
      : '') +
    row('copy', 'Sürümü ayrı proje olarak aç', 'folder') +
    row('file', 'Bu sürümü Dosyalar’a kaydet', 'download') +
    (current ? row('restore', 'Bu projede geri yükle', 'undo') : '');
  menu('Sürüm ' + revision, body, async (act) => {
    if (act === 'file') archiveFile(past);
    if (act === 'copy') {
      const now = new Date().toISOString();
      const saved = await saveProject(
        { ...past, id: uid(), name: past.name + ' · Sürüm ' + revision, createdAt: now, updatedAt: now },
        { expectedUpdatedAt: null }
      );
      closeDialog();
      await ctx.refreshList?.();
      await ctx.selectProject?.(saved.id);
    }
    if (act === 'restore') {
      form(
        'Sürümü geri yükle',
        [],
        'Yeni sürüm olarak kaydet',
        async () => {
          await restoreVersion(id, revision);
          await afterSync(id, ctx);
          return false;
        },
        {
          intro:
            'Sürüm ' + revision + ' bu projede yeni değişiklik olarak kaydedilecek. Önceki sürümler korunur.',
        }
      );
    }
  });
}
async function history(id, ctx) {
  if (!cloudSession()) return login(id, ctx);
  if (!id) return cloudList(ctx);
  const versions = await listVersions(id);
  menu(
    'Sürüm geçmişi',
    versions
      .map((v) =>
        row(
          'version',
          'Sürüm ' + v.revision + ' · ' + dateText(v.at) + ' · ' + v.username,
          'clock',
          v.revision
        )
      )
      .join('') || message('Henüz sunucu sürümü yok.'),
    async (act, n) => {
      if (act === 'version') await versionDetails(id, Number(n), ctx);
    }
  );
}
function share(id, ctx) {
  form(
    'Projeye erişim ver',
    [
      { key: 'username', label: 'Sunucudaki kullanıcı adı', required: true, full: true },
      {
        key: 'role',
        label: 'Erişim',
        choices: [
          ['viewer', 'Görüntüleyebilir'],
          ['editor', 'Düzenleyebilir'],
          ['none', 'Erişimi kaldır'],
        ],
        full: true,
      },
    ],
    'Uygula',
    async ({ username, role }) => {
      await shareProject(id, username, role);
      ctx.toast?.('Proje erişimi güncellendi.');
    },
    { intro: 'Seçim yalnız bu projeye uygulanır. Hesap aynı sunucuda önceden açılmış olmalı.' }
  );
}
async function teamMembers(ctx) {
  const members = await listMembers();
  const body =
    row('new', 'Ekip üyesi ekle', 'plus') +
    row('work', 'Ekip çalışmalarını gör', 'visit') +
    (members.length
      ? members
          .map((m) =>
            row('member', m.username + ' · ' + (m.active ? 'Etkin' : 'Erişimi kapalı'), 'user', m.username)
          )
          .join('')
      : message('Henüz ekip üyesi yok.'));
  menu('Ekip üyeleri', body, async (action, value) => {
    if (action === 'work') return workPanel(ctx);
    if (action === 'new')
      return form(
        'Ekip üyesi ekle',
        [
          { key: 'username', label: 'Kullanıcı adı', required: true, full: true },
          {
            key: 'password',
            label: 'İlk parola · en az 12 karakter',
            type: 'password',
            required: true,
            full: true,
          },
        ],
        'Hesabı oluştur',
        async (d, f) => {
          await createMember(d.username, d.password);
          f.elements.password.value = '';
          ctx.toast?.('Ekip hesabı oluşturuldu.');
          await teamMembers(ctx);
          return false;
        },
        {
          intro:
            'Üye kendi hesabıyla giriş yapar. Açtığı ve sunucuya eşitlediği projeleri Ekip çalışmaları ekranında görebilirsin.',
        }
      );
    const member = members.find((m) => m.username === value);
    if (!member) return;
    menu(
      member.username,
      row('reset', 'Parolayı yenile', 'lock') +
        row('toggle', member.active ? 'Hesaba erişimi kapat' : 'Hesaba erişimi aç', 'user'),
      async (act) => {
        if (act === 'reset')
          return form(
            'Üye parolasını yenile',
            [
              {
                key: 'password',
                label: 'Yeni parola · en az 12 karakter',
                type: 'password',
                required: true,
                full: true,
              },
            ],
            'Yeni parolayı uygula',
            async (d, f) => {
              await manageMember(member.username, 'reset', d.password);
              f.elements.password.value = '';
              await teamMembers(ctx);
              return false;
            },
            { intro: member.username + ' için açık sunucu oturumları kapanır.' }
          );
        const action = member.active ? 'disable' : 'enable';
        form(
          member.active ? 'Üye erişimini kapat' : 'Üye erişimini aç',
          [],
          member.active ? 'Erişimi kapat' : 'Erişimi aç',
          async () => {
            await manageMember(member.username, action);
            await teamMembers(ctx);
            return false;
          },
          {
            intro: member.active
              ? member.username + ' sunucuya erişemeyecek. Projeleri ve geçmişi ekipte korunur.'
              : member.username + ' kendi parolasıyla yeniden giriş yapabilecek.',
          }
        );
      }
    );
  });
}
function teamTime(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('tr-TR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';
}
async function workPanel(ctx, query = '', offset = 0) {
  const data = await teamWork(query, offset);
  const list = data.projects
    .map(
      (p) =>
        row('open', p.name + ' · ' + p.owner, 'folder', p.id) +
        message(
          [
            p.customer,
            p.surveyorName ? 'Sorumlu: ' + p.surveyorName : '',
            'Son eşitleyen: ' + (p.lastWriter || 'Paylaşımlı kullanıcı') + ' · ' + teamTime(p.at),
            p.observations + ' ölçü · ' + p.visits + ' ziyaret',
            p.declaredPeople.length ? 'Sahada bildirilen: ' + p.declaredPeople.join(', ') : '',
          ]
            .filter(Boolean)
            .join(' / ')
        )
    )
    .join('');
  const log = data.activity
    .map((a) =>
      row(
        'open',
        teamTime(a.at) + ' · ' + a.username + ' · ' + a.projectName + ' · Sürüm ' + a.revision,
        'clock',
        a.project
      )
    )
    .join('');
  const content =
    row('search', query ? 'Arama · ' + query : 'Proje veya kişi ara', 'search') +
    (query ? row('clear', 'Aramayı temizle', 'close') : '') +
    '<h3>Projeler</h3>' +
    (list || message('Bu aramada ekibe ait proje yok.')) +
    '<h3>Sunucu hareketleri</h3>' +
    (log || message('Görüntülenecek sürüm kaydı yok.')) +
    (offset ? row('prev', 'Daha yeni hareketler', 'clock') : '') +
    (data.more ? row('next', 'Daha eski hareketler', 'clock') : '');
  menu('Ekip çalışmaları', content, async (act, id) => {
    if (act === 'open') return afterSync(id, ctx);
    if (act === 'prev' || act === 'next')
      return workPanel(ctx, query, Math.max(0, offset + (act === 'next' ? 80 : -80)));
    if (act === 'clear') return workPanel(ctx);
    if (act === 'search')
      return form(
        'Ekip çalışmalarında ara',
        [{ key: 'q', label: 'Proje, kullanıcı, müşteri veya saha çalışanı', value: query, full: true }],
        'Ara',
        async (d) => {
          await workPanel(ctx, d.q.trim());
          return false;
        }
      );
  });
}

async function signout(id, ctx) {
  const state = id && (await getSyncState(id));
  const linked = !!state?.server;
  form(
    'Sunucu oturumunu kapat',
    linked
      ? [{ key: 'purge', label: 'Bu projenin cihaz kopyasını da kaldır', type: 'check', full: true }]
      : [],
    'Oturumu kapat',
    async ({ purge }) => {
      if (linked && purge) await removeDeviceCopy(id);
      try {
        await logoutCloud();
      } finally {
        closeDialog();
        await ctx.refreshList?.();
        if (ctx.p && !(await loadProject(ctx.p.id))) await ctx.refreshProject?.(ctx.p.id);
      }
      ctx.toast?.('Sunucu oturumu kapatıldı.');
    },
    {
      intro:
        'Hesaba bağlı kopyalar bu tarayıcıda gizlenir. Bekleyen bir çalışmayı kaldırmadan önce Dosyalar’a kaydet.',
    }
  );
}

async function panel(id, ctx) {
  const session = cloudSession();
  const state = id ? await getSyncState(id) : null;
  let body = '';
  if (id && state) {
    body += message(
      (ctx.p?.id === id ? ctx.p.name + ' · ' : '') +
        (names[state.state] || 'Bu cihazda') +
        (state.revision ? ' · Sürüm ' + state.revision : '')
    );
    if (state.lastSync)
      body += message('Son sunucu onayı · ' + new Date(state.lastSync).toLocaleString('tr-TR'));
    if (state.pendingFiles?.length)
      body += message(
        'Aktarım bekleyen dosyalar (' +
          state.pendingFiles.length +
          ') · ' +
          state.pendingFiles.slice(0, 5).join(', ')
      );
    body += '<p class="intro" role="status" data-cloud-progress="' + esc(id) + '"></p>';
  }
  if (session) {
    body += message(session.username + ' · ' + session.url);
    if (id && state)
      body += row('sync', state.state === 'conflict' ? 'Çakışmaları incele' : 'Şimdi eşitle', 'refresh');
    body += row('list', 'Sunucudaki projeleri aç', 'cloud');
    if (session.isAdmin)
      body += row('team', 'Ekip üyeleri', 'user') + row('work', 'Ekip çalışmaları', 'visit');
    if (id && state?.revision) body += row('versions', 'Sürüm geçmişi ve geri yükleme', 'clock');
    if (id && state?.role === 'owner' && state.revision)
      body += row('share', 'Proje erişimini yönet', 'settings');
    body += row('logout', 'Sunucu oturumunu kapat', 'close');
  } else {
    body += row('login', location.hostname.endsWith('-8794.app.github.dev') ? 'Ekip hesabıyla giriş' : 'Özel sunucuya bağlan', 'cloud');
  }
  if (id && state) {
    body +=
      row('package', 'Tam proje paketini kaydet', 'download') +
      message(
        'Paket fotoğrafları ve ölçüleri içerir. iPad’de Dosyalar üzerinden iCloud Drive veya Drive klasörünü seçebilirsin.'
      ) +
      row('persist', 'Kalıcı cihaz depolaması iste', 'archive');
  }
  body += row('github', 'GitHub proje arşivi', 'archive');
  menu('Bulut ve yedekler', body, async (act) => {
    if (act === 'github') return (await import('../ui/github-workspace.js')).showWorkspace(ctx);
    if (act === 'login') return login(id, ctx);
    if (act === 'sync')
      return state?.state === 'conflict' ? chooseConflicts(id, ctx, state.conflicts) : afterSync(id, ctx);
    if (act === 'list') return cloudList(ctx);
    if (act === 'team') return teamMembers(ctx);
    if (act === 'work') return workPanel(ctx);
    if (act === 'versions') return history(id, ctx);
    if (act === 'share') return share(id, ctx);
    if (act === 'logout') return signout(id, ctx);
    if (act === 'package') return localArchive(id);
    if (act === 'persist')
      ctx.toast?.(
        (await requestPersistentStorage())
          ? 'Tarayıcı kalıcı depolamayı onayladı.'
          : 'Tarayıcı depolama iznini vermedi. Proje paketini saklayabilirsin.'
      );
  });
}
export async function storageAction(act, id, ctx) {
  if (!['cloud', 'cloud-sync', 'versions', 'team-login'].includes(act)) return false;
  const projectId = id || ctx.p?.id;
  if (location.hostname === 'musacnktrn.github.io' && /^\/roleve-saha(?:\/|$)/.test(location.pathname)) {
    (await import('../ui/github-workspace.js')).showWorkspace(ctx);
    return true;
  }
  if (act === 'team-login' && !cloudSession()) { await login(projectId, ctx); return true; }
  if (act === 'versions') await history(projectId, ctx);
  else if (act === 'cloud-sync' && projectId && cloudSession()) await afterSync(projectId, ctx);
  else await panel(projectId, ctx);
  return true;
}
