// [codex] ureten: codex
// Synthetic building. A shared partition and a void exercise both orientations.
export function building(){
  const floors=[{id:'ground',name:'Zemin',elevation:200},{id:'upper',name:'Üst kat',elevation:3800}];
  const nodes=[],walls=[],rooms=[],elements=[],zones=[],observations=[];
  const p={schemaVersion:1,id:'survey-test',name:'Çınar & Ölçü',updatedAt:'2026-11-23T00:00:00.000Z',floors,nodes,walls,rooms,elements,zones,observations,notes:[],strokes:[],visits:[],underlays:[],northAngle:0};
  function room(id,floorId,name,left,right,top,bottom,height){
    const points=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>{
      let q=nodes.find(q=>q.x===x&&q.y===y&&q.floorId===floorId);
      if(!q){q={id:'node-'+nodes.length,floorId,x,y};nodes.push(q);}return q;
    });
    const wallIds=points.map((q,i)=>{
      const next=points[(i+1)%points.length];let w=walls.find(w=>(w.a===q.id&&w.b===next.id)||(w.a===next.id&&w.b===q.id));
      if(!w){w={id:'wall-'+walls.length,floorId,a:q.id,b:next.id,thickness:160,referenceRoomId:id};walls.push(w);}return w.id;
    });
    const r={id,name,code:id,nodeIds:points.map(p=>p.id),wallIds,floorId,height};rooms.push(r);return r;
  }
  const studio=room('studio','ground','Atölye',0,4000,0,3000,5400);
  const hall=room('hall','ground','Hol',4000,5600,0,3000,null);
  const loft=room('upper-room','upper','Galeri',0,4000,0,3000,1700);
  elements.push({id:'win-a',wallId:studio.wallIds[0],roomId:'studio',type:'window',name:'Batı <penceresi>',side:'inside',offset:1200,width:1000,height:1200,sill:900});
  elements.push({id:'door-a',wallId:hall.wallIds[3],roomId:'studio',type:'door',name:'Kapı',side:'inside',swing:'left',offset:500,width:900,height:2100,sill:0});
  elements.push({id:'socket-a',wallId:studio.wallIds[0],roomId:'studio',type:'socket',name:'Priz',side:'inside',offset:360,width:80,height:80,sill:410});
  const poly=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  zones.push({id:'plat',roomId:'studio',type:'platform',name:'Asma kat',points:poly(0,0,2000,3000),bottom:2400,top:2600});
  zones.push({id:'void',roomId:loft.id,type:'void',name:'Galeri boşluğu',points:poly(2000,0,2000,3000),bottom:null,top:null});
  observations.push({id:'measure-1',floorId:'ground',roomId:'studio',kind:'diagonal',a:{nodeId:studio.nodeIds[0]},b:{nodeId:studio.nodeIds[2]},raw:'5,00',unit:'m',value:5000,method:'lazer',date:'2026-11-23',note:'Fotoğraf; çizim'});
  return p;
}

export function annotatedBuilding(){
  const p=building();
  p.faceSketches=[
    {id:'sk-west-in',floorId:'ground',roomId:'studio',wallId:'wall-0',side:'inside',color:'#245fa6',width:37,opacity:.78,brush:'pencil',points:[{x:300,y:800},{x:900,y:1400}]},
    {id:'sk-west-out',floorId:'ground',roomId:'studio',wallId:'wall-0',side:'outside',color:'#a62c45',width:64,opacity:.42,brush:'marker',points:[{x:450,y:400},{x:450,y:700}]},
    {id:'sk-upper',floorId:'upper',roomId:'upper-room',wallId:p.rooms[2].wallIds[1],side:'inside',color:'#29704b',width:25,opacity:1,points:[{x:0,y:90},{x:240,y:420}]}
  ];
  p.strokes=[{id:'sk-plan',roomId:'studio',floorId:'ground',color:'#8650a1',width:88,opacity:.42,brush:'marker',shape:'rect',points:[{x:100,y:200},{x:500,y:200},{x:500,y:400},{x:100,y:400},{x:100,y:200}]}];
  p.notes=[{id:'pic-upper',floorId:'upper',roomId:null,surface:'floor',photo:{name:'upper.jpg'}},
    {id:'pic-ground',floorId:'ground',roomId:'studio',surface:'ceiling',photo:{name:'ceiling.jpg'},anchor:{x:400,y:700,wallId:'wall-0'},target:{x:800,y:700,wallId:'wall-0',elementId:'win-a'},direction:90,text:'Kiriş altı'},
    {id:'pic-floor',floorId:'ground',roomId:'studio',surface:'floor',photo:{name:'joint.jpg'},anchor:{x:700,y:900},target:{x:700,y:100},text:'Derz'}];
  return p;
}

export function detailedBuilding(){
  const p=annotatedBuilding(),[window,door]=p.elements;
  window.detailStrokes=[{id:'win-profile',color:'#234567',width:2.5,opacity:.85,brush:'pen',shape:'line',points:[{x:.1,y:.2},{x:.7,y:.85}]}];
  door.detailStrokes=[{id:'door-profile',color:'#8a385f',width:12,opacity:1,brush:'pen',shape:'rect',points:[{x:.2,y:.1},{x:.55,y:.8}]}];
  door.swing='right-out';door.hardware='Pirinç kol';door.handleHeight=980;
  return p;
}
