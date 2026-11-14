import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createStore} from '../server/state.mjs';
import {cameraRects,focusLayout,focusMaskGradient,CAMERA_FOCUS,CAMERA_TILE_SIZE,CAMERA_TAG} from '../public/build/stage.js';
import {MASCOT,pickMascot,BH_TICKER} from '../public/build/history.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
function fileStore(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v04h-'));
  t.after(()=>{try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{}});
  return {dir,store:createStore(path.join(dir,'state.json'))};
}
const cmd=(store,body)=>store.command({id:crypto.randomUUID(),...body});

test('v0.4H state: focus layer defaults, LIVE on/off, team pick, emergency clear',async t=>{
  const {store}=fileStore(t);
  assert.deepEqual(store.get().layers.focus,{visible:false,team:'A'},'old state upgraded: off, left team');
  assert.ok((await cmd(store,{type:'camera.setAllVisible',visible:true})).ok);
  assert.ok((await cmd(store,{type:'layer.setVisible',layer:'focus',visible:true})).ok);
  assert.equal(store.get().layers.focus.visible,true);
  assert.ok((await cmd(store,{type:'focus.setTeam',team:'B'})).ok);
  assert.deepEqual(store.get().layers.focus,{visible:true,team:'B'},'rows swap while on air');
  assert.equal((await cmd(store,{type:'focus.setTeam',team:'C'})).ok,false);
  assert.ok((await cmd(store,{type:'program.clear'})).ok);
  assert.equal(store.get().layers.focus.visible,false);
});

test('v0.4H state: Focus needs a camera on; switching every camera off ends Focus',async t=>{
  const {store}=fileStore(t);
  const r=await cmd(store,{type:'layer.setVisible',layer:'focus',visible:true});
  assert.ok(r.ok); assert.equal(store.get().layers.focus.visible,false,'no camera on: stays off');
  await cmd(store,{type:'camera.setVisible',slot:'A1',visible:true});
  await cmd(store,{type:'layer.setVisible',layer:'focus',visible:true});
  assert.equal(store.get().layers.focus.visible,true,'one camera is enough');
  await cmd(store,{type:'camera.setVisible',slot:'A1',visible:false});
  assert.equal(store.get().layers.focus.visible,false,'last camera off: focus off');
});

test('v0.4H state: TAKE from an older Studio (no focus field) keeps the live focus',async t=>{
  const {store}=fileStore(t);
  await cmd(store,{type:'camera.setAllVisible',visible:true});
  await cmd(store,{type:'focus.setTeam',team:'B'});
  await cmd(store,{type:'layer.setVisible',layer:'focus',visible:true});
  const old=store.get(); const {focus,...layers}=old.layers;
  const res=await cmd(store,{type:'program.take',expectedRevision:old.revision,match:old.match,layers,cameras:old.cameras});
  assert.ok(res.ok,JSON.stringify(res));
  assert.deepEqual(store.get().layers.focus,{visible:true,team:'B'});
});

test('v0.4H layout: a bit bigger than the normal tiles, focused team on top, all clear of ticker and scoreboard',()=>{
  const n=CAMERA_TILE_SIZE, top=CAMERA_FOCUS.top, bottom=CAMERA_FOCUS.bottom;
  for (const row of [top,bottom]) assert.ok(Math.abs(row.width/row.height-16/9)<0.01,'16:9');
  assert.ok(top.width>bottom.width && bottom.width>n.width,'focus > other > normal');
  assert.ok(top.width/n.width<=1.5,'only a little bigger (<= x1.5)');
  for (const team of ['A','B']) {
    const r=cameraRects(team), other=team==='A'?'B':'A';
    for (const s of [`${team}1`,`${team}2`]) { assert.equal(r[s].width,top.width); assert.equal(r[s].y,top.y); }
    for (const s of [`${other}1`,`${other}2`]) { assert.equal(r[s].width,bottom.width); assert.equal(r[s].y,bottom.y); }
    const all=Object.values(r);
    for (const x of all) { assert.ok(x.y+x.height<=BH_TICKER.top-10,'above the hashtag band'); assert.ok(x.y-CAMERA_TAG.height>=1440*0.45,'lower half of the screen'); }
    const left=Math.min(...all.map(x=>x.x)), right=Math.max(...all.map(x=>x.x+x.width));
    assert.equal(left+right,2560,'centred');
    assert.ok(top.y+top.height+CAMERA_TAG.height<=bottom.y,'bottom-row name tags clear of the top row');
  }
  assert.deepEqual(cameraRects('A').A2.x<cameraRects('A').A1.x,true,'A2 A1 | B1 B2 order kept');
  assert.equal(cameraRects('normal').B2.x,2144);
});

test('v0.4H focusLayout: on only with Focus visible and a camera on',()=>{
  const slots=v=>({A1:{playerId:null,visible:v},A2:{playerId:null,visible:false},B1:{playerId:null,visible:false},B2:{playerId:null,visible:false}});
  const p=(visible,team,cams)=>({layers:{focus:{visible,team}},cameras:{layout:'bottom4',slots:slots(cams)}});
  assert.equal(focusLayout(p(true,'B',true)),'B');
  assert.equal(focusLayout(p(true,'A',false)),'normal');
  assert.equal(focusLayout(p(false,'A',true)),'normal');
});

test('v0.4H scene: BO History background masked to the bottom, pauses off air; mascots only in free bottom areas',()=>{
  const stage=read('client/stage.ts'), css=read('public/assets/stage.css');
  assert.match(stage,/class="graphic-layer cf-layer"/); assert.match(stage,/mask-image:\$\{mask\}/);
  assert.match(stage,/backdropMarkup\(\)/,'same background as BO History');
  assert.match(css,/\.cf-layer \{ z-index:7;/,'below cameras (8) and scoreboard (10)');
  assert.match(css,/\.cf-layer\[data-state="hidden"\] \.bh-bg \*/);
  for (let i=0;i<300;i++){
    const s=pickMascot(Math.random,[],'focus');
    assert.ok(s.y>1440*0.75,'mostly visible part of the masked background');
    assert.ok(s.x+s.size/2<740||s.x-s.size/2>1820,'never behind the cameras');
  }
  assert.equal(MASCOT.max,3);
  assert.ok(MASCOT.pause[1]<=1.6,'more often than v0.4G');
});

test('v0.4H r2: mask is a long eased cross-fade (no cut line)',()=>{
  const g=focusMaskGradient(), stops=[...g.matchAll(/rgba\(0,0,0,([\d.]+)\) ([\d.]+)%/g)].map(m=>[+m[1],+m[2]]).slice(1);
  assert.ok(CAMERA_FOCUS.mask.to-CAMERA_FOCUS.mask.from>=40,'ramp spans at least 40% of the height');
  assert.ok(stops.length>=12);
  for (let i=1;i<stops.length;i++) assert.ok(stops[i][0]>=stops[i-1][0],'monotonic');
  const steps=stops.slice(1).map((s,i)=>s[0]-stops[i][0]);
  assert.ok(steps[0]<0.02&&steps[steps.length-1]<0.02,'gentle at both ends');
  assert.ok(Math.max(...steps)<0.2,'no sudden jump');
});
