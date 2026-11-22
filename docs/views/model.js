// [codex] ureten: codex
import {resolveAnchor as surveyAnchor} from '../geometry/measure.js';
import {zoneSurfaceAt} from '../geometry/core.js';
// Coordinates stay in survey millimetres throughout; Y grows down in the plan.
export const EPS = 0.00001;
export const isNumber = Number.isFinite;
export const isOpening = element => ['door', 'window', 'opening'].includes(element.type);
/** Hinge position is recorded from wall.a. A merged, reversed span swaps endpoints. */
export function doorSwing(el) {
  const match=/^(left|right)(?:-(in|out))?$/.exec(el.swing||'');
  if(el.type!=='door'||!match)return null;
  const atStart=(match[1]==='left')!==Boolean(el.reversedAlongWall);
  const direction=match[2] ? (match[2]==='out'?-1:1) : (el.side==='outside'?-1:1);
  return {atStart,direction};
}
export const kinds = {door:'Kapı', window:'Pencere', opening:'Açıklık', socket:'Priz', niche:'Niş', column:'Kolon', beam:'Kiriş', vent:'Menfez', switch:'Anahtar', drain:'Gider', fixture:'Donatı', shaft:'Şaft', platform:'Asma kat', ceiling:'Tavan bölgesi', void:'Galeri boşluğu', stair:'Merdiven'};
export const nameOf = item => item?.name || kinds[item?.type] || 'Öğe';
export const tr = (n, digits = 2) => isNumber(n) ? n.toLocaleString('tr-TR', {maximumFractionDigits:digits}) : '?';
export const elevationLabel = n => isNumber(n) ? (n >= 0 ? '+' : '−') + tr(Math.abs(n) / 1000, 3) : '?';
export function areaSigned(ring) {
  return ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]; return sum + a.x * b.y - b.x * a.y; }, 0) / 2;
}
export function distance(a,b) { return Math.hypot(b.x - a.x, b.y - a.y); }
export function pointInRing(pt, ring) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x-a.x)*(pt.y-a.y)/(b.y-a.y)+a.x) inside = !inside;
  }
  return inside;
}
export function limits(points) {
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for (const p of points) {
    if (!isNumber(p.x)||!isNumber(p.y)) continue;
    x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);
  }
  return x === Infinity ? null : {x,y,width:right-x,height:bottom-y};
}
function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const id = item[key];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(item);
  }
  return map;
}
export function currentObservations(project) {
  const records=project.observations||[],replaced=new Set(records.map(o=>o.replaces).filter(Boolean));
  return records.filter(o=>!replaced.has(o.id));
}
export function indexProject(p) {
  const keyed = list => new Map((list || []).map(item=>[item.id,item]));
  const index = {p, nodes:keyed(p.nodes), walls:keyed(p.walls), floors:keyed(p.floors), rooms:keyed(p.rooms), elements:keyed(p.elements), members:new Map(), rings:new Map(), frames:new Map(), wallElements:groupBy(p.elements || [], 'wallId'), roomZones:groupBy(p.zones || [],'roomId')};
  for(const room of index.rooms.values()) {
    index.rings.set(room.id, room.nodeIds.map(id=>index.nodes.get(id)).filter(Boolean));
    for(const id of room.wallIds) {if (!index.members.has(id)) index.members.set(id,[]); index.members.get(id).push(room);}
  }
  for (const wall of index.walls.values()) {
    const a=index.nodes.get(wall.a), b=index.nodes.get(wall.b);
    if(!a || !b) continue;
    const len=distance(a,b);
    if (len <= EPS) continue;
    const ux=(b.x-a.x)/len, uy=(b.y-a.y)/len;
    const room=index.rooms.get(wall.referenceRoomId)||index.members.get(wall.id)?.[0];
    const thick=Math.max(0,wall.thickness||0), sign=room?inwardSign(index,room,wall):1;
    const centerOffset=wall.reference==='axis'?0:-sign*thick/2;
    index.frames.set(wall.id,{a,b,len,ux,uy,thick,centerOffset,point:(d,normal=0,z=0)=>({x:a.x+ux*d-uy*normal,y:a.y+uy*d+ux*normal,z})});
  }
  return index;
}
export function inwardSign(idx, room, wall) {
  const i=room?.wallIds.indexOf(wall.id) ?? -1;
  if (i < 0) return 1;
  return (areaSigned(idx.rings.get(room.id)) > 0 ? 1 : -1) * (room.nodeIds[i]===wall.a ? 1 : -1);
}
export function resolvePoint(idx, anchor, floorId) {
  if (!anchor) return null;
  try { return surveyAnchor(idx.p,{floorId,...anchor}); }
  catch { return null; }
}
export function cross2(a,b) {return a.x*b.y-a.y*b.x;}
function unique(values) {
  const sorted=values.slice().sort((a,b)=>a-b);
  return sorted.filter((v,i)=>!i||Math.abs(v-sorted[i-1])>EPS);
}
export function cutSegments(a,b,rings) {
  // Finite segment clipped against one footprint minus the union of its holes.
  const dx=b.x-a.x,dy=b.y-a.y;
  const len=Math.hypot(dx,dy);
  if(len<EPS || !rings[0]?.length) return [];
  const ts=[0,1], direction={x:dx,y:dy};
  for(const ring of rings) for(let i=0;i<ring.length;i++) {
    const c=ring[i],e=ring[(i+1)%ring.length], side={x:e.x-c.x,y:e.y-c.y};
    const offset={x:c.x-a.x,y:c.y-a.y}, det=cross2(direction,side);
    if(Math.abs(det)<EPS) {
      if(Math.abs(cross2(offset,direction))<EPS) for(const q of [c,e]) {
        const t=((q.x-a.x)*dx+(q.y-a.y)*dy)/(len*len);
        if(t>0 && t<1) ts.push(t);
      }
    } else {
      const t=cross2(offset,side)/det, u=cross2(offset,direction)/det;
      if(t>0 && t<1 && u>=-EPS && u<=1+EPS) ts.push(t);
    }
  }
  const values=unique(ts), out=[];
  for(let i=1;i<values.length;i++) {
    const mid=(values[i-1]+values[i])/2, p={x:a.x+dx*mid,y:a.y+dy*mid};
    if(pointInRing(p,rings[0])&&!rings.slice(1).some(r=>pointInRing(p,r))) out.push([values[i-1]*len,values[i]*len]);
  }
  return out;
}
function intersectionY(a,b,c,d) {
  const v={x:b.x-a.x,y:b.y-a.y},w={x:d.x-c.x,y:d.y-c.y}, delta={x:c.x-a.x,y:c.y-a.y};
  const det=cross2(v,w);
  if(Math.abs(det)<EPS) return null;
  const t=cross2(delta,w)/det,u=cross2(delta,v)/det;
  return t>EPS&&t<1-EPS&&u>EPS&&u<1-EPS?a.y+v.y*t:null;
}
export function floorCells(outline, holes=[]) {
  // Nonoverlapping trapezoids, even for a concave room or two overlapping voids.
  if(outline.length<3) return [];
  const rings=[outline,...holes.filter(r=>r.length>=3)];
  if(rings.length===1 && convex(outline)) return [outline];
  const edges=rings.flatMap(r=>r.map((a,i)=>[a,r[(i+1)%r.length]]).filter(([a,b])=>Math.abs(a.y-b.y)>EPS));
  const ys=rings.flatMap(r=>r.map(p=>p.y));
  if(rings.length>1) for(let i=0;i<edges.length;i++) for(let j=i+1;j<edges.length;j++) {
    const crossing=intersectionY(...edges[i],...edges[j]); if(crossing!==null) ys.push(crossing);
  }
  const levels=unique(ys), cells=[];
  const xAt=(edge,y)=>edge[0].x+(edge[1].x-edge[0].x)*(y-edge[0].y)/(edge[1].y-edge[0].y);
  for(let i=1;i<levels.length;i++) {
    const low=levels[i-1],high=levels[i],y=(low+high)/2;
    const crossings=edges.filter(([a,b])=>(a.y>y)!==(b.y>y)).sort((a,b)=>xAt(a,y)-xAt(b,y));
    for(let j=1;j<crossings.length;j++) {
      const l=crossings[j-1],r=crossings[j],xl=xAt(l,y),xr=xAt(r,y),m={x:(xl+xr)/2,y};
      if(xr-xl<EPS||!pointInRing(m,outline)||rings.slice(1).some(h=>pointInRing(m,h))) continue;
      const poly=[{x:xAt(l,low),y:low},{x:xAt(r,low),y:low},{x:xAt(r,high),y:high},{x:xAt(l,high),y:high}];
      cells.push(poly.filter((v,k)=>distance(v,poly[(k+3)%4])>EPS));
    }
  }
  return cells;
}
// A shaft can target one platform or span a measured vertical interval.
export function voidsFor(zones,platform=null) {
  const intersects=(hole,z)=>isNumber(z)&&(hole.bottom==null||z>=hole.bottom-EPS)&&(hole.top==null||z<=hole.top+EPS);
  return zones.filter(h=>h.type==='void'&&(h.targetZoneId
    ? platform?.id===h.targetZoneId
    : platform ? intersects(h,platform.bottom)||intersects(h,platform.top) : intersects(h,0)));
}
function convex(poly) {
  let sign=0;
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],c=poly[(i+2)%poly.length];
    const s=Math.sign(cross2({x:b.x-a.x,y:b.y-a.y},{x:c.x-b.x,y:c.y-b.y}));
    if(s && sign && s!==sign)return false;
    if(s)sign=s;
  }
  return true;
}
export function wallBands(f, height, elems) {
  if(!isNumber(height) || height<=0) return [];
  const openings=elems.filter(e=>isOpening(e)&&isNumber(e.width)&&isNumber(e.height)&&e.width>0&&e.height>0&&isNumber(e.sill));
  const ds=unique([0,f.len,...openings.flatMap(e=>[e.offset,e.offset+e.width]).filter(d=>d>0&&d<f.len)]);
  const out=[];
  for(let i=1;i<ds.length;i++) {
    const l=ds[i-1],r=ds[i],mid=(r+l)/2;
    const active=openings.filter(e=>e.offset<mid&&e.offset+e.width>mid).map(e=>[Math.max(0,e.sill),Math.min(height,e.sill+e.height)]).filter(([lo,hi])=>hi>lo).sort((a,b)=>a[0]-b[0]);
    let cursor=0;
    for(const [lo,hi] of active) {if(lo-cursor>EPS)out.push({l,r,low:cursor,high:lo}); cursor=Math.max(cursor,hi);}
    if(height-cursor>EPS)out.push({l,r,low:cursor,high:height});
  }
  return out;
}
export function frameFootprint(f,l=0,r=f.len) {
  return [f.point(l,f.centerOffset-f.thick/2),f.point(r,f.centerOffset-f.thick/2),f.point(r,f.centerOffset+f.thick/2),f.point(l,f.centerOffset+f.thick/2)];
}
export function heightAt(zone, pt, field) {
  if (zone.slopePoints?.length) return zoneSurfaceAt(zone,pt,field);
  const points=zone.points;
  // Observations may supply up to one height per vertex under levels[] or point.top.
  const zs=points.map((v,i)=>v[field]??zone[field+'s']?.[i]??(field==='top'?zone.levels?.[i]:undefined));
  const measured=points.map((v,i)=>({...v,z:zs[i]})).filter(v=>isNumber(v.z));
  const a=measured[0];
  if(a) for(let i=1;i<measured.length;i++) for(let j=i+1;j<measured.length;j++) {
    const b=measured[i],c=measured[j],den=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    if(Math.abs(den)<EPS) continue;
    const s=((pt.x-a.x)*(c.y-a.y)-(pt.y-a.y)*(c.x-a.x))/den;
    const t=((b.x-a.x)*(pt.y-a.y)-(b.y-a.y)*(pt.x-a.x))/den;
    return a.z+s*(b.z-a.z)+t*(c.z-a.z);
  }
  return zone[field];
}
function putPrism(list,group,ring,lo,hi) {
  const lower=ring.map((v,i)=>({x:v.x,y:v.y,z:Array.isArray(lo)?lo[i]:lo}));
  const upper=ring.map((v,i)=>({x:v.x,y:v.y,z:Array.isArray(hi)?hi[i]:hi}));
  if(ring.length<3||!upper.every(v=>isNumber(v.z))||!lower.every(v=>isNumber(v.z))) return;
  const faces=[upper];
  if(upper.some((v,i)=>v.z>lower[i].z+EPS)) {
    faces.push(lower.slice().reverse());
    for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;faces.push([lower[i],lower[j],upper[j],upper[i]]);}
  }
  list.push({...group,faces});
}
export function buildSolids(idx, {floorId, roomId, isolate=false, glazing=true}={}) {
  const solids=[];
  const rooms=[...idx.rooms.values()].filter(room=>(!isolate||((!floorId||room.floorId===floorId)&&(!roomId||room.id===roomId))));
  const allowed=new Set(rooms.map(r=>r.id));
  for(const room of rooms) {
    const floorZ=idx.floors.get(room.floorId)?.elevation??0;
    const zones=idx.roomZones.get(room.id)||[];
    const holes=voidsFor(zones).map(z=>z.points);
    const meta={roomId:room.id,floorId:room.floorId};
    for(const cell of floorCells(idx.rings.get(room.id),holes))putPrism(solids,{...meta,id:room.id,type:'floor',name:room.name},cell,floorZ,floorZ);
    for(const zone of zones) {
      if(zone.type==='void')continue;
      const cutHoles=zone.type==='platform'?voidsFor(zones,zone).map(z=>z.points):[];
      for(const cell of floorCells(zone.points,cutHoles)) {
        const z=(v,field)=>{const value=heightAt(zone,v,field);return isNumber(value)?floorZ+value:null;};
        const bottom=cell.map(v=>z(v,'bottom')), top=cell.map(v=>z(v,'top'));
        if(!bottom.every(isNumber)&&!top.every(isNumber))continue;
        putPrism(solids,{...meta,id:zone.id,zoneId:zone.id,type:zone.type,name:nameOf(zone)},cell,bottom.every(isNumber)?bottom:top,top.every(isNumber)?top:bottom);
      }
    }
  }
  for(const wall of idx.walls.values()) {
    const members=(idx.members.get(wall.id)||[]).filter(r=>allowed.has(r.id));
    const f=idx.frames.get(wall.id); if(!members.length||!f)continue;
    const heights=members.map(r=>r.height).filter(isNumber);
    const z=idx.floors.get(wall.floorId)?.elevation??0,room=members[0];
    const elements=idx.wallElements.get(wall.id)||[];
    const meta={floorId:wall.floorId,roomId:room.id,wallId:wall.id};
    if(heights.length) for(const band of wallBands(f,Math.max(...heights),elements)) {
      const ring=frameFootprint(f,band.l,band.r);
      if(f.thick>EPS)putPrism(solids,{...meta,id:wall.id,type:'wall',name:wall.name||'Duvar'},ring,z+band.low,z+band.high);
      else {
        const faces=[[f.point(band.l,0,z+band.low),f.point(band.r,0,z+band.low),f.point(band.r,0,z+band.high),f.point(band.l,0,z+band.high)]];
        solids.push({...meta,id:wall.id,type:'wall',name:wall.name||'Duvar',faces});
      }
    }
    for(const e of elements) {
      if(!allowed.has(e.roomId)&&!isOpening(e))continue;
      if(!isNumber(e.width)||!isNumber(e.sill)||!isNumber(e.height))continue;
      if(e.type==='opening' || (e.type==='window'&&!glazing))continue;
      const normal=inwardSign(idx,idx.rooms.get(e.roomId)||room,wall)*(e.side==='outside'?-1:1);
      const depth=isOpening(e)?0:Math.max(0,e.depth||0), n=f.centerOffset+(isOpening(e)?0:normal*f.thick/2);
      const l=e.offset, r=e.offset+e.width;
      const eMeta={...meta,roomId:e.roomId||room.id,id:e.id,elementId:e.id,type:e.type,name:nameOf(e)};
      const low=z+e.sill, high=low+e.height;
      if(depth>0)putPrism(solids,eMeta,[f.point(l,n),f.point(r,n),f.point(r,n+normal*depth),f.point(l,n+normal*depth)],low,high);
      else solids.push({...eMeta,faces:[[f.point(l,n,low),f.point(r,n,low),f.point(r,n,high),f.point(l,n,high)]]});
    }
  }
  return solids;
}
