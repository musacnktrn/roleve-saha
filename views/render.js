// [codex] ureten: codex
import {EPS,isNumber,isOpening,doorSwing,nameOf,tr,elevationLabel,indexProject,currentObservations,inwardSign,resolvePoint,areaSigned,distance,limits,cutSegments,frameFootprint,wallBands,buildSolids,heightAt,floorCells,voidsFor} from './model.js';
import {Drawing,esc,n,palette as C,outlineStyle} from './drawing.js';
import {figure} from '../ui/plan.js';
import {inkStyle,strokeMarkup,visibleSketches} from '../ui/sketch.js';
import {photoPin,bearingOnPlan} from '../ui/photo-placement.js';
import {surfaces} from '../ui/survey.js';
import {crossedOpenings,sectionFrame,wallCut} from './section.js';
import {openingDetailMarkup} from '../openings/drawing.js';
import {roomCeilingInfo} from '../geometry/ceiling.js';
import {wallInteriorSpans} from '../geometry/measure.js';
export {sectionOpenings} from './section.js';

const P=(x,y)=>({x,y});
const avg=vertices=>({x:vertices.reduce((s,v)=>s+v.x,0)/vertices.length,y:vertices.reduce((s,v)=>s+v.y,0)/vertices.length});
const knownHeight=room=>isNumber(room?.height);
const wallSection=(e)=>isNumber(e.sill)&&isNumber(e.height);
const metric=(mm)=>tr(mm/1000,3)+' m';
const measureName=(room,wall)=>'Duvar '+String.fromCharCode(65+Math.max(0,room?.wallIds.indexOf(wall.id)??0)%26);
const validPts = ring => Array.isArray(ring)&&ring.length>=3;
const namedPick=(meta,label,locate)=>({meta,label,locate});
const drawFont=(span)=>Math.max(65,Math.min(240,span/48||100));
const rectCorners=(l,r,low,high)=>[P(l,-low),P(r,-low),P(r,-high),P(l,-high)];
const fit=(x,min,max)=>Math.min(max,Math.max(min,x));
const zoneColors={platform:'#dfc9a9',beam:'#b8c3b5',stair:'#d3bc9c',ceiling:'#dde6e0',void:'#fbfaf5'};

function symbol(d,e,x0,x1,z0,z1,pick) {
  const l=Math.min(x0,x1),r=Math.max(x0,x1),y=-z1,b=-z0, w=r-l, h=b-y;
  const glass=e.type==='window',swing=doorSwing(e);
  d.rect(l,y,w,h,{fill:glass?C.glass:e.type==='door'?'#eee5d8':'#eff0e7',stroke:glass?C.azure:C.ink,width:1.55},pick);
  const custom=Boolean(e.detailStrokes?.length&&isOpening(e));
  const inset=Math.min(45,w*.095,h*.095);
  if(!custom&&isOpening(e)&&w>inset*2&&h>inset*2) d.rect(l+inset,y+inset,w-2*inset,h-2*inset,{fill:'none',stroke:glass?C.azure:C.line,width:.75});
  if(!custom&&glass&&w>300) {
    for(const fraction of [.30,.39]) d.line(P(l+w*.07,y+h*fraction),P(l+w*.22,y+h*(fraction-.15)),{stroke:C.azure,width:.7});
  } else if(swing) {
    const reverse=swing.atStart ? x0>x1 : x1>x0;d.line(P(reverse?r-inset:l+inset,y+inset),P(reverse?l+inset:r-inset,b-h*.53),{stroke:C.dim,dash:'4 3',width:.7});
    d.line(P(reverse?l+inset:r-inset,b-h*.53),P(reverse?r-inset:l+inset,b-inset),{stroke:C.dim,dash:'4 3',width:.7});
  } else if(e.type==='vent') {
    for(let i=1;i<5;i++)d.line(P(l+inset,y+i*h/5),P(r-inset,y+i*h/5),{width:.7});
  }
  if(custom)d.parts.push(openingDetailMarkup(e,{left:x0,right:x1,bottom:b,top:y}));
  if((e.type==='door'||e.type==='window')&&isNumber(e.handleHeight)) {
    const y=-(z0+e.handleHeight);
    d.line(P(r,y),P(r+d.font*.45,y),{stroke:C.dim,width:.75});
    d.text(r+d.font*.54,y-d.font*.1,(e.hardware||(e.type==='door'?'Kol':'Mandal'))+' · eşikten '+metric(e.handleHeight),{size:d.font*.64,color:C.dim,halo:true});
  }
}
function drawInk(d,stroke,points=stroke.points) {
  const b=limits(points);if(!b)return;
  const r=inkStyle(stroke).width/2;
  d.take([P(b.x-r,b.y-r),P(b.x+b.width+r,b.y+b.height+r)]);
  d.parts.push(strokeMarkup(stroke,points));
}
function faceElements(idx,room,wall,side) {
  const faceSign=inwardSign(idx,room,wall)*(side==='outside'?-1:1);
  return (idx.wallElements.get(wall.id)||[]).filter(e=>isOpening(e)||inwardSign(idx,idx.rooms.get(e.roomId)||room,wall)*(e.side==='outside'?-1:1)===faceSign);
}
const ceilingZone=zone=>zone.type==='ceiling'||zone.type==='beam';
function netHeightLabel(info) {
  return isNumber(info.height)?'Net '+metric(info.height)+' · '+info.methodLabel:'Net yükseklik gir';
}
// The index is local to one rendering; a new observation always builds a fresh index.
function ceilingInfo(idx,roomId) {
  const cache=idx.ceilings??=new Map();
  if(!cache.has(roomId))cache.set(roomId,roomCeilingInfo(idx.p,roomId));
  return cache.get(roomId);
}
function ceilingAnchor(info,point) {
  return {...point,roomId:info.room.id,floorId:info.floor.id,z:info.absoluteZ,
    estimated:info.status==='estimated',unmeasuredZ:info.absoluteZ===null,
    zSource:{purpose:'room-ceiling',roomId:info.room.id,status:info.status,method:info.current?.method??null,
      methodLabel:info.methodLabel,observationId:info.current?.id??null}};
}
function onCeilingEdge(info,point) {
  return info&&isNumber(point.z)&&isNumber(info.absoluteZ)&&Math.abs(point.z-info.absoluteZ)<=EPS?ceilingAnchor(info,point):point;
}
function wallCapInfo(idx,members,preferredRoomId) {
  const heights=members.filter(knownHeight);
  if(!heights.length)return null;
  const upper=Math.max(...heights.map(r=>r.height));
  const top=heights.filter(r=>Math.abs(r.height-upper)<=EPS);
  return ceilingInfo(idx,(top.find(r=>r.id===preferredRoomId)||top[0]).id);
}
function ceilingProfiles(idx,room,wall,f) {
  const ref={wallId:wall.id,roomId:room.id,side:'inside'};
  const a=resolvePoint(idx,{...ref,t:0},room.floorId);
  if(!a)return [];
  const point=s=>P(a.x+s*f.ux,a.y+s*f.uy);
  return (idx.roomZones.get(room.id)||[]).filter(zone=>ceilingZone(zone)&&validPts(zone.points)).flatMap(zone=>
    wallInteriorSpans(idx.p,room.id,wall.id,zone.points).map(([l,r])=>({
      zone,l,r,h0:heightAt(zone,point(l),'bottom'),h1:heightAt(zone,point(r),'bottom'),
      height:s=>heightAt(zone,point(s),'bottom')
    })));
}
function elevation(idx,o) {
  let room=idx.rooms.get(o.roomId)||idx.p.rooms.find(r=>r.floorId===o.floorId)||idx.p.rooms[0];
  let wall=idx.walls.get(o.wallId)||idx.walls.get(room?.wallIds[0]);
  if(wall&&!room?.wallIds.includes(wall.id))room=idx.members.get(wall.id)?.[0];
  if(!room||!wall||!idx.frames.has(wall.id))return empty('Görünüş için bir duvar seç');
  const f=idx.frames.get(wall.id),info=ceilingInfo(idx,room.id),z=info.floor.elevation;
  const outside=o.side==='outside',side=outside?'outside':'inside';
  const elems=faceElements(idx,room,wall,o.side);
  const profiles=outside?[]:ceilingProfiles(idx,room,wall,f);
  const top=Math.max(0,...(!outside&&knownHeight(room)?[room.height]:[]),
    ...elems.filter(wallSection).map(e=>e.sill+e.height),...profiles.flatMap(v=>[v.h0,v.h1]).filter(isNumber));
  const span=Math.max(top,f.len);
  const mobile=isNumber(o.viewportWidth)&&o.viewportWidth>0&&o.viewportWidth<600;
  const d=new Drawing(mobile?Math.max(drawFont(span),span/27):drawFont(span)),fs=d.font;
  const labelRow=Math.max(fs*2.1,span*78/(o.viewportWidth||850));
  const sign=inwardSign(idx,room,wall)*(outside?-1:1);
  const sx=distance=>sign>0?distance:f.len-distance;
  const wx=sx; // Reversal is its own inverse.
  const wallName=measureName(room,wall);
  const baseMeta={floorId:room.floorId,wallId:wall.id,roomId:room.id,side};
  const onFace=(along,height,face=side)=>{
    const anchor={floorId:room.floorId,wallId:wall.id,roomId:room.id,side:face,t:along/f.len,
      z:isNumber(height)?z+height:null,...(!isNumber(height)?{unmeasuredZ:true}:{})};
    const point=resolvePoint(idx,anchor,room.floorId);
    return {...anchor,x:point?.x??null,y:point?.y??null};
  };
  const along=p=>fit(wx(p.x),0,f.len);
  const locate=p=>onFace(along(p),Math.max(0,-p.y));
  if(knownHeight(room)&&!outside) {
    d.rect(0,-info.height,f.len,info.height,{fill:C.wall,stroke:C.ink,width:1.8},namedPick(baseMeta,wallName,p=>onCeilingEdge(info,locate(p))));
  } else if(top>0) {
    for(const x of [0,f.len])d.line(P(x,0),P(x,-top),{stroke:C.dim,width:.75,dash:'4 4'});
  }
  const ext=fs*1.5;
  const groundLabel='Zemin '+elevationLabel(z)+' m';
  d.surfaceTarget({from:P(0,0),to:P(f.len,0),caption:groundLabel,at:P(f.len+ext,fs*.32),color:C.ink,width:2.2},
    namedPick({...baseMeta,groundLevel:true},room.name+' · Bitmiş zemin '+elevationLabel(z)+' m',p=>onFace(along(p),0)));
  const netLabel=(outside?'İç yüz · ':'')+netHeightLabel(info);
  // The room's interior survey remains accessible from the opposite view,
  // without projecting an interior ceiling or beam onto the exterior face.
  d.surfaceTarget({...(knownHeight(room)&&!outside?{from:P(0,-info.height),to:P(f.len,-info.height)}:{}),
    caption:netLabel,at:P(0,-top-labelRow)},
    namedPick({...baseMeta,side:'inside',viewSide:side,roomHeight:true},room.name+' · Genel net tavan yüksekliği · '+netLabel,
      p=>ceilingAnchor(info,onFace(along(p),info.height,'inside'))));
  let unknownRow=0;
  for(const {zone,l,r,h0,h1,height} of profiles) {
    const known=isNumber(h0)&&isNumber(h1);
    const leftX=Math.min(sx(l),sx(r)),start=sx(l)<sx(r)?h0:h1,end=sx(l)<sx(r)?h1:h0;
    const differing=known&&Math.abs(start-end)>.1;
    const local=known?(differing?tr(start/1000,3)+'–'+metric(end):metric(start)):'kot gir';
    const caption=nameOf(zone)+' · alt '+local;
    const at=known?P(leftX,-start-fs*.25):P(0,-top-labelRow*(2.5+unknownRow++));
    const kot=known?'kot '+elevationLabel(z+start)+(differing?'–'+elevationLabel(z+end):'')+' m':'';
    d.surfaceTarget({...(known?{from:P(sx(l),-h0),to:P(sx(r),-h1)}:{}),caption,detail:z!==0?kot:'',at,color:C.accent,dash:'5 2'},
      namedPick({...baseMeta,zoneId:zone.id,heightZone:true},room.name+' · '+caption+(kot?' · '+kot:''),p=>{
        const s=fit(along(p),l,r);return {...onFace(s,height(s)),zoneId:zone.id};
      }));
  }
  for(const e of elems) {
    if(!wallSection(e))continue;
    symbol(d,e,sx(e.offset),sx(e.offset+e.width),e.sill,e.sill+e.height,namedPick({...baseMeta,elementId:e.id},nameOf(e),locate));
  }
  for(const {stroke,points} of visibleSketches(idx.p,{mode:'elevation',roomId:room.id,wallId:wall.id,floorId:room.floorId,side:o.side})) {
    drawInk(d,stroke,points);
  }
  d.dimension(0,f.len,-top-labelRow-fs*1.7,metric(f.len));
  if(knownHeight(room)&&!outside) {
    d.level(f.len+ext,-info.height,elevationLabel(info.absoluteZ)+' m');
    const dimX=-fs*.95;
    d.line(P(dimX,-info.height),P(dimX,0),{stroke:C.dim,width:.8});
    for(const y of [0,-info.height])d.line(P(dimX-fs*.25,y+fs*.25),P(dimX+fs*.25,y-fs*.25),{stroke:C.dim});
  }
  const cuts=Array.from(new Set([0,f.len,...elems.filter(isOpening).flatMap(e=>[sx(e.offset),sx(e.offset+e.width)])])).sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++) {
    const l=cuts[i-1],r=cuts[i];
    if(r-l>fs*1.8)d.dimension(l,r,fs*1.85,tr((r-l)/1000,3));
  }
  const notes=(idx.p.notes||[]).filter(note=>note.wallId===wall.id&&(!note.side||note.side===(o.side||'inside'))&&(!note.roomId||note.roomId===room.id));
  if(notes.length)d.text(0,fs*3.25,notes.length+' saha notu',{size:fs*.83,color:C.dim});
  return d.finish(room.name+' · '+wallName+' · '+(o.side==='outside'?'Dış yüz':'İç yüz'));
}
function empty(label){const d=new Drawing(90);d.text(0,0,label,{anchor:'middle',color:C.dim});return d.finish(label);}
function floorPlan(idx,o,ceiling=false) {
  const floor=idx.floors.get(o.floorId)||idx.p.floors[0];
  const rooms=idx.p.rooms.filter(r=>r.floorId===floor?.id && (!o.isolate||r.id===o.roomId));
  if(!floor)return empty('Önce bir kat ekle');
  const roomIds=new Set(rooms.map(r=>r.id));
  const inRoom=record=>!o.isolate||!record.roomId||roomIds.has(record.roomId);
  const strokes=ceiling?[]:(idx.p.strokes||[]).filter(st=>st.floorId===floor.id&&inRoom(st));
  const notes=(idx.p.notes||[]).filter(note=>(note.floorId||idx.rooms.get(note.roomId)?.floorId)===floor.id&&inRoom(note)&&(!ceiling||note.photo&&note.surface==='ceiling'));
  const witnesses=notes.flatMap(note=>[note.anchor,note.target]).filter(pt=>isNumber(pt?.x)&&isNumber(pt?.y));
  const ext=limits([...rooms.flatMap(r=>idx.rings.get(r.id)),...strokes.flatMap(st=>st.points),...witnesses]);
  if(!rooms.length&&!ext)return empty('Kat planına bir oda ekle');
  const d=new Drawing(drawFont(Math.max(ext?.width||0,ext?.height||0)));
  const z=floor.elevation??0;
  for(const room of rooms) {
    const ring=idx.rings.get(room.id), zones=idx.roomZones.get(room.id)||[];
    const voids=voidsFor(zones).filter(zone=>validPts(zone.points));
    const meta={floorId:floor.id,roomId:room.id};
    const pick=namedPick(meta,room.name,pt=>ceiling?ceilingAnchor(ceilingInfo(idx,room.id),pt):{...pt,z});
    for(const cell of floorCells(ring,voids.map(zone=>zone.points)))d.poly(cell,{fill:room.id===o.roomId?'#e3e9de':C.wall,stroke:'none'},pick);
    for(const zone of zones) {
      if(!validPts(zone.points))continue;
      d.poly(zone.points,{fill:zone.type==='void'?'none':zoneColors[zone.type]||'#e1ddcc',stroke:zone.type==='void'?C.accent:C.dim,dash:zone.type==='void'||zone.type==='ceiling'?'5 3':undefined,width:1},namedPick({...meta,zoneId:zone.id,...(ceiling&&ceilingZone(zone)?{heightZone:true}:{})},nameOf(zone),pt=>{
        const h=heightAt(zone,pt,ceiling?'bottom':'top');return {...pt,z:isNumber(h)?z+h:null,...(!isNumber(h)?{unmeasuredZ:true}:{})};}));
      const b=limits(zone.points);
      if(b.width>d.font*6 && b.height>d.font*2) {
        const face=ceiling?'bottom':'top',top=heightAt(zone,avg(zone.points),face);
        d.text(b.x+d.font*.5,b.y+d.font*1.35,nameOf(zone)+(isNumber(top)?' '+elevationLabel(z+top):''),{color:C.dim,size:d.font*.76,halo:true});
      }
    }
  }
  function roomLabel(room) {
    const ring=idx.rings.get(room.id);
    const cells=floorCells(ring,voidsFor(idx.roomZones.get(room.id)||[]).map(z=>z.points));
    if(!cells.length)return;
    const anchor=avg(cells.sort((a,b)=>Math.abs(areaSigned(b))-Math.abs(areaSigned(a)))[0]);
    d.text(anchor.x,anchor.y,room.name,{anchor:'middle',bold:true,halo:true});
    if(ceiling) {
      const info=ceilingInfo(idx,room.id),caption=netHeightLabel(info);
      const wallId=room.wallIds.includes(o.wallId)?o.wallId:room.wallIds[0];
      const meta={floorId:room.floorId,roomId:room.id,wallId,roomHeight:true};
      d.surfaceTarget({caption,at:P(anchor.x,anchor.y+d.font*1.35),anchor:'middle'},
        namedPick(meta,room.name+' · Genel net tavan yüksekliği · '+caption,
          ()=>ceilingAnchor(info,anchor)));
      const status=isNumber(info.absoluteZ)?'Tavan '+elevationLabel(info.absoluteZ)+' m':'Tavan kotu eksik';
      d.text(anchor.x,anchor.y+d.font*2.5,status,{anchor:'middle',size:d.font*.72,color:C.dim,halo:true});
    }
  }
  if(ceiling)for(const room of rooms)roomLabel(room);
  if(!ceiling)for(const item of idx.p.furniture||[]) {
    if(!roomIds.has(item.roomId)||![item.x,item.y,item.width,item.depth].every(isNumber))continue;
    d.take([P(item.x,item.y),P(item.x+item.width,item.y+item.depth)]);
    d.parts.push('<g fill="#f6f4e9" stroke="#839382" stroke-width="16">'+figure(item.type,item.x,item.y,item.width,item.depth,item.rotation)+'</g>');
  }
  for(const wall of idx.p.walls.filter(w=>w.floorId===floor.id)) {
    const members=(idx.members.get(wall.id)||[]).filter(r=>roomIds.has(r.id));
    const member=members.find(r=>r.id===o.roomId)||members[0];
    const f=idx.frames.get(wall.id);if(!f||!member)continue;
    const openings=(idx.wallElements.get(wall.id)||[]).filter(isOpening).slice().sort((a,b)=>a.offset-b.offset);
    const wallPick=namedPick({floorId:floor.id,roomId:member.id,wallId:wall.id},measureName(member,wall),
      p=>ceiling?ceilingAnchor(ceilingInfo(idx,member.id),p):{...p,z});
    let end=0;
    function solid(l,r) {if(r-l<=EPS)return;d.poly(frameFootprint(f,l,r),outlineStyle(C.ink),wallPick);}
    for(const el of openings) {
      const start=fit(el.offset,0,f.len),finish=fit(el.offset+el.width,0,f.len);
      solid(end,start);end=Math.max(end,finish);
      d.poly(frameFootprint(f,start,finish),{fill:el.type==='window'?C.glass:C.paper,stroke:C.line,width:.7},namedPick({floorId:floor.id,roomId:member.id,wallId:wall.id,elementId:el.id},nameOf(el),p=>({...p,z:isNumber(el.sill)?z+el.sill:null})));
      const swing=doorSwing(el);
      if(swing&&!ceiling&&finish>start) {
        const sign=inwardSign(idx,idx.rooms.get(el.roomId)||member,wall)*swing.direction;
        const h=swing.atStart?start:finish,r=finish-start;
        const hinge=f.point(h,f.centerOffset),tip=f.point(h,f.centerOffset+sign*r),closed=f.point(swing.atStart?finish:start,f.centerOffset);
        const sweep=(swing.atStart?1:-1)*sign>0?1:0;
        d.take([tip,hinge,closed]);d.line(hinge,tip,{stroke:C.line,width:.9});
        d.parts.push('<path d="M'+n(closed.x)+' '+n(closed.y)+' A'+n(r)+' '+n(r)+' 0 0 '+sweep+' '+n(tip.x)+' '+n(tip.y)+'" fill="none" stroke="'+C.dim+'" stroke-width=".7" vector-effect="non-scaling-stroke" pointer-events="none"/>');
      }
    }
    solid(end,f.len);
  }
  if(!ceiling)for(const room of rooms)roomLabel(room);
  if(!ceiling)for(const obs of currentObservations(idx.p)) {
    if(obs.purpose==='room-ceiling'||obs.floorId!==floor.id||(!roomIds.has(obs.roomId)&&obs.roomId))continue;
    const a=resolvePoint(idx,obs.a,floor.id), b=resolvePoint(idx,obs.b,floor.id);if(!a||!b)continue;
    d.line(a,b,{stroke:C.accent,dash:'4 3'});d.text((a.x+b.x)/2,(a.y+b.y)/2-d.font*.2,metric(obs.value),{anchor:'middle',size:d.font*.78,color:C.accent,halo:true});
  }
  for(const stroke of strokes)drawInk(d,stroke);
  const numbers=new Map((idx.p.notes||[]).filter(n=>n.photo).map((note,i)=>[note.id,i+1]));
  for(const note of notes) {
    // Photo pins retain capture coordinates plus context IDs. A wall or
    // element hit does not turn the camera position into a geometric anchor.
    const pointFor=v=>isNumber(v?.x)&&isNumber(v?.y)?v:resolvePoint(idx,v,floor.id);
    const a=pointFor(note.anchor);if(!a)continue;
    const target=pointFor(note.target);
    if(note.photo) {
      const direction=isNumber(note.direction)?note.direction:target&&distance(a,target)>=1?bearingOnPlan(a,target):null;
      d.parts.push(photoPin({...note,anchor:a,target,direction}));
      d.take([P(a.x-430,a.y-430),P(a.x+430,a.y+430)]);
      if(target)d.take([target]);
      const mark='F'+String(numbers.get(note.id)).padStart(2,'0')+' · '+(surfaces[note.surface]||'Fotoğraf')+(isNumber(direction)?' · '+tr(direction,1)+'°':'');
      d.text(a.x+190,a.y+d.font,mark,{size:d.font*.92,color:C.teal,bold:true,halo:true});
      if(note.text)d.text(a.x+190,a.y+d.font*2,note.text,{size:d.font*.66,color:C.dim,halo:true});
    } else if(note.text)d.text(a.x+d.font*.45,a.y+d.font,note.text,{size:d.font*.72,color:C.accent,halo:true});
  }
  if(!ceiling&&(o.sectionLine||o.sectionId)) {
    const trace=sectionFrame(idx,{...o,isolate:true,floorId:floor.id});
    if(trace?.len&&(!trace.sourceFloorId||trace.sourceFloorId===floor.id)) {
      d.line(trace.a,trace.b,{stroke:C.teal,width:1.15,dash:'9 4 2 4'});
      for(const [end,label] of [[trace.a,'A'],[trace.b,'A′']]) {
        const arm=d.font*1.7,head=d.font*.36;
        const tip=P(end.x+arm*trace.look.x,end.y+arm*trace.look.y);
        const base=P(tip.x-2*head*trace.look.x,tip.y-2*head*trace.look.y);
        d.line(end,tip,{stroke:C.teal,width:1.45});
        d.poly([tip,P(base.x+head*trace.ux,base.y+head*trace.uy),P(base.x-head*trace.ux,base.y-head*trace.uy)],{fill:C.teal,stroke:'none'});
        d.text(end.x-trace.look.x*d.font*.6,end.y-trace.look.y*d.font*.6,label,{anchor:'middle',color:C.teal,bold:true,halo:true});
      }
    }
  }
  return d.finish(floor.name+(ceiling?' · Tavan planı':' · Kat planı'));
}
function crossSection(idx,o) {
  const trace=sectionFrame(idx,o);
  if(!trace)return empty('Kesit için bir oda ekle');
  if(!trace.len)return empty('Kesit için iki ayrı nokta seç');
  const {a,b,len,rooms,floors,floorIds:ids,point:pos}=trace;
  const d=new Drawing(drawFont(len)),fs=d.font;
  const choose=pt=>({...pos(fit(pt.x,0,len)),z:-pt.y});
  const openings=crossedOpenings(idx,trace);
  let cuts=0;
  for(const room of rooms) {
    const info=ceilingInfo(idx,room.id),z=info.floor.elevation,zones=idx.roomZones.get(room.id)||[];
    const ring=idx.rings.get(room.id),voids=voidsFor(zones);
    for(const [l,r] of cutSegments(a,b,[ring])) {
      cuts++;const meta={floorId:room.floorId,roomId:room.id};
      const pick=namedPick(meta,room.name,pt=>onCeilingEdge(info,choose(pt)));
      if(knownHeight(room)) {
        d.poly(rectCorners(l,r,z,z+room.height),{fill:'#f3f1e8',stroke:C.faint,width:.7},pick);
      }
      const edge=knownHeight(room)?{from:P(l,-info.absoluteZ),to:P(r,-info.absoluteZ)}:
        {caption:'Net yükseklik gir',at:P((l+r)/2,-z-fs*2),anchor:'middle'};
      d.surfaceTarget({...edge,color:C.ink,width:1.4},namedPick({...meta,roomHeight:true},
        room.name+' · Genel net tavan yüksekliği · '+netHeightLabel(info),pt=>ceilingAnchor(info,pos(fit(pt.x,l,r)))));
      if(r-l>fs*4)d.text((l+r)/2,-z-(knownHeight(room)?room.height*.55:fs*.7),room.name,{anchor:'middle',size:fs*.9,halo:true});
    }
    for(const [l,r] of cutSegments(a,b,[ring,...voids.map(v=>v.points)])) d.line(P(l,-z),P(r,-z),{stroke:C.ink,width:2.6});
    for(const zone of zones) {
      if(zone.type==='void')continue;
      const holes=zone.type==='platform'?voidsFor(zones,zone).map(v=>v.points):[];
      for(const [l,r] of cutSegments(a,b,[zone.points,...holes])) {
        const low=[l,r].map(s=>heightAt(zone,pos(s),'bottom')),high=[l,r].map(s=>heightAt(zone,pos(s),'top'));
        if(!low.every(isNumber)&&!high.every(isNumber))continue;
        const ll=low.every(isNumber)?low:high, hh=high.every(isNumber)?high:low;
        const profile=[P(l,-z-ll[0]),P(r,-z-ll[1]),P(r,-z-hh[1]),P(l,-z-hh[0])];
        d.poly(profile,{fill:zoneColors[zone.type]||C.floor,stroke:C.ink,width:1.45},namedPick({floorId:room.floorId,roomId:room.id,zoneId:zone.id,...(ceilingZone(zone)?{heightZone:true}:{})},nameOf(zone),choose));
        if(r-l>fs*4)d.text(l+fs*.3,-z-hh[0]-fs*.25,nameOf(zone)+' '+elevationLabel(z+hh[0]),{size:fs*.7,color:C.teal,halo:true});
      }
    }
  }
  for(const wall of idx.p.walls.filter(w=>ids.has(w.floorId))) {
    const f=idx.frames.get(wall.id),members=idx.members.get(wall.id)||[];
    const cap=wallCapInfo(idx,members,o.roomId),max=cap?.height;
    if(!f||!max)continue;
    const z=idx.floors.get(wall.floorId)?.elevation??0;
    const bands=wallBands(f,max,idx.wallElements.get(wall.id)||[]);
    for(const band of bands) {
      const cut=wallCut(trace,f,band.l,band.r);
      if(!cut)continue;
      const {fromMm:l,toMm:r}=cut;
      if(r-l<EPS)d.line(P(l,-z-band.low),P(l,-z-band.high),{stroke:C.ink,width:1.25});
      else d.poly(rectCorners(l,r,z+band.low,z+band.high),{fill:C.ink,stroke:C.ink,width:1},namedPick({floorId:wall.floorId,roomId:members[0]?.id,wallId:wall.id},'Kesilen duvar',pt=>onCeilingEdge(cap,choose(pt))));
      if(Math.abs(band.high-max)<=EPS&&r-l>EPS)d.surfaceTarget({from:P(l,-cap.absoluteZ),to:P(r,-cap.absoluteZ),color:C.ink},
        namedPick({floorId:wall.floorId,roomId:cap.room.id,wallId:wall.id,roomHeight:true},cap.room.name+' · Duvar üst sınırı · '+netHeightLabel(cap),
          pt=>ceilingAnchor(cap,pos(fit(pt.x,l,r)))));
    }
  }
  if(!cuts&&!openings.length)return empty('Kesit hattı odaların dışında');
  for(const hit of openings) {
    const {fromMm:l,toMm:r,stationMm:mid,sillZ,headZ}=hit;
    const z=idx.floors.get(hit.floorId).elevation;
    const color=hit.type==='window'?C.azure:C.accent;
    const kind=hit.type==='door'?'Eşik':'Parapet';
    const info=kind+' '+(hit.sill===null?'ölçülmedi':metric(hit.sill))+' · Net '+(hit.height===null?'ölçülmedi':metric(hit.height));
    const label=hit.name+' · '+info;
    const pick=namedPick({elementId:hit.elementId,roomId:hit.roomId,wallId:hit.wallId,floorId:hit.floorId,sectionOpening:true},label,pt=>{
      const station=fit(pt.x,l,r);
      return {...pos(station),z:sillZ===null?null:headZ===null?sillZ:fit(-pt.y,sillZ,headZ)};
    });
    if(sillZ!==null&&headZ!==null) {
      if(r-l>EPS)d.poly(rectCorners(l,r,sillZ,headZ),{fill:hit.type==='window'?'#e0eeec':'#f1eadc',stroke:color,width:.85});
      // The vertical stroke marks the opening interval; it does not invent an unmeasured frame profile.
      d.line(P(mid,-sillZ),P(mid,-headZ),{stroke:color,width:1.55});
      d.text(r+fs*.26,-(sillZ+headZ)/2,hit.name,{size:fs*.73,color,halo:true});
      d.text(r+fs*.26,-(sillZ+headZ)/2+fs*.9,info,{size:fs*.62,color,halo:true});
      d.sectionTarget(l,r,sillZ,headZ,pick);
    } else {
      const ref=sillZ??z;
      d.line(P(mid-fs*.3,-ref),P(mid+fs*.3,-ref),{stroke:color,width:1.3});
      d.text(r+fs*.3,-ref-fs*.3,label,{size:fs*.69,color,halo:true});
      d.sectionTarget(l,r,ref-fs*.40,ref+fs*.40,pick);
    }
  }
  for(const floor of floors)d.level(len+fs*.6,-(floor.elevation??0),floor.name+' '+elevationLabel(floor.elevation??0));
  const ground=Math.min(...floors.map(f=>f.elevation??0));
  d.dimension(0,len,-ground+fs*2.5,metric(len));
  d.text(0,-ground+fs*3.67,'A',{color:C.teal,anchor:'middle',bold:true});d.text(len,-ground+fs*3.67,'A′',{color:C.teal,anchor:'middle',bold:true});
  return d.finish(trace.name?trace.name+' · A – A′':'A – A′ kesiti');
}
function facade(idx,o) {
  const pickedWall=idx.walls.get(o.wallId);
  const exterior=w=>w&&idx.frames.has(w.id)&&idx.members.get(w.id)?.length===1;
  const originWall=(exterior(pickedWall)?pickedWall:null)||idx.p.walls.find(w=>exterior(w)&&w.floorId===o.floorId)||idx.p.walls.find(exterior);
  if(!originWall)return empty('Cephe için bir dış duvar seç');
  const reference=idx.frames.get(originWall.id),host=idx.members.get(originWall.id)?.[0];
  const sign=-inwardSign(idx,host,originWall);
  const right={x:reference.ux*sign,y:reference.uy*sign};
  const outward={x:-reference.uy*sign,y:reference.ux*sign};
  const dot=(p,v)=>(p.x-reference.a.x)*v.x+(p.y-reference.a.y)*v.y;
  const visible=[];
  for(const w of idx.p.walls) {
    const rooms=idx.members.get(w.id)||[],f=idx.frames.get(w.id);
    if(rooms.length!==1||!f||(o.isolate&&w.floorId!==o.floorId))continue;
    const s=-inwardSign(idx,rooms[0],w);
    if(((-f.uy*s)*outward.x+(f.ux*s)*outward.y)<.02)continue;
    const z=idx.floors.get(w.floorId)?.elevation??0;
    visible.push({w,f,room:rooms[0],z,depth:(dot(f.a,outward)+dot(f.b,outward))*.5});
  }
  if(!visible.length)return empty('Bu yönde dış cephe bulunmuyor');
  const all=visible.flatMap(v=>[P(dot(v.f.a,right),-v.z),P(dot(v.f.b,right),-v.z-(v.room.height||0))]);
  const bounds=limits(all),d=new Drawing(drawFont(Math.max(bounds.width,bounds.height)));
  for(const {w,f,room,z} of visible.sort((a,b)=>a.depth-b.depth)) {
    const l=dot(f.a,right),r=dot(f.b,right), h=knownHeight(room)?room.height:0;
    if(Math.abs(l-r)<EPS)continue;
    const locate=p=>{
      const t=fit((p.x-l)/(r-l),0,1),side='outside';
      const offset=f.centerOffset-inwardSign(idx,room,w)*f.thick/2;
      return {...f.point(t*f.len,offset,-p.y),wallId:w.id,roomId:room.id,side,t};
    };
    const meta={floorId:w.floorId,roomId:room.id,wallId:w.id};
    if(h) {
      const cap=ceilingInfo(idx,room.id);
      d.poly(rectCorners(l,r,z,z+h),{fill:w.id===originWall.id?'#e6e4d9':C.wall,stroke:C.ink,width:1.35},
        namedPick(meta,room.name+' dış cephe',p=>onCeilingEdge(cap,locate(p))));
      d.surfaceTarget({from:P(l,-cap.absoluteZ),to:P(r,-cap.absoluteZ),color:C.ink},
        namedPick({...meta,roomHeight:true},room.name+' · Duvar üst sınırı · '+netHeightLabel(cap),p=>ceilingAnchor(cap,locate(p))));
    }
    else {d.line(P(l,-z),P(r,-z),{stroke:C.ink,width:1.7});d.text((l+r)/2,-z-d.font*.4,'Yükseklik eksik',{size:d.font*.7,anchor:'middle',color:C.accent});}
    for(const e of faceElements(idx,room,w,'outside').filter(wallSection)) {
      symbol(d,e,l+(r-l)*e.offset/f.len,l+(r-l)*(e.offset+e.width)/f.len,z+e.sill,z+e.sill+e.height,namedPick({...meta,elementId:e.id},nameOf(e),locate));
    }
  }
  for(const floor of idx.p.floors.filter(f=>visible.some(v=>v.w.floorId===f.id)))d.level(bounds.x+bounds.width+d.font, -floor.elevation,floor.name+' '+elevationLabel(floor.elevation));
  return d.finish('Dış cephe · '+(host?.name || 'Bina'));
}
function projector(yaw,pitch) {
  const az=yaw*Math.PI/180,el=fit(pitch,3,88)*Math.PI/180;
  const c=Math.cos(az),s=Math.sin(az),up=Math.cos(el),tilt=Math.sin(el);
  return p=>{
    const forward=s*p.x+c*p.y;
    return {x:c*p.x-s*p.y,y:tilt*forward-up*p.z,depth:up*forward+tilt*p.z};
  };
}
function locateOnFace(screen,world,pt) {
  if(!pt)return world[0];
  for(let i=1;i<screen.length-1;i++) {
    const a=screen[0],b=screen[i],c=screen[i+1];
    const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(Math.abs(den)<EPS)continue;
    const w1=((b.y-c.y)*(pt.x-c.x)+(c.x-b.x)*(pt.y-c.y))/den;
    const w2=((c.y-a.y)*(pt.x-c.x)+(a.x-c.x)*(pt.y-c.y))/den;
    const w3=1-w1-w2;
    if(w1>=-.001&&w2>=-.001&&w3>=-.001) {
      const mix=k=>w1*world[0][k]+w2*world[i][k]+w3*world[i+1][k];
      return {x:mix('x'),y:mix('y'),z:mix('z')};
    }
  }
  let near=0;
  for(let i=1;i<screen.length;i++)if(distance(screen[i],pt)<distance(screen[near],pt))near=i;
  return world[near];
}
function surfaceStyle(solid,face,proj,selected) {
  const flat=face.every(v=>Math.abs(v.z-face[0].z)<EPS);
  if(solid.type==='wall') {
    if(flat)return {fill:'#aab8ac',stroke:'#53665c',width:.72};
    const edge=face.find(v=>distance(v,face[0])>EPS);
    const east=edge&&Math.abs(edge.x-face[0].x)>Math.abs(edge.y-face[0].y);
    return {fill:east?'#e3e3d9':'#f4efe1',stroke:'#55675a',width:selected?1.45:.77};
  }
  if(solid.type==='floor')return {fill:selected?'#d0dbc5':'#dbe0d4',stroke:'#72816f',width:.72};
  if(solid.type==='window')return {fill:'#b2d2d3',stroke:'#61898c',opacity:.76,width:.85};
  if(solid.type==='ceiling')return {fill:'#cadccf',stroke:'#758a7c',opacity:.46,width:.85};
  if(solid.type==='door')return {fill:'#c8b799',stroke:'#846e51',width:.8};
  return {fill:zoneColors[solid.type]||'#b1bdb5',stroke:'#687966',width:.85};
}
function axonometric(idx,o) {
  const solidList=buildSolids(idx,o);
  if(!solidList.length)return empty('Model için bir oda veya ölçü ekle');
  const project=projector(isNumber(o.yaw)?o.yaw:35,isNumber(o.pitch)?o.pitch:28);
  const faces=[];
  for(const solid of solidList) for(const face of solid.faces) {
    const screen=face.map(project);
    if(Math.abs(areaSigned(screen))<EPS)continue;
    faces.push({solid,world:face,screen,depth:screen.reduce((sum,v)=>sum+v.depth,0)/screen.length});
  }
  faces.sort((a,b)=>a.depth-b.depth);
  const e=limits(faces.flatMap(f=>f.screen));if(!e)return empty('Gösterilecek yüz bulunmuyor');
  const d=new Drawing(drawFont(Math.max(e.width,e.height)));
  for(const {solid,world,screen} of faces) {
    const meta={roomId:solid.roomId,wallId:solid.wallId,zoneId:solid.zoneId,elementId:solid.elementId,floorId:solid.floorId,...(solid.zoneId&&ceilingZone(solid)?{heightZone:true}:{})};
    const members=solid.type==='wall'?(idx.members.get(solid.wallId)||[]).filter(r=>!o.isolate||!o.roomId||r.id===o.roomId):[];
    const cap=wallCapInfo(idx,members,o.roomId),top=cap&&world.every(v=>Math.abs(v.z-cap.absoluteZ)<=EPS);
    const pick=namedPick(top?{...meta,roomHeight:true,roomId:cap.room.id}:meta,
      top?cap.room.name+' · Duvar üst yüzü · '+netHeightLabel(cap):solid.name,pt=>onCeilingEdge(cap,locateOnFace(screen,world,pt)));
    const style=surfaceStyle(solid,world,screen,solid.wallId?solid.wallId===o.wallId:solid.roomId===o.roomId);
    d.poly(screen,style,pick);
    // A wall without a measured thickness has no top polygon to tap.
    if(cap&&!(idx.frames.get(solid.wallId)?.thick>EPS)) {
      const upper=world.map((v,i)=>({v,s:screen[i]})).filter(({v})=>Math.abs(v.z-cap.absoluteZ)<=EPS);
      if(upper.length===2) {
        const [a,b]=upper,dx=b.s.x-a.s.x,dy=b.s.y-a.s.y,den=dx*dx+dy*dy;
        if(den>EPS)d.surfaceTarget({from:a.s,to:b.s,color:C.line,width:.8},namedPick({...meta,roomHeight:true,roomId:cap.room.id},
          cap.room.name+' · Duvar üst kenarı · '+netHeightLabel(cap),pt=>{
            const t=fit(((pt.x-a.s.x)*dx+(pt.y-a.s.y)*dy)/den,0,1);
            return ceilingAnchor(cap,P(a.v.x+t*(b.v.x-a.v.x),a.v.y+t*(b.v.y-a.v.y)));
          }));
      }
    }
    const el=idx.elements.get(solid.elementId);
    if(el?.detailStrokes?.length&&isOpening(el)&&screen.length===4&&el.width>0&&el.height>0) {
      const [a,b,,top]=screen;
      const matrix=[(b.x-a.x)/el.width,(b.y-a.y)/el.width,(a.x-top.x)/el.height,(a.y-top.y)/el.height,a.x,a.y];
      // Keep details next to their own face in the depth-sorted drawing. Faces
      // later in the list then occlude the linework as well as the panel.
      d.parts.push('<g pointer-events="none" transform="matrix('+matrix.map(n).join(' ')+')">'+openingDetailMarkup(el,{left:0,right:el.width,bottom:0,top:-el.height})+'</g>');
    }
  }
  for(const a of o.anchors||[]) {
    const p=resolvePoint(idx,a,o.floorId);
    if(p&&isNumber(p.z))d.dot(project(p),null);
  }
  if((o.anchors||[]).length===2) {
    const [a,b]=o.anchors.map(p=>resolvePoint(idx,p,o.floorId));
    if(a&&b&&isNumber(a.z)&&isNumber(b.z)) {
      const u=project(a),v=project(b);d.line(u,v,{stroke:C.accent,width:1.9,dash:'5 3'});
      d.text((u.x+v.x)/2,(u.y+v.y)/2-d.font*.35,metric(Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)),{anchor:'middle',halo:true,color:C.accent});
    }
  }
  const unknown=idx.p.rooms.filter(room=>!knownHeight(room)&&(!o.isolate||((!o.floorId||room.floorId===o.floorId)&&(!o.roomId||room.id===o.roomId))));
  if(unknown.length)d.text(e.x,e.y+e.height+d.font*1.7,'Tavan yüksekliği eksik · '+unknown.map(r=>r.name).join(', '),{size:d.font*.74,color:C.accent});
  return d.finish('Aksonometrik model');
}
export function buildDrawing(project,options={}) {
  const idx=indexProject(project);
  switch(options.mode) {
    case 'model': return axonometric(idx,options);
    case 'elevation': return elevation(idx,options);
    case 'section': return crossSection(idx,options);
    case 'facade': return facade(idx,options);
    case 'ceiling': return floorPlan(idx,options,true);
    default: return floorPlan(idx,options);
  }
}
const eventsBySvg=new WeakMap();
export function renderView(svg,project,options={}) {
  const drawing=buildDrawing(project,{...options,viewportWidth:svg.clientWidth||options.viewportWidth}),b=drawing.bounds;
  svg.setAttribute('viewBox',[b.x,b.y,b.width,b.height].map(n).join(' '));
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  svg.setAttribute('aria-label',drawing.title);
  svg.innerHTML='<title>'+esc(drawing.title)+'</title>'+drawing.markup;
  const old=eventsBySvg.get(svg);
  if(old) {svg.removeEventListener('click',old);svg.removeEventListener('keydown',old);}
  const pick=event=>{
    if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
    const el=event.target?.closest?.('[data-rs-pick]');if(!el||typeof options.onPick!=='function')return;
    const obj=drawing.picks[Number(el.getAttribute('data-rs-pick'))];if(!obj)return;
    let p;
    const matrix=svg.getScreenCTM?.();
    if(event.type==='click'&&event.detail!==0&&matrix) {
      const q=svg.createSVGPoint();q.x=event.clientX;q.y=event.clientY;const point=q.matrixTransform(matrix.inverse());p={x:point.x,y:point.y};
    } else {
      const box=el.getBBox();p={x:box.x+box.width/2,y:box.y+box.height/2};
    }
    event.preventDefault();
    const anchor=obj.locate(p);
    const rounded=value=>isNumber(value)?Math.round(value*1000)/1000:null;
    const source=anchor.zSource;
    const label=source&&!obj.label.includes(source.methodLabel)?obj.label+' · '+source.methodLabel:obj.label;
    const meta=source?{...obj.meta,roomId:source.roomId,floorId:anchor.floorId}:obj.meta;
    options.onPick({...meta,anchor:{...anchor,...(meta.floorId?{floorId:meta.floorId}:{}),x:rounded(anchor.x),y:rounded(anchor.y),z:rounded(anchor.z),label}});
  };
  if(['ink','erase'].includes(options.tool)) {
    for(const el of svg.querySelectorAll('[data-rs-pick]')) {
      el.removeAttribute('tabindex');el.removeAttribute('role');el.removeAttribute('style');el.setAttribute('pointer-events','none');
    }
    for(const el of svg.querySelectorAll('[pointer-events="stroke"],[pointer-events="all"]'))el.setAttribute('pointer-events','none');
    eventsBySvg.delete(svg);
  } else if(options.onPick){svg.addEventListener('click',pick);svg.addEventListener('keydown',pick);eventsBySvg.set(svg,pick);}
  else eventsBySvg.delete(svg);
  return {bounds:b,title:drawing.title};
}
