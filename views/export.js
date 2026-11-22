// [codex] ureten: codex
import {indexProject,currentObservations,isNumber,nameOf,isOpening,doorSwing,inwardSign,frameFootprint,buildSolids,resolvePoint,tr,elevationLabel,heightAt} from './model.js';
import {buildDrawing} from './render.js';
import {esc,n} from './drawing.js';
import {head,tail} from './dxf-base.js';
import {inkStyle} from '../ui/sketch.js';
import {openingStrokePoints,validateOpeningDetail} from '../openings/drawing.js';
import {sectionFrame} from './section.js';
const trimNumber=x=>Number.isFinite(x)?n(x):'';

function csvCell(value) {
  let s=String(value??'');
  if(typeof value==='string'&&/^[ \t\r\n]*[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
function caption(idx,a,floorId) {
  if(!a)return '';
  if(a.label)return String(a.label);
  if(a.nodeId)return 'Köşe '+a.nodeId;
  if(a.wallId)return 'Duvar '+a.wallId+' · '+tr(a.t*100,1)+'%'+(a.side?' · '+({inside:'iç yüz',outside:'dış yüz',axis:'aks'}[a.side]||a.side):'');
  if(a.elementId)return nameOf(idx.elements.get(a.elementId))+' · '+({start:'başlangıç',end:'bitiş',center:'merkez'}[a.at]||'merkez');
  const q=resolvePoint(idx,a,floorId);return q?'Nokta '+[q.x,q.y,q.z].map(trimNumber).join('/'):'';
}
export function exportCSV(project) {
  const idx=indexProject(project);
  const rows=[['Gözlem kimliği','Kat','Oda','Tür','Başlangıç','Bitiş','Ham giriş','Giriş birimi','Uzunluk (mm)','Yöntem','Tarih','Durum','Önceki gözlem','Not','A X (mm)','A Y (mm)','A Z (mm)','B X (mm)','B Y (mm)','B Z (mm)']];
  for(const o of project.observations||[]) {
    const a=resolvePoint(idx,o.a,o.floorId),b=resolvePoint(idx,o.b,o.floorId);
    rows.push([o.id,idx.floors.get(o.floorId)?.name,idx.rooms.get(o.roomId)?.name,o.kind,caption(idx,o.a,o.floorId),caption(idx,o.b,o.floorId),o.raw,o.unit,o.value,o.method,o.date,o.status,o.replaces,o.note,a?.x,a?.y,a?.z,b?.x,b?.y,b?.z]);
  }
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';
}
function dxfText(value) {
  return String(value??'').replace(/[\r\n\t]/g,' ').replace(/\\/g,'\uFF3C').split('').map(c=>{
    const v=c.charCodeAt(0);return v<32?' ':v<127?c:'\\U+'+v.toString(16).toUpperCase().padStart(4,'0');
  }).join('');
}
export function exportDXF(project, options={}) {
  const idx=indexProject(project), entities=[];
  let handle=0x100;
  function entity(type,layer,klass,pairs,attributes=[]) {
    const data=[0,type,5,(handle++).toString(16).toUpperCase(),330,'17',100,'AcDbEntity',8,layer,...attributes,100,klass,...pairs];
    entities.push(data.join('\n')+'\n');
  }
  function pt(group,p,z) {return [group,n(p.x),group+10,n(-p.y),group+20,n(z)];}
  function line(layer,a,b,za,zb=za) {
    if(!a||!b||Math.hypot(a.x-b.x,a.y-b.y,za-zb)<.00001)return;
    entity('LINE',layer,'AcDbLine',[...pt(10,a,za),...pt(11,b,zb)]);
  }
  function inkPath(layer,style,points,elevation,normal) {
    if(points.length<2||!isNumber(elevation))return;
    const first=points[0],last=points.at(-1);
    const closed=points.length>2&&first.x===last.x&&first.y===last.y;
    const vertices=closed?points.slice(0,-1):points;
    const body=[90,vertices.length,70,closed?1:0,43,n(style.width),38,n(elevation)];
    for(const v of vertices)body.push(10,n(v.x),20,n(v.y));
    body.push(210,normal.x.toPrecision(15),220,normal.y.toPrecision(15),230,normal.z.toPrecision(15));
    const color=parseInt(style.color.slice(1),16),alpha=0x02000000+Math.round(255*style.opacity);
    entity('LWPOLYLINE',layer,'AcDbPolyline',body,[420,color,440,alpha]);
  }
  function label(layer,p,z,s,height=110) {
    entity('TEXT',layer,'AcDbText',[...pt(10,p,z),40,n(height),1,dxfText(s),100,'AcDbText']);
  }
  function loop(layer,ps,z) {for(let i=0;i<ps.length;i++)line(layer,ps[i],ps[(i+1)%ps.length],z);}
  function traceWall(f,lo,hi,z) {
    if(hi<=lo)return;
    if(!f.thick)line('DUVAR',f.point(lo),f.point(hi),z);
    else {const ring=frameFootprint(f,lo,hi);line('DUVAR',ring[0],ring[1],z);line('DUVAR',ring[2],ring[3],z);}
  }
  const inFloor=id=>!options.floorId||options.floorId===id;
  for(const wall of project.walls||[]) {
    if(!inFloor(wall.floorId))continue;
    const f=idx.frames.get(wall.id);if(!f)continue;
    const z=idx.floors.get(wall.floorId)?.elevation??0;
    const es=(idx.wallElements.get(wall.id)||[]).slice().sort((a,b)=>a.offset-b.offset);
    let cursor=0;
    for(const e of es.filter(isOpening)) {
      const l=Math.max(0,e.offset),r=Math.min(f.len,e.offset+e.width);
      traceWall(f,cursor,l,z);cursor=Math.max(cursor,r);
      const layer=e.type==='door'?'KAPI':e.type==='window'?'PENCERE':'DETAY';
      if(f.thick) {
        const ring=frameFootprint(f,l,r);line(layer,ring[3],ring[0],z);line(layer,ring[1],ring[2],z);
      }
      if(e.type==='window')line(layer,f.point(l,f.centerOffset),f.point(r,f.centerOffset),z);
      else if(!f.thick)for(const d of [l,r])line(layer,f.point(d,-35),f.point(d,35),z);
      const swing=doorSwing(e);
      if(swing) {
        const sign=inwardSign(idx,idx.rooms.get(e.roomId),wall)*swing.direction;
        const hinge=swing.atStart?l:r;
        const center=f.point(hinge,f.centerOffset),tip=f.point(hinge,f.centerOffset+sign*(r-l));
        const closed=f.point(swing.atStart?r:l,f.centerOffset);
        line('KAPI',center,tip,z);
        const angle=(p)=>(Math.atan2(center.y-p.y,p.x-center.x)*180/Math.PI+360)%360;
        let start=angle(closed),end=angle(tip);if((end-start+360)%360>180)[start,end]=[end,start];
        if(r>l)entity('ARC','KAPI','AcDbCircle',[...pt(10,center,z),40,n(r-l),100,'AcDbArc',50,n(start),51,n(end)]);
      }
      const marker=f.point((l+r)/2,f.centerOffset+Math.max(75,f.thick*.75));
      label(layer,marker,z,nameOf(e)+' '+tr(e.width)+' mm'+(isNumber(e.sill)?' · alt '+tr(e.sill)+' mm':''),90);
    }
    traceWall(f,cursor,f.len,z);
    for(const e of es.filter(e=>!isOpening(e))) {
      const normal=inwardSign(idx,idx.rooms.get(e.roomId),wall)*(e.side==='outside'?-1:1);
      const base=f.centerOffset+normal*f.thick/2, outer=base+normal*(e.depth||0);
      const ring=[f.point(e.offset,base),f.point(e.offset+e.width,base),f.point(e.offset+e.width,outer),f.point(e.offset,outer)];
      const layer=e.type==='column'?'KOLON':'DETAY';loop(layer,ring,z);label(layer,ring[0],z,nameOf(e),90);
    }
  }
  for(const room of project.rooms||[]) {
    if(!inFloor(room.floorId))continue;
    const floor=idx.floors.get(room.floorId),z=floor?.elevation??0,r=idx.rings.get(room.id);
    const p=r[0];if(p)label('MAHAL',{x:p.x+135,y:p.y+190},z,[floor?.name,room.code,room.name].filter(Boolean).join(' · '));
    if(p&&isNumber(room.height))label('KOT',{x:p.x+135,y:p.y+330},z,'Tavan '+elevationLabel(z+room.height)+' m',90);
    for(const v of idx.roomZones.get(room.id)||[]) {
      const layer={stair:'MERDIVEN',platform:'ASMA_KAT',void:'GALERI',ceiling:'TAVAN',beam:'DETAY'}[v.type]||'DETAY';
      for(let i=0;i<v.points.length;i++) {
        const a=v.points[i],b=v.points[(i+1)%v.points.length];
        const elevation=pt=>heightAt(v,pt,'top')??heightAt(v,pt,'bottom');
        const ha=elevation(a),hb=elevation(b);
        // An unlevelled boundary stays in the plan as a reference trace.
        if(isNumber(ha)&&isNumber(hb))line(layer,a,b,z+ha,z+hb);
        else if(v.type==='void')line(layer,a,b,z);
      }
      if(v.points[0])label(layer,v.points[0],z,nameOf(v),90);
    }
  }
  for(const o of currentObservations(project)) {
    if(!inFloor(o.floorId))continue;
    const a=resolvePoint(idx,o.a,o.floorId),b=resolvePoint(idx,o.b,o.floorId);
    if(!a||!b)continue;
    const z=idx.floors.get(o.floorId)?.elevation??0;
    const needsZ=['vertical','spatial','slope','3d','elevation','level'].includes(o.kind);
    if(!needsZ||(isNumber(a.z)&&isNumber(b.z)))line('OLCU',a,b,a.z??z,b.z??z);
    label('OLCU',{x:(a.x+b.x)/2,y:(a.y+b.y)/2-55},z,String(o.raw)+' '+o.unit+' · '+o.kind,95);
  }
  for(const stroke of project.strokes||[]) if(inFloor(stroke.floorId)) {
    const z=idx.floors.get(stroke.floorId)?.elevation;
    inkPath('KROKI',inkStyle(stroke),stroke.points.map(v=>({x:v.x,y:-v.y})),z,{x:0,y:0,z:1});
  }
  function faceInk(layer,reference,points,style) {
    const {floorId,roomId,wallId,side}=reference;
    const f=idx.frames.get(wallId),z=idx.floors.get(floorId)?.elevation;
    const start=resolvePoint(idx,{floorId,roomId,wallId,t:0,side},floorId);
    if(!start||!f||!isNumber(z)||points.some(pt=>pt.x<-.001||pt.x>f.len+.001))return false;
    // The DXF object's plane uses the physical A→B axis and world up.
    const normal={x:-f.uy,y:-f.ux,z:0};
    const along=start.x*f.ux+start.y*f.uy,elevation=-start.x*f.uy+start.y*f.ux;
    inkPath(layer,style,points.map(q=>({x:along+q.x,y:z+q.y})),elevation,normal);
    return true;
  }
  for(const stroke of project.faceSketches||[]) if(inFloor(stroke.floorId)) {
    if(!faceInk('DUVAR_ESKIZ',stroke,stroke.points,inkStyle(stroke)))options.onUnlocatedSketch?.(stroke);
  }
  for(const opening of project.elements||[]) {
    const floorId=idx.walls.get(opening.wallId)?.floorId;
    if(!opening.detailStrokes?.length||!inFloor(floorId))continue;
    validateOpeningDetail(opening);
    if(!isNumber(opening.sill)||!isNumber(opening.height)){options.onUnlocatedSketch?.(opening);continue;}
    for(const stroke of opening.detailStrokes) {
      const vertices=openingStrokePoints(stroke).map(pt=>({x:opening.offset+pt.x*opening.width,y:opening.sill+pt.y*opening.height}));
      if(!faceInk('DETAY',{...opening,floorId},vertices,stroke)){options.onUnlocatedSketch?.(opening);break;}
    }
  }
  if(options.sectionLine||options.sectionId) {
    const floor=idx.floors.get(options.markFloorId||options.floorId)||project.floors[0];
    const trace=sectionFrame(idx,{floorId:floor.id,isolate:true,sectionId:options.sectionId,sectionLine:options.sectionLine});
    if(trace?.len&&(!trace.sourceFloorId||trace.sourceFloorId===floor.id)) {
      const {a,b,look,ux,uy}=trace,z=floor.elevation;
      line('DETAY',a,b,z);
      for(const [end,text] of [[a,'A'],[b,'A′']]) {
        const tip={x:end.x+200*look.x,y:end.y+200*look.y};
        line('DETAY',end,tip,z);
        for(const sign of [-1,1])line('DETAY',tip,{x:tip.x-60*look.x+sign*28*ux,y:tip.y-60*look.y+sign*28*uy},z);
        label('DETAY',{x:end.x-130*look.x,y:end.y-130*look.y},z,text,100);
      }
    }
  }
  for(const note of project.notes||[]) {
    const room=idx.rooms.get(note.roomId);if(!room||!inFloor(room.floorId))continue;
    const f=idx.frames.get(note.wallId);
    const a=note.anchor?resolvePoint(idx,note.anchor,room.floorId):f?f.point(f.len/2):idx.rings.get(room.id)[0];
    if(a&&note.text)label('NOT',a,idx.floors.get(room.floorId)?.elevation??0,note.text,90);
  }
  const seeded=head.replace(/\$HANDSEED\n  5\n[0-9A-F]+\n/,'$HANDSEED\n  5\n'+handle.toString(16).toUpperCase()+'\n');
  return (seeded+'  2\nENTITIES\n'+entities.join('')+tail).replace(/\r?\n/g,'\r\n');
}
export function exportOBJ(project,options={}) {
  const solids=buildSolids(indexProject(project),options), lines=['# Rölöve Saha','# units: metres; x = plan x, y = -plan y, z = survey elevation'];
  if(isNumber(project.northAngle))lines.push('# Project north angle (degrees): '+n(project.northAngle));
  let start=1,id='';
  for(const solid of solids) {
    if(id!==solid.id){id=solid.id;lines.push('o '+(solid.type+'_'+id).replace(/[^A-Za-z0-9_.-]/g,'_'));}
    for(const face of solid.faces) {
      for(const p of face)lines.push('v '+[p.x/1000,-p.y/1000,p.z/1000].map(v=>v.toFixed(6)).join(' '));
      const vertices=face.map((_,i)=>start+i).reverse();
      lines.push('f '+vertices.join(' ')); start+=face.length;
    }
  }
  return lines.join('\n')+'\n';
}
function outputSpec(p,opts) {
  const d=buildDrawing(p,opts), scale=Number(opts.scale??50);
  if(!Number.isFinite(scale)||scale<1||scale>10000)throw new Error('Pafta ölçeği 1 ile 10000 arasında olmalı.');
  if(opts.mode==='model')throw new Error('Ölçekli pafta için plan, kesit veya görünüş seçin.');
  const landscape=opts.orientation!=='portrait',a3=String(opts.paper||'A4').toUpperCase()==='A3';
  const long=a3?420:297,short=a3?297:210;
  return {d,scale,width:landscape?long:short,height:landscape?short:long};
}
function metaLine(p, d, opts, scale, i, total) {
  return [d.title,'1/'+scale,opts.revision||p.updatedAt?.slice(0,10),total>1?'Pafta '+(i+1)+' / '+total:''].filter(Boolean).join('   ·   ');
}
// Convert screen-pixel stroke widths to paper millimetres only on stroked geometry.
function printStrokes(markup,scale) {
  return markup.replace(/<[^>]*vector-effect="non-scaling-stroke"[^>]*>/g,tag=>tag
    .replace('vector-effect="non-scaling-stroke"','')
    .replace(/stroke-width="([\d.]+)"/,(_,value)=>'stroke-width="'+n(Number(value)*scale*.24)+'"'));
}
function sheet(p,opts,spec,tile,i,total) {
  const {width,height,scale,d}=spec,margin=10,top=23,foot=16;
  const clipW=width-margin*2,clipH=height-top-foot;
  const plan=opts.mode==='plan'||!opts.mode||opts.mode==='ceiling';
  const north=Number.isFinite(p.northAngle)?p.northAngle:null;
  const barWorld=[100,200,500,1000,2000,5000,10000,20000,50000,100000].filter(mm=>mm/scale<=42).at(-1);
  const bar=barWorld?barWorld/scale:0;
  const x=width-margin-bar, y=height-6;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+n(width)+'mm" height="'+n(height)+'mm" viewBox="0 0 '+n(width)+' '+n(height)+'" font-family="system-ui,sans-serif"><title>'+esc(p.name+' · '+d.title)+'</title><rect width="100%" height="100%" fill="#fff"/><text x="10" y="10" font-size="5.2" fill="#203c37" font-weight="650">'+esc(String(p.name).slice(0,70))+'</text><text x="10" y="17.5" font-size="3" fill="#415750">'+esc(metaLine(p,d,opts,scale,i,total))+'</text>'
  +'<line x1="10" x2="'+n(width-10)+'" y1="20" y2="20" stroke="#75877c" stroke-width=".3"/>'
  +(plan && north!==null?'<g transform="translate('+n(width-17)+' 12)" fill="#263f39"><path transform="rotate('+n(north)+')" d="M-1.4 1.5L0 -3.5L1.4 1.5L0 .5Z"/><text x="0" y="-4.5" font-size="2.8" text-anchor="middle">K</text></g>':plan?'<text x="'+n(width-10)+'" y="12" text-anchor="end" font-size="2.8" fill="#51665b">Kuzey yönü girilmedi</text>':'')
  +'<svg x="'+margin+'" y="'+top+'" width="'+n(clipW)+'" height="'+n(clipH)+'" viewBox="'+[tile.x,tile.y,clipW*scale,clipH*scale].map(n).join(' ')+'" preserveAspectRatio="none" overflow="hidden">'+printStrokes(d.markup,scale)+'</svg>'
  +'<line x1="10" x2="'+n(width-10)+'" y1="'+n(height-foot+2)+'" y2="'+n(height-foot+2)+'" stroke="#75877c" stroke-width=".25"/><text x="10" y="'+n(y)+'" font-size="2.8" fill="#45574f">Rölöve · Bitmiş yüz ölçüleri · %100 baskı</text>'
  +(bar?'<path d="M'+n(x)+' '+n(y-.2)+'v-2h'+n(bar)+'v2" stroke="#263f39" stroke-width=".45" fill="none"/><text x="'+n(x+bar/2)+'" y="'+n(y-3.5)+'" text-anchor="middle" font-size="2.8">'+tr(barWorld/1000,3)+' m</text>':'')+'</svg>';
}
export function sheetPages(p,opts={}) {
  const spec=outputSpec(p,opts),b=spec.d.bounds;
  const w=(spec.width-20)*spec.scale,h=(spec.height-39)*spec.scale;
  const cols=Math.max(1,Math.ceil(b.width/w)),rows=Math.max(1,Math.ceil(b.height/h));
  if(cols*rows>120)throw new Error('Bu pafta 120 sayfayı aşıyor. Daha küçük çizim ölçeği seçin.');
  const pages=[];
  const left=b.x-(cols*w-b.width)/2,top=b.y-(rows*h-b.height)/2;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)pages.push(sheet(p,opts,spec,{x:left+col*w,y:top+row*h},pages.length,cols*rows));
  return {pages,width:spec.width,height:spec.height,scale:spec.scale};
}
export function exportSVG(p,options={}) {
  const d=buildDrawing(p,options),b=d.bounds,scale=Number(options.scale??50);
  if(!Number.isFinite(scale)||scale<=0)throw new Error('Ölçek pozitif olmalı.');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+n(b.width/scale)+'mm" height="'+n(b.height/scale)+'mm" viewBox="'+[b.x,b.y,b.width,b.height].map(n).join(' ')+'"><title>'+esc(p.name+' · '+d.title)+'</title>'+printStrokes(d.markup,scale)+'</svg>';
}
export function printHTML(p,options={}) {
  const {pages,width,height}=sheetPages(p,options);
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>'+esc(p.name+' — Ölçekli rölöve')+'</title><style>@page{size:'+width+'mm '+height+'mm;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#ddd}svg{display:block}article{width:'+width+'mm;height:'+height+'mm;overflow:hidden;break-after:page;background:white;margin:0 auto}article:last-child{break-after:auto}@media print{html,body{background:white}article{margin:0}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>'+pages.map(s=>'<article>'+s+'</article>').join('')+'</body></html>';
}
export function printSheet(p,options={}) {
  const html=printHTML(p,options),win=window.open('','_blank');
  if(!win)throw new Error('Pafta penceresini açmak için bu sitede yeni pencerelere izin verin.');
  win.opener=null;win.document.open();win.document.write(html);win.document.close();
  const ready=win.document.fonts?.ready||Promise.resolve();
  ready.then(()=>{if(!win.closed)win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>win.print()));});
  return win;
}
export {exportIFC} from './ifc.js';
