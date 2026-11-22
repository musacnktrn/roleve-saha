// [codex] ureten: codex
import {limits} from './model.js';

export const palette={ink:'#283e3b',line:'#536764',teal:'#406b5d',faint:'#a3aaa2',paper:'#fbfaf5',floor:'#e6eadf',wall:'#eeeae0',accent:'#ad5639',azure:'#6d9197',glass:'#d8e7e6',dim:'#677e76'};
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const n = x => Number.isFinite(x)?String(Math.round(x*10000)/10000):'0';
const xy = p => n(p.x)+','+n(p.y);
const pointsAttr = points => points.map(xy).join(' ');
const attrs = object => Object.entries(object).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>' '+k+'="'+esc(v)+'"').join('');

export class Drawing {
  constructor(font=100){this.font=font;this.parts=[];this.picks=[];this.extent=null;}
  take(points) {
    const b=limits(points);if(!b)return;
    const e=this.extent;
    if(!e){this.extent={...b};return;}
    const nx=Math.min(e.x,b.x),ny=Math.min(e.y,b.y);
    this.extent={x:nx,y:ny,width:Math.max(e.x+e.width,b.x+b.width)-nx,height:Math.max(e.y+e.height,b.y+b.height)-ny};
  }
  pickAttrs(pick) {
    if(!pick)return {'pointer-events':'none'};
    const id=this.picks.length;this.picks.push(pick);
    return {'data-rs-pick':id,role:'button',tabindex:0,'aria-label':pick.label,style:'cursor:pointer'};
  }
  poly(points, options={}, pick) {
    if(points.length<2)return;
    this.take(points);
    this.parts.push('<polygon'+attrs({points:pointsAttr(points),fill:options.fill??palette.wall,stroke:options.stroke??palette.line,'stroke-width':options.width??1,'stroke-linejoin':'round','stroke-dasharray':options.dash,opacity:options.opacity,'vector-effect':'non-scaling-stroke',...this.pickAttrs(pick)})+'/>');
  }
  rings(rings,options={},pick) {
    for(const ring of rings)this.take(ring);
    const d=rings.map(r=>r.length?'M'+r.map(xy).join('L')+'Z':'').join('');
    this.parts.push('<path'+attrs({d,fill:options.fill??palette.floor,stroke:options.stroke??palette.line,'stroke-width':options.width??1,'fill-rule':'evenodd','vector-effect':'non-scaling-stroke',...this.pickAttrs(pick)})+'/>');
  }
  line(a,b,options={}) {
    this.take([a,b]);
    this.parts.push('<line'+attrs({x1:n(a.x),y1:n(a.y),x2:n(b.x),y2:n(b.y),stroke:options.stroke??palette.line,'stroke-width':options.width??1,'stroke-dasharray':options.dash,'stroke-linecap':options.cap??'butt','vector-effect':'non-scaling-stroke','pointer-events':'none'})+'/>');
  }
  text(x,y,value,options={}) {
    const anchor=options.anchor??'start',size=options.size??this.font;
    const full=String(value??'');const label=full.length>75?full.slice(0,73)+'…':full;
    const len=Math.max(size,Array.from(label).length*size*.57);
    const left=anchor==='middle'?x-len/2:anchor==='end'?x-len:x;
    this.take([{x:left,y:y-size},{x:left+len,y:y+size*.28}]);
    this.parts.push('<text'+attrs({x:n(x),y:n(y),'font-size':n(size),'font-family':'system-ui, sans-serif','font-weight':options.bold?650:500,'text-anchor':anchor,fill:options.color??palette.ink,'pointer-events':'none','letter-spacing':options.spacing,stroke:options.halo?palette.paper:undefined,'stroke-width':options.halo?size*.14:undefined,'stroke-linejoin':options.halo?'round':undefined,'paint-order':options.halo?'stroke':undefined})+'>'+esc(label)+'</text>');
  }
  sectionTarget(l,r,base,head,pick) {
    const mid=(l+r)/2;
    // A narrow or unmeasured wall stays thin in the drawing. Only its hit
    // target grows in CSS pixels so it can be reached with a fingertip.
    this.parts.push('<g'+attrs(this.pickAttrs(pick))+'><rect'+attrs({x:n(l),y:n(-head),width:n(r-l),height:n(head-base),fill:'transparent','pointer-events':'all'})+'/>'+
      '<path'+attrs({d:'M'+n(mid)+' '+n(-base)+'V'+n(-head),stroke:'transparent','stroke-width':44,'vector-effect':'non-scaling-stroke','pointer-events':'stroke'})+'/></g>');
  }
  dot(a,pick) {
    this.take([a]);
    this.parts.push('<circle'+attrs({cx:n(a.x),cy:n(a.y),r:n(this.font*.43),fill:palette.paper,stroke:palette.accent,'stroke-width':1.3,'vector-effect':'non-scaling-stroke',...this.pickAttrs(pick)})+'/>');
  }
  rect(x,y,w,h,opts,pick){this.poly([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],opts,pick);}
  dimension(l,r,y,label) {
    const tick=this.font*.22;
    this.line({x:l,y},{x:r,y},{stroke:palette.dim,width:.85});
    for(const x of [l,r])this.line({x:x-tick,y:y+tick},{x:x+tick,y:y-tick},{stroke:palette.dim});
    this.text((l+r)/2,y-this.font*.30,label,{anchor:'middle',size:this.font*.75,color:palette.dim,halo:true});
  }
  level(x,y,z) {
    this.poly([{x:x-this.font*.5,y:y-this.font*.45},{x:x+this.font*.5,y:y-this.font*.45},{x,y}],{fill:palette.teal,stroke:'none'});
    this.line({x,y},{x:x+this.font*3.4,y},{stroke:palette.teal,width:.8});
    this.text(x+this.font*.45,y-this.font*.29,z,{size:this.font*.75,color:palette.teal,halo:true});
  }
  finish(title) {
    const e=this.extent||{x:0,y:0,width:2000,height:1600};
    const margin=Math.max(this.font*1.5,Math.max(e.width,e.height)*.04,1);
    return {title,font:this.font,picks:this.picks,markup:this.parts.join(''),bounds:{x:e.x-margin,y:e.y-margin,width:Math.max(1,e.width)+2*margin,height:Math.max(1,e.height)+2*margin}};
  }
}
export function outlineStyle(fill) {return {fill,stroke:palette.ink,width:1.4};}
