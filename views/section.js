// [codex] ureten: codex
import {EPS,distance,indexProject,isNumber,isOpening,limits,nameOf} from './model.js';

export function sectionFrame(idx,options={}) {
  const floors=idx.p.floors.filter(f=>!options.isolate||!options.floorId||f.id===options.floorId);
  const floorIds=new Set(floors.map(f=>f.id));
  const rooms=idx.p.rooms.filter(r=>floorIds.has(r.floorId));
  const bounds=limits(rooms.flatMap(room=>idx.rings.get(room.id)));
  if(!bounds)return null;
  const y=isNumber(options.sectionY)?options.sectionY:bounds.y+bounds.height/2;
  const saved=options.sectionId?(idx.p.sections||[]).find(s=>s.id===options.sectionId):null;
  const line=options.sectionLine||saved;
  const a=line?.a||line?.[0]||{x:bounds.x-500,y}, b=line?.b||line?.[1]||{x:bounds.x+bounds.width+500,y};
  const len=distance(a,b);
  if(!isNumber(len)||len<EPS)return {floors,floorIds,rooms,a,b,len:0};
  const ux=(b.x-a.x)/len,uy=(b.y-a.y)/len;
  return {floors,floorIds,rooms,a,b,len,ux,uy,name:saved?.name||line?.name||null,sourceFloorId:saved?.floorId||line?.floorId||null,look:{x:uy,y:-ux},point:s=>({x:a.x+s*ux,y:a.y+s*uy})};
}

/** Clip a finite section trace against a wall strip, from wall.a in survey mm.
 * An unknown/zero thickness is a reference surface, with no invented depth.
 */
export function wallCut(trace,f,start,end) {
  if(end-start<=EPS||!trace?.len)return null;
  const px=trace.a.x-f.a.x,py=trace.a.y-f.a.y;
  const u=px*f.ux+py*f.uy,v=-px*f.uy+py*f.ux;
  const du=trace.ux*f.ux+trace.uy*f.uy,dv=-trace.ux*f.uy+trace.uy*f.ux;
  if(f.thick<=EPS) {
    if(Math.abs(dv)<1e-11)return null;
    const s=(f.centerOffset-v)/dv,along=u+s*du;
    if(s<-EPS||s>trace.len+EPS||along<=start+EPS||along>=end-EPS)return null;
    const station=Math.max(0,Math.min(trace.len,s));
    return {fromMm:station,toMm:station,stationMm:station,wallAtMm:along};
  }
  let from=0,to=trace.len;
  const strips=[[u,du,start,end],[v,dv,f.centerOffset-f.thick/2,f.centerOffset+f.thick/2]];
  for(const [position,rate,low,high] of strips) {
    if(Math.abs(rate)<1e-11) {
      if(position<=low+EPS||position>=high-EPS)return null; // Tangency does not cut the opening.
    } else {
      const a=(low-position)/rate,b=(high-position)/rate;
      from=Math.max(from,Math.min(a,b));to=Math.min(to,Math.max(a,b));
      if(to-from<=EPS)return null;
    }
  }
  const mid=(from+to)/2;
  return {fromMm:from,toMm:to,stationMm:mid,wallAtMm:u+du*mid};
}

export function crossedOpenings(idx,trace) {
  if(!trace?.len)return [];
  const result=[];
  for(const el of idx.elements.values()) {
    if(!isOpening(el))continue;
    const wall=idx.walls.get(el.wallId),f=idx.frames.get(el.wallId);
    if(!wall||!f||!trace.floorIds.has(wall.floorId)||!isNumber(el.width)||el.width<=0)continue;
    const hit=wallCut(trace,f,Math.max(0,el.offset),Math.min(f.len,el.offset+el.width));
    if(!hit)continue;
    const floorZ=idx.floors.get(wall.floorId)?.elevation;
    const sill=isNumber(el.sill)?el.sill:null,height=isNumber(el.height)?el.height:null;
    const sillZ=isNumber(floorZ)&&sill!==null?floorZ+sill:null;
    const roomId=idx.rooms.has(el.roomId)?el.roomId:idx.members.get(wall.id)?.[0]?.id;
    result.push({elementId:el.id,wallId:wall.id,roomId,floorId:wall.floorId,type:el.type,name:nameOf(el),
      ...hit,width:el.width,sill,height,sillZ,headZ:sillZ!==null&&height!==null?sillZ+height:null,
      wallThickness:isNumber(wall.thickness)?wall.thickness:null});
  }
  return result.sort((a,b)=>idx.floors.get(a.floorId).elevation-idx.floors.get(b.floorId).elevation||a.stationMm-b.stationMm||String(a.elementId).localeCompare(String(b.elementId)));
}

export function sectionOpenings(project,options={}) {
  const idx=indexProject(project);
  return crossedOpenings(idx,sectionFrame(idx,options));
}
