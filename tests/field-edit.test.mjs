// [codex] ureten: codex
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../geometry/core.js';
import { currentWallReadings, planMarkup, readingMethod } from '../ui/plan.js';
import { photoAimMarkup, bearingOnPlan } from '../ui/photo-placement.js';

test('Saha okuması yazıldığı biçimde kalır ve aynı duvarın krokiden gelen uzunluğuna önceliklidir', () => {
  const p = G.createProject();
  const r = G.addRoom(p,{points:G.templatePoints('rect',4300,3100)});
  const [a,b,c] = r.nodeIds;
  const wall = r.wallIds[0];
  const observation = (raw,kind,method='laser',more={}) => G.addObservation(p,{
    roomId:r.id,a:{nodeId:a},b:{nodeId:b},raw,unit:'cm',kind,method,...more
  });
  const previous = observation('430,10','wall','laser',{wallId:wall});
  const reading = observation('428,50','distance','laser',{a:{nodeId:b},b:{nodeId:a},replaces:previous.id});
  observation('440','plan','estimate');
  observation('430,00','plan','model');
  observation('520','spatial','laser',{a:{nodeId:a,z:0},b:{nodeId:b,z:2500}});
  observation('500','distance','laser',{b:{nodeId:c}});
  observation('330','distance','laser',{b:{x:3000,y:0}});
  assert.equal(currentWallReadings(p).get(wall).id,reading.id);
  const before=structuredClone(p.observations);
  G.moveNode(p,b,{x:4752,y:725});
  assert.deepEqual(p.observations,before);
  assert.equal(currentWallReadings(p).get(wall).raw,'428,50');
  assert.notEqual(G.wallLength(p,wall),4285);
  const svg=planMarkup(p,{floorId:r.floorId,roomId:r.id,tool:'select',anchorFn:G.resolveAnchor}).html;
  assert.match(svg,/428,50 cm/);
  assert.ok(!svg.includes('430,10 cm'));
  assert.ok(!svg.includes('430,00 cm'));
  assert.equal(readingMethod('model').label,'Modelden hesap');
  assert.equal(readingMethod('iphone').label,'Telefon ölçümü');
  assert.ok(svg.lastIndexOf('node-hit') > svg.lastIndexOf('obs-guide'));
  const estimated=observation('445','plan','estimate',{b:{nodeId:a},a:{nodeId:r.nodeIds[3]}});
  assert.equal(currentWallReadings(p).get(r.wallIds[3]).id,estimated.id);
});

test('Kamera yönü ekran ölçeğinde okunur, belirsiz yön ok üretmez', () => {
  const a={x:150,y:-20};
  for (const [point,angle] of [[{x:150,y:-520},0],[{x:650,y:-20},90],[{x:150,y:180},180],[{x:-450,y:-20},270]]) {
    assert.equal(bearingOnPlan(a,point),angle);
    assert.ok(photoAimMarkup(a,point,0.2).includes('data-bearing="'+angle+'"'));
  }
  assert.doesNotMatch(photoAimMarkup(a,a,1),/data-bearing/);
  assert.doesNotMatch(photoAimMarkup(a,{x:a.x+0.5,y:a.y},5),/data-bearing/);
});
