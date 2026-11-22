// [codex] ureten: codex
import {downloadFile,fmt,readMm,safePhoto,uid} from '../ui/base.js';
import {closeDialog,form,imageData,notify} from '../ui/dialog.js';
import {projectChecks} from '../geometry/core.js';
import {exportCSV,exportDXF,exportIFC,exportOBJ,exportSVG,printSheet} from './export.js';

const modeNames={plan:'Kat planı',elevation:'Duvar görünüşü',section:'Kesit',facade:'Cephe',ceiling:'Tavan planı',model:'3B model'};
const formats={
  pdf:['Ölçekli pafta · PDF / yazdır', 'pdf', 'application/pdf'],
  project:['Tam proje · ölçüler, notlar ve fotoğraflar', 'roleve.json','application/json'],
  svg:['Vektör çizim · SVG','svg','image/svg+xml'],
  csv:['Ölçü defteri · CSV','csv','text/csv;charset=utf-8'],
  dxf:['Katmanlı CAD çizimi · DXF','dxf','application/dxf'],
  obj:['Üç boyutlu yüzeyler · OBJ','obj','text/plain;charset=utf-8'],
  ifc:['Katları ve ölçü kaynaklarıyla BIM · IFC4','ifc','application/x-step'],
  report:['Eksik ve tekrar ölçülecekler · metin','txt','text/plain;charset=utf-8']
};
const fname=s=>String(s||'Rölöve').replace(/[\u0000-\u001f:/\\?*"<>|]/g,' ').trim().slice(0,90)||'Rölöve';
const noteStatusLabel=new Map([
  ['open','Açık'],['remeasure','Tekrar ölç'],['repeat','Tekrar ölç'],
  ['unavailable','Erişilemedi'],['inaccessible','Erişilemedi'],['missing','Eksik'],
]);
function issueReport(p){
  const groups=new Map(p.floors.map(f=>[f.id,{name:f.name,lines:[]}]));
  const rooms=new Map(p.rooms.map(r=>[r.id,r]));
  function add(floorId,text){
    const key=groups.has(floorId)?floorId:null;
    if(!groups.has(key))groups.set(key,{name:'Kat belirtilmedi',lines:[]});
    groups.get(key).lines.push('• '+text);
  }
  for(const issue of projectChecks(p)){
    if(issue.kind==='note')continue;
    const room=rooms.get(issue.roomId);
    const floorId=room?.floorId||issue.floorId||p.observations.find(o=>o.id===issue.observationId)?.floorId;
    add(floorId,(room?room.name+' · ':'')+issue.message);
  }
  for(const note of p.notes||[]){
    if(note.status==='done')continue;
    const room=rooms.get(note.roomId);
    const status=noteStatusLabel.get(note.status)||note.status||'Açık';
    add(room?.floorId||note.floorId,[room?.name||'Genel not',status,note.text||note.photo?.name||'Saha notu'].join(' · '));
  }
  const lines=[p.name,'Saha dönüş listesi',new Date().toLocaleDateString('tr-TR'),''];
  for(const group of groups.values())if(group.lines.length)lines.push(group.name,...group.lines,'');
  if(lines.length===4)lines.push('Açık kontrol kaydı yok.');
  return lines.join('\n');
}

function settings(s){
  return {mode:s.mode,floorId:s.floorId,roomId:s.roomId,wallId:s.wallId,side:s.side,yaw:s.yaw,pitch:s.pitch,sectionId:s.sectionId,sectionLine:s.sectionLine,sectionY:s.sectionY,isolate:s.isolate};
}
function exportDialog(ctx){
  const {p,s}=ctx;
  const fields=[
    {key:'format',label:'Dosya',choices:Object.entries(formats).map(([id,item])=>[id,item[0]]),value:s.mode==='model'?'obj':'pdf',full:true},
    {key:'view',label:'Görünüm',choices:Object.entries(modeNames),value:s.mode||'plan'},
    {key:'scale',label:'Çizim ölçeği',choices:[20,25,50,75,100,125,200,500].map(n=>[String(n),'1 / '+n]),value:'50'},
    {key:'paper',label:'Kağıt',choices:['A4','A3'],value:'A4'},
    {key:'orientation',label:'Yön',choices:[['landscape','Yatay'],['portrait','Dikey']],value:'landscape'},
    {key:'allFloors',label:'DXF tüm katlar',type:'check',value:true},
    {key:'share',label:'Cihazın paylaşım menüsünü aç',type:'check',value:false}
  ];
  form('Dışa aktar',fields,'Hazırla',async data=>{
    const key=data.format,choice=formats[key];
    const opts={...settings(s),mode:data.view,scale:Number(data.scale),paper:data.paper,orientation:data.orientation};
    if(key==='pdf') {
      printSheet(p,opts);return;
    }
    const unlocated=[];
    const make={
      project:()=>JSON.stringify(p,null,2),csv:()=>exportCSV(p),svg:()=>exportSVG(p,opts),
      dxf:()=>exportDXF(p,{floorId:data.allFloors?undefined:s.floorId,markFloorId:s.floorId,sectionId:s.sectionId,sectionLine:s.sectionLine,onUnlocatedSketch:st=>unlocated.push(st.id)}),obj:()=>exportOBJ(p),ifc:()=>exportIFC(p),report:()=>issueReport(p)
    };
    const blob=new Blob([make[key]()],{type:choice[2]});
    const name=fname(p.name)+(key==='svg'?' — '+modeNames[data.view]:'')+'.'+choice[1];
    const feedback=unlocated.length?unlocated.length+' eskiz veya açıklık detayının konumu belirsiz. DXF için duvar kalınlığını, alt kotu ve yüksekliği kontrol edin.':'';
    if(data.share&&typeof File!=='undefined'&&typeof navigator.share==='function') {
      const file=new File([blob],name,{type:blob.type});
      if(navigator.canShare?.({files:[file]})) {
        try{await navigator.share({files:[file],title:name});if(feedback)(ctx.toast||notify)(feedback);return;}
        catch(e){if(e.name==='AbortError')return false;throw Error('Dosya paylaşılamadı. Paylaşım seçimini kapatıp cihaza kaydedebilirsiniz.');}
      }
    }
    downloadFile(blob,name);(ctx.toast||notify)(feedback||name+' kaydedilmeye hazır.');
  },{intro:'Tam proje dosyası başka bir cihazda yeniden açılır. PDF paftasını gerçek ölçekte yazdırmak için %100 seçin.',after:f=>{
    const update=()=>{
      const k=f.elements.format.value;
      for(const [id,ok] of [['view',['pdf','svg'].includes(k)],['scale',['pdf','svg'].includes(k)],['paper',k==='pdf'],['orientation',k==='pdf'],['allFloors',k==='dxf'],['share',k!=='pdf'&&typeof navigator.share==='function']]) {
        const field=f.elements[id];field.disabled=!ok;field.closest('label').hidden=!ok;
      }
      const model=f.elements.view.querySelector('option[value="model"]');if(model)model.disabled=k==='pdf';
      if(k==='pdf'&&f.elements.view.value==='model')f.elements.view.value='plan';
      f.querySelector('[type=submit]').textContent=k==='pdf'?'Paftayı aç':(f.elements.share.checked&&!f.elements.share.disabled?'Paylaş':'Dosyayı kaydet');
    };
    f.addEventListener('change',update);update();
  }});
}
function wallChoices(p,s,exterior){
  const rooms=p.rooms.filter(r=>r.floorId===s.floorId), links=new Map();
  for(const r of rooms)for(const [i,wallId] of r.wallIds.entries()) {
    if(!links.has(wallId))links.set(wallId,[]);
    links.get(wallId).push([r.id+'|'+wallId,r.name+' · Duvar '+String.fromCharCode(65+i%26)]);
  }
  return [...links.values()].filter(group=>!exterior||group.length===1).flat();
}
function viewSettings(ctx){
  const {p,s}=ctx,fields=[],mode=s.mode||'plan';
  if(mode==='model')fields.push(
    {key:'yaw',label:'Yatay dönüş (°)',number:true,value:s.yaw??35,required:true},
    {key:'pitch',label:'Bakış eğimi (°)',number:true,value:s.pitch??28,required:true},
    {key:'isolate',label:'Seçili mahali göster',type:'check',value:s.isolate});
  if(mode==='elevation'||mode==='facade'){
    const choices=wallChoices(p,s,mode==='facade');
    if(choices.length)fields.push({key:'wall',label:mode==='facade'?'Dış cepheye bakış':'Mahal ve duvar',choices,full:true,value:choices.some(c=>c[0]===s.roomId+'|'+s.wallId)?s.roomId+'|'+s.wallId:choices[0][0]});
    if(mode==='elevation')fields.push({key:'side',label:'Bakış yüzü',choices:[['inside','İç yüz'],['outside','Karşı yüz']],value:s.side||'inside'});
  }
  if(mode==='section')fields.push({key:'isolate',label:'Yalnız seçili kat',type:'check',value:s.isolate});
  if(mode==='ceiling')fields.push({key:'isolate',label:'Yalnız seçili mahal',type:'check',value:s.isolate});
  if(mode==='plan')fields.push({key:'underlay',label:'Referans altlığını göster',type:'check',value:s.showUnderlay!==false});
  const extra=mode==='section'?'<button type="button" class="secondary" id="cut-trace">Planda iki noktayla kesit al</button>':'';
  form(modeNames[mode]+' ayarları',fields,'Uygula',data=>{
    const patch={};
    if(mode==='model'){
      const raw=String(data.yaw).replace(',','.'),pitch=Number(String(data.pitch).replace(',','.'));
      if(!raw.trim()||!Number.isFinite(Number(raw))||!Number.isFinite(pitch)||pitch<3||pitch>88)throw Error('Yatay açı için sayı, bakış eğimi için 3–88° arasında bir değer girin.');
      patch.yaw=(Number(raw)%360+360)%360;patch.pitch=pitch;
    }
    if(fields.some(f=>f.key==='isolate'))patch.isolate=Boolean(data.isolate);
    if(data.wall){const [roomId,wallId]=data.wall.split('|');Object.assign(patch,{roomId,wallId,elementId:null});}
    if(data.side)patch.side=data.side;
    if(mode==='plan')patch.showUnderlay=Boolean(data.underlay);
    ctx.set(patch);
  },{extra,after:f=>{
    const cut=f.querySelector('#cut-trace');
    if(cut)cut.onclick=()=>{closeDialog();ctx.set({mode:'plan',tool:'sectionline',draft:[]});};
  }});
}
function uploadUnderlay(ctx) {
  const floorId=ctx.s.floorId;
  form('Altlık ekle',[
    {key:'file',label:'Plan görüntüsü veya PDF',type:'file',accept:'image/*,application/pdf,.pdf',required:true,full:true},
    {key:'page',label:'PDF sayfası',number:true,value:1},
    {key:'opacity',label:'Görünürlük (%)',number:true,value:45}
  ],'Altlığı ekle',async data=>{
    const file=data.file;
    if(!file?.size)throw Error('Bir görsel veya PDF seçin.');
    const isPDF=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
    const page=Number(data.page||1), opacity=Number(data.opacity);
    if(!Number.isInteger(page)||page<1)throw Error('Pozitif bir sayfa numarası girin.');
    if(!Number.isFinite(opacity)||opacity<5||opacity>100)throw Error('Görünürlüğü 5–100 arasında girin.');
    const image=isPDF?await (await import('../ui/pdf-image.js')).pdfImage(file,page):await imageData(file);
    if(!image||!safePhoto(image.data))throw Error('Plan görüntüsü okunamadı.');
    const id=uid(),height=4000*image.pixelHeight/image.pixelWidth;
    const nodes=ctx.p.nodes.filter(n=>n.floorId===floorId);
    const origin=nodes.length?{x:Math.min(...nodes.map(n=>n.x)),y:Math.min(...nodes.map(n=>n.y))}:{x:0,y:0};
    const layer={id,floorId,name:file.name+(isPDF?' · '+page+'. sayfa':''),...origin,width:4000,height,opacity:opacity/100,rotation:0,
      data:image.data,pixelWidth:image.pixelWidth,pixelHeight:image.pixelHeight,sourcePage:isPDF?page:null};
    await ctx.change('Referans altlığı eklendi',p=>{p.underlays.push(layer);});
    ctx.set({mode:'plan',tool:'calibrate',draft:[],underlayId:id,showUnderlay:true});
  },{intro:'Ölçeği, plandaki iki nokta ve aralarındaki bilinen mesafeyle kuracaksınız.'});
}
function underlays(ctx) {
  const {p,s}=ctx;
  const layers=(p.underlays||[]).filter(u=>u.floorId===s.floorId);
  if(!layers.length){uploadUnderlay(ctx);return;}
  const options=layers.map(u=>[u.id,u.name||'Altlık']);
  const actions=[['calibrate','Bilinen uzunlukla kalibre et'],['edit','Konum ve görünürlük'],['remove','Seçili altlığı kaldır']];
  const extra='<button type="button" id="new-underlay" class="secondary">Yeni altlık ekle</button>';
  form('Referans altlıkları',[{key:'layer',label:'Kat altlığı',choices:options,full:true,value:s.underlayId||layers[0].id},{key:'act',label:'İşlem',choices:actions,full:true}], 'Devam et',async ({layer,act})=>{
    const u=layers.find(u=>u.id===layer);if(!u)throw Error('Altlık bulunamadı.');
    if(act==='calibrate'){ctx.set({mode:'plan',tool:'calibrate',draft:[],underlayId:layer,showUnderlay:true});return;}
    if(act==='edit'){
      form('Altlık konumu',[
        {key:'x',label:'X (m)',value:fmt(u.x),number:true},{key:'y',label:'Y (m)',value:fmt(u.y),number:true},
        {key:'rotation',label:'Dönüş (°)',value:u.rotation||0,number:true},{key:'opacity',label:'Görünürlük (%)',value:Math.round(100*(u.opacity??.45)),number:true}
      ],'Uygula',async data=>{
        const x=readMm(data.x),y=readMm(data.y),rotation=Number(String(data.rotation).replace(',','.')),percent=Number(data.opacity);
        if(!isNumber(rotation)||!isNumber(percent)||percent<5||percent>100)throw Error('Açıyı sayı, görünürlüğü %5–100 aralığında girin.');
        await ctx.change('Altlık konumu güncellendi',p=>{
          const item=p.underlays.find(i=>i.id===layer);if(!item)throw Error('Altlık bulunamadı.');
          if(x!==item.x||y!==item.y||rotation!==item.rotation){delete item.calibration;delete item.calibrationCheck;delete item.verification;}
          Object.assign(item,{x,y,rotation,opacity:percent/100});
        });
      });return false;
    }
    if(act==='remove'){
      form('Altlığı kaldır',[], 'Altlığı kaldır',async()=>{
        await ctx.change('Altlık kaldırıldı',p=>{p.underlays=p.underlays.filter(u=>u.id!==layer);});
        ctx.set({underlayId:null,tool:'select',draft:[]});
      },{intro:u.name+' bu projeden kaldırılacak.'});return false;
    }
  },{extra,after:f=>{f.querySelector('#new-underlay').onclick=()=>uploadUnderlay(ctx);}});
}
const isNumber=Number.isFinite;
export async function viewAction(act,id,ctx) {
  if(act==='export'){exportDialog(ctx);return true;}
  if(act==='view-settings'){viewSettings(ctx);return true;}
  if(act==='underlay'){underlays(ctx);return true;}
  return false;
}
