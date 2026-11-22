// [codex] ureten: codex
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOpeningDetail, openingDetailMarkup, openingStrokePoints, openingEraserHits} from '../drawing.js';

const point = (x,y) => ({x,y});
const ink = {id:'bölme',color:'#234567',width:5,opacity:1,brush:'pen',shape:'line',points:[point(.1,.2),point(.7,.85)]};
const base = {id:'p-01',type:'window',width:1000,height:1500};
const element = { ...base, detailStrokes:[ink] };
const view = {left:300,right:1300,bottom:2400,top:900};
const markup = (e=element, f=view) => openingDetailMarkup(e,f);

test('eski açıklık, boş liste ve eksik yükseklik', () => {
  assert.equal(validateOpeningDetail(base),base);
  assert.equal(markup(base),'');
  assert.equal(markup({...element,detailStrokes:[]}),'');
  assert.equal(markup({...element,height:null}),'');
  assert.equal(markup(element,{...view,left:view.right}),'');
});
test('şema kaynaklı sayıları, birim aralığını, kimlikleri ve çizim türünü doğrular', () => {
  for (const bad of [
    {id:''},{color:'#fff'},{color:'url(#x)'},{opacity:0},{opacity:2},{width:NaN},{width:0},
    {brush:'xx'},{shape:'circle'},{points:[point(.2,.5)]},{points:[point(-.1,.3),point(0,1)]},
    {points:[point(0,0),point(.2,.3),point(1,1)]},{points:[point(0,0),point(NaN,1)]},
  ]) assert.throws(() => validateOpeningDetail({...base, detailStrokes:[{...ink,...bad}]}));
  assert.throws(() => validateOpeningDetail({...base,detailStrokes:null}));
  assert.throws(() => validateOpeningDetail({...base, detailStrokes:[ink,ink]}));
  assert.throws(() => validateOpeningDetail({...element,type:'socket'}));
  assert.equal(validateOpeningDetail(element),element);
});
test('A→B ve alt→üst iki görünüşte, yeniden boyutta ve fiziksel mm kalınlığında', () => {
  assert.match(markup(),/points="400,2100 1000,1125"/);
  assert.match(markup(),/stroke-width="5"/);
  assert.match(markup(element,{...view,left:1300,right:300}),/points="1200,2100 600,1125"/);
  assert.match(markup({...element,width:2000,height:3000},{left:0,right:2000,bottom:3000,top:0}),/points="200,2400 1400,450"/);
  assert.match(markup(element,{left:0,right:100,bottom:150,top:0}),/stroke-width="0.5"/);
  assert.match(markup(),/overflow="hidden"/);
  assert.match(markup({...element,detailStrokes:[{...ink,id:'a"&b'}]}),/data-opening-stroke="a&quot;&amp;b"/);
});
test('düz, serbest, dörtgen, kemer ve oval aynı izden çizilir ve silinir', () => {
  const a=point(.1,.2), b=point(.7,.8);
  const path = (shape,points=[a,b]) => openingStrokePoints({...ink,shape,points});
  assert.deepEqual(path('free',[a,b,point(.9,.2)]),[a,b,point(.9,.2)]);
  assert.deepEqual(path('rect'),[a,point(.7,.2),b,point(.1,.8),a]);
  const arc=path('arc');
  assert.deepEqual(arc[0],a); assert.deepEqual(arc[16],point(.4,.8)); assert.deepEqual(arc.at(-1),point(.7,.2));
  const oval=path('oval');
  assert.deepEqual(oval[0],oval.at(-1)); assert.deepEqual(oval[16],point(.4,.8)); assert.deepEqual(oval[48],point(.4,.2));
  assert.deepEqual(path('arc',[b,a]),arc);
});
test('süpürme temasını, kalınlığı, elipsin içindeki boşluğu ve kesişmeyi ayırır', () => {
  const data = {...base,width:1000,height:2000,detailStrokes:[
    {...ink,id:'a',points:[point(.1,.2),point(.9,.2)]},
    {...ink,id:'b',width:10,shape:'oval',points:[point(.1,.35),point(.9,.95)]},
  ]};
  const hits = (path,r=1) => [...openingEraserHits(data,path,r)];
  assert.deepEqual(hits([point(.5,.1),point(.5,.3)]),['a']);
  assert.deepEqual(hits([point(.3,.203)],4),['a']);
  assert.deepEqual(hits([point(.5,.65)]),[]);
  assert.deepEqual(hits([point(.1,.65)]),['b']);
  assert.deepEqual(hits([point(.5,.05),point(.5,1)]),['a','b']);
});
