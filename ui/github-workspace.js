// [codex] ureten: codex
import { button, downloadFile, esc, icon } from './base.js';
import { showDialog } from './dialog.js';
import { createGithubBundle, readGithubBundle } from '../storage/github/bundle.js';

import { surveyCard } from './github-card.js';

const archives = 'https://github.com/musacnktrn/roleve-saha-ekip';

export function isPublishedStudio(loc = location) {
  return loc.hostname.toLowerCase() === 'musacnktrn.github.io' && /^\/roleve-saha(?:\/|$)/.test(loc.pathname);
}
function link(url,text,symbol='folder') {
  return `<a class="action-row gh-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon(symbol)}<span>${esc(text)}</span>${icon('right')}</a>`;
}
const action=(name,title,symbol)=>button(name,title,symbol,'action-row');
const find=(d,s)=>d.querySelector(`[data-act="${s}"]`);
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
  let body=`<div class="gh-panel"><section><h3>Proje arşivi</h3><p class="intro">Bu cihazdaki çalışmanın bir sürümünü fotoğraflarıyla ekibin özel GitHub deposuna kaydet. Depoya davetli herkes buradaki projeleri görebilir ve değiştirebilir.</p>${ctx.p?action('gh-export','Bu projeyi GitHub’a aktar','upload'):''}${action('gh-import','GitHub’dan indirilen projeyi aç','folder')}${link(archives+'/tree/main/arsiv','Özel proje arşivini görüntüle')}</section>`;
  body+=`<section><h3>Ekip ve saha kayıtları</h3><p class="intro">Herkes kendi GitHub hesabıyla çalışır. Saha kartında ölçüyü alan kişi, sürüm geçmişinde dosyayı yükleyen hesap görünür.</p>${link(archives+'/issues','Ekip saha defterini aç','visit')}${link(archives+'/issues/new?template=saha-kaydi.yml','Yeni saha ziyareti kaydet','plus')}${link(archives+'/commits/main/arsiv/','Sürümü kim yükledi?','clock')}${link(archives+'/settings/access','Ekip üyelerini davet et ve yönet','user')}</section><p class="err gh-error" role="alert"></p></div>`;
  return showDialog('GitHub çalışma alanı',body,d=>{
    busyButton(d,'gh-export',async()=>{
      const p=ctx.p;
      const bundle=await createGithubBundle(p);
      if(find(d,'gh-export')?.isConnected)showExport(bundle,p);
    });
    busyButton(d,'gh-import',()=>showImport(ctx));
  });
}
function showExport(bundle,project) {
  const card=surveyCard(project,bundle);
  const downloads=[...bundle.files,card];
  const many=bundle.files.length>1;
  const sizes=num=>num<1024*1024 ? Math.max(1,Math.ceil(num/1024))+' KB' : (num/(1024*1024)).toLocaleString('tr-TR',{maximumFractionDigits:1})+' MiB';
  const files=downloads.map((f,i)=>`<button type="button" class="action-row gh-file" data-gh-file="${i}">${icon('download')}<span>${esc(f.name)}</span><small>${sizes(f.blob.size)}</small></button>`).join('');
  const body=`<div class="gh-panel"><p>${esc(project.name)}</p><p class="intro">${many?'Parçaları ve liste dosyasını birlikte kaydet.':'Proje dosyasını cihazına kaydet.'} Müşteri ve ölçüleri alan kişi depoda okunabilsin diye saha kartını da kaydet. Ardından GitHub yükleme ekranında dosyaları seçip <strong>Commit changes</strong> düğmesine dokun. Buluta aktarım o adımda tamamlanır.</p><div class="gh-files">${files}</div><div data-gh-share></div>${link(archives+'/upload/main/arsiv','GitHub yükleme ekranını aç','upload')}<p class="err gh-error" role="alert"></p></div>`;
  showDialog('Projeyi GitHub’a aktar',body,d=>{
    for (const b of d.querySelectorAll('[data-gh-file]')) b.onclick=()=>{const f=downloads[Number(b.dataset.ghFile)];downloadFile(f.blob,f.name);};
    if(navigator.canShare && typeof File==='function'){
      const fs=downloads.map(f=>new File([f.blob],f.name,{type:f.blob.type||'application/octet-stream'}));
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
      const files=Array.from(input.files).filter(f=>!/^saha-.*\.md$/i.test(f.name));
      if(!files.length)throw Error('Saha kartındaki bağlantıdan proje dosyasını indirip seç.');
      const raw=await readGithubBundle(files);
      if(input.isConnected)await ctx.importArchive(raw);
    });
  });
}
