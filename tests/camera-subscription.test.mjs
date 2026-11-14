import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraReceiver} from '../public/build/camera-receiver.js';
import {SAMPLE_PROGRAM,cloneProgram} from '../public/build/contracts.js';

// v0.3F: the receiver reads publishers straight from the SFU (identity
// player-<playerId>), binds slots by playerId and never shows the opponent.
function harness(identities,options={}){
  globalThis.window={LivekitClient:{Track:{Source:{Camera:'camera'}}},setTimeout,clearTimeout};
  const subscribed=[];
  const pub=(identity)=>({
    trackSid:`${identity}-camera`,isMuted:false,
    videoTrack:{identity,attach(video){video.srcObject={identity};},detach(video){video.srcObject=null;}},
    setSubscribed(value){subscribed.push([identity,value]);}
  });
  const room={disconnect:async()=>{},remoteParticipants:new Map(identities.map(id=>{const p=pub(id);return [id,{identity:id,getTrackPublication:()=>p}];}))};
  const videos=new Map(['A1','A2','B1','B2'].map(s=>[s,{srcObject:null,play(){return Promise.resolve();}}]));
  const ready={};
  const stage={getCameraVideo:s=>videos.get(s),setCameraStreamState:(s,v)=>{ready[s]=v;}};
  const receiver=new CameraReceiver([stage],{exitHoldMs:20,idleMs:50,...options});
  receiver.boId='match-test';receiver.room=room;
  const program=cloneProgram(SAMPLE_PROGRAM);
  program.match.teamA.teamId='C10';program.match.teamB.teamId='C16';
  program.cameras.slots={A1:{playerId:'C10-P1',visible:false},A2:{playerId:'C10-P2',visible:false},B1:{playerId:'C16-P1',visible:false},B2:{playerId:'C16-P2',visible:false}};
  const shown=s=>videos.get(s).srcObject?.identity??null;
  const done=async()=>{await receiver.disconnect();delete globalThis.window;};
  return {receiver,stage,program,subscribed,ready,shown,videos,done};
}

test('each slot shows its own player; two online teammates are never duplicated (A2 fix)',async()=>{
  const h=harness(['player-C10-P1','player-C10-P2','player-C16-P1']);
  h.receiver.setComposition(h.stage,h.program);
  assert.equal(h.ready.A1,false);
  h.program.cameras.slots.A1.visible=true;h.program.cameras.slots.A2.visible=true;
  h.receiver.setComposition(h.stage,h.program);
  assert.equal(h.shown('A1'),'player-C10-P1');
  assert.equal(h.shown('A2'),'player-C10-P2');
  assert.equal(h.ready.A1,true);
  assert.ok(h.subscribed.some(([id,on])=>id==='player-C10-P2'&&on));
  assert.ok(!h.subscribed.some(([id,on])=>id==='player-C16-P1'&&on),'team B not visible -> not subscribed');
  await h.done();
});

test('offline player falls back to the teammate only, never to the other team',async()=>{
  const h=harness(['player-C10-P1','player-C16-P1']);
  h.program.cameras.slots.B2.visible=true;
  h.program.cameras.slots.A2.visible=true;
  h.receiver.setComposition(h.stage,h.program);
  assert.equal(h.shown('B2'),'player-C16-P1','B2 offline -> teammate B1');
  assert.equal(h.shown('A2'),'player-C10-P1','A2 offline -> teammate A1');
  // A slot pointing at an opponent ID is ignored and resolves to its default.
  h.program.cameras.slots.A1={playerId:'C16-P1',visible:true};
  h.receiver.setComposition(h.stage,h.program);
  assert.equal(h.shown('A1'),'player-C10-P1');
  await h.done();
});

test('no publisher at all keeps the placeholder; hide keeps the last frame during exit animation',async()=>{
  const h=harness(['player-C10-P1']);
  h.program.cameras.slots.B1.visible=true;h.program.cameras.slots.A1.visible=true;
  h.receiver.setComposition(h.stage,h.program);
  assert.equal(h.shown('B1'),null);assert.equal(h.ready.B1,false);
  h.program.cameras.slots.A1.visible=false;
  h.receiver.setComposition(h.stage,h.program);
  assert.equal(h.shown('A1'),'player-C10-P1','still attached while the tile animates out');
  await new Promise(r=>setTimeout(r,40));
  assert.equal(h.shown('A1'),null,'released after exitHoldMs');
  assert.equal(h.ready.A1,false);
  await h.done();
});

test('subscriptions are released after the grace window when no slot needs a team',async()=>{
  const h=harness(['player-C10-P1','player-C16-P1']);
  h.program.cameras.slots.A1.visible=true;h.program.cameras.slots.B1.visible=true;
  h.receiver.setComposition(h.stage,h.program);
  h.program.cameras.slots.A1.visible=false;h.program.cameras.slots.B1.visible=false;
  h.receiver.setComposition(h.stage,h.program);
  h.receiver.desiredSince.set('player-C10-P1',Date.now()-1);
  h.receiver.desiredSince.set('player-C16-P1',Date.now()-1);
  h.receiver.sync();
  assert.ok(h.subscribed.some(([id,on])=>id==='player-C10-P1'&&on===false));
  assert.ok(h.subscribed.some(([id,on])=>id==='player-C16-P1'&&on===false));
  await h.done();
});

test('lazy connection: joins LiveKit only when a slot is visible or pre-warmed, leaves when idle',async()=>{
  const h=harness([]);
  h.receiver.room=null;let opened=0;
  h.receiver.open=async function(){opened++;};
  h.receiver.setComposition(h.stage,h.program);
  assert.equal(opened,0,'no visible camera -> no SFU participant minutes');
  h.receiver.prewarm(30);
  assert.equal(opened,1,'Preview staging pre-warms the OBS receiver');
  // Pretend the join finished, then nothing becomes visible: idle teardown.
  let left=0;h.receiver.room={disconnect:async()=>{left++;},remoteParticipants:new Map()};
  await new Promise(r=>setTimeout(r,45));
  h.receiver.sync();
  await new Promise(r=>setTimeout(r,80));
  assert.equal(left,1,'idle receiver disconnects from the SFU');
  await h.done();
});
