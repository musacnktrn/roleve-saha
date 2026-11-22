// [codex] ureten: codex
import {indexProject,buildSolids,frameFootprint,nameOf,isNumber,isOpening} from './model.js';
import {n} from './drawing.js';

// IFC4 tessellated geometry. Application identifiers are retained as tags and Pset values.
const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
function globalId(key) {
  let hi=14695981039346656037n,lo=7809847782465536322n;
  for(const byte of new TextEncoder().encode(key)) {
    hi=BigInt.asUintN(64,(hi^BigInt(byte))*1099511628211n);
    lo=BigInt.asUintN(64,(lo+BigInt(byte)+hi)*14029467366897019727n);
  }
  let value=(hi<<64n)|lo, encoded='';
  for(let i=0;i<22;i++) {encoded=alphabet[Number(value&63n)]+encoded;value>>=6n;}
  return "'"+encoded+"'";
}
function stepString(value) {
  const text=String(value??'');let result="'",escaped='';
  const flush=()=>{if(escaped){result+='\\X2\\'+escaped+'\\X0\\';escaped='';}};
  for(let i=0;i<text.length;i++) {
    const code=text.charCodeAt(i);
    if(code>=32&&code<127&&text[i]!=='\\') {flush();result+=text[i]==="'"?"''":text[i];}
    else escaped+=code.toString(16).toUpperCase().padStart(4,'0');
  }
  flush();return result+"'";
}
const list=items=>'('+items.join(',')+')';
const real=x=>{if(!Number.isFinite(x))return '$';const value=n(x);return value.includes('.')?value:value+'.';};
function openingFaces(f,e) {
  if(!isNumber(e.sill)||!isNumber(e.height)||e.width<=0||e.height<=0)return [];
  const ring=frameFootprint(f,e.offset,e.offset+e.width);
  const bottom=ring.map(p=>({...p,z:e.sill})),top=ring.map(p=>({...p,z:e.sill+e.height}));
  if(!f.thick)return [[f.point(e.offset,0,e.sill),f.point(e.offset+e.width,0,e.sill),f.point(e.offset+e.width,0,e.sill+e.height),f.point(e.offset,0,e.sill+e.height)]];
  return [bottom.slice().reverse(),top,...bottom.map((p,i)=>[p,bottom[(i+1)%4],top[(i+1)%4],top[i]])];
}
export function exportIFC(project) {
  const idx=indexProject(project), lines=[];
  const id=s=>globalId(project.id+'/'+s);
  const add=(type,...args)=>{lines.push('#'+(lines.length+1)+'='+type+'('+args.join(',')+');');return '#'+lines.length;};
  const point=values=>add('IFCCARTESIANPOINT',list(values.map(real)));
  const origin=add('IFCAXIS2PLACEMENT3D',point([0,0,0]),'$','$');
  const context=add('IFCGEOMETRICREPRESENTATIONCONTEXT','$',stepString('Model'),3,'0.00001',origin,'$');
  const unit=add('IFCSIUNIT','*','.LENGTHUNIT.','.MILLI.','.METRE.');
  const units=add('IFCUNITASSIGNMENT',list([unit,add('IFCSIUNIT','*','.AREAUNIT.','$','.SQUARE_METRE.'),add('IFCSIUNIT','*','.VOLUMEUNIT.','$','.CUBIC_METRE.')]));
  const root=add('IFCPROJECT',id('project'),'$',stepString(project.name),'$','$','$','$',list([context]),units);
  const buildingPlacement=add('IFCLOCALPLACEMENT','$',origin);
  const building=add('IFCBUILDING',id('building'),'$',stepString(project.name),'$','$',buildingPlacement,'$','$','.ELEMENT.','$','$','$');
  const aggregate=(key,parent,items)=>items.length&&add('IFCRELAGGREGATES',id('ag/'+key),'$','$','$',parent,list(items));
  aggregate('project',root,[building]);
  function shape(faces,baseZ) {
    if(!faces.length)return '$';
    const coordinates=[],index=new Map(),triangles=[];
    function vertex(q) {
      const xyz=[q.x,-q.y,q.z-baseZ].map(real),key=xyz.join(',');
      if(!index.has(key)){coordinates.push('('+key+')');index.set(key,coordinates.length);}
      return index.get(key);
    }
    for(const f of faces) {
      const ref=f.map(vertex).reverse();
      for(let i=1;i<ref.length-1;i++)if(new Set([ref[0],ref[i],ref[i+1]]).size===3)triangles.push(list([ref[0],ref[i],ref[i+1]]));
    }
    if(!triangles.length)return '$';
    const coords=add('IFCCARTESIANPOINTLIST3D',list(coordinates));
    const mesh=add('IFCTRIANGULATEDFACESET',coords,'$','$',list(triangles),'$');
    const body=add('IFCSHAPEREPRESENTATION',context,stepString('Body'),stepString('Tessellation'),list([mesh]));
    return add('IFCPRODUCTDEFINITIONSHAPE','$','$',list([body]));
  }
  const byId=new Map();
  for(const s of buildSolids(idx)) {
    if(!byId.has(s.id))byId.set(s.id,[]);
    byId.get(s.id).push(...s.faces);
  }
  const stores=[],wallRefs=new Map();
  const obsByTarget=new Map();
  for(const o of project.observations||[]) for(const target of new Set([o.roomId,o.wallId,o.a?.wallId,o.b?.wallId,o.a?.elementId,o.b?.elementId].filter(Boolean))) {
    if(!obsByTarget.has(target))obsByTarget.set(target,[]);obsByTarget.get(target).push(o);
  }
  function surveyProps(key,entity,info={}) {
    const observations=obsByTarget.get(key)||[];
    const vals=Object.entries({KayitKimligi:key,...info}).filter(([,val])=>val!=null).map(([name,val])=>add('IFCPROPERTYSINGLEVALUE',stepString(name),'$','IFCTEXT('+stepString(val)+')','$'));
    for(const [i,o] of observations.entries()) {
      const text=JSON.stringify({id:o.id,raw:o.raw,unit:o.unit,mm:o.value,method:o.method,date:o.date,a:o.a,b:o.b});
      vals.push(add('IFCPROPERTYSINGLEVALUE',stepString('Olcu_'+(i+1)),'$','IFCTEXT('+stepString(text)+')','$'));
    }
    const pset=add('IFCPROPERTYSET',id('pset/'+key),'$',stepString('RoleveSaha_Kayit'),'$',list(vals));
    add('IFCRELDEFINESBYPROPERTIES',id('properties/'+key),'$','$','$',list([entity]),pset);
  }
  for(const floor of project.floors) {
    const z=floor.elevation??0;
    const layerPlacement=add('IFCLOCALPLACEMENT',buildingPlacement,add('IFCAXIS2PLACEMENT3D',point([0,0,z]),'$','$'));
    const store=add('IFCBUILDINGSTOREY',id('level/'+floor.id),'$',stepString(floor.name),'$','$',layerPlacement,'$','$','.ELEMENT.',real(z));
    stores.push(store);
    const contained=[],spaces=[];
    const floorRooms=project.rooms.filter(r=>r.floorId===floor.id);
    for(const room of floorRooms) {
      const rep=shape(byId.get(room.id)||[],z);
      const entity=add('IFCSPACE',id('room/'+room.id),'$',stepString(room.name),stepString('Ölçülen bitmiş döşeme yüzeyi'), '$',layerPlacement,rep,stepString(room.code||room.name),'.ELEMENT.','.INTERNAL.','$');
      spaces.push(entity);
      surveyProps(room.id,entity,{TavanYuksekligi_mm:room.height,Kat:floor.name});
    }
    aggregate('rooms/'+floor.id,store,spaces);
    function product(type,obj,rep,tail) {
      const entity=add(type,id('product/'+obj.id),'$',stepString(nameOf(obj)),'$','$',layerPlacement,rep,stepString(obj.id),...tail);
      contained.push(entity);return entity;
    }
    for(const w of project.walls.filter(w=>w.floorId===floor.id)) {
      const e=product('IFCWALL',{...w,name:w.name||'Duvar'},shape(byId.get(w.id)||[],z),['.NOTDEFINED.']);
      wallRefs.set(w.id,e);surveyProps(w.id,e,{Kalinlik_mm:w.thickness,Referans:w.reference||'face'});
    }
    for(const e of (project.elements||[]).filter(e=>idx.walls.get(e.wallId)?.floorId===floor.id)) {
      const info={Tur:e.type,Duvar:e.wallId,Yuz:e.side,AltKot_mm:e.sill,Konum_mm:e.offset,
        Donanim:e.hardware,KoluEsiktenYukseklik_mm:e.handleHeight,
        AciklikDetay_xAB_yEsik_01:e.detailStrokes?.length?JSON.stringify(e.detailStrokes):undefined};
      let opening;
      if(isOpening(e)) {
        const f=idx.frames.get(e.wallId);
        opening=add('IFCOPENINGELEMENT',id('opening/'+e.id),'$',stepString(nameOf(e)+' açıklığı'),'$','$',layerPlacement,f?shape(openingFaces(f,e),0):'$',stepString(e.id),'.OPENING.');
        add('IFCRELVOIDSELEMENT',id('void/'+e.id),'$','$','$',wallRefs.get(e.wallId),opening);
      }
      if(e.type==='opening') {surveyProps(e.id,opening,info);continue;}
      const cls={door:'IFCDOOR',window:'IFCWINDOW',column:'IFCCOLUMN',beam:'IFCBEAM'}[e.type]||'IFCBUILDINGELEMENTPROXY';
      const args=opening?[real(e.height),real(e.width),e.type==='door'?'.DOOR.':'.WINDOW.','.NOTDEFINED.','$']:['.NOTDEFINED.'];
      const entity=product(cls,e,shape(byId.get(e.id)||[],z),args);
      surveyProps(e.id,entity,info);
      if(opening)add('IFCRELFILLSELEMENT',id('fill/'+e.id),'$','$','$',opening,entity);
    }
    for(const v of (project.zones||[]).filter(v=>idx.rooms.get(v.roomId)?.floorId===floor.id)) {
      // The open volume has already been subtracted from the floor mesh.
      const cls={platform:'IFCSLAB',ceiling:'IFCCOVERING',beam:'IFCBEAM',stair:'IFCSTAIR'}[v.type]||'IFCBUILDINGELEMENTPROXY';
      const kind=v.type==='platform'?'.FLOOR.':v.type==='ceiling'?'.CEILING.':'.NOTDEFINED.';
      const entity=product(cls,v,shape(byId.get(v.id)||[],z),[kind]);
      surveyProps(v.id,entity,{Tur:v.type,AltKot_mm:v.bottom,UstKot_mm:v.top});
    }
    if(contained.length)add('IFCRELCONTAINEDINSPATIALSTRUCTURE',id('contain/'+floor.id),'$','$','$',list(contained),store);
  }
  aggregate('building',building,stores);
  const time=(Number.isFinite(Date.parse(project.updatedAt))?new Date(project.updatedAt):new Date()).toISOString().split('.')[0];
  return "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Architectural field survey, IFC4 tessellated exchange'),'2;1');\nFILE_NAME('roleve.ifc',"+stepString(time)+",(''),(''),'Roleve Saha','Roleve Saha','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n"+lines.join('\n')+'\nENDSEC;\nEND-ISO-10303-21;\n';
}
