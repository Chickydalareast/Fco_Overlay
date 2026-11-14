import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCameraService} from '../server/camera-room.mjs';
import {createStore,validateCameras} from '../server/state.mjs';
import {openTournamentDB} from '../server/tournament-db.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v03c-cam-'));
  const db=openTournamentDB({dbFile:path.join(dir,'main.sqlite')});
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const store=createStore(path.join(dir,'program.json'),{database:db});
  const svc=createCameraService({inviteSecret:'invite-private-012345',livekitUrl:'wss://example.livekit.cloud',
    livekitKey:'testKey',livekitSecret:'testSecret',roomName:'test-camera',getProgram:()=>store.get(),registry:()=>db.registry()});
  return {db,store,svc};
}
function decode(jwt){const [h,p,s]=jwt.split('.');assert.equal(s,crypto.createHmac('sha256','testSecret').update(`${h}.${p}`).digest('base64url'));return JSON.parse(Buffer.from(p,'base64url').toString());}
async function startBo(store,teamA='C10',teamB='C16'){
  const initial=store.get();const registryTeams=([teamA,teamB]).map(id=>id==='C10'?['FC Barcelona','/assets/clubs/barcelona.png']:['Arsenal FC','/assets/clubs/arsenal.png']);
  const match=structuredClone(initial.match);
  match.matchId=undefined;
  match.bestOf=5;match.gameNumber=1;
  for(const [side,id,data] of [['teamA',teamA,registryTeams[0]],['teamB',teamB,registryTeams[1]]]){
    const team=match[side];team.teamId=id;team.playerId=`${id}-P1`;team.name=data[0];team.shortName=id;team.clubLogo=data[1];team.seriesWins=0;team.gameGoals=0;
  }
  const result=await store.command({id:crypto.randomUUID(),type:'program.take',expectedRevision:initial.revision,match,layers:initial.layers,cameras:initial.cameras});
  assert.ok(result.ok,JSON.stringify(result));return result.program.match.matchId;
}
test('one current BO limits room choices to exactly two allowed teams and four registered players',async t=>{
  const {svc,store}=fixture(t);
  assert.match(svc.getOptions({invite:'wrong',boId:'wrong'}).error,/Invalid room invite/);
  assert.match(svc.getOptions({invite:'invite-private-012345',boId:'old'}).error,/unavailable/);
  const id=await startBo(store);
  const opts=svc.getOptions({invite:'invite-private-012345',boId:id});
  assert.deepEqual(opts.teams.map(x=>x.teamId),['C10','C16']);
  assert.deepEqual(opts.teams.flatMap(x=>x.players.map(p=>p.id)),['C10-P1','C10-P2','C16-P1','C16-P2']);
  assert.equal(svc.getInvitePath().includes(encodeURIComponent(id)),true);
  assert.match(svc.requestJoin({invite:'invite-private-012345',boId:id,teamId:'C1',playerId:'C1-P1'}).error,/allowed/);
});
test('approval is mandatory before camera token; tokens are camera only and scoped to BO',async t=>{
  const {svc,store}=fixture(t);const id=await startBo(store);
  const req=svc.requestJoin({invite:'invite-private-012345',boId:id,teamId:'C10',playerId:'C10-P2'});
  assert.equal(req.status,'pending');
  assert.equal(svc.pending().length,1);
  assert.deepEqual(svc.getRequestStatus({requestId:req.requestId,claim:req.claim}),{status:'pending',error:undefined});
  assert.ok(svc.getRequestStatus({requestId:req.requestId,claim:'wrong'}).error);
  const reviewed=svc.reviewRequest({requestId:req.requestId,approved:true});
  assert.ok(reviewed.ok);
  const grant=svc.getRequestStatus({requestId:req.requestId,claim:req.claim});
  assert.equal(grant.status,'approved');
  const jwt=decode(grant.token);
  assert.equal(jwt.video.canSubscribe,true,'v0.4D: players subscribe to BTC audio only (client side)');
  assert.deepEqual(jwt.video.canPublishSources,['camera']);
  assert.ok(jwt.exp-jwt.iat<=600);
  assert.equal(jwt.video.room.includes(id),false,'room name uses hashed session ID');
  assert.equal(decode(svc.issueViewer().token).video.canPublish,false);
  assert.equal(grant.identity,'player-C10-P2','publisher identity is derived from the stable player ID');
  assert.equal(svc.authenticatePlayer(grant.session),'C10-P2');
  svc.updatePlayer('C10-P2',{connected:true,published:true});
  const entry=svc.roster().find(p=>p.playerId==='C10-P2');
  assert.equal(svc.roster().length,4,'roster always lists the four registered players of the BO');
  assert.equal(entry.rosterSlot,2);
  assert.equal(entry.teamId,'C10');
  assert.equal(entry.status,'approved');
  assert.equal(entry.published,true);
});
test('old BO invite and pending approval are invalid after TAKE starts a new BO',async t=>{
  const {svc,store}=fixture(t);const old=await startBo(store);
  const request=svc.requestJoin({invite:'invite-private-012345',boId:old,teamId:'C10',playerId:'C10-P1'});
  const next=await startBo(store);
  assert.notEqual(old,next);
  assert.match(svc.getOptions({invite:'invite-private-012345',boId:old}).error,/unavailable/);
  assert.equal(svc.getRequestStatus({requestId:request.requestId,claim:request.claim}).status,'expired');
  assert.match(svc.reviewRequest({requestId:request.requestId,approved:true}).error,/No pending/);
  assert.equal(svc.issueViewer().boId,next);
});
test('cancel and reject requests do not issue a publisher token',async t=>{
  const {svc,store}=fixture(t);const id=await startBo(store);
  let req=svc.requestJoin({invite:'invite-private-012345',boId:id,teamId:'C16',playerId:'C16-P1'});
  assert.ok(svc.cancelRequest({requestId:req.requestId,claim:req.claim}).ok);
  assert.equal(svc.getRequestStatus({requestId:req.requestId,claim:req.claim}).status,'cancelled');
  req=svc.requestJoin({invite:'invite-private-012345',boId:id,teamId:'C16',playerId:'C16-P1'});
  assert.equal(svc.reviewRequest({requestId:req.requestId,approved:false}).status,'rejected');
  assert.equal(svc.getRequestStatus({requestId:req.requestId,claim:req.claim}).status,'rejected');
});
test('camera slots bind to same-side player IDs; emergency clear keeps assignments',async t=>{
  const {store}=fixture(t);await startBo(store);
  const previous=store.get();assert.equal(validateCameras(previous.cameras),true);
  assert.deepEqual(Object.values(previous.cameras.slots).map(s=>s.playerId),['C10-P1','C10-P2','C16-P1','C16-P2'],'TAKE fills each slot with its roster default');
  const next=await store.command({id:'cam-v03f-0003',type:'camera.assign',slot:'A1',playerId:'C10-P2'});
  assert.ok(next.ok);
  const foreign=await store.command({id:'cam-v03f-0005',type:'camera.assign',slot:'A1',playerId:'C16-P1'});
  assert.equal(foreign.ok,false,'a slot can never show the opposite team');
  await store.command({id:'cam-v03f-0006',type:'camera.setVisible',slot:'A1',visible:true});
  const hidden=await store.command({id:'cam-v03f-0004',type:'program.clear'});
  assert.equal(hidden.program.cameras.slots.A1.playerId,'C10-P2');
  assert.equal(hidden.program.cameras.slots.A1.visible,false);
});
