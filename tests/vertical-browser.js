// [codex] ureten: codex. Isolated synthetic upper-floor field survey.
import * as G from '/app/geometry/core.js';
import {listProjects,loadProject,saveProject} from '/app/storage/store.js';
import {buildDrawing} from '/app/views/render.js';
import {indexProject,buildSolids} from '/app/views/model.js';
import {createGithubBundle,readGithubBundle} from '/app/storage/github/bundle.js';
const frame=document.querySelector('#subject'),result={ok:false,checks:[]};
const doc=()=>frame.contentDocument,get=q=>doc().querySelector(q),win=()=>frame.contentWindow;
async function until(fn,label) {
  const start=performance.now();
  while(performance.now()-start<8000){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,28));}
  throw Error(label+' '+(get('.err')?.textContent||get('#toast')?.textContent||''));
}
function check(name,value){if(!value)throw Error(name);result.checks.push(name);}
async function click(q){(await until(()=>get(q),q)).click();}
async function action(key){await click('[data-act="'+key+'"]');}
function select(q,value){const el=get(q);el.value=value;el.dispatchEvent(new(win().Event)('change',{bubbles:true}));}
function fill(q,value){const el=get(q);el.value=value;el.dispatchEvent(new(win().Event)('input',{bubbles:true}));el.dispatchEvent(new(win().Event)('change',{bubbles:true}));}
async function reload(){const next=new Promise(r=>frame.addEventListener('load',r,{once:true}));win().location.reload();await next;await until(()=>get('#viewport .room'),'Uygulama açılmadı');}
function visible(el){const r=el?.getBoundingClientRect();return r&&r.width>0&&r.height>0&&r.left>=0&&r.right<=win().innerWidth+.5;}
try {
  await until(()=>get('#viewport .room'),'Örnek açılış');
  const before=await loadProject((await listProjects())[0].id);
  const p=G.createProject('Sentetik iki mahal');p.id=before.id;
  const upper=G.addFloor(p,{name:'Üst kat',elevation:3200});
  G.addRoom(p,{points:G.templatePoints('rect',1000,1200),name:'Zemin odası',height:2100});
  const r=G.addRoom(p,{floorId:upper.id,points:G.templatePoints('rect',4500,4200),name:'Atölye'});
  const wall=r.wallIds[0];
  const other=G.addAdjacentRoom(p,{roomId:r.id,wallId:wall,depth:2600,name:'Antre',height:3300});
  const unknown=G.addElement(p,{roomId:r.id,wallId:wall,type:'window',name:'Yüksek pencere',offset:1450,width:850});
  const door=G.addElement(p,{roomId:r.id,wallId:wall,type:'door',name:'Bahçe kapısı',offset:320,width:850,height:2200,sill:0});
  const zone=G.addZone(p,{roomId:r.id,type:'beam',name:'Giriş kirişi',points:G.templatePoints('rect',1200,500),bottom:2050,top:2450});
  G.addZone(p,{roomId:other.id,type:'beam',name:'Antre kirişi',points:G.templatePoints('rect',1000,500,{x:300,y:-660}),bottom:1800,top:2400});
  await saveProject(p,{expectedUpdatedAt:before.updatedAt});await reload();
  const snapshot=()=>loadProject(p.id);
  const rHeight=q=>q.rooms.find(x=>x.id===r.id).height;
  const view=mode=>click('[data-act=view][data-mode="'+mode+'"]');
  const card=()=>until(()=>get('#fd-height')&&get('#fd-method'),'Net yükseklik kartı');
  const close=()=>click('#dlg-x');
  async function svgPick(filter,side='inside',roomId=r.id,wallId=wall) {
    const rendered=buildDrawing(await snapshot(),{mode:'elevation',roomId,wallId,floorId:upper.id,side});
    const ix=rendered.picks.findIndex(x=>filter(x.meta));
    if(ix<0)throw Error('Görünüş hedefi bulunamadı');
    const el=get('#viewport [data-rs-pick="'+ix+'"]');
    if(!el)throw Error('Görünüş DOM hedefi bulunamadı');
    el.dispatchEvent(new(win().KeyboardEvent)('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  }
  select('#floor-select',upper.id);await view('elevation');
  const toolbar=get('.vertical-toolbar');
  check('Duvar görünüşünde duvar seçimi, doğrudan tavan ve detay kontrolleri görünür',visible(toolbar)&&[...toolbar.children].every(visible)&&toolbar.textContent.includes('Ölçü gir'));
  await svgPick(m=>m.roomHeight);await card();
  check('Ölçülmemiş görünüş etiketine Enter mahal kartını doğru katta açar',!get('#fd-height').value&&get('#modal').textContent.includes('Atölye')&&get('#modal').textContent.includes('Üst kat'));
  fill('#fd-height','-10');select('#fd-method','laser');await click('#edit-form [type=submit]');
  await until(()=>get('.err')?.textContent,'Negatif yükseklik');
  check('Geçersiz değerde eski proje ve açık düzenleme korunur',rHeight(await snapshot())===null&&!!get('dialog[open]'));
  fill('#fd-height','270,00 cm');await click('#edit-form [type=submit]');
  await until(async()=>rHeight(await snapshot())===2700&&!get('dialog[open]'),'270 cm kaydı');
  let edited=await snapshot();const obs=edited.observations.find(o=>o.purpose==='room-ceiling');
  check('270,00 cm lazer okuması özgün biçim, birim, mahal ve üst kat ile kaydedilir',obs?.raw==='270,00'&&obs.unit==='cm'&&obs.method==='laser'&&obs.roomId===r.id&&obs.floorId===upper.id);
  check('Kat +3,20 m iken görünüş tavan kotu +5,90 m, komşu mahal 3,30 m kalır',get('#viewport').textContent.includes('5,9')&&edited.rooms.find(x=>x.id===other.id).height===3300);
  check('Yükseklik girildiğinde tavan ve döşeme çizime sığar',(()=>{const b=get('#viewport').viewBox.baseVal;return b.y<=-2700&&b.y+b.height>=0;})());
  await view('section');
  const cut=buildDrawing(edited,{mode:'section',floorId:upper.id,roomId:r.id});
  const cutIx=cut.picks.findIndex(x=>x.meta.roomId===r.id&&!x.meta.wallId&&!x.meta.zoneId&&!x.meta.elementId);
  const cutShape=get('#viewport polygon[data-rs-pick="'+cutIx+'"]');
  check('Canlı kesitte atölye zemini +3200, tavanı +5900 mm',!!cutShape&&Math.abs(cutShape.getBBox().y+5900)<.05&&Math.abs(cutShape.getBBox().height-2700)<.05);
  await view('model');
  const mesh=buildSolids(indexProject(edited)).filter(s=>s.wallId===r.wallIds[2]);
  const zs=mesh.flatMap(s=>s.faces.flat().map(v=>v.z));
  check('3B görünümde aynı duvarın fiziksel köşe kotları 3200 ve 5900 mm',!!get('#viewport polygon[data-rs-pick]')&&Math.min(...zs)===3200&&Math.max(...zs)===5900);
  await view('elevation');
  const heightButton='.vertical-toolbar [data-act=room-height]';
  const heightActions=()=>[...get('.vertical-toolbar').querySelectorAll('button,select')];
  result.controls=heightActions().map(x=>({tag:x.tagName,width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height,left:x.getBoundingClientRect().left,right:x.getBoundingClientRect().right}));
  check('Telefon ve tablet denetimleri çizim alanına taşmadan dokunulabilir',heightActions().every(x=>visible(x) && parseFloat(win().getComputedStyle(x).minHeight)>=44 && x.getBoundingClientRect().height>=43.9));
  await action('vertical-details');
  check('Eksik açıklık çizilemese de kendi duvarının kartında parapet ve yüksekliği ile listelenir',get('[data-act=edit-element][data-id="'+unknown.id+'"]').textContent.includes('Ölçülmedi'));
  await click('[data-act=edit-element][data-id="'+unknown.id+'"]');
  await until(()=>get('#fd-type')?.value==='window','Eksik pencere kartı');
  check('Eksik pencere kendi ölçü kartını açar',get('#fd-sill') && get('#fd-height') && get('#fd-type')?.value==='window');
  await close();await svgPick(m=>m.elementId===door.id);
  await until(()=>get('#fd-type')?.value==='door','Kapı kartı');
  check('Görünüşte çizilmiş kapıya dokunmak doğrudan açıklık kartını açar',!!get('#fd-sill')&&get('#fd-type').value==='door');await close();
  await svgPick(m=>m.heightZone&&m.zoneId===zone.id);
  await until(()=>get('#fd-type')?.value==='beam','Kiriş kot kartı');
  check('Duvar üzerindeki kiriş altı kendi kot kartına gider',get('#fd-bottom')?.value&&get('#fd-type').value==='beam');
  await close();await action('vertical-details');await action('add-ceiling-zone');
  await until(()=>get('#fd-type')?.value==='ceiling','Tavan bölgesi');
  check('Asma tavan kısa yolu bölge türünü doğru seçer',get('#fd-type').value==='ceiling');await close();
  await action('vertical-details');await action('add-beam-zone');
  await until(()=>get('#fd-type')?.value==='beam','Kiriş bölgesi');
  check('Kiriş kısa yolu üst ve alt kotları ayrı açar',get('#fd-type').value==='beam'&&get('#fd-bottom')&&get('#fd-top'));await close();
  await action('vertical-details');await action('vertical-checks');
  check('Kat kontrolü kirişten 150 mm yüksek lentoyu ve eksik pencereyi tam kartına bağlar',
    get('[data-act=vertical-fix-element][data-id="'+door.id+'"]').textContent.includes('150')&&get('[data-act=vertical-fix-element][data-id="'+unknown.id+'"]')&&!get('#modal').textContent.includes('Zemin odası'));
  await click('[data-act=vertical-fix-element][data-id="'+unknown.id+'"]');
  await until(()=>get('#fd-type')?.value==='window','Kontrolden pencere kartı');
  check('Kontrolden gidilen öğe doğru pencere ve duvarı açar',get('#fd-type').value==='window'&&get('#fd-name').value==='Yüksek pencere');await close();
  await action('vertical-details');await action('shared-wall-room');
  check('Ortak duvarın karşı mahalinde ayrı tavan ve aynı duvar kimliği açılır',get(heightButton).dataset.id===other.id&&get('[data-vertical-select]').value===wall);
  await action('vertical-details');await action('vertical-checks');
  const wallFix='[data-act=vertical-fix-wall][data-id="'+wall+'"][data-room-id="'+other.id+'"]';
  check('Kalınlığı bilinmeyen karşı iç yüz kontrolü doğrudan ilgili duvarı ister',get(wallFix)?.textContent.includes('kalınlığını ölç'));
  await click(wallFix);await until(()=>get('#fd-thickness'),'Duvar kalınlığı kartı');
  fill('#fd-thickness','160 mm');await click('#edit-form [type=submit]');
  await until(async()=>!get('dialog[open]')&&(await snapshot()).walls.find(w=>w.id===wall).thickness===160,'Duvar kalınlığı kaydı');
  await action('vertical-details');await action('vertical-checks');
  const hallFix='[data-act=vertical-fix-element][data-id="'+door.id+'"][data-room-id="'+other.id+'"]';
  check('Aynı kapı için 160 mm ötede Antre kirişinin 400 mm aşımı doğru mahalde görünür',get(hallFix)?.textContent.includes('400')&&!get(wallFix));
  await click(hallFix);await until(()=>get('#fd-type')?.value==='door','Karşı mahaldeki kapı kartı');
  check('Karşı mahalin kapı kartı kendi tavanını gösterirken açıklığın ilk kayıt sahibi korunur',get('#modal').textContent.includes('Antre')&&get('#opening-levels')?.textContent.includes('1,8')&&(await snapshot()).elements.find(e=>e.id===door.id).roomId===r.id);
  await close();await action('vertical-details');await action('shared-wall-room');
  await click(heightButton);await card();fill('#fd-height','3050 mm');select('#fd-method','tape');await click('#edit-form [type=submit]');
  await until(async()=>rHeight(await snapshot())===3050&&!get('dialog[open]'),'İkinci okuma');
  edited=await snapshot();const next=edited.observations.find(o=>o.replaces===obs.id);
  check('Düzeltme eski ham ölçüyü silmeden yeni yöntemi ve değeri bağlar',next?.raw==='3050'&&next.unit==='mm'&&next.method==='tape'&&edited.observations.some(o=>o.id===obs.id));
  await action('undo');await until(async()=>rHeight(await snapshot())===2700,'Geri al');
  await action('redo');await until(async()=>rHeight(await snapshot())===3050,'Yinele');
  await view('ceiling');
  check('Tavan planında aynı mahal kaydı ve yeni mutlak +6,25 m görünür',get(heightButton).dataset.id===r.id&&get('#viewport').textContent.includes('6,25'));
  await click(heightButton);await card();get('#fd-unmeasured').click();await click('#edit-form [type=submit]');
  await until(async()=>rHeight(await snapshot())===null&&!get('dialog[open]'),'Ölçülmedi');
  check('Ölçülmedi seçimi önceki gerçek okumaları ve komşu mahali korur',(await snapshot()).observations.some(o=>o.id===next.id)&&get(heightButton).textContent.includes('Ölçü gir'));
  await action('undo');await until(async()=>rHeight(await snapshot())===3050,'Ölçülmediyi geri al');
  await reload();select('#floor-select',upper.id);await view('elevation');
  const archive=await createGithubBundle(await snapshot());
  const restored=await readGithubBundle(archive.files.map(o=>new File([o.blob],o.name)));
  check('Yeniden açma ve GitHub proje arşivi üst katta yüksekliği, geçmişi ve yerel kirişi korur',rHeight(restored)===3050&&restored.zones.find(v=>v.id===zone.id).bottom===2050&&restored.observations.find(o=>o.id===next.id).replaces===obs.id&&get(heightButton).dataset.id===r.id);
  result.ok=true;
} catch(e){result.error=e.message;result.line=String(e.stack).split('\n').slice(1,4);}
await fetch('/'+location.hash.slice(1)+'/result',{method:'POST',body:JSON.stringify(result)});
