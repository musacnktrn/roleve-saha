// [codex] ureten: codex
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDrawing,sectionOpenings} from '../render.js';
import {exportCSV,exportDXF,exportOBJ,exportSVG,sheetPages,printHTML,exportIFC} from '../export.js';
import {areaSigned,buildSolids,doorSwing,cutSegments,floorCells,heightAt,indexProject,resolvePoint,wallBands} from '../model.js';
import {annotatedBuilding,building,detailedBuilding} from './fixture.js';
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const approx=(a,b,tol=.00001)=>assert.ok(Math.abs(a-b)<tol,a+' ≠ '+b);
const p=building();
test('Ü5 · aynı duvarın iki yüzü açıklığı ayna yönünde gösterir, priz doğru yüzde kalır',()=>{
  const opts={mode:'elevation',floorId:'ground',roomId:'studio',wallId:'wall-0'};
  const inside=buildDrawing(p,{...opts,side:'inside'}),outside=buildDrawing(p,{...opts,side:'outside'});
  const insideGlass=inside.picks.find(k=>k.meta.elementId==='win-a');
  const outsideGlass=outside.picks.find(k=>k.meta.elementId==='win-a');
  assert.ok(insideGlass);assert.ok(outsideGlass);
  const a=insideGlass.locate({x:1200,y:-900}), b=outsideGlass.locate({x:2800,y:-900});
  approx(a.x,b.x);approx(a.z,1100);approx(a.y,0);approx(b.y,-160);
  assert.ok(inside.picks.some(q=>q.meta.elementId==='socket-a'));
  assert.ok(!outside.picks.some(q=>q.meta.elementId==='socket-a'));
  assert.match(inside.markup,/5,4/);assert.match(inside.markup,/4 m/);
});
test('Ü5 · asma kat, ölçüsüz tavan ve katlar arası cephe aynı kotları kullanır',()=>{
  const v=buildDrawing(p,{mode:'section',sectionLine:{a:{x:-100,y:1400},b:{x:6600,y:1600}}});
  assert.ok(v.picks.find(q=>q.meta.zoneId==='plat'));assert.match(v.markup,/Asma kat \+2,8/);
  const facade=buildDrawing(p,{mode:'facade',roomId:'studio',wallId:'wall-0'});
  assert.match(facade.markup,/Üst kat \+3,8/);assert.match(facade.markup,/Yükseklik eksik/);
  const ceiling=buildDrawing(p,{mode:'ceiling',floorId:'ground'});
  assert.match(ceiling.markup,/Tavan kotu eksik/);
  const other=buildDrawing(p,{mode:'section',sectionLine:{a:{x:-100,y:-900},b:{x:5000,y:-900}}});
  assert.match(other.title,/dışında/);
});
test('Ü5 · eğimli tavan kesiti üç ölçülen örnekle eğimi korur',()=>{
  const q=building(),zone={id:'slope',roomId:'studio',type:'ceiling',points:rect(0,0,4000,3000),top:3100,bottom:3000,slopePoints:[{x:0,y:0,z:3000},{x:4000,y:0,z:3400},{x:0,y:3000,z:3000}]};q.zones.push(zone);
  approx(heightAt(zone,{x:2000,y:1500},'bottom'),3200);
  const mesh=buildSolids(indexProject(q)).find(s=>s.id==='slope');
  approx(Math.min(...mesh.faces.flat().map(v=>v.z)),3200);
  approx(Math.max(...mesh.faces.flat().map(v=>v.z)),3700);
  assert.ok(buildDrawing(q,{mode:'section',sectionY:1500}).picks.some(k=>k.meta.zoneId==='slope'));
});
test('Ü6 · galeri boşluğu, çakışan delikler ve eğik kesit gerçek poligonlarla hesaplanır',()=>{
  const outline=rect(0,0,4000,3000),holes=[rect(900,0,1600,2000),rect(1500,500,2000,2000)];
  const area=floorCells(outline,holes).reduce((s,cell)=>s+Math.abs(areaSigned(cell)),0);
  approx(area,12000000-(3200000+4000000-1500000));
  assert.deepEqual(cutSegments({x:0,y:1200},{x:4000,y:1200},[outline,...holes]),[[0,900],[3500,4000]]);
  const q=building();q.zones.find(z=>z.id==='void').roomId='studio';q.zones.find(z=>z.id==='void').targetZoneId='plat';
  const scoped=buildSolids(indexProject(q));
  const floorArea=scoped.filter(s=>s.type==='floor'&&s.roomId==='studio').reduce((sum,s)=>sum+Math.abs(areaSigned(s.faces[0])),0);
  approx(floorArea,12000000);
  const mesh=buildSolids(indexProject(p));
  const upperArea=mesh.filter(s=>s.type==='floor'&&s.roomId==='upper-room').reduce((count,s)=>count+Math.abs(areaSigned(s.faces[0])),0);
  approx(upperArea,6000000);
});
test('Ü6 · gerçek duvar boşluğu, çift seçim ve fiziksel koordinatlar kamera döndüğünde korunur',()=>{
  const idx=indexProject(p),f=idx.frames.get('wall-0');
  const bands=wallBands(f,5400,idx.wallElements.get('wall-0'));
  approx(bands.reduce((s,b)=>s+(b.r-b.l)*(b.high-b.low),0),4000*5400-1000*1200);
  assert.deepEqual(resolvePoint(idx,{nodeId:'node-0'},'ground'),{x:0,y:0,z:200});
  const opt={mode:'model',yaw:17,pitch:38,anchors:[{nodeId:'node-0'},{nodeId:'node-2'}]};
  const drawing=buildDrawing(p,opt);assert.match(drawing.markup,/5 m/);assert.match(drawing.markup,/Hol/);
  const other=buildDrawing(p,{...opt,yaw:76});assert.notEqual(drawing.markup,other.markup);
  const pick=drawing.picks.find(x=>x.meta.elementId==='win-a');
  assert.equal(pick.label,'Batı <penceresi>');
  const vertex=pick.locate({x:-100000,y:-100000});
  assert.ok(vertex.z===1100||vertex.z===2300);assert.ok(vertex.x===1200||vertex.x===2200);
  const select=buildDrawing(p,{mode:'model',roomId:'studio',floorId:'ground',isolate:true});
  assert.ok(select.picks.every(k=>k.meta.floorId==='ground'&&k.meta.roomId==='studio'));
});
test('Ü7 · CSV hücreleri ve SVG metni Unicode ve özel karakterleri güvenli tutar',()=>{
  const q=building();q.observations[0].note='=1+2;"a"\nö';q.rooms[0].name='<&"Salon">';
  const csv=exportCSV(q);assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/"5,00";"m";"5000"/);assert.match(csv,/"'=1\+2;""a""\nö"/);
  const svg=exportSVG(q,{mode:'plan',floorId:'ground'});assert.match(svg,/&lt;&amp;&quot;Salon&quot;&gt;/);
  const dxf=exportDXF(q,{floorId:'ground'});assert.match(dxf,/\$INSUNITS\r\n 70\r\n4/);assert.match(dxf,/AcDbArc/);
  assert.ok(!dxf.includes('Üst kat'));assert.match(exportOBJ(p),/^# Rölöve/m);
});
test('Ü7 · 1/50 pafta mm boyutunda ve büyük plan ölçek değişmeden sayfalara bölünür',()=>{
  const opts={mode:'plan',scale:50,paper:'A4',floorId:'ground'};
  const a=sheetPages(p,opts);assert.equal(a.width,297);assert.equal(a.height,210);assert.equal(a.pages.length,1);
  assert.match(a.pages[0],/width="277" height="171" viewBox="[^"]*13850 8550"/);
  const narrow=sheetPages(p,{...opts,scale:7});assert.ok(narrow.pages.length>1);assert.match(narrow.pages[0],/1939 1197/);
  const halo=buildDrawing(p,opts).markup.match(/<text[^>]+stroke-width="([^"]+)"[^>]+paint-order="stroke"/);
  assert.ok(halo&&a.pages[0].includes('stroke-width="'+halo[1]+'" stroke-linejoin="round" paint-order="stroke"'));
  assert.match(printHTML(p,opts),/@page\{size:297mm 210mm/);assert.throws(()=>sheetPages(p,{mode:'model'}));
});
test('Ü9 · IFC4 ailesi kat, oda, açıklık ve ölçü kaynağını taşır',()=>{
  const ifc=exportIFC(p);
  assert.match(ifc,/FILE_SCHEMA\(\('IFC4'\)\)/);assert.equal((ifc.match(/=IFCBUILDINGSTOREY\(/g)||[]).length,2);
  assert.equal((ifc.match(/=IFCRELVOIDSELEMENT\(/g)||[]).length,2);assert.equal((ifc.match(/=IFCRELFILLSELEMENT\(/g)||[]).length,2);
  assert.ok(ifc.includes('5,00'));assert.ok(ifc.includes('measure-1'));assert.equal(ifc,exportIFC(p));
});

test('Ü5 · ölçülen dört kapı açılımı, duvar ters dönüşü ve aynalanmış karşı yüz',()=>{
  const q=building(),door=q.elements.find(e=>e.type==='door');
  const floor={mode:'plan',floorId:'ground'};
  for(const [swing,atStart,dir] of [['left-in',true,1],['right-in',false,1],['left-out',true,-1],['right-out',false,-1],['left',true,1],['right',false,1]]) {
    Object.assign(door,{swing,reversedAlongWall:false});
    assert.deepEqual(doorSwing(door),{atStart,direction:dir});
    assert.match(buildDrawing(q,floor).markup,/A900 900 0 0 [01]/);
    const dxf=exportDXF(q,floor);assert.match(dxf,/AcDbArc/);
    const e={mode:'elevation',floorId:'ground',roomId:'studio',wallId:door.wallId};
    const front=buildDrawing(q,{...e,side:'inside'}).markup,back=buildDrawing(q,{...e,side:'outside'}).markup;
    assert.notEqual(front.match(/<line[^>]+stroke-dasharray="4 3"[^>]*>/)[0],back.match(/<line[^>]+stroke-dasharray="4 3"[^>]*>/)[0]);
    door.reversedAlongWall=true;assert.equal(doorSwing(door).atStart,!atStart);
  }
  door.swing=null;assert.equal(doorSwing(door),null);
  assert.doesNotMatch(buildDrawing(q,floor).markup,/A900 900 0 0/);
});
test('Ü7 · eski ölçü fiziksel çizimden düşer, CSV arşivi iki gözlemi de taşır',()=>{
  const q=building(),old=q.observations[0];
  Object.assign(old,{value:4521,raw:'4,521'});q.observations.push({...old,id:'again',replaces:old.id,value:5219,raw:'5,219'});
  const opts={floorId:'ground',mode:'plan'};
  for(const data of [buildDrawing(q,opts).markup,exportSVG(q,opts),printHTML(q,opts),exportDXF(q,opts)]){
    assert.ok(data.includes('5,219'));assert.ok(!data.includes('4,521'));
  }
  assert.ok(exportCSV(q).includes('4,521')&&exportCSV(q).includes('5,219'));
});

test('Ü5 · kalem eskizi yalnız kaydedilen mahal/kat/duvar/yüze basılır; karşı yüzde A ucu aynalanır',()=>{
  const p=annotatedBuilding(),o={mode:'elevation',roomId:'studio',wallId:'wall-0',floorId:'ground'};
  for(const [side,id,mapping,other,color,width,opacity] of [
    ['inside','sk-west-in','300,-800 900,-1400','sk-west-out','#245fa6',37,.78],
    ['outside','sk-west-out','3550,-400 3550,-700','sk-west-in','#a62c45',64,.42]
  ]){
    const params={...o,side};
    for(const markup of [buildDrawing(p,params).markup,exportSVG(p,params),printHTML(p,params)]){
      const tag=markup.match(new RegExp('<polyline data-sketch="'+id+'"[^>]*>'))?.[0]||'';
      for(const attr of ['points="'+mapping+'"','stroke="'+color+'"','stroke-width="'+width+'"','opacity="'+opacity+'"'])assert.ok(tag.includes(attr),tag);
      assert.ok(!markup.includes(other)&&!markup.includes('sk-plan')&&!markup.includes('sk-upper'));
    }
  }
  assert.ok(!buildDrawing(p,{...o,wallId:'wall-1'}).markup.includes('sk-west-in'));
  p.walls[0].thickness=null;const unresolved=[];exportDXF(p,{onUnlocatedSketch:stroke=>unresolved.push(stroke.id)});
  assert.deepEqual(unresolved,['sk-west-out']);
});
test('Ü7 · plan işaretleri aynı kalem stilini, çekim yerini, tavan/zemin yüzünü ve hedef yönünü taşır',()=>{
  const p=annotatedBuilding(),opt={mode:'plan',floorId:'ground'};
  for(const markup of [buildDrawing(p,opt).markup,exportSVG(p,opt),printHTML(p,opt)]){
    const sketch=markup.match(/<polyline data-sketch="sk-plan"[^>]*>/)?.[0]||'';
    assert.ok(sketch.includes('stroke="#8650a1"')&&sketch.includes('stroke-width="88"')&&sketch.includes('opacity="0.42"'));
    assert.ok(markup.includes('F02 · Tavan · 90°')&&markup.includes('F03 · Zemin · 0°'));
    assert.ok(markup.includes('M0 0 L400 0')&&!markup.includes('sk-west-out'));
  }
  const ceiling=buildDrawing(p,{...opt,mode:'ceiling'}).markup;
  assert.ok(ceiling.includes('F02 · Tavan')&&!ceiling.includes('F03 · Zemin')&&!ceiling.includes('sk-plan'));
  p.rooms=[];p.walls=[];p.nodes=[];p.notes[1].roomId=null;
  assert.ok(buildDrawing(p,opt).markup.includes('F02 · Tavan'));
});

test('Ü5 · sonlu A–A′ hattı açıklığın içini keser; teğet, dışarıda ve ince duvara paralel hat seçilmez',()=>{
  const p=detailedBuilding();
  const section=(a,b)=>({mode:'section',sectionLine:{a,b}}),opts=section({x:1700,y:-1000},{x:1700,y:3000});
  p.sections=[{id:'cut-1',name:'Atölye kesiti',floorId:'ground',...opts.sectionLine}];
  assert.equal(sectionOpenings(p,{sectionId:'cut-1'})[0].elementId,'win-a');
  assert.ok(buildDrawing(p,{sectionId:'cut-1',mode:'section'}).title.includes('Atölye kesiti'));
  const [win]=sectionOpenings(p,opts);
  assert.deepEqual([win.elementId,win.roomId,win.wallId,win.floorId],['win-a','studio','wall-0','ground']);
  assert.deepEqual([win.fromMm,win.toMm,win.stationMm,win.wallAtMm,win.sillZ,win.headZ],[840,1000,920,1700,1100,2300]);
  const view=buildDrawing(p,opts),pick=view.picks.find(k=>k.meta.sectionOpening);
  assert.ok(pick&&pick.meta.elementId==='win-a');assert.deepEqual(pick.locate({x:0,y:-5000}),{x:1700,y:-160,z:2300});
  assert.ok(view.markup.includes('Parapet 0,9 m')&&!view.markup.includes('win-profile'));
  for(const [a,b] of [[{x:900,y:-1000},{x:900,y:600}],[{x:1200,y:-1000},{x:1200,y:600}],[{x:1300,y:-210},{x:1900,y:-210}],[{x:1700,y:-1000},{x:1700,y:-170}],[{x:900,y:0},{x:2400,y:0}]])assert.deepEqual(sectionOpenings(p,section(a,b)),[]);
  // Parallel section lying strictly inside the measured wall really intersects the opening volume.
  assert.equal(sectionOpenings(p,section({x:1000,y:-80},{x:2450,y:-80}))[0].elementId,'win-a');
  assert.equal(sectionOpenings(p,section({x:3500,y:900},{x:4500,y:900}))[0].elementId,'door-a');
  assert.deepEqual(sectionOpenings(p,{...opts,floorId:'upper',isolate:true}),[]);
  const oblique=section({x:900,y:-800},{x:2500,y:800});
  assert.ok(sectionOpenings(p,oblique)[0].toMm-sectionOpenings(p,oblique)[0].fromMm>160);
  p.walls[0].thickness=null;
  const [thin]=sectionOpenings(p,oblique);
  assert.equal(thin.fromMm,thin.toMm);approx(thin.stationMm,Math.hypot(800,800));approx(thin.wallAtMm,1700);
  assert.deepEqual(sectionOpenings(p,section({x:1000,y:0},{x:2450,y:0})),[]);
  p.elements[0].sill=null;const pending=buildDrawing(p,oblique).picks.find(k=>k.meta.sectionOpening);
  assert.ok(pending.label.includes('Parapet ölçülmedi'));assert.equal(pending.locate({x:0,y:0}).z,null);
});
test('Ü7 · normalleştirilmiş pencere/kapı çizimi yeniden boyutlanır, cephede aynalanır, fiziksel kesitte motif yoktur',()=>{
  const p=detailedBuilding(),w=p.elements[0],opts={floorId:'ground',roomId:'studio',wallId:w.wallId};
  const mark=(drawing,id)=>drawing.match(new RegExp('<polyline data-opening-stroke="'+id+'"[^>]*>'))?.[0]||'';
  const inside=exportSVG(p,{...opts,mode:'elevation'}),outside=exportSVG(p,{...opts,mode:'facade'});
  assert.ok(mark(inside,'win-profile').includes('1300,-1140 1900,-1920'));
  assert.ok(mark(outside,'win-profile').includes('-1300,-1340 -1900,-2120'));
  const detail=exportSVG(p,{...opts,wallId:p.elements[1].wallId,mode:'elevation'});
  assert.ok(detail.includes('door-profile')&&detail.includes('Pirinç kol')&&detail.includes('stroke-dasharray="4 3"'));
  assert.ok(exportSVG(p,{mode:'model'}).includes('matrix(')&&exportSVG(p,{mode:'model'}).includes('win-profile'));
  Object.assign(w,{width:1400,height:1600,sill:300});
  assert.ok(mark(printHTML(p,{...opts,mode:'elevation'}),'win-profile').includes('1340,-620 2180,-1660'));
  const line={a:{x:1700,y:-400},b:{x:1700,y:3600}},cuts=exportSVG(p,{...opts,mode:'section',sectionLine:line});
  assert.ok(cuts.includes('Parapet 0,3 m')&&cuts.includes('Net 1,6 m')&&!cuts.includes('win-profile')&&!cuts.includes('door-profile'));
  const plan=printHTML(p,{...opts,mode:'plan',sectionLine:line});assert.ok(plan.includes('A′</text>')&&plan.includes('stroke-dasharray="9 4 2 4"'));
});
