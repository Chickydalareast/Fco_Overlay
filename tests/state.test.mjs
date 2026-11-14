import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, validateMatch, validateLayers } from '../server/state.mjs';

function createFixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fc-overlay-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return {file:path.join(dir,'state.json'),store:createStore(path.join(dir,'state.json'))};
}
test('default state starts with two separate layer flags', t=>{
  const {store}=createFixture(t);
  assert.equal(store.get().layers.scoreboard.visible,true);
  assert.equal(store.get().layers.intro.visible,false);
});
test('scoreboard and intro can be live at once or both hidden',async t=>{
  const {store}=createFixture(t);
  const intro=await store.command({type:'layer.setVisible',layer:'intro',visible:true,id:'command-001'});
  assert.equal(intro.ok,true);
  assert.equal(intro.program.layers.scoreboard.visible,true);
  assert.equal(intro.program.layers.intro.visible,true);
  const clear=await store.command({type:'program.clear',id:'command-002'});
  assert.equal(clear.program.layers.scoreboard.visible,false);
  assert.equal(clear.program.layers.intro.visible,false);
});
test('TAKE is revision guarded and persists to disk',async t=>{
  const {store,file}=createFixture(t);
  const before=store.get();
  const edited=structuredClone(before);
  edited.match.teamA.player='TEST PLAYER';
  edited.layers.intro.visible=true;
  const take=await store.command({type:'program.take',id:'command-003',expectedRevision:before.revision,match:edited.match,layers:edited.layers});
  assert.equal(take.ok,true);
  assert.equal(take.program.match.teamA.player,'TEST PLAYER');
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).layers.intro.visible,true);
  assert.equal(createStore(file).get().match.teamA.player,'TEST PLAYER');
  const stale=await store.command({type:'program.take',id:'command-004',expectedRevision:before.revision,match:edited.match,layers:edited.layers});
  assert.equal(stale.ok,false);
  assert.match(stale.reason,/STALE_REVISION/);
});
test('deduplicates command IDs, validates score bounds and URLs',async t=>{
  const {store}=createFixture(t);
  const command={type:'score.adjust',id:'command-005',team:'A',kind:'seriesWins',delta:1};
  assert.equal((await store.command(command)).program.match.teamA.seriesWins,2);
  assert.equal((await store.command(command)).program.match.teamA.seriesWins,2);
  const bad=store.get().match;
  bad.teamA.portrait='javascript:alert(1)';
  assert.equal(validateMatch(bad),false);
  assert.equal(validateLayers({scoreboard:{visible:true},intro:{visible:true}}),true);
  assert.equal(validateLayers({scoreboard:{visible:true}}),false);
});
test('cannot score below zero or exceed wins needed for series',async t=>{
  const {store}=createFixture(t);
  for(let n=0;n<12;n++) await store.command({type:'score.adjust',id:`step-up-${n}`,team:'A',kind:'seriesWins',delta:1});
  assert.equal(store.get().match.teamA.seriesWins,3);
  for(let n=0;n<12;n++) await store.command({type:'score.adjust',id:`step-down-${n}`,team:'A',kind:'seriesWins',delta:-1});
  assert.equal(store.get().match.teamA.seriesWins,0);
});
