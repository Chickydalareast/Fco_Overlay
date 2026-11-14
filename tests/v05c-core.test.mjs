import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openTournamentDB} from '../server/tournament-db.mjs';
import {createStore} from '../server/state.mjs';
import {cloneProgram,rebaseDraft,resetNewBoDraft,restoreCurrentBoDraft,SAMPLE_PROGRAM} from '../public/build/contracts.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v05c-'));
  const db=openTournamentDB({dbFile:path.join(dir,'program.sqlite')});
  t.after(()=>{db.close();try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:80});}catch{}});
  return {db,store:createStore(path.join(dir,'program.json'),{database:db})};
}
function nextBo(store,a='C10',b='C16'){
  const m=structuredClone(store.get().match);
  delete m.matchId;
  m.gameNumber=1;
  for(const [side,teamId] of [['teamA',a],['teamB',b]]){
    Object.assign(m[side],{teamId,playerId:`${teamId}-P1`,seriesWins:0,gameGoals:0});
  }
  return m;
}
async function take(store,match,cameras){
  const p=store.get();
  return store.command({id:crypto.randomUUID(),type:'program.take',expectedRevision:p.revision,match,layers:p.layers,cameras:cameras??p.cameras});
}

test('v0.5C: server rejects inherited BO wins without creating or finishing a session',async t=>{
  const {store,db}=fixture(t);
  const p=store.get(),before=db.listMatches().length,m=nextBo(store);m.teamA.seriesWins=2;
  const rejected=await take(store,m);
  assert.equal(rejected.ok,false);
  assert.match(rejected.reason,/NEW_BO_NOT_RESET/);
  assert.equal(store.get().revision,p.revision);
  assert.equal(db.listMatches().length,before);
});

test('v0.5C: server rejects old GAME number and carried single-game goals for a new BO',async t=>{
  const {store,db}=fixture(t);
  const before=db.listMatches().length,m=nextBo(store);m.gameNumber=2;
  const wrongGame=await take(store,m);
  assert.match(wrongGame.reason,/NEW_BO_NOT_RESET/);
  m.gameNumber=1;m.teamB.gameGoals=1;
  const wrongGoals=await take(store,m);
  assert.match(wrongGoals.reason,/NEW_BO_NOT_RESET/);
  assert.equal(db.listMatches().length,before);
});

test('v0.5C: valid clean BO, following BO resets score and preserves archived history',async t=>{
  const {store,db}=fixture(t);
  const first=await take(store,nextBo(store));assert.equal(first.ok,true);
  const prior=first.program.match.matchId;
  db.saveGameResult({matchId:prior,gameNumber:1,leftGoals:2,rightGoals:0,winnerTeamId:'C10'});
  const scored=await store.command({id:crypto.randomUUID(),type:'score.adjust',team:'A',kind:'seriesWins',delta:1});
  assert.equal(scored.program.match.teamA.seriesWins,1);
  const inherited=nextBo(store,'C1','C12');inherited.teamA.seriesWins=1;
  const refused=await take(store,inherited);
  assert.equal(refused.ok,false);
  assert.equal(db.getMatch(prior).status,'in_progress');
  const second=await take(store,nextBo(store,'C1','C12'));
  assert.equal(second.ok,true);
  assert.notEqual(second.program.match.matchId,prior);
  assert.equal(second.program.match.gameNumber,1);
  assert.equal(second.program.match.teamA.seriesWins,0);
  assert.equal(second.program.match.teamB.seriesWins,0);
  assert.equal(db.getMatch(prior).status,'finished');
  assert.equal(db.getGameResults(prior).games.length,1);
  assert.equal(db.getGameResults(second.program.match.matchId).games.length,0);
});

test('v0.5C: same BO TAKE still permits manual scores and a side swap',async t=>{
  const {store}=fixture(t);
  const first=await take(store,nextBo(store));assert.equal(first.ok,true);
  const m=structuredClone(first.program.match),prior=m.matchId;
  m.teamA.seriesWins=1;m.teamA.gameGoals=3;m.gameNumber=2;
  [m.teamA,m.teamB]=[m.teamB,m.teamA];
  const second=await take(store,m);assert.equal(second.ok,true);
  assert.equal(second.program.match.matchId,prior);
  assert.equal(second.program.match.teamB.seriesWins,1);
  assert.equal(second.program.match.teamB.gameGoals,3);
  assert.equal(second.program.match.gameNumber,2);
});

test('v0.5C: pending NEW BO Preview keeps score/goals/game/cameras during LIVE score change',()=>{
  const base=cloneProgram({revision:7,updatedAt:'2026-11-15T00:00:00Z',...structuredClone({
    match:{competition:'CUP',stage:'FINAL',matchNumber:1,gameNumber:3,bestOf:5,matchId:'match-custom-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      teamA:{teamId:'C10',playerId:'C10-P1',name:'A',shortName:'A',player:'X',seriesWins:1,gameGoals:2,color:'#ffffff',portrait:''},
      teamB:{teamId:'C16',playerId:'C16-P1',name:'B',shortName:'B',player:'Y',seriesWins:0,gameGoals:1,color:'#ffffff',portrait:''}},
    layers:{scoreboard:{visible:true},intro:{visible:false},history:{visible:false},focus:{visible:false,team:'A'}},
    cameras:{layout:'bottom4',slots:{A1:{playerId:'C10-P1',visible:true},A2:{playerId:'C10-P2',visible:false},B1:{playerId:'C16-P1',visible:false},B2:{playerId:'C16-P2',visible:false}}}
  })});
  const draft=cloneProgram(base);
  delete draft.match.matchId;
  draft.match.teamA.teamId='C1';draft.match.teamA.playerId='C1-P1';
  draft.match.teamB.teamId='C12';draft.match.teamB.playerId='C12-P1';
  draft.match.gameNumber=1;
  for(const side of ['teamA','teamB']){draft.match[side].seriesWins=0;draft.match[side].gameGoals=0;}
  for(const [slot,team] of [['A1','C1'],['A2','C1'],['B1','C12'],['B2','C12']])draft.cameras.slots[slot]={playerId:`${team}-P${slot[1]}`,visible:false};
  const live=cloneProgram(base);live.revision=8;live.match.teamA.seriesWins=2;live.match.teamA.gameGoals=4;live.match.gameNumber=4;live.cameras.slots.A2.visible=true;live.layers.intro.visible=true;
  const {program,conflicts}=rebaseDraft(base,draft,live);
  assert.equal(program.revision,8);
  assert.equal(program.match.matchId,undefined);
  assert.equal(program.match.gameNumber,1);
  assert.equal(program.match.teamA.teamId,'C1');
  assert.equal(program.match.teamA.seriesWins,0);
  assert.equal(program.match.teamA.gameGoals,0);
  assert.equal(program.cameras.slots.A2.visible,false);
  assert.equal(program.layers.intro.visible,true,'unmodified graphic layer still follows live');
  assert.deepEqual(conflicts,[]);
});

test('v0.5C: deliberately preparing a NEW BO with the SAME teams also isolates score',()=>{
  const base=cloneProgram({revision:0,updatedAt:'',match:nextBo({get:()=>({match:{
    competition:'CUP',stage:'FINAL',matchNumber:1,gameNumber:1,bestOf:3,
    teamA:{teamId:'C10',playerId:'C10-P1',name:'A',shortName:'A',player:'X',seriesWins:0,gameGoals:0,color:'#ffffff',portrait:''},
    teamB:{teamId:'C16',playerId:'C16-P1',name:'B',shortName:'B',player:'Y',seriesWins:0,gameGoals:0,color:'#ffffff',portrait:''}
  }})}),layers:{scoreboard:{visible:true},intro:{visible:false},history:{visible:false},focus:{visible:false,team:'A'}},
  cameras:{layout:'bottom4',slots:{A1:{playerId:null,visible:false},A2:{playerId:null,visible:false},B1:{playerId:null,visible:false},B2:{playerId:null,visible:false}}}});
  base.match.matchId='match-custom-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  base.match.teamA.seriesWins=1;
  const draft=cloneProgram(base);delete draft.match.matchId;draft.match.teamA.seriesWins=0;
  const live=cloneProgram(base);live.revision=1;live.match.teamA.seriesWins=2;
  const result=rebaseDraft(base,draft,live);
  assert.equal(result.program.match.matchId,undefined);
  assert.equal(result.program.match.teamA.seriesWins,0);
});

test('v0.5C: normal SAME-BO Preview still follows LIVE score when conflict',()=>{
  const base=cloneProgram({revision:0,updatedAt:'',match:nextBo({get:()=>({match:{
    competition:'CUP',stage:'FINAL',matchNumber:1,gameNumber:1,bestOf:3,
    teamA:{name:'A',shortName:'A',player:'X',seriesWins:0,gameGoals:0,color:'#ffffff',portrait:''},
    teamB:{name:'B',shortName:'B',player:'Y',seriesWins:0,gameGoals:0,color:'#ffffff',portrait:''}
  }})}),layers:{scoreboard:{visible:true},intro:{visible:false},history:{visible:false},focus:{visible:false,team:'A'}},
  cameras:{layout:'bottom4',slots:{A1:{playerId:null,visible:false},A2:{playerId:null,visible:false},B1:{playerId:null,visible:false},B2:{playerId:null,visible:false}}}});
  base.match.matchId='match-custom-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  base.match.teamA.seriesWins=1;
  const draft=cloneProgram(base);draft.match.teamA.seriesWins=0;
  const live=cloneProgram(base);live.revision=1;live.match.teamA.seriesWins=2;
  const result=rebaseDraft(base,draft,live);
  assert.equal(result.program.match.teamA.seriesWins,2);
  assert.ok(result.conflicts.includes('match.teamA.seriesWins'));
});

test('v0.5C: both TAKE buttons share pending ID and wait for Program snapshot',()=>{
  const src=fs.readFileSync(path.join(ROOT,'client/studio.ts'),'utf8');
  assert.match(src,/const takeLocked=!connected \|\| stale \|\| !changed \|\| !!pendingTakeId/);
  assert.match(src,/if\(pendingTakeId \|\| !connected \|\| !live \|\| !draftDirty\(\)\)return/);
  assert.match(src,/if\(event.id!==pendingTakeId\)settleCommand\(event.id\)/);
  assert.match(src,/if\(wasOwnTake\) \{newBoPrepared=false;settleCommand\(event.commandId\);\}/);
  assert.ok(src.includes("if (!connection.send(outgoing)) {showError('Could not send command');return;}"));
});


test('v0.5C: Studio fresh-BO helper resets both scores, GAME and every camera',()=>{
  const live=cloneProgram(SAMPLE_PROGRAM);
  live.match.matchId='match-custom-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  live.match.teamA.teamId='C10';live.match.teamB.teamId='C16';
  live.match.teamA.gameGoals=7;live.match.teamB.seriesWins=1;
  live.cameras.slots.A1.visible=true;
  live.cameras.slots.B2.visible=true;
  const staged=resetNewBoDraft(live);
  assert.equal(staged.match.matchId,undefined);
  assert.equal(staged.match.gameNumber,1);
  for(const side of ['teamA','teamB']){
    assert.equal(staged.match[side].seriesWins,0);
    assert.equal(staged.match[side].gameGoals,0);
  }
  for(const slot of ['A1','A2','B1','B2']){
    assert.equal(staged.cameras.slots[slot].visible,false);
    assert.equal(staged.cameras.slots[slot].playerId,`${slot[0]==='A'?'C10':'C16'}-P${slot[1]}`);
  }
  assert.equal(live.match.teamA.seriesWins,1,'input is never mutated');
  assert.equal(live.cameras.slots.A1.visible,true,'Program camera is untouched');
});

test('v0.5C: returning to LIVE pair restores wins, goals, game number and camera slots after detour',()=>{
  const live=cloneProgram(SAMPLE_PROGRAM);
  live.match.matchId='match-custom-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  live.match.teamA.teamId='C10';live.match.teamB.teamId='C16';
  live.match.teamA.seriesWins=2;live.match.teamA.gameGoals=4;
  live.match.teamB.seriesWins=1;live.match.teamB.gameGoals=2;
  live.match.gameNumber=4;
  live.cameras.slots.A1={playerId:'C10-P1',visible:true};
  live.cameras.slots.B2={playerId:'C16-P2',visible:true};
  const detour=resetNewBoDraft(live);
  detour.match.matchId=live.match.matchId; // back to the existing pair
  const restored=restoreCurrentBoDraft(detour,live);
  assert.equal(restored.match.gameNumber,4);
  assert.equal(restored.match.teamA.seriesWins,2);
  assert.equal(restored.match.teamB.seriesWins,1);
  assert.equal(restored.match.teamA.gameGoals,4);
  assert.equal(restored.match.teamB.gameGoals,2);
  assert.deepEqual(restored.cameras,live.cameras);
  const swapped=cloneProgram(detour);
  [swapped.match.teamA,swapped.match.teamB]=[swapped.match.teamB,swapped.match.teamA];
  const reversed=restoreCurrentBoDraft(swapped,live);
  assert.equal(reversed.match.teamA.seriesWins,1);
  assert.equal(reversed.match.teamB.seriesWins,2);
  assert.deepEqual(reversed.cameras.slots.A1,live.cameras.slots.B1);
  assert.deepEqual(reversed.cameras.slots.B2,live.cameras.slots.A2);
  assert.equal(detour.match.teamA.seriesWins,0,'staged input remains unchanged');
});


test('v0.5C: first BO Preview is protected even before VPS has any BO ID',()=>{
  const base=cloneProgram(SAMPLE_PROGRAM); // demo Program with no matchId
  const staged=resetNewBoDraft(base);
  staged.match.teamA.teamId='C10';staged.match.teamA.playerId='C10-P1';
  staged.match.teamB.teamId='C16';staged.match.teamB.playerId='C16-P1';
  const live=cloneProgram(base);live.revision=10;live.match.teamA.seriesWins=2;
  const result=rebaseDraft(base,staged,live);
  assert.equal(result.program.match.teamA.seriesWins,0);
  assert.equal(result.program.match.gameNumber,1);
  assert.equal(result.program.match.teamA.teamId,'C10');
});
