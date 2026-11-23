// [codex] ureten: codex
import { button, esc, fmt, icon } from './base.js';
import { wallName } from './plan.js';
import { projectChecks } from '../geometry/core.js';
import { roomCeilingInfo } from '../geometry/ceiling.js';
import { showDialog } from './dialog.js';

const labels = {door:'Kapı',window:'Pencere',opening:'Açıklık',beam:'Kiriş',ceiling:'Tavan bölgesi',
  socket:'Priz',switch:'Anahtar',niche:'Niş',column:'Kolon',shaft:'Şaft',vent:'Menfez',fixture:'Donatı'};
const length = (mm,unit) => Number.isFinite(mm) ? `${fmt(mm,unit)} ${unit}` : 'Ölçülmedi';
function current(p,s) {
  const room=p.rooms.find(r=>r.id===s.roomId && r.floorId===s.floorId);
  const wall=room && (room.wallIds.includes(s.wallId) ? s.wallId : room.wallIds[0]);
  return {room,wall};
}
export function verticalToolbar(p,s) {
  if (!['elevation','ceiling'].includes(s.mode)) return '';
  const {room,wall}=current(p,s);
  if(!room) return '';
  const elevation=s.mode==='elevation';
  const list=elevation ? room.wallIds.map((id,i)=>[id,'Duvar '+wallName(i)]) :
    p.rooms.filter(r=>r.floorId===s.floorId).map(r=>[r.id,r.name]);
  const selected=elevation ? wall : room.id;
  const selector='<select data-vertical-select="'+(elevation?'wall':'room')+'" aria-label="'+(elevation?'Görünüş duvarı':'Tavan planındaki mahal')+'">'+
    list.map(([id,name])=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>';
  const info=roomCeilingInfo(p,room.id);
  const h=Number.isFinite(room.height) ? (info.status==='estimated' ? 'Tahmin · ' : '')+length(room.height,p.unit) : 'Ölçü gir';
  return '<div class="vertical-toolbar" role="group" aria-label="Düşey ölçü araçları">'+selector+
    '<button class="height-action" data-act="room-height" data-id="'+esc(room.id)+'" aria-label="'+esc(room.name+' · Tavan yüksekliği · '+h)+'">'+icon('ceiling',18)+'<span>Tavan yüksekliği</span><strong>'+esc(h)+'</strong></button>'+
    button('vertical-details',elevation?'Duvar detayları':'Tavan detayları','settings','secondary')+'</div>';
}
function item(act,id,title,details,roomId) {
  return `<button class="dlg-row vertical-row" data-act="${esc(act)}" data-id="${esc(id)}"${roomId ? ` data-room-id="${esc(roomId)}"` : ''}><span class="info"><strong>${esc(title)}</strong><small>${esc(details)}</small></span>${icon('right',16)}</button>`;
}
export function openVerticalDetails(p,s) {
  const {room,wall}=current(p,s);
  if(!room) return;
  const elevation=s.mode==='elevation',floor=p.floors.find(f=>f.id===room.floorId);
  const open=['door','window','opening'];
  const objects=p.elements.filter(e=>e.wallId===wall && (open.includes(e.type) ||
    (e.roomId===room.id ? (e.side||'inside')===(s.side||'inside') : (e.side||'inside')!==(s.side||'inside'))));
  const other=p.rooms.filter(r=>r.id!==room.id && r.wallIds.includes(wall));
  const zones=p.zones.filter(z=>z.roomId===room.id && ['ceiling','beam'].includes(z.type));
  const context=elevation?' · Duvar '+wallName(room.wallIds.indexOf(wall))+' · '+(s.side==='outside'?'Dış yüz':'İç yüz'):'';
  const sections=[
    `<p class="intro">${esc([floor?.name,room.name].filter(Boolean).join(' / ')+context)}</p>`,
    item('room-height',room.id,'Mahal net tavan yüksekliği',length(room.height,p.unit)+' · bitmiş zeminden · '+roomCeilingInfo(p,room.id).methodLabel),
  ];
  if(elevation && wall) {
    sections.push('<div class="row-wrap">'+button('resize-wall','Duvar boyu','ruler','secondary',`data-id="${esc(wall)}"`)+button('flip-wall-face',s.side==='outside'?'İç yüze bak':'Dış yüze bak','rotate','secondary')+'</div>');
    for(const r of other)sections.push(item('shared-wall-room',r.id,r.name+' tarafından bak','Ortak duvar · diğer mahalin iç yüzü'));
    sections.push('<h3>Bu duvardaki öğeler</h3>');
    for(const e of objects){
      const descriptor=e.type==='window'?'Parapet':e.type==='door'?'Eşik':'Alt kot';
      const info=descriptor+' '+length(e.sill,p.unit)+' · Yükseklik '+length(e.height,p.unit)+' · En '+length(e.width,p.unit);
      sections.push(item('edit-element',e.id,e.name||labels[e.type]||'Duvar öğesi',info));
    }
    sections.push(button('add-element','Duvara öğe ekle','plus','secondary'));
  }
  sections.push('<h3>Mahalin tavan ve kiriş bölgeleri</h3>');
  for(const z of zones){
    const count=z.slopePoints?.length||0;
    const details=count ? `${count} eğim noktası` : 'Alt kot '+length(z.bottom,p.unit)+' · Üst kot '+length(z.top,p.unit);
    sections.push(item('zone-info',z.id,z.name||labels[z.type],details));
  }
  sections.push('<div class="row-wrap">'+button('add-ceiling-zone','Asma / eğimli tavan','ceiling','secondary',`data-id="${esc(room.id)}"`)+button('add-beam-zone','Kiriş altı','slab','secondary',`data-id="${esc(room.id)}"`)+'</div>');
  sections.push(button('vertical-checks','Kattaki eksik ve çelişen ölçüler','flag','secondary'));
  showDialog(elevation?'Duvar detayları':'Tavan detayları','<div class="vertical-details">'+sections.join('')+'</div>');
}

// Each finding returns to the room and the exact card that can complete it.
export function verticalIssues(p,floorId) {
  const rooms = new Map(p.rooms.filter(r=>r.floorId===floorId).map(r=>[r.id,r]));
  const findings=[];
  const add=(roomId,kind,id,text)=>{if(rooms.has(roomId))findings.push({roomId,kind,id,text});};
  for(const r of rooms.values()) {
    const info=roomCeilingInfo(p,r.id);
    if(info.status==='estimated') add(r.id,'room',r.id,'Tahmini tavan '+length(r.height,p.unit)+' · Yerinde ölç');
  }
  const zones=new Map(p.zones.filter(z=>rooms.has(z.roomId) && ['beam','ceiling'].includes(z.type)).map(z=>[z.id,z]));
  for(const v of projectChecks(p)) {
    if (v.kind==='height') add(v.roomId,'room',v.roomId,v.message);
    if (v.kind==='opening-face') add(v.roomId,'wall',v.wallId,v.message);
    if (v.kind==='opening-head') add(v.roomId,'element',v.elementId,v.message);
    if (v.kind==='slope') {
      const id=v.id.slice('slope-'.length);
      if(zones.has(id)) add(v.roomId,'zone',id,v.message);
    }
  }
  for(const z of zones.values()) {
    const count=z.slopePoints?.length||0,missing=[];
    if(count===1 || count===2) missing.push('eğim düzlemi için üç doğrusal olmayan nokta');
    if(count<3 && !Number.isFinite(z.bottom))missing.push('alt kot');
    if(!Number.isFinite(z.top))missing.push('üst kot');
    if(missing.length)add(z.roomId,'zone',z.id,(z.name||labels[z.type])+' · Eksik '+missing.join(', '));
  }
  for(const e of p.elements) {
    if(!rooms.has(e.roomId) || !['door','window','opening'].includes(e.type))continue;
    const missing=[];
    if(!Number.isFinite(e.sill))missing.push(e.type==='window'?'parapet':'eşik');
    if(!Number.isFinite(e.height))missing.push('açıklık yüksekliği');
    if(missing.length)add(e.roomId,'element',e.id,(e.name||labels[e.type])+' · Eksik '+missing.join(', '));
  }
  return findings;
}
export function openVerticalChecks(p,s) {
  const rows=verticalIssues(p,s.floorId),floor=p.floors.find(f=>f.id===s.floorId);
  const content=p.rooms.filter(r=>r.floorId===s.floorId).map(r=>{
    const roomIssues=rows.filter(v=>v.roomId===r.id);
    if(!roomIssues.length)return '';
    return '<h3>'+esc(r.name)+'</h3>'+roomIssues.map(v=>item('vertical-fix-'+v.kind,v.id,v.text,'Ölçü kartını aç',r.id)).join('');
  }).join('');
  showDialog('Düşey ölçü kontrolü','<div class="vertical-details"><p class="intro">'+esc(floor?.name||'')+' · '+rows.length+' açık kontrol</p>'+(content||'<p>Bu katta girilmiş verilerde açık düşey ölçü kontrolü bulunmuyor.</p>')+'</div>');
}
