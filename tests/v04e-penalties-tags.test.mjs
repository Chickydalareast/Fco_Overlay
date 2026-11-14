import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {openTournamentDB} from '../server/tournament-db.mjs';
import {decidedSuffix,SAMPLE_PROGRAM,cloneProgram} from '../public/build/contracts.js';
import {CameraReceiver} from '../public/build/camera-receiver.js';
import {CAMERA_TILES,CAMERA_TAG} from '../public/build/stage.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const M='match-GROUP-A-1'; // C10 (left) vs C16 (right), BO3
// Windows keeps SQLite files locked until every handle is closed: close first,
// then remove with retries, and never fail a test on temp-folder cleanup.
const removeDir=dir=>{try{fs.rmSync(dir,{force:true,recursive:true,maxRetries:10,retryDelay:100});}catch{}};
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v04e-'));
  const db=openTournamentDB({dbFile:path.join(dir,'fc.sqlite')});
  t.after(()=>{try{db.close();}catch{}removeDir(dir);});
  return {db};
}

test('v0.4E migration v4 upgrades an existing v3 database; old results become "regular"',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v04e-mig-'));
  const dbFile=path.join(dir,'fc.sqlite');
  let db=null,raw=null;
  try{
    openTournamentDB({dbFile}).close();
    // Turn the fresh DB back into a v3 one that already holds a result.
    raw=new DatabaseSync(dbFile);
    raw.exec(`ALTER TABLE game_results DROP COLUMN decided_by; ALTER TABLE game_results DROP COLUMN left_pens; ALTER TABLE game_results DROP COLUMN right_pens;
      DELETE FROM schema_migrations WHERE version=4;`);
    raw.prepare(`INSERT INTO game_results(match_id,game_number,left_goals,right_goals,winner_team_id,note,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(M,1,2,2,'C10','won on penalties (old note)',1,'2026-01-01','2026-01-01');
    raw.close();raw=null;
    db=openTournamentDB({dbFile});
    const game=db.getGameResults(M).games[0];
    assert.deepEqual([game.decidedBy,game.leftPens,game.rightPens,game.winnerTeamId,game.note],['regular',null,null,'C10','won on penalties (old note)']);
    db.close();db=null;
    raw=new DatabaseSync(dbFile);
    assert.equal(raw.prepare('SELECT max(version) v FROM schema_migrations').get().v,4);
  }finally{
    try{raw?.close();}catch{}try{db?.close();}catch{}
    removeDir(dir);
  }
});

test('v0.4E penalties: level score + shoot-out decides the winner; audit keeps the shoot-out',t=>{
  const {db}=setup(t);
  const g=db.saveGameResult({matchId:M,gameNumber:1,leftGoals:2,rightGoals:2,decidedBy:'penalties',leftPens:3,rightPens:4,expectedVersion:0});
  assert.equal(g.winnerTeamId,'C16','winner derived from penalties');
  assert.deepEqual([g.decidedBy,g.leftPens,g.rightPens],['penalties',3,4]);
  const saved=db.getGameResults(M).games[0];
  assert.deepEqual([saved.leftPens,saved.rightPens,saved.decidedBy],[3,4,'penalties']);
  const edit=db.saveGameResult({matchId:M,gameNumber:1,leftGoals:3,rightGoals:2,decidedBy:'extra_time',expectedVersion:1});
  assert.equal(edit.winnerTeamId,'C10');assert.equal(edit.leftPens,null);
  const audit=db.getGameAudit(M);
  assert.deepEqual([audit[0].previous.leftPens,audit[0].previous.rightPens,audit[0].next.decidedBy],[3,4,'extra_time']);
});

test('v0.4E rules: level needs penalties, penalties need level, shoot-out cannot be level, winner must agree',t=>{
  const {db}=setup(t);const base={matchId:M,gameNumber:1,expectedVersion:0};
  assert.throws(()=>db.saveGameResult({...base,leftGoals:1,rightGoals:1}),/Level score: decide the game by penalties/);
  assert.throws(()=>db.saveGameResult({...base,leftGoals:1,rightGoals:1,decidedBy:'extra_time'}),/Level score/);
  assert.throws(()=>db.saveGameResult({...base,leftGoals:2,rightGoals:1,decidedBy:'penalties',leftPens:4,rightPens:3}),/Penalties need a level score/);
  assert.throws(()=>db.saveGameResult({...base,leftGoals:1,rightGoals:1,decidedBy:'penalties',leftPens:4,rightPens:4}),/cannot be level/);
  assert.throws(()=>db.saveGameResult({...base,leftGoals:1,rightGoals:1,decidedBy:'penalties',leftPens:4}),/Enter both penalty scores/);
  assert.throws(()=>db.saveGameResult({...base,leftGoals:2,rightGoals:0,leftPens:1,rightPens:0}),/only allowed when decided by penalties/);
  assert.throws(()=>db.saveGameResult({...base,leftGoals:1,rightGoals:1,decidedBy:'penalties',leftPens:5,rightPens:4,winnerTeamId:'C16'}),/Winner conflicts/);
  assert.throws(()=>db.saveGameResult({...base,leftGoals:2,rightGoals:1,decidedBy:'golden_goal'}),/Invalid game result/);
  assert.throws(()=>db.saveGameResult({...base,leftGoals:1,rightGoals:1,decidedBy:'penalties',leftPens:31,rightPens:4}),/penalty scores/);
  // An older Studio tab (no decidedBy, explicit winner) still saves a normal result.
  assert.equal(db.saveGameResult({...base,leftGoals:0,rightGoals:1,winnerTeamId:'C16'}).decidedBy,'regular');
});

test('v0.4E display suffix for history',()=>{
  assert.equal(decidedSuffix({decidedBy:'penalties',leftPens:4,rightPens:3}),'PEN 4-3');
  assert.equal(decidedSuffix({decidedBy:'penalties',leftPens:4,rightPens:3},true),'PEN 3-4');
  assert.equal(decidedSuffix({decidedBy:'extra_time',leftPens:null,rightPens:null}),'HIỆP PHỤ');
  assert.equal(decidedSuffix({decidedBy:'regular'}),'');
  assert.equal(decidedSuffix({}),'','results saved before v0.4E');
});

test('v0.4E camera name tag follows who is on the tile (teammate on fallback), hidden when nobody',async()=>{
  globalThis.window={LivekitClient:{Track:{Source:{Camera:'camera'}}},setTimeout,clearTimeout};
  const pub=id=>({trackSid:id,isMuted:false,videoTrack:{attach(v){v.srcObject={id};},detach(v){v.srcObject=null;}},setSubscribed(){}});
  const room={disconnect:async()=>{},remoteParticipants:new Map(['player-C10-P1','player-C16-P1','player-C16-P2'].map(id=>[id,{identity:id,getTrackPublication:()=>pub(id)}]))};
  const source={};
  const stage={getCameraVideo:()=>({srcObject:null,play(){return Promise.resolve();}}),setCameraStreamState(){},setCameraSource:(s,id)=>{source[s]=id;}};
  const receiver=new CameraReceiver([stage],{});receiver.boId='bo';receiver.room=room;
  const program=cloneProgram(SAMPLE_PROGRAM);program.match.teamA.teamId='C10';program.match.teamB.teamId='C16';
  program.cameras.slots={A1:{playerId:'C10-P1',visible:true},A2:{playerId:'C10-P2',visible:true},B1:{playerId:'C16-P1',visible:true},B2:{playerId:'C16-P2',visible:false}};
  receiver.setComposition(stage,program);
  assert.deepEqual(source,{A1:'C10-P1',A2:'C10-P1',B1:'C16-P1',B2:null});
  await receiver.disconnect();delete globalThis.window;
});

test('v0.4E camera name tag sits on top of the frame, never over the video',()=>{
  const stage=fs.readFileSync(path.join(ROOT,'client/stage.ts'),'utf8');
  assert.match(stage,/top:\$\{CAMERA_TILES\[slot\]\.y - CAMERA_TAG\.height\}px/);
  assert.ok(CAMERA_TAG.height<=40,'small tag (v0.4G: 40 px at 2K)');
  for (const t of Object.values(CAMERA_TILES)) assert.ok(t.y-CAMERA_TAG.height>0);
  const css=fs.readFileSync(path.join(ROOT,'public/assets/stage.css'),'utf8');
  assert.match(css,/\.camera-tag\[data-show="true"\]/);
  assert.match(css,/\.camera-tag\.camera-side-B \{ background:#fe9500/);
});
