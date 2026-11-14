import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openTournamentDB} from '../server/tournament-db.mjs';
import {createStore} from '../server/state.mjs';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v03c-bo-'));const db=openTournamentDB({dbFile:path.join(dir,'main.sqlite')});t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});return {db,store:createStore(path.join(dir,'state.json'),{database:db})};}
function matchFor(state){const match=structuredClone(state.match);match.matchId=undefined;match.bestOf=5;match.gameNumber=1;match.teamA.gameGoals=0;match.teamB.gameGoals=0;match.teamA.teamId='C10';match.teamA.playerId='C10-P1';match.teamA.seriesWins=0;match.teamB.teamId='C16';match.teamB.playerId='C16-P1';match.teamB.seriesWins=0;return match;}
async function take(store,match){const old=store.get();const result=await store.command({type:'program.take',id:crypto.randomUUID(),expectedRevision:old.revision,match,layers:old.layers,cameras:old.cameras});assert.ok(result.ok,JSON.stringify(result));return result.program;}
test('TAKE without a fixture creates a single BO session linked to two selected teams',async t=>{
  const {db,store}=fixture(t);const first=await take(store,matchFor(store.get()));
  assert.match(first.match.matchId,/^match-custom-/);
  assert.deepEqual(db.getMatch(first.match.matchId).leftTeamId,'C10');
  const count=db.listMatches().length;
  const changed=structuredClone(first.match);changed.gameNumber=2;
  const second=await take(store,changed);
  assert.equal(second.match.matchId,first.match.matchId);
  assert.equal(db.listMatches().length,count);
});
test('new BO with same two teams archives old game history, keeps manual BO scores independent',async t=>{
  const {db,store}=fixture(t);
  const first=await take(store,matchFor(store.get()));
  const old=first.match.matchId;
  db.saveGameResult({matchId:old,gameNumber:1,leftGoals:1,rightGoals:0,winnerTeamId:'C10'});
  const inc=await store.command({id:'score-inc-03c',type:'score.adjust',team:'A',kind:'seriesWins',delta:1});
  assert.equal(inc.program.match.teamA.seriesWins,1);
  assert.equal(db.getGameResults(old).games.length,1);
  const reset=matchFor(inc.program);
  const second=await take(store,reset);
  assert.notEqual(second.match.matchId,old);
  assert.equal(second.match.teamA.seriesWins,0);
  assert.equal(db.getMatch(old).status,'finished');
  assert.equal(db.getGameResults(old).games.length,1);
  assert.equal(db.getGameResults(second.match.matchId).games.length,0);
});
test('side swaps keep the same BO ID and do not change historical left/right',async t=>{
  const {db,store}=fixture(t);const first=await take(store,matchFor(store.get()));
  const swapped=structuredClone(first.match);
  [swapped.teamA,swapped.teamB]=[swapped.teamB,swapped.teamA];
  const second=await take(store,swapped);
  assert.equal(first.match.matchId,second.match.matchId);
  assert.equal(db.getMatch(first.match.matchId).leftTeamId,'C10');
  assert.equal(db.getMatch(first.match.matchId).rightTeamId,'C16');
});
