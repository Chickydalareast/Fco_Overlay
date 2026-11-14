import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/state.mjs';
import defaultProgram from '../server/default-program.json' with {type:'json'};

function setup(t, legacy=defaultProgram){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-unified-v03d-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'program.json');
  fs.writeFileSync(file,JSON.stringify(legacy));
  return {file,store:createStore(file)};
}
const id=(n)=>`unified-core-${n}`;

test('v0.3C saved program migrates to hidden BO history without losing any prior layer or camera',async(t)=>{
  const legacy=structuredClone(defaultProgram);
  delete legacy.layers.history;
  legacy.layers.scoreboard.visible=true;
  legacy.layers.intro.visible=true;
  legacy.cameras.slots.A1={participantId:null,visible:true};
  legacy.match.teamA.seriesWins=2;
  const {store}=setup(t,legacy);
  const snapshot=store.get();
  assert.equal(snapshot.layers.history.visible,false);
  assert.equal(snapshot.layers.scoreboard.visible,true);
  assert.equal(snapshot.layers.intro.visible,true);
  assert.equal(snapshot.cameras.slots.A1.visible,true);
  assert.equal(snapshot.match.teamA.seriesWins,2);
  const cleared=await store.command({id:id('clear'),type:'program.clear'});
  assert.equal(cleared.ok,true);
  assert.equal(cleared.program.layers.history.visible,false);
  assert.equal(cleared.program.cameras.slots.A1.visible,false);
});

test('BO history can be toggled together with scoreboard, intro, and cameras; emergency clear affects only visibility',async(t)=>{
  const {store}=setup(t);
  const turnOn=await store.command({id:id('history-on'),type:'layer.setVisible',layer:'history',visible:true});
  assert.equal(turnOn.ok,true);
  const intro=await store.command({id:id('intro-on'),type:'layer.setVisible',layer:'intro',visible:true});
  assert.equal(intro.ok,true);
  assert.equal(intro.program.layers.scoreboard.visible,true);
  assert.equal(intro.program.layers.intro.visible,true);
  assert.equal(intro.program.layers.history.visible,true);
  const cam=await store.command({id:id('cam-on'),type:'camera.setVisible',slot:'A2',visible:true});
  assert.equal(cam.program.cameras.slots.A2.visible,true);
  const clear=await store.command({id:id('clear-all'),type:'program.clear'});
  for(const key of ['scoreboard','intro','history']) assert.equal(clear.program.layers[key].visible,false);
  assert.equal(clear.program.cameras.slots.A2.visible,false);
});

test('program TAKE accepts v0.3C clients without a history layer and preserves manual BO score',async(t)=>{
  const {store}=setup(t);
  const draft=store.get();
  draft.match.teamA.seriesWins=2;
  delete draft.layers.history;
  const taken=await store.command({id:id('take-legacy'),type:'program.take',expectedRevision:draft.revision,match:draft.match,layers:draft.layers,cameras:draft.cameras});
  assert.equal(taken.ok,true);
  assert.equal(taken.program.layers.history.visible,false);
  assert.equal(taken.program.match.teamA.seriesWins,2);
});

test('history live toggle remains revision guarded by server command pipeline',async(t)=>{
  const {store}=setup(t);
  const program=store.get();
  const change=await store.command({id:id('toggle'),type:'layer.setVisible',layer:'history',visible:true});
  assert.equal(change.ok,true);
  const stale=await store.command({id:id('stale'),type:'program.take',expectedRevision:program.revision,match:program.match,layers:program.layers,cameras:program.cameras});
  assert.equal(stale.ok,false);
  assert.match(stale.reason,/STALE_REVISION/);
});
