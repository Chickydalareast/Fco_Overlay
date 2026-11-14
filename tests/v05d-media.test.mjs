import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CameraReceiver} from '../public/build/camera-receiver.js';
import {SAMPLE_PROGRAM,cloneProgram} from '../public/build/contracts.js';
import {acceptRendererReady,acceptRendererMedia,rendererInfo} from '../server/renderer-sync.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=rel=>fs.readFileSync(path.join(ROOT,rel),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function program(){
  const p=cloneProgram(SAMPLE_PROGRAM);p.revision=17;
  p.match.matchId='match-v05d-live';p.match.teamA.teamId='C10';p.match.teamB.teamId='C16';
  for(const slot of ['A1','A2','B1','B2'])p.cameras.slots[slot]={visible:false,playerId:`${slot[0]==='A'?'C10':'C16'}-P${slot[1]}`};
  return p;
}
function publication(identity,log){
  const track={identity,attach(video){video.srcObject={identity};},detach(video){video.srcObject=null;}};
  return {trackSid:'same-camera-SID',isMuted:false,videoTrack:track,
    setSubscribed(value){log.push({identity,subscribed:value});},setVideoQuality(q){log.push({identity,quality:q});}};
}
function video(){
  const listeners=new Map(),frameCallbacks=[];
  return {srcObject:null,readyState:0,videoWidth:0,
    muted:false,autoplay:false,playsInline:false,
    play(){return Promise.resolve();},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
    requestVideoFrameCallback(fn){frameCallbacks.push(fn);},
    drainFrames(){return frameCallbacks.splice(0);},
    fireFrame(){this.readyState=3;this.videoWidth=640;for(const fn of frameCallbacks.splice(0))fn();},
    fire(name){for(const fn of listeners.get(name)??[])fn();}};
}
async function receiverHarness(t,{withRoom=true}={}){
  const saved={window:globalThis.window,fetch:globalThis.fetch};
  const ids=['player-C10-P1','player-C10-P2','player-C16-P1','player-C16-P2'];
  const events={TrackPublished:'trackPublished',TrackUnpublished:'trackUnpublished',TrackSubscribed:'trackSubscribed',TrackUnsubscribed:'trackUnsubscribed',
    ParticipantConnected:'participantConnected',ParticipantDisconnected:'participantDisconnected',TrackMuted:'muted',TrackUnmuted:'unmuted',
    Reconnecting:'reconnecting',Reconnected:'reconnected',Disconnected:'disconnected'};
  const rooms=[],subscriptions=[];
  class Room {
    constructor(){this.handlers=new Map();this.remoteParticipants=new Map();
      for(const id of ids){const pub=publication(id,subscriptions);this.remoteParticipants.set(id,{identity:id,getTrackPublication:()=>pub,pub});}
      rooms.push(this);
    }
    on(name,fn){this.handlers.set(name,fn);}
    emit(name){this.handlers.get(name)?.();}
    async connect(){this.connected=true;}
    async disconnect(){this.connected=false;this.disconnected=true;}
  }
  globalThis.window={LivekitClient:{Room,RoomEvent:events,Track:{Source:{Camera:'camera'}},VideoQuality:{HIGH:2}},setTimeout,clearTimeout};
  globalThis.fetch=async()=>({ok:true,json:async()=>({url:'wss://mock.invalid',token:'token',boId:'match-v05d-live'})});
  const videos=new Map(['A1','A2','B1','B2'].map(s=>[s,video()]));
  const states=[];const stage={getCameraVideo:slot=>videos.get(slot),setCameraStreamState:(slot,value)=>states.push({slot,value}),setCameraSource(){}};
  const receiver=new CameraReceiver([stage],{idleMs:40,exitHoldMs:10});
  const p=program();
  receiver.setComposition(stage,p);
  await receiver.setSession(p.match.matchId);
  if(withRoom)await delay(8);
  t.after(async()=>{await receiver.disconnect();if(saved.window===undefined)delete globalThis.window;else globalThis.window=saved.window;globalThis.fetch=saved.fetch;});
  return {receiver,stage,p,videos,subscriptions,rooms,states};
}

test('v0.5D: full LiveKit disconnect subscribes a new publication even when trackSid is identical',async t=>{
  const h=await receiverHarness(t);
  h.p.cameras.slots.A1.visible=true;h.receiver.setComposition(h.stage,h.p);await delay(8);
  assert.equal(h.rooms.length,1);
  assert.equal(h.subscriptions.filter(x=>x.identity==='player-C10-P1'&&x.subscribed===true).length,1);
  h.rooms[0].emit('disconnected');
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A1']});
  h.receiver.reconnectTimer&&clearTimeout(h.receiver.reconnectTimer);
  h.receiver.reconnectTimer=0;
  await h.receiver.open();
  assert.equal(h.rooms.length,2);
  assert.equal(h.rooms[1].remoteParticipants.get('player-C10-P1').pub.trackSid,'same-camera-SID');
  assert.equal(h.subscriptions.filter(x=>x.identity==='player-C10-P1'&&x.subscribed===true).length,2,
    'new publication must re-subscribe even with unchanged participant and SID');
});

test('v0.5D: ICE Reconnected reasserts LiveKit subscription and resets frame readiness',async t=>{
  const h=await receiverHarness(t);
  h.p.cameras.slots.A1.visible=true;h.receiver.setComposition(h.stage,h.p);await delay(8);
  h.videos.get('A1').fireFrame();
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:['A1'],waiting:[]});
  h.rooms[0].emit('reconnecting');
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A1']});
  h.rooms[0].emit('reconnected');
  assert.equal(h.subscriptions.filter(x=>x.identity==='player-C10-P1'&&x.subscribed===true).length,2);
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A1']});
  h.videos.get('A1').fireFrame();
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:['A1'],waiting:[]});
});

test('v0.5D: OBS readiness stays waiting until a video frame, not just track attach',async t=>{
  const h=await receiverHarness(t);
  const reports=[];h.receiver.onReadiness=(_stage,state)=>reports.push(state);
  h.p.cameras.slots.A1.visible=true;h.receiver.setComposition(h.stage,h.p);await delay(8);
  assert.equal(h.videos.get('A1').srcObject.identity,'player-C10-P1');
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A1']});
  h.videos.get('A1').fireFrame();
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:['A1'],waiting:[]});
  assert.ok(reports.some(r=>r.ready.includes('A1')));
  h.p.cameras.slots.A1.visible=false;h.receiver.setComposition(h.stage,h.p);
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:[]});
});

test('v0.5D: a delayed frame from an old camera cannot mark the replacement track ready',async t=>{
  const h=await receiverHarness(t);
  h.p.cameras.slots.A1.visible=true;h.receiver.setComposition(h.stage,h.p);await delay(8);
  const videoEl=h.videos.get('A1');
  const oldCallbacks=videoEl.drainFrames();
  assert.equal(oldCallbacks.length,1);
  // Replace the SDK publication without delivering the old track's frame.
  const participant=h.rooms[0].remoteParticipants.get('player-C10-P1');
  const newer=publication('player-C10-P1',h.subscriptions);
  participant.getTrackPublication=()=>newer;
  h.receiver.sync();
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A1']});
  oldCallbacks[0]();
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A1']},'late old-track frame is ignored');
  videoEl.fireFrame();
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:['A1'],waiting:[]});
});

test('v0.5D: prewarm subscribes only selected BO feeds and disconnects on expiry if no camera is LIVE',async t=>{
  const h=await receiverHarness(t);
  // Room can exist, but zero visible tiles = no active camera subscription.
  assert.equal(h.rooms.length,0);
  h.receiver.prewarm(30,['C10-P1','C10-P2']);
  await delay(8);
  assert.equal(h.rooms.length,1);
  assert.ok(h.subscriptions.some(x=>x.identity==='player-C10-P1'&&x.subscribed));
  assert.ok(h.subscriptions.some(x=>x.identity==='player-C10-P2'&&x.subscribed));
  assert.ok(!h.subscriptions.some(x=>x.identity==='player-C16-P1'&&x.subscribed));
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:[]});
  await delay(60);
  assert.equal(h.rooms[0].disconnected,true,'prewarm-only room is released promptly, not kept another idleMs');
});

test('v0.5D: stale or future renderer.ready cannot claim OBS is synced',()=>{
  const entry={rendererId:'r1',label:'OBS',revision:null,mediaRevision:null,cameraReady:[],cameraWaiting:[]};
  assert.equal(acceptRendererReady(entry,6,7),false);
  assert.equal(acceptRendererReady(entry,100,7),false);
  assert.equal(entry.revision,null);
  assert.equal(acceptRendererReady(entry,7,7),true);
  assert.equal(entry.revision,7);
  assert.equal(entry.mediaRevision,null);
});

test('v0.5D: media status is revision-scoped and must contain exactly all currently-visible slots',()=>{
  const p=program();p.cameras.slots.A1.visible=true;p.cameras.slots.B2.visible=true;
  const entry={rendererId:'r1',label:'OBS',revision:null,mediaRevision:null,cameraReady:[],cameraWaiting:[]};
  assert.equal(acceptRendererReady(entry,17,17),true);
  assert.equal(acceptRendererMedia(entry,{revision:16,ready:['A1'],waiting:['B2']},p),false);
  assert.equal(acceptRendererMedia(entry,{revision:17,ready:['A1'],waiting:['A1']},p),false);
  assert.equal(acceptRendererMedia(entry,{revision:17,ready:['A1'],waiting:[]},p),false);
  assert.equal(acceptRendererMedia(entry,{revision:17,ready:['A1'],waiting:['B2']},p),true);
  assert.deepEqual(rendererInfo(entry,p),{id:'r1',label:'OBS',revision:17,mediaRevision:17,cameraReady:['A1'],cameraWaiting:['B2']});
  p.revision=18;
  assert.deepEqual(rendererInfo(entry,p),{id:'r1',label:'OBS',revision:17},'stale media must not be shown for a new Program');
});

test('v0.5D: changing program revision invalidates previous media until fresh renderer.ready & renderer.media',()=>{
  const entry={rendererId:'r1',label:'OBS',revision:null,mediaRevision:null,cameraReady:[],cameraWaiting:[]};
  const p=program();p.cameras.slots.A1.visible=true;
  assert.equal(acceptRendererReady(entry,17,17),true);
  assert.equal(acceptRendererMedia(entry,{revision:17,ready:['A1'],waiting:[]},p),true);
  assert.equal(acceptRendererReady(entry,18,18),true);
  assert.equal(entry.mediaRevision,null);
  assert.equal(acceptRendererMedia(entry,{revision:17,ready:['A1'],waiting:[]},{...p,revision:18}),false);
});

test('v0.5D: server filters prewarm to the active BO and forwards no unrelated player IDs',()=>{
  const source=read('server/index.mjs');
  assert.match(source,/message\.boId!==program\.match\.matchId/);
  assert.match(source,/requested\.filter\(id=>typeof id==='string'&&ids\.has\(id\)\)/);
  assert.match(source,/acceptRendererReady\(entry,message\.revision,store\.get\(\)\.revision\)/);
  assert.match(source,/acceptRendererMedia\(entry,message,store\.get\(\)\)/);
});

test('v0.5D: OBS sends frame status only after layout ACK, and Studio distinguishes sync from media',()=>{
  const output=read('client/output.ts'),studio=read('client/studio.ts');
  assert.match(output,/layoutAcked=connection\.send\(\{type:'renderer\.ready',revision:renderedRevision\}\)/);
  assert.match(output,/type:'renderer\.media',revision:renderedRevision,ready,waiting/);
  assert.match(studio,/OBS CAMERA WAIT/);
  assert.match(studio,/r\.mediaRevision!==current/);
  assert.match(studio,/type:'camera\.prewarm',boId,playerIds:\[\.\.\.playerIds\]/);
});

test('v0.5D: prewarm expiry cannot disconnect a receiver that became LIVE',async t=>{
  const h=await receiverHarness(t);
  h.receiver.prewarm(25,['C10-P1']);
  await delay(8);
  h.p.cameras.slots.A1.visible=true;
  h.receiver.setComposition(h.stage,h.p);
  await delay(50);
  assert.equal(h.rooms.length,1);
  assert.equal(h.rooms[0].disconnected,undefined,'LIVE camera holds the room after short prewarm expires');
  assert.equal(h.receiver.getReadiness(h.stage).waiting.includes('A1'),true);
});

test('v0.5D: an obsolete ICE frame callback cannot override a newer Reconnected readiness check',async t=>{
  const h=await receiverHarness(t);
  h.p.cameras.slots.A1.visible=true;h.receiver.setComposition(h.stage,h.p);await delay(8);
  const videoEl=h.videos.get('A1');
  const oldCallbacks=videoEl.drainFrames();
  h.rooms[0].emit('reconnecting');
  h.rooms[0].emit('reconnected');
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A1']});
  for(const fn of oldCallbacks)fn();
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A1']});
  videoEl.fireFrame();
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:['A1'],waiting:[]});
});

test('v0.5D: absent camera frames are reported as waiting even if a player is publishing',async t=>{
  const h=await receiverHarness(t);
  h.p.cameras.slots.A2.visible=true;h.receiver.setComposition(h.stage,h.p);await delay(8);
  assert.ok(h.subscriptions.some(x=>x.identity==='player-C10-P2'&&x.subscribed));
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A2']});
  h.rooms[0].remoteParticipants.get('player-C10-P2').pub.isMuted=true;
  h.rooms[0].emit('muted');
  assert.deepEqual(h.receiver.getReadiness(h.stage),{ready:[],waiting:['A2']});
});
