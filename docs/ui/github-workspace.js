// [codex] ureten: codex
import { button, downloadFile, esc, icon } from './base.js';
import { showDialog, form } from './dialog.js';
import { createGithubBundle, readGithubBundle } from '../storage/github/bundle.js';

const archives = 'https://github.com/musacnktrn/roleve-saha-ekip';
const runtime = 'https://github.com/musacnktrn/roleve-saha-sunucu';
const settingKey = 'roleve:github:team-url';
export function isPublishedStudio(loc = location) {
  return loc.hostname.toLowerCase() === 'musacnktrn.github.io' && /^\/roleve-saha(?:\/|$)/.test(loc.pathname);
}
export function teamURL(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Yöneticinin gönderdiği tam GitHub ekip adresini gir.'); }
  if (url.protocol!=='https:' || url.username || url.password || url.port ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*-8794\.app\.github\.dev$/.test(url.hostname) ||
      url.pathname!=='/' || url.search || (url.hash && url.hash!=='#ekip')) {
    throw Error('8794 numaralı GitHub Codespaces ekip adresini kullan.');
  }
  return url.origin+'/#ekip';
}
function link(url,text,symbol='folder') {
  return `<a class="action-row gh-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon(symbol)}<span>${esc(text)}</span>${icon('right')}</a>`;
}
const action=(name,title,symbol)=>button(name,title,symbol,'action-row');
const find=(d,s)=>d.querySelector(`[data-act="${s}"]`);
function savedTeam() {
  try {const value=localStorage.getItem(settingKey);return value?teamURL(value):'';} catch{return '';}
}
function editTeam(ctx) {
  form('GitHub ekip adresi',[
    {key:'url',label:'Ekip yöneticisinin paylaştığı adres',value:savedTeam(),required:true,full:true,placeholder:'https://…-8794.app.github.dev'}
  ],'Adresi kaydet',({url})=>{
    const target=teamURL(url);
    localStorage.setItem(settingKey,target);
    showWorkspace(ctx);
    return false;
  });
}
function busyButton(d,name,work) {
  const btn=find(d,name);
  if(!btn) return;
  btn.onclick=async()=>{
    const err=d.querySelector('.gh-error');
    try {btn.disabled=true;if(err)err.textContent='';await work();}
    catch(e){if(err?.isConnected)err.textContent=e.message||'İşlem tamamlanamadı.';}
    finally {if(btn.isConnected)btn.disabled=false;}
  };
}
export function showWorkspace(ctx) {
  const team=savedTeam();
  let body=`<div class="gh-panel"><section><h3>Proje arşivi</h3><p class="intro">Ölçü ve fotoğrafları özel GitHub deposuna aktar. Bu depoya erişimi olanlar içindeki bütün proje arşivlerini görebilir. Tek projeyi paylaşmak için ekip oturumundaki proje erişimini kullan.</p>${ctx.p?action('gh-export','Bu projeyi GitHub’a aktar','upload'):''}${action('gh-import','GitHub’dan indirilen projeyi aç','folder')}${link(archives+'/tree/main/arsiv','Özel proje arşivini görüntüle')}</section>`;
  body+=`<section><h3>Parolalı ekip oturumu</h3><p class="intro">Ekip oturumu açıkken projeler cihazlar arasında eşitlenir. Yönetici buradan kullanıcı ve parola tanımlar.</p>${team?link(team,'Kayıtlı ekip oturumunu aç','people'):''}${action('gh-team-url',team?'Ekip adresini değiştir':'Ekip adresini gir','people')}<details class="gh-admin"><summary>Yönetici işlemleri</summary>${link(runtime,'Sunucu ve ilk kullanım','settings')}${link('https://github.com/codespaces','Mevcut ekip oturumumu başlat','refresh')}${link('https://github.com/codespaces/new?repo=1468094153','Yeni GitHub ekip oturumu kur','plus')}</details></section><p class="err gh-error" role="alert"></p></div>`;
  return showDialog('GitHub çalışma alanı',body,d=>{
    busyButton(d,'gh-export',async()=>{
      const p=ctx.p;
      const bundle=await createGithubBundle(p);
      if(find(d,'gh-export')?.isConnected)showExport(ctx,bundle,p.name);
    });
    busyButton(d,'gh-import',()=>showImport(ctx));busyButton(d,'gh-team-url',()=>editTeam(ctx));
  });
}
function showExport(ctx,bundle,name) {
  const many=bundle.files.length>1;
  const sizes=num=>num<1024*1024 ? Math.max(1,Math.ceil(num/1024))+' KB' : (num/(1024*1024)).toLocaleString('tr-TR',{maximumFractionDigits:1})+' MiB';
  const files=bundle.files.map((f,i)=>`<button type="button" class="action-row gh-file" data-gh-file="${i}">${icon('download')}<span>${esc(f.name)}</span><small>${sizes(f.blob.size)}</small></button>`).join('');
  const body=`<div class="gh-panel"><p>${esc(name)}</p><p class="intro">${many?'Parçaları ve liste dosyasını birlikte kaydet.':'Proje dosyasını cihazına kaydet.'} Ardından GitHub yükleme ekranında dosyaları seçip <strong>Commit changes</strong> düğmesine dokun. Buluta aktarım o adımda tamamlanır.</p><div class="gh-files">${files}</div><div data-gh-share></div>${link(archives+'/upload/main/arsiv','GitHub yükleme ekranını aç','upload')}<p class="err gh-error" role="alert"></p></div>`;
  showDialog('Projeyi GitHub’a aktar',body,d=>{
    for (const b of d.querySelectorAll('[data-gh-file]')) b.onclick=()=>{const f=bundle.files[Number(b.dataset.ghFile)];downloadFile(f.blob,f.name);};
    if(many && navigator.canShare && typeof File==='function'){
      const fs=bundle.files.map(f=>new File([f.blob],f.name,{type:f.blob.type||'application/octet-stream'}));
      if(navigator.canShare({files:fs})){
        d.querySelector('[data-gh-share]').innerHTML=action('gh-share','Dosyaların tümünü kaydet veya paylaş','download');
        busyButton(d,'gh-share',async()=>{try{await navigator.share({files:fs});}catch(e){if(e.name!=='AbortError')throw e;}});
      }
    }
  });
}
function showImport(ctx) {
  showDialog('GitHub arşivini aç',`<div class="gh-panel">${link(archives+'/tree/main/arsiv','Özel depodan dosyaları indir','download')}<p class="intro">Açmak istediğin sürümün dosyasını seç. Çok parçalı arşivde aynı sürümün liste dosyasıyla bütün parçalarını birlikte seç.</p><label class="field"><span>Proje dosyaları</span><input type="file" multiple data-gh-input></label>${action('gh-open','Cihazda aç','folder')}<p class="err gh-error" role="alert"></p></div>`,d=>{
    busyButton(d,'gh-open',async()=>{
      const input=d.querySelector('[data-gh-input]');
      if(!input.files.length)throw Error('Önce GitHub’dan indirdiğin dosyaları seç.');
      const raw=await readGithubBundle(input.files);
      if(input.isConnected)await ctx.importArchive(raw);
    });
  });
}
