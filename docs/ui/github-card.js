// [codex] A readable companion to the private archive. Filenames remain unique per exported version.
function label(value) {
  return String(value ?? '').replace(/\s+/g,' ').trim().slice(0,220);
}
function html(value) {
  return label(value).replace(/[&<>"'@]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','@':'&#64;'}[c]));
}
function slug(value) {
  return label(value).toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFKD')
    .replace(/\p{M}/gu,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,45);
}
export function surveyCard(project,bundle) {
  const customer=project.customer?.name || '';
  const staff=[...new Set([...(project.visits||[]).map(v=>label(v.person)),
    ...(project.observations||[]).map(o=>label(o.measuredBy))].filter(Boolean))];
  const rows=[
    ['Müşteri',customer||'Belirtilmedi'],['Proje',project.name],['Proje sorumlusu',project.surveyorName||'Belirtilmedi'],
    ['Sahada ölçüyü alanlar',staff.join(', ')||'Belirtilmedi'],['Son cihaz kaydı',project.updatedAt||'Belirtilmedi'],
    ['Kat / mahal',`${project.floors.length} / ${project.rooms.length}`],
    ['Kaydedilen ölçü / ziyaret',`${(project.observations||[]).length} / ${(project.visits||[]).length}`]
  ];
  const data=['# Rölöve saha kartı','','<table>',...rows.map(([k,v])=>`<tr><th>${html(k)}</th><td>${html(v)}</td></tr>`),'</table>','',
    'Sürümü yükleyen GitHub hesabını ve yükleme zamanını bu dosyanın **History** bölümünde görebilirsin.',
    '','## Proje dosyaları','',...bundle.files.map(f=>`- [${f.name}](./${encodeURIComponent(f.name)})`),'',
    'Dosyaları GitHub’da açıp **Download raw file** ile indir. Rölöve Saha’da **Bulut → GitHub’dan indirilen projeyi aç** ile yükle.',''];
  const name=['saha',slug(customer),slug(project.name),bundle.folder.replace('roleve-paket-','')].filter(Boolean).join('-')+'.md';
  const blob=new Blob([data.join('\n')],{type:'text/markdown;charset=utf-8'});
  return {name,blob,size:blob.size};
}
