import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CameraReceiver} from '../public/build/camera-receiver.js';
import {SAMPLE_PROGRAM,cloneProgram} from '../public/build/contracts.js';
import {openTournamentDB} from '../server/tournament-db.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function program(){
  const p=cloneProgram(SAMPLE_PROGRAM);
  p.match.matchId='match-v05f';p.match.teamA.teamId='C10';p.match.teamB.teamId='C16';
  for(const slot of ['A1','A2','B1','B2'])p.cameras.slots[slot]={visible:false,playerId:`${slot[0]==='A'?'C10':'C16'}-P${slot[1]}`};
  p.cameras.slots.A1.visible=true;
  return p;
}
async function mockReceiver(t,quality){
  const oldWindow=globalThis.window,oldFetch=globalThis.fetch;
  const calls=[],rooms=[];
  const identity='player-C10-P1';
  const publication={videoTrack:{attach(video){video.srcObject={identity};},detach(video){video.srcObject=null;}},isMuted:false,
    setSubscribed(value){calls.push({type:'subscription',value});},setVideoQuality(value){calls.push({type:'quality',value});}};
  class Room{
    constructor(){this.remoteParticipants=new Map([[identity,{identity,getTrackPublication:()=>publication}]]);this.handlers=new Map();rooms.push(this);}
    on(name,fn){this.handlers.set(name,fn);}
    async connect(){this.connected=true;}
    async disconnect(){this.disconnected=true;}
  }
  globalThis.window={LivekitClient:{Room,RoomEvent:{Disconnected:'disconnect'},Track:{Source:{Camera:'camera'}},VideoQuality:{LOW:0,MEDIUM:1,HIGH:2}},setTimeout,clearTimeout};
  globalThis.fetch=async()=>({ok:true,json:async()=>({url:'wss://unused',token:'t',boId:'match-v05f'})});
  const videos=new Map(['A1','A2','B1','B2'].map(slot=>[slot,{
    play(){return Promise.resolve();},requestVideoFrameCallback(){},srcObject:null,readyState:0
  }]));
  const stage={getCameraVideo:slot=>videos.get(slot),setCameraStreamState(){},setCameraSource(){}};
  const receiver=new CameraReceiver([stage],{videoQuality:quality,idleMs:40});
  const p=program();
  receiver.setComposition(stage,p);await receiver.setSession(p.match.matchId);await delay(5);
  t.after(async()=>{await receiver.disconnect(); if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
    if(oldFetch===undefined)delete globalThis.fetch;else globalThis.fetch=oldFetch;});
  return {receiver,stage,rooms,calls,p};
}
test('v0.5F Studio requests LOW only; OBS can request HIGH on its independent SFU connection',async t=>{
  const low=await mockReceiver(t,'low');
  assert.deepEqual(low.calls.filter(c=>c.type==='quality').map(c=>c.value),[0]);
  assert.ok(low.calls.some(c=>c.type==='subscription'&&c.value));
});
test('v0.5F OBS HIGH request remains intact',async t=>{
  const high=await mockReceiver(t,'high');
  assert.deepEqual(high.calls.filter(c=>c.type==='quality').map(c=>c.value),[2]);
});
test('v0.5F hidden Studio immediately disconnects viewer; foreground resubscribes and can watch again',async t=>{
  const h=await mockReceiver(t,'low');
  assert.equal(h.rooms.length,1);
  h.receiver.setMonitoringEnabled(false);
  await delay(5);
  assert.equal(h.rooms[0].disconnected,true);
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A1']});
  h.receiver.setComposition(h.stage,h.p);
  await delay(5);
  assert.equal(h.rooms.length,1,'hidden receiver must not reconnect due to other state updates');
  h.receiver.setMonitoringEnabled(true);
  await delay(5);
  assert.equal(h.rooms.length,2,'foreground receiver must reconnect to latest BO');
});
test('v0.5F Studio/OBS configs are explicitly different; browser hidden listener only on Studio',()=>{
  assert.match(read('client/studio.ts'),/videoQuality:'low'/);
  assert.match(read('client/studio.ts'),/setMonitoringEnabled\(!document\.hidden\)/);
  assert.match(read('client/output.ts'),/videoQuality:'high'/);
  assert.doesNotMatch(read('client/output.ts'),/setMonitoringEnabled/);
});
test('v0.5F pause all Intro and Focus background loops in Studio; do not remove on-air loops',()=>{
  const intro=read('public/assets/intro.css'),history=read('public/assets/history.css');
  assert.match(intro,/\.stage-monitor \.intro-beam-wave \{ animation:none!important;/);
  assert.match(history,/\.cf-layer\[data-state="hidden"\] \.bh-bg \*/);
  assert.match(history,/\.stage-monitor \.cf-layer \.bh-bg \*/);
  assert.match(history,/@keyframes bh-ticker/);
});
test('v0.5F new Game 3 is rejected when BO3 ended after Game 2; manual scoreboard unchanged',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v05f-history-'));
  const db=openTournamentDB({dbFile:path.join(folder,'t.sqlite')});
  t.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true});});
  const matchId='match-GROUP-A-1';
  const match=db.getMatch(matchId);
  assert.equal(match.bestOf,3);
  db.saveGameResult({matchId,gameNumber:1,leftGoals:2,rightGoals:0});
  db.saveGameResult({matchId,gameNumber:2,leftGoals:1,rightGoals:0});
  assert.throws(()=>db.saveGameResult({matchId,gameNumber:3,leftGoals:0,rightGoals:1}),/BO_FINISHED: Game 2/);
  assert.equal(db.getGameResults(matchId).games.length,2);
  assert.equal(db.getGameAudit(matchId).length,2,'rejected write does not create audit row');
});
test('v0.5F BO3 at 1-1 permits Game 3 and historic Game 1 edits',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v05f-history-'));
  const db=openTournamentDB({dbFile:path.join(folder,'t.sqlite')});
  t.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true});});
  const matchId='match-GROUP-A-1';
  db.saveGameResult({matchId,gameNumber:1,leftGoals:2,rightGoals:0});
  db.saveGameResult({matchId,gameNumber:2,leftGoals:0,rightGoals:1});
  db.saveGameResult({matchId,gameNumber:3,leftGoals:1,rightGoals:0});
  assert.equal(db.getGameResults(matchId).games.length,3);
  const edit=db.saveGameResult({matchId,gameNumber:1,leftGoals:3,rightGoals:0,expectedVersion:1});
  assert.equal(edit.version,2);
});
test('v0.5F performance keeps no schema migrations; package & current UI versions stay consistent',()=>{
  const p=JSON.parse(read('package.json'));
  assert.match(p.version,/^0\.5\.[56]$/);
  const uiLabel=p.version==='0.5.5'?'v0.5F':'v0.5G';
  assert.ok(read('client/studio.ts').includes(`footer-version">${uiLabel}`));
  assert.ok(read('server/index.mjs').includes(`VERSION='${p.version}'`));
});

test('v0.5F BO/daily backup is off the server event loop and WAL-safe',async t=>{
  const {scheduleBackup}=await import('../server/backup-scheduler.mjs');
  const {DatabaseSync}=await import('node:sqlite');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v05f-backup-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const dbFile=path.join(folder,'current.sqlite');
  const db=new DatabaseSync(dbFile);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE stable(id INTEGER PRIMARY KEY,v TEXT);');
  const insert=db.prepare('INSERT INTO stable(v) VALUES(?)');
  db.exec('BEGIN');for(let i=0;i<100;i++)insert.run(`entry-${i}`);db.exec('COMMIT');
  try{
    let ticked=false;
    const first=scheduleBackup(dbFile,'bo-change');
    const timer=setTimeout(()=>{ticked=true;},0);
    const backup=await first;
    clearTimeout(timer);
    assert.equal(ticked,true,'worker startup/backup must let timers run on main event loop');
    const copy=new DatabaseSync(backup,{readOnly:true});
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM stable').get().n,100);
    copy.close();
    const paths=await Promise.all([scheduleBackup(dbFile,'bo-change'),scheduleBackup(dbFile,'daily')]);
    assert.equal(new Set(paths).size,2,'consecutive backup jobs are serialized, with distinct filenames');
    assert.ok(paths.every(p=>fs.existsSync(p)));
  }finally{db.close();}
});
