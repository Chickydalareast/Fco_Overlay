import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCameraService,ADMIN_PREFIX} from '../server/camera-room.mjs';
import {createStore} from '../server/state.mjs';
import {openTournamentDB} from '../server/tournament-db.mjs';
import {CameraReceiver} from '../public/build/camera-receiver.js';
import {SAMPLE_PROGRAM,cloneProgram} from '../public/build/contracts.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v04d-'));
  const db=openTournamentDB({dbFile:path.join(dir,'main.sqlite')});
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const store=createStore(path.join(dir,'program.json'),{database:db});
  const svc=createCameraService({inviteSecret:'invite-private-012345',livekitUrl:'wss://example.livekit.cloud',
    livekitKey:'testKey',livekitSecret:'testSecret',roomName:'test-camera',getProgram:()=>store.get(),registry:()=>db.registry()});
  return {store,svc};
}
const decode=jwt=>JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString());
async function startBo(store){
  const initial=store.get();const match=structuredClone(initial.match);match.matchId=undefined;match.gameNumber=1;
  for(const [side,id] of [['teamA','C10'],['teamB','C16']]){const team=match[side];team.teamId=id;team.playerId=`${id}-P1`;team.shortName=id;team.seriesWins=0;team.gameGoals=0;}
  const r=await store.command({id:crypto.randomUUID(),type:'program.take',expectedRevision:initial.revision,match,layers:initial.layers,cameras:initial.cameras});
  assert.ok(r.ok,JSON.stringify(r));return r.program.match.matchId;
}

test('v0.4D BTC token: audio only (mic + relayed audio), can watch, same BO room, unlimited',async t=>{
  const {svc,store}=fixture(t);
  assert.equal(svc.issueAdmin(),null,'no BO -> no BTC room');
  const boId=await startBo(store);
  const a=svc.issueAdmin(),b=svc.issueAdmin();
  assert.ok(a.identity.startsWith(ADMIN_PREFIX)&&b.identity.startsWith(ADMIN_PREFIX));
  assert.notEqual(a.identity,b.identity,'every operator gets an own identity (no limit)');
  const jwt=decode(a.token);
  assert.deepEqual(jwt.video.canPublishSources,['microphone','screen_share_audio']);
  assert.equal(jwt.video.canSubscribe,true);assert.equal(jwt.video.canPublishData,false);
  assert.equal(jwt.video.room,decode(svc.issueViewer().token).video.room,'same media room as players / OBS');
  assert.ok(jwt.exp-jwt.iat<=600);
  assert.equal(a.boId,boId);
  assert.equal(a.roster.length,4);assert.deepEqual(a.teams.map(x=>x.teamId),['C10','C16']);
});

test('v0.4D server: BTC token needs Studio login; mic only allowed on the BTC page',()=>{
  const src=read('server/index.mjs');
  assert.match(src,/url\.pathname==='\/api\/camera\/admin-token'\) \{\s*\/\/[^\n]*\n\s*if \(!isAdmin\(req\)\) return respond\(res,401/);
  assert.match(src,/resource==='\/admin-room'\) resource='\/admin-room\.html'/);
  assert.match(src,/resource==='\/admin-room\.html'\?'camera=\(\), microphone=\(self\), display-capture=\(self\)':'camera=\(self\), microphone=\(\), display-capture=\(\)'/);
  assert.match(read('client/studio.ts'),/href="\/admin-room" target="_blank"/);
});

test('v0.4D OBS takes the top camera layer; never touches audio',async()=>{
  globalThis.window={LivekitClient:{Track:{Source:{Camera:'camera'}},VideoQuality:{LOW:0,HIGH:2}},setTimeout,clearTimeout};
  const quality=[];
  const pub={trackSid:'s',isMuted:false,videoTrack:{attach(v){v.srcObject={};},detach(v){v.srcObject=null;}},setSubscribed(){},setVideoQuality(q){quality.push(q);}};
  const room={disconnect:async()=>{},remoteParticipants:new Map([['player-C10-P1',{identity:'player-C10-P1',getTrackPublication:()=>pub}]])};
  const stage={getCameraVideo:()=>({srcObject:null,play(){return Promise.resolve();}}),setCameraStreamState(){}};
  const receiver=new CameraReceiver([stage],{});receiver.boId='bo';receiver.room=room;
  const program=cloneProgram(SAMPLE_PROGRAM);program.match.teamA.teamId='C10';program.match.teamB.teamId='C16';
  program.cameras.slots.A1={playerId:'C10-P1',visible:true};
  receiver.setComposition(stage,program);
  assert.deepEqual(quality,[2]);
  await receiver.disconnect();delete globalThis.window;
  assert.doesNotMatch(read('client/camera-receiver.ts'),/Kind\.Audio|Microphone/);
});

test('v0.4D player room: simulcast small layer, hears only BTC audio; BTC room never plays audio',()=>{
  const room=read('client/room.ts');
  assert.match(room,/simulcast:true,videoSimulcastLayers:\[small\]/);
  assert.match(room,/dynacast:true/);
  assert.match(room,/if\(!participant\.identity\.startsWith\(ADMIN_PREFIX\)\)continue;/);
  assert.match(room,/publication\.kind===LK\.Track\.Kind\.Audio/);
  assert.match(room,/audio:false/,'players still never send a microphone');
  for (const text of ['Âm thanh từ BTC','Tắt tiếng','Bấm để bật âm thanh']) assert.ok(room.includes(text),text);
  const admin=read('client/admin-room.ts');
  assert.match(admin,/publishOptions:\(\)=>\(\{source:window\.LivekitClient\.Track\.Source\.Microphone/,'microphone publication is now mediated by the serialized BTC controller');
  assert.match(admin,/source:LK\.Track\.Source\.ScreenShareAudio/);
  assert.match(admin,/echoCancellation:false,noiseSuppression:false,autoGainControl:false/,'relay keeps the original sound');
  assert.match(admin,/pub\.setVideoQuality\(LK\.VideoQuality\.LOW\)/,'BTC watches the small layer');
  assert.doesNotMatch(admin,/Kind\.Audio|\.attach\(\)/,'BTC room does not subscribe/play audio (no echo)');
  assert.match(admin,/e\.code!=='Space'/,'push-to-talk');
  assert.match(read('public/admin-room.html'),/lang="vi"/);
});
