// [codex] ureten: codex. This suite always runs on an isolated localhost origin.
import * as G from '/app/geometry/core.js';
import {listProjects, loadProject, saveProject} from '/app/storage/store.js';
import {createGithubBundle, readGithubBundle} from '/app/storage/github/bundle.js';

const frame=document.querySelector('#subject');
const win=()=>frame.contentWindow;
const doc=()=>frame.contentDocument;
const get=selector=>doc().querySelector(selector);
const svg=()=>get('#viewport');
const result={ok:false,checks:[]};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,why) {
  const start=performance.now();
  while(performance.now()-start<12000) {
    const found=await fn();
    if(found)return found;
    await wait(35);
  }
  throw Error(why+' '+(get('.err')?.textContent || get('#toast.on')?.textContent || ''));
}
function check(name,condition) {
  if(!condition)throw Error(name);
  result.checks.push(name);
}
async function click(selector) { (await until(()=>get(selector),selector)).click(); }
async function reload() {
  const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
  win().location.reload();
  await loaded;
  await until(()=>svg()?.querySelector('.room'), 'Plan geri açılmadı');
}
function screen(point) {
  return new (win().DOMPoint)(point.x,point.y).matrixTransform(svg().getScreenCTM());
}
function hit(point) {
  const c=screen(point);
  return doc().elementFromPoint(c.x,c.y);
}
function pointer(type,point,kind='touch',target=svg(),id=3) {
  const c=screen(point);
  target.dispatchEvent(new (win().PointerEvent)(type,{
    bubbles:true,cancelable:true,pointerId:id,pointerType:kind,isPrimary:true,
    button:0,buttons:type==='pointerup'||type==='pointercancel'||kind==='mouse'&&type==='pointermove'?0:1,
    clientX:c.x,clientY:c.y,pressure:kind==='pen'?.6:0
  }));
}
function tap(point,kind='touch') {
  const target=hit(point);
  if(!target||!svg().contains(target))throw Error('Planda dokunulamayan nokta '+[point.x,point.y,target?.tagName,target?.className]);
  pointer('pointerdown',point,kind,target);
  pointer('pointerup',point,kind);
}
async function place(mode='place-photo') {
  await click('[data-act="camera"]');
  await click('[data-act="'+mode+'"]');
  await until(()=>get('#tool-hint')?.textContent.includes('Kameranın yerine'),'Kamera aracı');
}
function inputPhoto(bytes,name,type) {
  const w=win(),dt=new w.DataTransfer();
  dt.items.add(new w.File([bytes],name,{type}));
  get('#fd-photo').files=dt.files;
}
const bytes=Uint8Array.from(atob('@FIELD_HEIC_BASE64@'),ch=>ch.charCodeAt(0));
try {
  await until(()=>svg()?.querySelector('.room'),'İlk çalışma alanı');
  const example=await loadProject((await listProjects())[0].id);
  const plan=G.createProject('Sentetik köşe ve kamera');
  plan.id=example.id;
  const room=G.addRoom(plan,{name:'Ölçülen oda',points:G.templatePoints('rect',4300,3100)});
  const outline=room.nodeIds,wall=room.wallIds[0];
  const a=G.addObservation(plan,{roomId:room.id,raw:'428,50',unit:'cm',kind:'distance',method:'laser',a:{nodeId:outline[0]},b:{nodeId:outline[1]}});
  G.addObservation(plan,{roomId:room.id,raw:'430,00',unit:'cm',kind:'plan',method:'model',a:{nodeId:outline[1]},b:{nodeId:outline[0]}});
  const measurement=JSON.stringify(a),origin={...plan.nodes.find(n=>n.id===outline[1])};
  const locked=plan.nodes.find(n=>n.id===outline[2]);locked.locked=true;
  await saveProject(plan,{expectedUpdatedAt:example.updatedAt});
  await reload();
  const row=()=>get('.wall-line[data-id="'+wall+'"]');
  const snapshot=()=>loadProject(plan.id);
  const pos=p=>p.nodes.find(n=>n.id===origin.id);
  const same=(a,b,t=0.01)=>Math.hypot(a.x-b.x,a.y-b.y)<t;
  check('Ölçülen duvarın iki ucundan girilen 428,50 cm özgün birimle görünür',row().textContent.includes('Saha ölçüsü')&&row().textContent.includes('428,50 cm'));
  check('Ölçü çizgisinin ucundaki tutamaç dokunulabilir',hit(origin)?.closest('[data-node]')?.dataset.node===origin.id);
  tap(origin,'pen');
  check('Köşeye kalemle dokunmak koordinat formu açmaz',!get('dialog[open]'));
  const dest={x:origin.x+350,y:origin.y+210},geom=()=>svg().querySelector('.room').getAttribute('points');
  const before=geom();
  pointer('pointerdown',origin,'touch',hit(origin));pointer('pointermove',dest);
  check('Parmakla sürüklerken mahal görünür biçimde değişir, kayıt bırakmaya kadar bekler',geom()!==before&&same(pos(await snapshot()),origin)&&!get('dialog[open]'));
  pointer('pointerup',dest);
  const moved=await until(async()=>{const q=await snapshot();return !same(pos(q),origin)&&q;},'Köşe kaydedilmedi');
  await until(()=>get('#toast')?.textContent==='Köşe taşındı','Taşıma bitti');
  check('Bırakma tek kayıtta köşeyi taşır ve saha ölçüsünü, tanığını, birimini korur',same(pos(moved),dest,18)&&JSON.stringify(moved.observations[0])===measurement&&row().textContent.includes('428,50 cm')&&!get('dialog[open]'));
  await click('[data-act="undo"]');
  await until(async()=>same(pos(await snapshot()),origin)&&!get('[data-act="redo"]').disabled,'Geri al');
  check('Tek Geri al hareketi eski krokiyi geri getirir',geom()===before);
  await click('[data-act="redo"]');
  await until(async()=>!same(pos(await snapshot()),origin),'Yinele');
  await reload();
  check('Yinele ve sayfayı yeniden açma son köşeyi ve ölçüyü korur',same(pos(await snapshot()),dest,18)&&row().textContent.includes('428,50 cm'));
  const lockedDest={x:locked.x-220,y:locked.y-300};
  pointer('pointerdown',locked,'pen',hit(locked));pointer('pointermove',lockedDest,'pen');pointer('pointerup',lockedDest,'pen');
  await until(()=>get('#toast')?.textContent.toLocaleLowerCase('tr').includes('kilit'),'Kilit bilgisi');
  check('Kilitli köşeyi zorlayan sürükleme veri değiştirmez ve önizleme geri alınır',same((await snapshot()).nodes.find(n=>n.id===locked.id),locked)&&get('circle.node-handle[data-node="'+locked.id+'"]').parentElement.getAttribute('transform')===null);

  const camera={x:1400,y:1350},look={x:3150,y:1350};
  await place();
  tap(camera);
  check('İlk dokunuştan hemen sonra planda kamera ve yön istemi görünür',!!get('#draft-layer .photo-aim')&&get('#tool-hint').textContent.includes('Baktığın yere')&&!get('dialog[open]'));
  pointer('pointermove',look,'mouse');
  check('Konumdan hedefe giderken plandaki ok sağa döner',Math.abs(Number(get('[data-bearing]')?.dataset.bearing)-90)<1);
  tap(camera);
  check('Aynı noktaya ikinci dokunuş yönü uydurmaz ve ilk noktayı korur',!!get('#draft-layer .photo-aim')&&!get('dialog[open]'));
  tap(look);
  await until(()=>get('#fd-direction'),'Fotoğraf formu');
  check('İkinci dokunuş elle açı girmeden fotoğrafı hazırlıyor',Math.abs(Number(get('#fd-direction').value)-90)<1&&get('#fd-roomId').value===room.id);
  if(location.hash) {
    await until(()=>win().navigator.serviceWorker?.controller,'Çevrimdışı önbellek kontrolü');
    await fetch('/'+location.hash.slice(1)+'/offline',{method:'POST'});
    const probe=await win().fetch('/app/field-probe-offline',{cache:'no-store'});
    const decoder=await win().fetch('/app/assets/heic/libheif.wasm');
    check('Bağlantı kesikken gerçek WASM önbellekten doğru biçimde gelir',probe.status===503&&decoder.ok&&(await decoder.arrayBuffer()).byteLength>1000000);
  }
  inputPhoto(new Uint8Array([1,2,3]),'hasarli.heic','image/heic');
  await click('#edit-form [type="submit"]');
  await until(()=>get('#edit-form .err')?.textContent,'Hatalı dosya uyarısı');
  check('Okunamayan dosyanın hatası seçim formunda kalır, fotoğraf kaydı oluşmaz',!(await snapshot()).notes.length&&!!get('#fd-direction'));
  inputPhoto(bytes,'Saha sentetik.HEIC','');
  await click('#edit-form [type="submit"]');
  const saved=await until(async()=>{const q=await snapshot();return q.notes[0];},'HEIC kayıt');
  await until(()=>get('[data-photo-surface]'),'Fotoğraf işaretleme ekranı');
  const decoded=new(win().Image)();decoded.src=saved.photo.data;await decoded.decode();
  check('HEIC galeri dosyası okunur, JPEG üzerinden çizim ve ölçü araçları açılır',saved.photo.sourceType==='image/heic'&&decoded.naturalWidth===16&&decoded.naturalHeight===24&&!!get('.photo-editor [data-tool=dimension]')&&!!get('[data-base-photo]'));
  check('Özgün HEIC baytları, konum ve bakış hedefi proje ile birlikte saklanır',saved.photo.original.data.split(',')[1]==='@FIELD_HEIC_BASE64@'&&same(saved.anchor,camera,18)&&same(saved.target,look,18)&&Math.abs(saved.direction-90)<1);
  await click('#dlg-x');
  await place('place-exterior');
  const exterior={x:4680,y:1800},wallPoint={x:4300,y:2250};
  // Use the middle of the actual right wall after the corner has moved.
  const finalCorner=pos(await snapshot());
  wallPoint.x=finalCorner.x+(locked.x-finalCorner.x)*(wallPoint.y-finalCorner.y)/(locked.y-finalCorner.y);
  pointer('pointerdown',exterior,'touch',hit(exterior));pointer('pointermove',wallPoint);
  check('Tek sürüklemede parmak kalkmadan bakış oku görünür',!!get('[data-bearing]'));
  pointer('pointerup',wallPoint);
  await until(()=>get('#fd-direction'),'Sürükleme fotoğraf formu');
  check('Tek hareket çekim yerini ve yönü seçer, temas edilen duvarı bağlar',get('#fd-wallId').value===room.wallIds[1]&&get('#fd-scene').value==='exterior'&&get('#fd-surface').value==='facade');
  await click('#dlg-x');
  await click('[data-act="notebook"]');
  await click('[data-act="note-info"][data-id="'+saved.id+'"]');
  await click('[data-act="place-photo"][data-id="'+saved.id+'"]');
  const outsideTarget={x:4900,y:1920};
  result.outsideHit={camera:hit(exterior)?.closest('[data-room],[data-wall]')?.tagName || null,target:hit(outsideTarget)?.closest('[data-room],[data-wall]')?.tagName || null};
  tap(exterior);tap(outsideTarget);
  await until(()=>get('#fd-direction'),'Dış çekim yeni yönü');
  result.outsideFields={room:get('#fd-roomId').value,wall:get('#fd-wallId').value,scene:get('#fd-scene').value};
  check('Dışarı bakınca eski mahal ve duvar yeni hedefe taşınmaz',!get('#fd-roomId').value&&!get('#fd-wallId').value&&get('#fd-scene').value==='exterior');
  get('#fd-direction').value='270';get('#fd-openPhoto').checked=false;
  await click('#edit-form [type="submit"]');
  await until(async()=>!get('dialog[open]')&&(await snapshot()).notes[0].direction===270,'Yeniden yön verilen fotoğraf');
  const archived=await snapshot(),bundle=await createGithubBundle(archived);
  const roundtrip=await readGithubBundle(bundle.files.map(f=>new File([f.blob],f.name)));
  const revised=roundtrip.notes[0];
  check('Elle düzeltilen yön eski hedef çizgisini kaldırır ve yeni çekim noktasını saklar',!revised.target&&same(revised.anchor,exterior,18)&&revised.direction===270);
  check('GitHub proje arşivi geri açıldığında HEIC, ölçü ve konum birebir korunur',revised.photo.original.data===saved.photo.original.data&&JSON.stringify(archived.observations)===JSON.stringify(roundtrip.observations));
  await reload();
  check('Tekrar açılan planda kaydedilen fotoğrafın çekim pini ve yönü görünür',!!get('.photo-pin[data-note="'+saved.id+'"]')&&(await snapshot()).notes.length===1);
  result.ok=true;
} catch(error) { result.error=error.message; result.line=String(error.stack).split('\n').slice(1,4); }
await fetch('/'+location.hash.slice(1)+'/result',{method:'POST',body:JSON.stringify(result)});
