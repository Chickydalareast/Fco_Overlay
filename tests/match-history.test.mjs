import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openTournamentDB} from '../server/tournament-db.mjs';
import {createStore} from '../server/state.mjs';

function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v03b-'));
  const dbFile=path.join(dir,'fc.sqlite');
  const db=openTournamentDB({dbFile});
  t.after(()=>{db.close();fs.rmSync(dir,{force:true,recursive:true});});
  return {db,dbFile,stateFile:path.join(dir,'program.json')};
}
test('v0.3B migration creates 8 tournament matches and preserves prior program schema',t=>{
  const {db,dbFile}=setup(t);
  const list=db.listMatches();
  assert.equal(list.length,8);
  assert.deepEqual(db.getMatch('match-GROUP-A-1'),{
    id:'match-GROUP-A-1',leftTeamId:'C10',rightTeamId:'C16',bestOf:3,status:'planned',fixtureId:'GROUP-A-1'
  });
  const sqlite=new DatabaseSync(dbFile);
  const version=sqlite.prepare('SELECT max(version) as version FROM schema_migrations').get().version;
  assert.equal(version,4); // v0.3F admin sessions + camera admissions; v0.4E penalty columns
  sqlite.close();
});
test('historical game save + edit has explicit winner, versions and audit trail',t=>{
  const {db}=setup(t);const matchId='match-GROUP-A-1';
  const first=db.saveGameResult({matchId,gameNumber:1,leftGoals:2,rightGoals:1,winnerTeamId:'C10',expectedVersion:0});
  assert.equal(first.version,1);
  const second=db.saveGameResult({matchId,gameNumber:1,leftGoals:1,rightGoals:2,winnerTeamId:'C16',expectedVersion:1,note:'Revised from recording'});
  assert.equal(second.version,2);
  assert.equal(db.getGameResults(matchId).games[0].winnerTeamId,'C16');
  const audit=db.getGameAudit(matchId);
  assert.equal(audit.length,2);
  assert.equal(audit[0].action,'edit');
  assert.equal(audit[0].previous.leftGoals,2);
  assert.equal(audit[0].next.rightGoals,2);
  assert.equal(audit[1].action,'create');
});
test('reject stale game version, incompatible winner, invalid game number and unknown match',t=>{
  const {db}=setup(t);const props={matchId:'match-GROUP-A-1',gameNumber:1,leftGoals:3,rightGoals:1,winnerTeamId:'C10',expectedVersion:0};
  db.saveGameResult(props);
  assert.throws(()=>db.saveGameResult(props),/STALE_GAME_VERSION/);
  assert.throws(()=>db.saveGameResult({...props,gameNumber:2,winnerTeamId:'C16'}),/Winner conflicts/);
  assert.throws(()=>db.saveGameResult({...props,gameNumber:8}),/Invalid game result/);
  assert.throws(()=>db.saveGameResult({...props,matchId:'match-bad'}),/Unknown match/);
});
test('manual BO score remains independent of Game History and survives SQLite reload',async t=>{
  const {db,stateFile}=setup(t);const store=createStore(stateFile,{database:db});
  const previous=store.get();
  db.saveGameResult({matchId:'match-GROUP-A-1',gameNumber:1,leftGoals:4,rightGoals:2,winnerTeamId:'C10',expectedVersion:0});
  assert.equal(store.get().match.teamA.seriesWins,previous.match.teamA.seriesWins);
  const updated=await store.command({id:'manual-bo-inc-03b',type:'score.adjust',team:'B',kind:'seriesWins',delta:1});
  assert.ok(updated.ok);
  assert.equal(createStore(stateFile,{database:db}).get().match.teamB.seriesWins,1);
  assert.equal(db.getGameResults('match-GROUP-A-1').games.length,1);
});
test('canonical club name and logo enforced on TAKE, and side swap preserves identity/results',async t=>{
  const {db,stateFile}=setup(t);const store=createStore(stateFile,{database:db});const current=store.get();
  const match=structuredClone(current.match);match.matchId='match-GROUP-A-1';match.bestOf=3;
  match.teamA.teamId='C16';match.teamA.playerId='C16-P1';match.teamA.name='Wrong';match.teamA.clubLogo='/assets/clubs/liverpool.png';
  match.teamB.teamId='C10';match.teamB.playerId='C10-P1';match.teamB.name='Wrong2';
  match.teamA.seriesWins=1;match.teamB.seriesWins=0;
  const saved=await store.command({id:'swap-confirm-03b',type:'program.take',expectedRevision:current.revision,match,layers:current.layers,cameras:current.cameras});
  assert.ok(saved.ok,JSON.stringify(saved));
  assert.equal(saved.program.match.teamA.name,'Arsenal FC');
  assert.equal(saved.program.match.teamA.clubLogo,'/assets/clubs/arsenal.png');
  assert.equal(saved.program.match.teamB.name,'FC Barcelona');
  db.saveGameResult({matchId:'match-GROUP-A-1',gameNumber:1,leftGoals:1,rightGoals:0,winnerTeamId:'C10',expectedVersion:0});
  assert.equal(db.getGameResults('match-GROUP-A-1').games[0].winnerTeamId,'C10','game history does not use display side');
});
test('ad-hoc match creates stable ID and keeps team pairing constrained',t=>{
  const {db}=setup(t);
  const custom=db.createMatch({leftTeamId:'C1',rightTeamId:'C9',bestOf:5});
  assert.match(custom.id,/^match-custom-[a-f0-9-]+$/);
  assert.equal(db.getMatch(custom.id).bestOf,5);
  assert.throws(()=>db.createMatch({leftTeamId:'C3',rightTeamId:'C3',bestOf:3}),/Invalid match/);
});
test('existing v0.3A program with C10 but no logo upgrades without changing BO score',async t=>{
  const {db,stateFile}=setup(t);
  const legacy=createStore(stateFile,{database:db}).get();
  legacy.match.teamA.teamId='C10';legacy.match.teamA.playerId='C10-P1';
  legacy.match.teamA.name='FC Barcelona';legacy.match.teamA.shortName='C10';
  legacy.match.teamA.seriesWins=2;delete legacy.match.teamA.clubLogo;
  db.saveProgram(legacy);
  const reloaded=createStore(stateFile,{database:db}).get();
  assert.equal(reloaded.match.teamA.clubLogo,'/assets/clubs/barcelona.png');
  assert.equal(reloaded.match.teamA.seriesWins,2);
  assert.equal(reloaded.revision,legacy.revision);
});
