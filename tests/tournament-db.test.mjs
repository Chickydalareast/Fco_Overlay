import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openTournamentDB} from '../server/tournament-db.mjs';
import {createStore} from '../server/state.mjs';
import defaultProgram from '../server/default-program.json' with {type:'json'};

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v03a-'));
  const dbFile=path.join(dir,'fc-online.sqlite');
  const jsonFile=path.join(dir,'program.json');
  const registry=openTournamentDB({dbFile});
  t.after(()=>{registry.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {registry,jsonFile,dbFile,dir};
}

test('SQLite schema and seed have 16 clubs / 16 teams / 32 players / 8 fixtures',t=>{
  const {registry}=fixture(t);
  const data=registry.registry();
  assert.deepEqual(registry.counts(),{teams:16,players:32,clubs:16,fixtures:8});
  assert.equal(data.schemaVersion,1);
  assert.deepEqual(new Set(data.teams.map(x=>x.group)),new Set(['A','B','C','D']));
  for (const team of data.teams) {
    assert.equal(team.players.length,2);
    assert.ok(team.club.logo.startsWith('/assets/clubs/'));
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(team.club.colors.primary));
  }
});

test('C10 Barcelona roster and C16 Arsenal pairing match supplied tournament reference',t=>{
  const {registry}=fixture(t);
  const d=registry.registry();
  const c10=d.teams.find(x=>x.id==='C10');
  assert.equal(c10.club.name,'FC Barcelona');
  assert.deepEqual(c10.players.map(x=>x.displayName),['TANK','Tân Mai Thanh']);
  assert.deepEqual(d.teams.find(x=>x.id==='C16').players.map(x=>x.displayName),['Quách Minh Vũ','Hoàng Trần Gia Bình']);
  assert.ok(d.fixtures.some(x=>x.id==='GROUP-A-1' && x.leftTeamId==='C10' && x.rightTeamId==='C16'));
});

test('program JSON v0.2 migrates once to SQLite, keeping scores and camera assignments',async t=>{
  const {registry,jsonFile,dbFile}=fixture(t);
  const old=structuredClone(defaultProgram);
  old.revision=11;
  old.match.teamA.seriesWins=2;
  old.match.teamB.seriesWins=1;
  old.cameras.slots.A1.participantId='player-abcdef123456';
  old.cameras.slots.A1.visible=true;
  fs.writeFileSync(jsonFile,JSON.stringify(old,null,2));
  const store=createStore(jsonFile,{database:registry});
  assert.equal(store.get().revision,11);
  assert.equal(store.get().match.teamA.seriesWins,2);
  assert.equal(store.get().cameras.slots.A1.visible,true);
  await store.command({type:'score.adjust',id:'step-add-0001',team:'B',kind:'seriesWins',delta:1});
  assert.equal(registry.loadProgram().match.teamB.seriesWins,2);
  assert.equal(JSON.parse(fs.readFileSync(jsonFile,'utf8')).match.teamB.seriesWins,1,'legacy JSON must stay unchanged as backup');
  assert.ok(fs.existsSync(dbFile));
});

test('SQLite authoritative state survives server restart and manual series score remains independent',async t=>{
  const {registry,jsonFile}=fixture(t);
  const initial=createStore(jsonFile,{database:registry});
  await initial.command({type:'score.adjust',id:'step-add-0002',team:'A',kind:'seriesWins',delta:1});
  const reopened=createStore(jsonFile,{database:registry});
  assert.equal(reopened.get().match.teamA.seriesWins,2);
  assert.equal(reopened.get().match.teamA.gameGoals,0);
  assert.equal(reopened.get().revision,1);
});

test('registry returned as a defensive clone; editing response does not mutate DB registry',t=>{
  const {registry}=fixture(t);
  const read=registry.registry();
  read.teams[0].players[0].displayName='CHANGED';
  assert.notEqual(registry.registry().teams[0].players[0].displayName,'CHANGED');
});

test('malformed legacy JSON aborts migration instead of overwriting with defaults',t=>{
  const {registry,jsonFile}=fixture(t);
  fs.writeFileSync(jsonFile,'{"incomplete":true}');
  assert.throws(()=>createStore(jsonFile,{database:registry}),/invalid structure/);
  assert.equal(registry.loadProgram(),null);
});

test('server rejects mismatched player IDs and duplicate team IDs in program TAKE',async t=>{
  const {registry,jsonFile}=fixture(t);
  const store=createStore(jsonFile,{database:registry});
  const initial=store.get();
  const match=structuredClone(initial.match);
  Object.assign(match.teamA,{teamId:'C10',playerId:'C16-P1'});
  Object.assign(match.teamB,{teamId:'C16',playerId:'C16-P2'});
  const bad=await store.command({id:'invalid-pair-001',type:'program.take',expectedRevision:initial.revision,match,layers:initial.layers,cameras:initial.cameras});
  assert.equal(bad.ok,false);
  assert.match(bad.reason,/Invalid/);
  match.teamA.playerId='C10-P1';match.teamB.teamId='C10';match.teamB.playerId='C10-P2';
  const duplicate=await store.command({id:'duplicate-pair-001',type:'program.take',expectedRevision:initial.revision,match,layers:initial.layers,cameras:initial.cameras});
  assert.equal(duplicate.ok,false);
  assert.equal(store.get().revision,initial.revision);
  match.teamB.teamId='C16';match.teamB.playerId='C16-P2';
  // v0.5C: an accepted NEW BO is explicitly reset to GAME 1 / 0-0.
  match.gameNumber=1;match.teamA.seriesWins=0;match.teamB.seriesWins=0;
  match.teamA.gameGoals=0;match.teamB.gameGoals=0;
  const accepted=await store.command({id:'valid-registry-001',type:'program.take',expectedRevision:initial.revision,match,layers:initial.layers,cameras:initial.cameras});
  assert.equal(accepted.ok,true);
  assert.equal(accepted.program.match.teamA.teamId,'C10');
});
