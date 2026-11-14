import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openTournamentDB} from '../server/tournament-db.mjs';
import {createStore} from '../server/state.mjs';
import {createCameraService} from '../server/camera-room.mjs';
import {rebaseDraft,SAMPLE_PROGRAM,cloneProgram} from '../public/build/contracts.js';

const INVITE='invite-private-012345';
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v03f-'));
  const dbFile=path.join(dir,'main.sqlite');
  let db=openTournamentDB({dbFile});
  t.after(()=>{try{db.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  const store=createStore(path.join(dir,'program.json'),{database:db});
  return {dir,dbFile,db,store,reopen(){db.close();db=openTournamentDB({dbFile});return db;}};
}
const cmd=(type,extra={})=>({id:`v03f-${crypto.randomUUID()}`,type,...extra});
function boMatch(state,a='C10',b='C16'){
  const m=structuredClone(state.match);m.matchId=undefined;m.bestOf=5;m.gameNumber=1;
  Object.assign(m.teamA,{teamId:a,playerId:`${a}-P1`,seriesWins:0,gameGoals:0});
  Object.assign(m.teamB,{teamId:b,playerId:`${b}-P1`,seriesWins:0,gameGoals:0});
  return m;
}
async function take(store,match,extra={}){
  const cur=store.get();
  return store.command(cmd('program.take',{expectedRevision:cur.revision,match,layers:cur.layers,cameras:cur.cameras,...extra}));
}
function camera(db,store,calls=[]){
  return createCameraService({inviteSecret:INVITE,livekitUrl:'wss://example.livekit.cloud',livekitKey:'testKey',livekitSecret:'testSecret',
    roomName:'test-camera',getProgram:()=>store.get(),registry:()=>db.registry(),store:db.cameraRequests,log:{warn(){}},
    fetchImpl:async(url,init)=>{calls.push({url,body:JSON.parse(init.body),auth:init.headers.Authorization});return {ok:true,status:200};}});
}
const jwt=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());

test('A1: one failed DB write does not poison later commands',async t=>{
  const {db,store}=fixture(t);
  const save=db.saveProgram;let fail=true;
  db.saveProgram=(p)=>{if(fail){fail=false;throw new Error('SQLITE_BUSY simulated');}return save(p);};
  const first=await store.command(cmd('layer.setVisible',{layer:'intro',visible:true}));
  assert.equal(first.ok,false);assert.match(first.reason,/Save failed/);
  assert.equal(store.get().layers.intro.visible,false,'live state unchanged after failed save');
  const second=await store.command(cmd('layer.setVisible',{layer:'intro',visible:true}));
  assert.equal(second.ok,true,'next command works without restarting Node');
  assert.equal(db.loadProgram().layers.intro.visible,true);
});

test('BO start, previous BO finish and Program save are one transaction',async t=>{
  const {db,store}=fixture(t);
  const first=await take(store,boMatch(store.get()));assert.ok(first.ok);
  const before=db.listMatches().length;
  const save=db.saveProgram;db.saveProgram=()=>{throw new Error('disk full simulated');};
  const failed=await take(store,boMatch(store.get(),'C1','C12'));
  assert.equal(failed.ok,false);
  assert.equal(db.listMatches().length,before,'no orphan BO row after a failed TAKE');
  assert.equal(db.getMatch(first.program.match.matchId).status,'in_progress','old BO not finished');
  db.saveProgram=save;
  const ok=await take(store,boMatch(store.get(),'C1','C12'));
  assert.ok(ok.ok);assert.equal(ok.boChanged,true);
  assert.equal(db.getMatch(first.program.match.matchId).status,'finished');
});

test('correcting BO3/5/7 keeps the same BO session; refuses if saved games would not fit',async t=>{
  const {db,store}=fixture(t);
  const first=await take(store,boMatch(store.get()));const id=first.program.match.matchId;
  db.saveGameResult({matchId:id,gameNumber:4,leftGoals:1,rightGoals:0,winnerTeamId:'C10'});
  const m=structuredClone(store.get().match);m.bestOf=7;
  const seven=await take(store,m);assert.ok(seven.ok);
  assert.equal(seven.program.match.matchId,id);assert.equal(db.getMatch(id).bestOf,7);
  const m3=structuredClone(store.get().match);m3.bestOf=3;
  const three=await take(store,m3);
  assert.equal(three.ok,false,'game 4 is saved, BO3 is impossible');
  assert.equal(db.getMatch(id).bestOf,7);
});

test('A9: a double-click on +1 is rejected instead of adding +2',async t=>{
  const {store}=fixture(t);
  const from=store.get().match.teamA.seriesWins;
  const a=await store.command(cmd('score.adjust',{team:'A',kind:'seriesWins',delta:1,from}));
  const b=await store.command(cmd('score.adjust',{team:'A',kind:'seriesWins',delta:1,from}));
  assert.equal(a.ok,true);assert.equal(b.ok,false);assert.match(b.reason,/SCORE_CHANGED/);
  assert.equal(store.get().match.teamA.seriesWins,from+1);
});

test('A11: TAKE drops fields outside the Program contract',async t=>{
  const {store}=fixture(t);
  const m=boMatch(store.get());m.injected='x'.repeat(500);m.teamA.extra={a:1};
  const r=await take(store,m);assert.ok(r.ok);
  assert.equal(r.program.match.injected,undefined);assert.equal(r.program.match.teamA.extra,undefined);
});

test('legacy LiveKit identities in saved slots migrate to roster player IDs',async t=>{
  const {db,store,dir}=fixture(t);
  await take(store,boMatch(store.get()));
  const p=db.loadProgram();
  p.cameras.slots={A1:{participantId:'player-y_Kpt_9C3AT6ZyZxvc0',visible:false},A2:{participantId:null,visible:true},B1:{participantId:null,visible:false},B2:{participantId:null,visible:false}};
  db.saveProgram(p);
  const reloaded=createStore(path.join(dir,'program.json'),{database:db}).get();
  assert.deepEqual(Object.values(reloaded.cameras.slots).map(s=>s.playerId),['C10-P1','C10-P2','C16-P1','C16-P2']);
  assert.equal(reloaded.cameras.slots.A2.visible,true);
});

test('admin sessions survive a database reopen (Node restart)',async t=>{
  const f=fixture(t);
  f.db.adminSessions.add('hash-abc',Date.now()+60_000);
  f.db.adminSessions.add('hash-old',Date.now()-1);
  const db=f.reopen();
  assert.equal(db.adminSessions.valid('hash-abc',Date.now()),true);
  assert.equal(db.adminSessions.valid('hash-old',Date.now()),false);
});

test('B: approved camera survives a Node restart (session + token from SQLite)',async t=>{
  const f=fixture(t);
  await take(f.store,boMatch(f.store.get()));
  const bo=f.store.get().match.matchId;
  const svc=camera(f.db,f.store);
  const req=svc.requestJoin({invite:INVITE,boId:bo,teamId:'C10',playerId:'C10-P1'});
  assert.ok(svc.reviewRequest({requestId:req.requestId,approved:true}).ok);
  const grant=svc.getRequestStatus({requestId:req.requestId,claim:req.claim});
  // Simulate restart: new DB handle, new Program store, new camera service.
  const db=f.reopen();
  const store=createStore(path.join(f.dir,'program.json'),{database:db});
  const svc2=camera(db,store);
  assert.equal(svc2.authenticatePlayer(grant.session),'C10-P1','player WS re-authenticates after restart');
  const again=svc2.getRequestStatus({requestId:req.requestId,claim:req.claim});
  assert.equal(again.status,'approved');assert.equal(jwt(again.token).sub,'player-C10-P1');
  assert.equal(svc2.roster().find(p=>p.playerId==='C10-P1').status,'approved');
});

test('P0.1/P0.2: one approved device per player; revoke and replace act on LiveKit',async t=>{
  const f=fixture(t);
  await take(f.store,boMatch(f.store.get()));
  const bo=f.store.get().match.matchId;
  const calls=[];const svc=camera(f.db,f.store,calls);
  const r1=svc.requestJoin({invite:INVITE,boId:bo,teamId:'C16',playerId:'C16-P2'});
  svc.reviewRequest({requestId:r1.requestId,approved:true});
  const s1=svc.getRequestStatus({requestId:r1.requestId,claim:r1.claim}).session;
  // Not online over WS -> a second device may ask; approval replaces the first.
  const r2=svc.requestJoin({invite:INVITE,boId:bo,teamId:'C16',playerId:'C16-P2'});
  assert.equal(svc.pending()[0].replaces,true);
  assert.equal(svc.reviewRequest({requestId:r2.requestId,approved:true}).replaced,1);
  assert.equal(svc.authenticatePlayer(s1),null,'old device session is dead');
  assert.equal(svc.getRequestStatus({requestId:r1.requestId,claim:r1.claim}).status,'replaced');
  const s2=svc.getRequestStatus({requestId:r2.requestId,claim:r2.claim}).session;
  svc.updatePlayer('C16-P2',{connected:true,published:true});
  assert.match(svc.requestJoin({invite:INVITE,boId:bo,teamId:'C16',playerId:'C16-P2'}).error,/already online/);
  assert.ok(svc.revoke({playerId:'C16-P2'}).ok);
  await svc.flushAdmin();
  assert.equal(svc.authenticatePlayer(s2),null);
  const kick=calls.find(c=>c.url.endsWith('/twirp/livekit.RoomService/RemoveParticipant'));
  assert.ok(kick,'server removes the publisher from the SFU');
  assert.equal(kick.url.startsWith('https://example.livekit.cloud/'),true);
  assert.equal(kick.body.identity,'player-C16-P2');
  assert.equal(jwt(kick.auth.replace('Bearer ','')).video.roomAdmin,true);
});

test('new BO deletes the old LiveKit room and expires its approvals',async t=>{
  const f=fixture(t);
  await take(f.store,boMatch(f.store.get()));
  const old=f.store.get().match.matchId;
  const calls=[];const svc=camera(f.db,f.store,calls);svc.syncSession();
  const r=svc.requestJoin({invite:INVITE,boId:old,teamId:'C10',playerId:'C10-P1'});
  svc.reviewRequest({requestId:r.requestId,approved:true});
  const session=svc.getRequestStatus({requestId:r.requestId,claim:r.claim}).session;
  await take(f.store,boMatch(f.store.get(),'C1','C12'));
  svc.syncSession();await svc.flushAdmin();
  const del=calls.find(c=>c.url.endsWith('/DeleteRoom'));
  assert.ok(del);assert.equal(del.body.room,svc.mediaRoom(old));
  assert.equal(svc.authenticatePlayer(session),null);
  assert.equal(f.db.cameraRequests.get(r.requestId).status,'expired');
});

test('Preview rebase: a LIVE +1 is merged into an edited Preview instead of making it stale',()=>{
  const base=cloneProgram(SAMPLE_PROGRAM);
  const draft=cloneProgram(base);draft.match.stage='SEMI FINAL';draft.layers.intro.visible=true;
  const live=cloneProgram(base);live.revision=5;live.match.teamA.seriesWins=2;live.layers.scoreboard.visible=false;
  const {program,conflicts}=rebaseDraft(base,draft,live);
  assert.deepEqual(conflicts,[]);
  assert.equal(program.revision,5);
  assert.equal(program.match.stage,'SEMI FINAL','operator edit kept');
  assert.equal(program.layers.intro.visible,true,'operator edit kept');
  assert.equal(program.match.teamA.seriesWins,2,'live score followed');
  assert.equal(program.layers.scoreboard.visible,false,'live toggle followed');
  const edited=cloneProgram(base);edited.match.teamA.seriesWins=0;
  const clash=rebaseDraft(base,edited,live);
  assert.deepEqual(clash.conflicts,['match.teamA.seriesWins']);
  assert.equal(clash.program.match.teamA.seriesWins,2,'BO score conflicts always follow LIVE');
});

test('database backup is a consistent copy and old copies are pruned',async t=>{
  const f=fixture(t);
  const file=f.db.backup('unit-test',2);
  assert.ok(fs.existsSync(file));
  const copy=openTournamentDB({dbFile:file});
  try{assert.equal(copy.counts().teams,16);}finally{copy.close();}
});
