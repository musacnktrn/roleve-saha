// [codex] ureten: codex
import {buildDrawing,renderView} from '../render.js';
import {indexProject,buildSolids} from '../model.js';
import {printHTML,exportSVG} from '../export.js';
import {measure,resolveAnchor} from '../../geometry/measure.js';
import {addObservation,addRoom,createProject,normalizeProject} from '../../geometry/core.js';
import {setRoomCeiling} from '../../geometry/ceiling.js';
import {building} from './fixture.js';

const opts={mode:'elevation',roomId:'studio',wallId:'wall-0',floorId:'ground',side:'inside'};
const point=(x,y)=>({x,y});
const rect=(x,y,w,h)=>[point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)];
const at=(drawing,key,id)=>drawing.picks.find(p=>id?p.meta[key]===id:p.meta[key]);
function survey() {
  const p=building();
  p.rooms[0].height=3400;
  Object.assign(p.elements[0],{sill:2380,height:740});
  p.zones.push({id:'soffit',roomId:'studio',type:'ceiling',name:'Ahşap tavan',points:rect(400,0,2400,600),
    bottom:2300,top:2400,slopePoints:[{x:400,y:0,z:2300},{x:2800,y:0,z:2900},{x:400,y:600,z:2300}]});
  return p;
}
function fieldSurvey(method='estimate') {
  const input=createProject('Kaynak deneyi'),floor=input.floors[0];floor.elevation=200;
  const room=addRoom(input,{name:'Kaynak odası',floorId:floor.id,points:rect(0,0,4000,3000)});
  for(const wall of input.walls)wall.thickness=220;
  let reading=null;
  if(method==='legacy')room.height=2800;
  else if(method!=='unknown')reading=setRoomCeiling(input,room.id,{height:'2,80',unit:'m',method}).observation;
  const project=normalizeProject(JSON.parse(JSON.stringify(input)));
  return {project,selection:{roomId:room.id,wallId:room.wallIds[0],floorId:floor.id,side:'inside'},reading};
}

// This entry also runs unchanged in the existing desktop browser with a
// phone-sized SVG. Hit testing uses screen coordinates and the topmost DOM target.
export function browserCeilingChecks(svg) {
  const p=survey(),checks=[];
  let hit=null;
  const check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);};
  const draw=(config={})=>{hit=null;return renderView(svg,p,{...opts,onPick:h=>{hit=h;},...config});};
  const click=(x,y)=>{
    hit=null;
    const s=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM()),node=document.elementFromPoint(s.x,s.y);
    if(!node)throw Error('Çizim noktasının ekran konumu bulunamadı.');
    node.dispatchEvent(new MouseEvent('click',{detail:1,bubbles:true,clientX:s.x,clientY:s.y}));
    return hit;
  };
  const group=fragment=>[...svg.querySelectorAll('[data-rs-pick]')].find(el=>el.getAttribute('aria-label').includes(fragment));
  const key=el=>{hit=null;el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter'}));return hit;};
  svg.style.width='390px';svg.style.height='480px';svg.style.maxWidth='100%';
  draw();svg.scrollIntoView({block:'center'});
  check('390 px · fiziksel üst çizgi net tavanı açar',click(3500,-3400)?.roomHeight&&hit.anchor.z===3600);
  check('390 px · duvarın alt çizgisi bitmiş döşemedir',click(3300,0)?.groundLevel&&hit.anchor.z===200);
  check('390 px · renkli kiriş/tavan çizgisi eğimli alt kotu döndürür',click(800,-2400)?.heightZone&&hit.zoneId==='soffit'&&Math.abs(hit.anchor.z-2600)<=8);
  check('Açıklıkla çakışan çizgi pencere seçimini örtmez',click(1500,-2575)?.elementId==='win-a');
  const target=group('Genel net tavan yüksekliği'),label=target.querySelector('text').getBBox();
  check('Genel tavan etiketi ekranda dokunulabilir',click(label.x+label.width*.5,label.y+label.height*.5)?.roomHeight);
  check('Klavye oda, kat, yüz ve duvar kimliklerini taşır',key(target)?.roomHeight&&hit.roomId==='studio'&&hit.floorId==='ground'&&hit.wallId==='wall-0'&&hit.anchor.side==='inside');
  check('Kiriş etiketinin erişilebilir adı yerel yükseklik ve mutlak kotu içerir',group('Ahşap tavan').getAttribute('aria-label').includes('kot +2,5–+3,1 m'));
  draw({side:'outside'});
  check('Dış görünüşte yalnız mahale başvuran iç NET etiketi vardır',!group('Ahşap tavan')&&key(group('İç yüz · Net'))?.anchor.side==='inside'&&hit.anchor.y===0);
  draw({mode:'ceiling'});
  check('Tavan planındaki etiket aynı mahal kaydına ulaşır',key(group('Atölye · Genel net'))?.roomHeight&&hit.anchor.z===3600);
  check('Tavan planı aynı bölgenin alt yüzünü seçer',key(group('Ahşap tavan'))?.zoneId==='soffit'&&hit.heightZone);
  p.rooms[0].height=null;p.zones=[];p.elements=[];
  draw({tool:'measure'});
  check('Ölçülmeyen tavan klavyeyle de boş kot verir',key(group('Net yükseklik gir'))?.anchor.z===null&&hit.anchor.unmeasuredZ);
  check('Boş görünüşte yükseklik etiketi zemin çizgisini kapatmaz',click(500,0)?.groundLevel&&hit.anchor.z===200);
  for(const tool of ['ink','erase']) {
    draw({tool});
    check(tool+' · odaklanabilir yükseklik düğmesi kalmaz',!svg.querySelector('[data-rs-pick][tabindex]'));
    check(tool+' · SVG kalem/temizleme olayına seçim karışmaz',click(500,0)===null);
  }
  draw();
  check('Seçim moduna dönüşte yeni dinleyici ve etiket çalışır',key(group('Net yükseklik gir'))?.roomHeight);
  const field=fieldSurvey(),source=field.reading.id;
  Object.assign(p,field.project);
  const paint=(mode,extra={})=>draw({...field.selection,mode,tool:'measure',isolate:true,...extra});
  const linked=a=>a?.z===3000&&a.estimated===true&&a.unmeasuredZ===false&&a.zSource?.method==='estimate'&&a.zSource?.observationId===source;
  paint('ceiling');
  const fill=click(3200,450)?.anchor;
  check('Gerçek tavan planı dolgusu +3 m, Tahmin ve saha gözlem kimliğini verir',linked(fill)&&fill.label.includes('Tahmin'));
  check('Aynı tavan planı duvar kenarı kaynağı korur',linked(click(3400,-80)?.anchor));
  check('Aynı tavan planı etiketi dolgunun gözlemini kullanır',linked(key(group('Genel net tavan')).anchor));
  paint('elevation');
  check('Aynı iç duvar üst çizgisi saha kaynağını korur',linked(click(3300,-2800)?.anchor));
  const ground=click(3300,0)?.anchor;
  check('Döşeme tavanın tahminini almaz',ground?.z===200&&!ground.zSource&&!ground.estimated);
  paint('section',{sectionLine:{a:point(-400,1500),b:point(4400,1500)}});
  check('Fiziksel kesit üst kenarı ters ekran kotundan bağımsızdır',linked(click(2400,-3000)?.anchor));
  paint('model');
  let cap=null;
  for(const polygon of svg.querySelectorAll('polygon[aria-label*="Duvar üst yüzü"]')) {
    const verts=Array.from(polygon.points),x=verts.reduce((s,p)=>s+p.x,0)/verts.length,y=verts.reduce((s,p)=>s+p.y,0)/verts.length;
    const sample=click(x,y);if(sample?.roomHeight&&linked(sample.anchor)){cap=sample.anchor;break;}
  }
  check('Ekrandaki 3B duvar üst yüzünün dokunulabilen parçası kaynağı korur',linked(cap));
  const observed=addObservation(p,{...field.selection,kind:'vertical',method:'model',raw:'2,80',unit:'m',a:ground,b:fill});
  const saved=normalizeProject(JSON.parse(JSON.stringify(p))).observations.find(o=>o.id===observed.id);
  check('Normalize edilmiş saha defteri kaynak B tanığını ve 2800 mm değerini korur',linked(saved.b)&&linked(saved.witness.sourceB)&&measure(p,saved.a,saved.b,'vertical')===2800);
  setRoomCeiling(p,field.selection.roomId,{unmeasured:true});paint('ceiling');
  const empty=click(3200,450)?.anchor,emptyLabel=key(group('Genel net tavan')).anchor;
  check('Ölçülmedi durumunda önceki tahmin dolgu veya etiket aracılığıyla geri dönmez',
    [empty,emptyLabel].every(a=>a.z===null&&a.unmeasuredZ&&!a.estimated&&a.zSource.status==='unknown'&&a.zSource.observationId===null));
  return {checks,width:svg.clientWidth,height:svg.clientHeight};
}

if(typeof window==='undefined') {
  const {default:test}=await import('node:test');
  const {default:assert}=await import('node:assert/strict');
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,String(a)+' ≠ '+b);
  const elevations=(p,options={})=>buildDrawing(p,{...opts,...options});
  test('Net tavan/bitmiş döşeme ve bilinmeyen yükseklik ayrı fiziksel uçlardır',()=>{
    const p=survey(),v=elevations(p);
    const hi=at(v,'roomHeight'),lo=at(v,'groundLevel');
    assert.equal(hi.meta.wallId,'wall-0');assert.equal(hi.meta.floorId,'ground');assert.equal(hi.meta.roomId,'studio');
    const a=hi.locate(point(1500,-222)),b=lo.locate(point(1500,-1000));
    assert.equal(a.z,3600);assert.equal(b.z,200);assert.equal(a.side,'inside');near(measure(p,b,a,'vertical'),3400);
    assert.match(v.markup,/Net 3,4 m · Yöntem kaydı yok/);
    p.rooms[0].height=null;p.zones=[];p.elements=[];
    const unknown=elevations(p),ceiling=at(unknown,'roomHeight').locate(point(1234,-1500));
    assert.match(unknown.markup,/Net yükseklik gir/);assert.equal(ceiling.z,null);assert.equal(resolveAnchor(p,ceiling).z,undefined);
    assert.throws(()=>measure(p,b,ceiling,'vertical'),/iki kot/);
    assert.doesNotMatch(unknown.markup,/y[12]="-1500"/);
  });
  test('Temas aralıkları pozitif uzunluklu, oda içi ve duvara bitişik olmalıdır',()=>{
    const p=survey(),z=p.zones.at(-1);
    const add=(id,points,extra={})=>p.zones.push({id,name:id,type:'beam',roomId:'studio',bottom:2250,points,...extra});
    add('gap',rect(200,.001,1000,200));
    add('outside',rect(200,-600,1000,600));
    add('tip',[point(300,0),point(600,200),point(200,200)]);
    add('reverse',rect(3500,0,300,300).reverse());
    add('split',[point(0,0),point(600,0),point(600,300),point(1200,300),point(1200,0),point(1800,0),point(1800,600),point(0,600)]);
    add('otherRoom',z.points,{roomId:'hall'});add('notCeiling',z.points,{type:'platform'});
    const picks=elevations(p).picks.filter(q=>q.meta.heightZone);
    const intervals=id=>picks.filter(q=>q.meta.zoneId===id).map(q=>[q.locate(point(-500,0)).x,q.locate(point(7000,0)).x]);
    for(const id of ['gap','outside','tip','otherRoom','notCeiling'])assert.deepEqual(intervals(id),[]);
    assert.deepEqual(intervals('soffit'),[[400,2800]]);assert.deepEqual(intervals('reverse'),[[3500,3800]]);
    assert.deepEqual(intervals('split'),[[0,600],[1200,1800]]);
  });
  test('Ortak duvarın karşı mahali ölçülen yüzünden örneklenir, yatay konum aynalanır',()=>{
    const p=survey();
    p.zones.push({id:'hallBeam',name:'Hol kirişi',roomId:'hall',type:'beam',points:rect(4160,300,400,750),bottom:2000,
      slopePoints:[{x:4160,y:300,z:2000},{x:4160,y:1050,z:2150},{x:4500,y:300,z:2000}]});
    const wallId=p.rooms[0].wallIds[1],ctx={roomId:'hall',wallId},v=elevations(p,ctx);
    const beam=at(v,'zoneId','hallBeam'),anchor=beam.locate(point(2400,-600));
    near(anchor.x,4160);near(anchor.y,600);near(anchor.z,2260);near(anchor.t,.2);
    assert.equal(anchor.side,'inside');assert.equal(anchor.roomId,'hall');
    assert.match(v.markup,/alt 2,15–2 m/);
    const opposite=elevations(p,{...ctx,side:'outside'});
    assert.equal(at(opposite,'zoneId','hallBeam'),undefined);
    assert.equal(at(opposite,'roomHeight').meta.side,'inside');assert.equal(at(opposite,'roomHeight').meta.viewSide,'outside');
    const oppositeLabel=at(opposite,'roomHeight').locate(point(600,0));
    near(oppositeLabel.x,4160);near(oppositeLabel.y,600);assert.equal(oppositeLabel.side,'inside');
    p.walls.find(w=>w.id===wallId).thickness=null;
    const noFace=elevations(p,ctx);
    assert.equal(at(noFace,'zoneId','hallBeam'),undefined);assert.equal(at(noFace,'roomHeight').locate(point(600,0)).x,null);
  });
  test('Tavan, kesit, hafif model ve görünüş aynı eğim ve kat kotunu kullanır',()=>{
    const p=survey(),s=at(elevations(p),'zoneId','soffit').locate(point(1600,-1));
    const rcp=at(elevations(p,{mode:'ceiling'}),'zoneId','soffit');
    near(s.z,2800);near(rcp.locate(point(1600,120)).z,s.z);assert.ok(rcp.meta.heightZone);
    const cut=at(elevations(p,{mode:'section',sectionLine:{a:point(0,120),b:point(4000,120)}}),'zoneId','soffit');
    assert.ok(cut.meta.heightZone);near(cut.locate(point(1600,-2800)).z,s.z);
    assert.ok(elevations(p,{mode:'model'}).picks.some(q=>q.meta.zoneId==='soffit'&&q.meta.heightZone));
    const mesh=buildSolids(indexProject(p)).find(s=>s.zoneId==='soffit');
    near(Math.min(...mesh.faces.flat().map(v=>v.z)),2500);near(Math.max(...mesh.faces.flat().map(v=>v.z)),3200);
    assert.match(exportSVG(p,opts),/Ahşap tavan · alt 2,3–2,9 m/);assert.match(exportSVG(p,opts),/>kot \+2,5–\+3,1 m<\/text>/);
    assert.match(printHTML(p,opts),/Net 3,4 m/);
  });
  test('Bir veya iki eğim örneği düz kiriş altına dönüştürülmez',()=>{
    for(const count of [1,2]) {
      const p=survey(),zone=p.zones.at(-1);zone.slopePoints=zone.slopePoints.slice(0,count);
      const v=elevations(p),pick=at(v,'zoneId','soffit'),a=pick.locate(point(1200,-1500));
      assert.equal(a.z,null);assert.equal(a.unmeasuredZ,true);assert.match(v.markup,/Ahşap tavan · alt kot gir/);
      assert.equal(at(elevations(p,{mode:'ceiling'}),'zoneId','soffit').locate(point(1200,200)).z,null);
      assert.equal(at(elevations(p,{mode:'model'}),'zoneId','soffit'),undefined);
    }
  });
  test('Tahmin görünür kalır, düşey mahal gözlemi plan ve paftada sahte uzunluk bırakmaz',()=>{
    const p=survey(),a={floorId:'ground',nodeId:p.rooms[0].nodeIds[0],z:200};
    const obs={purpose:'room-ceiling',id:'hi',roomId:'studio',floorId:'ground',kind:'vertical',method:'estimate',raw:'3.4',value:3400,unit:'m',a,b:{...a,z:3600}};
    p.observations.push(obs);
    const v=elevations(p);assert.match(v.markup,/Net 3,4 m · Tahmin/);
    assert.equal(at(v,'roomHeight').locate(point(125,0)).estimated,true);
    const plain={...p,observations:p.observations.filter(o=>o.id!==obs.id)};
    assert.equal(elevations(p,{mode:'plan'}).markup,elevations(plain,{mode:'plan'}).markup);
    assert.equal(exportSVG(p,{...opts,mode:'plan'}),exportSVG(plain,{...opts,mode:'plan'}));
  });
  test('Genel tavan kaynak sözleşmesi yedi yöntem/durumda dolgu, etiket, duvar ve kesitte aynıdır',()=>{
    for(const [method,status] of [['estimate','estimated'],['laser','measured'],['tape','measured'],['iphone','measured'],['unspecified','unattributed'],['legacy','legacy'],['unknown','unknown']]) {
      const {project,selection,reading}=fieldSurvey(method);
      const view=(mode,extra={})=>buildDrawing(project,{...selection,mode,...extra});
      const plan=view('ceiling'),elevation=view('elevation'),section=view('section',{sectionLine:{a:point(-400,1500),b:point(4400,1500)}});
      const z=status==='unknown'?null:3000;
      const fill=plan.picks.find(k=>k.label==='Kaynak odası').locate(point(3200,450));
      const edge=plan.picks.find(k=>k.meta.wallId===selection.wallId&&!k.meta.roomHeight),cut=at(section,'roomHeight');
      for(const a of [fill,edge.locate(point(3400,-80)),at(plan,'roomHeight').locate(point(0,0)),
        at(elevation,'roomHeight').locate(point(3300,-100)),cut.locate(point(2400,-9000))]) {
        assert.deepEqual(a.zSource,fill.zSource);assert.equal(a.zSource.roomId,selection.roomId);
        assert.equal(a.zSource.status,status);assert.equal(a.zSource.method,reading?.method??null);
        assert.equal(a.zSource.observationId,reading?.id??null);assert.equal(a.z,z);assert.equal(a.estimated,method==='estimate');
        assert.equal(a.unmeasuredZ,z===null);assert.equal(a.floorId,selection.floorId);
      }
      const ground=at(elevation,'groundLevel').locate(point(3300,0));
      assert.equal(ground.zSource,undefined);
      const raw=addObservation(project,{floorId:selection.floorId,roomId:selection.roomId,a:ground,b:fill,raw:'2,79',unit:'m',kind:'vertical',method:'laser'});
      const normalized=normalizeProject(JSON.parse(JSON.stringify(project)));
      const kept=normalized.observations.find(o=>o.id===raw.id);
      assert.equal(kept.method,'laser');assert.equal(kept.value,2790);assert.deepEqual(kept.b.zSource,fill.zSource);
      assert.deepEqual(kept.witness.sourceB.zSource,fill.zSource);
      if(z===null) assert.throws(()=>measure(normalized,kept.a,kept.b,'vertical'),/iki kot/);
      else {near(measure(normalized,kept.a,kept.b,'vertical'),2800);assert.equal(kept.witness.b.z,3000);}
    }
  });
  test('En yüksek ortak duvar başlığı doğru mahalden gelir, bağımsız alt kiriş ve döşemeye taşınmaz',()=>{
    const p=building(),hall=p.rooms[1],shared=p.rooms[0].wallIds[1];
    p.rooms[0].height=2800;hall.height=3500;
    p.observations.push({id:'hall-3500',roomId:hall.id,floorId:hall.floorId,purpose:'room-ceiling',kind:'vertical',value:3500,method:'estimate'});
    const model=buildDrawing(p,{...opts,mode:'model'});
    const head=model.picks.find(k=>k.meta.wallId===shared&&k.meta.roomHeight),a=head.locate(point(0,0));
    assert.equal(head.meta.roomId,hall.id);assert.equal(a.z,3700);assert.equal(a.zSource.observationId,'hall-3500');
    assert.equal(a.estimated,true);
    const isolated=buildDrawing(p,{...opts,isolate:true,mode:'model'}).picks.find(k=>k.meta.wallId===shared&&k.meta.roomHeight);
    assert.equal(isolated.meta.roomId,'studio');assert.equal(isolated.locate(point(0,0)).zSource.status,'legacy');
    const plank=model.picks.find(k=>k.meta.zoneId==='plat').locate(point(0,0));assert.equal(plank.zSource,undefined);
    const floor=model.picks.find(k=>k.label===p.rooms[0].name&&!k.meta.wallId).locate(point(0,0));assert.equal(floor.zSource,undefined);
  });
}
