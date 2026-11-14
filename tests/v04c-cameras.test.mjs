import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CameraReceiver} from '../public/build/camera-receiver.js';
import {SAMPLE_PROGRAM,cloneProgram} from '../public/build/contracts.js';
import {CAMERA_TILES,CAMERA_TILE_SIZE,CAMERA_FRAME_COLORS,STAGE_W,STAGE_H} from '../public/build/stage.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Fake SFU: each identity has a camera publication that can be muted (paused).
function harness(identities){
  globalThis.window={LivekitClient:{Track:{Source:{Camera:'camera'}}},setTimeout,clearTimeout};
  const pubs=new Map(identities.map(identity=>[identity,{
    trackSid:`${identity}-camera`,isMuted:false,
    videoTrack:{identity,attach(video){video.srcObject={identity};},detach(video){video.srcObject=null;}},
    setSubscribed(){}
  }]));
  const room={disconnect:async()=>{},remoteParticipants:new Map(identities.map(id=>[id,{identity:id,getTrackPublication:()=>pubs.get(id)}]))};
  const videos=new Map(['A1','A2','B1','B2'].map(s=>[s,{srcObject:null,play(){return Promise.resolve();}}]));
  const ready={};
  const stage={getCameraVideo:s=>videos.get(s),setCameraStreamState:(s,v)=>{ready[s]=v;}};
  const receiver=new CameraReceiver([stage],{exitHoldMs:20,idleMs:50});
  receiver.boId='match-test';receiver.room=room;
  const program=cloneProgram(SAMPLE_PROGRAM);
  program.match.teamA.teamId='C10';program.match.teamB.teamId='C16';
  program.cameras.slots={A1:{playerId:'C10-P1',visible:true},A2:{playerId:'C10-P2',visible:true},B1:{playerId:'C16-P1',visible:true},B2:{playerId:'C16-P2',visible:true}};
  const shown=s=>videos.get(s).srcObject?.identity??null;
  const leave=id=>{room.remoteParticipants.delete(id);receiver.sync();};
  const mute=(id,on)=>{pubs.get(id).isMuted=on;receiver.sync();};
  return {receiver,stage,program,ready,shown,leave,mute,done:async()=>{await receiver.disconnect();delete globalThis.window;}};
}

test('v0.4C paused camera (phone turned upright) shows the logo placeholder, not the teammate',async()=>{
  const h=harness(['player-C10-P1','player-C10-P2']);
  h.receiver.setComposition(h.stage,h.program);
  assert.equal(h.shown('A2'),'player-C10-P2');assert.equal(h.ready.A2,true);
  h.mute('player-C10-P2',true);
  assert.equal(h.shown('A2'),'player-C10-P2','own track stays attached');
  assert.equal(h.ready.A2,false,'placeholder covers the paused camera');
  assert.equal(h.ready.A1,true,'teammate tile unaffected');
  h.mute('player-C10-P2',false);
  assert.equal(h.ready.A2,true,'resumes on the same track');
  await h.done();
});

test('v0.4C player who leaves the room is replaced by the teammate camera (same team only)',async()=>{
  const h=harness(['player-C10-P1','player-C10-P2','player-C16-P1']);
  h.receiver.setComposition(h.stage,h.program);
  h.leave('player-C10-P2');
  assert.equal(h.shown('A2'),'player-C10-P1','A2 left -> both left tiles show A1');
  assert.equal(h.ready.A2,true);
  assert.equal(h.shown('B2'),'player-C16-P1','B2 never joined -> teammate B1');
  // Teammate paused too: placeholder, never the other team.
  h.mute('player-C10-P1',true);
  assert.equal(h.ready.A1,false);assert.equal(h.shown('A2'),null);assert.equal(h.ready.A2,false);
  h.leave('player-C16-P1');
  assert.equal(h.shown('B1'),null);assert.equal(h.shown('B2'),null);
  await h.done();
});

test('v0.4C camera tiles: FVPL positions, 16:9, mirrored, clear of the game minimap',()=>{
  const {width,height,border}=CAMERA_TILE_SIZE;
  assert.ok(Math.abs(width/height-16/9)<0.01);
  assert.equal(border,5);
  // Measured on the 1080p FVPL frame (x4/3): cam 1 at 36..314 x 771..928
  assert.ok(Math.abs(CAMERA_TILES.A2.x-36*4/3)<=2 && Math.abs(CAMERA_TILES.A2.y-771*4/3)<=2);
  assert.ok(Math.abs(CAMERA_TILES.A1.x-520*4/3)<=2 && Math.abs(CAMERA_TILES.A1.y-873*4/3)<=2);
  // Mirror around the centre (±4 px from the measurement)
  assert.ok(Math.abs((CAMERA_TILES.A1.x+width)-(STAGE_W-CAMERA_TILES.B1.x))<=4);
  assert.ok(Math.abs((CAMERA_TILES.A2.x+width)-(STAGE_W-CAMERA_TILES.B2.x))<=4);
  assert.equal(CAMERA_TILES.A1.y,CAMERA_TILES.B1.y);assert.equal(CAMERA_TILES.A2.y,CAMERA_TILES.B2.y);
  // Inner tiles leave the game's minimap (1080p x 822..1098) uncovered
  assert.ok(CAMERA_TILES.A1.x+width<=822*4/3 && CAMERA_TILES.B1.x>=1098*4/3);
  for (const t of Object.values(CAMERA_TILES)) assert.ok(t.x>=0 && t.y+height<=STAGE_H && t.x+width<=STAGE_W);
  // Player 1 inner, player 2 outer; left team red frame, right team orange
  assert.ok(CAMERA_TILES.A1.x>CAMERA_TILES.A2.x && CAMERA_TILES.B1.x<CAMERA_TILES.B2.x);
  assert.deepEqual(CAMERA_FRAME_COLORS,{A:'#ff4242',B:'#fe9500'});
  const css=fs.readFileSync(path.join(ROOT,'public/assets/stage.css'),'utf8');
  assert.match(css,/\.camera-tile \{[^}]*border:5px solid #ff4242/);
  assert.match(css,/\.camera-side-B \{ border-color:#fe9500/);
  const stage=fs.readFileSync(path.join(ROOT,'client/stage.ts'),'utf8');
  assert.doesNotMatch(stage,/camera-player-name|WAITING FOR PLAYER/,'no names on air');
});

test('v0.4C player room: Vietnamese UI, landscape guard, video only',()=>{
  const room=fs.readFileSync(path.join(ROOT,'client/room.ts'),'utf8');
  for (const text of ['PHÒNG CAMERA TUYỂN THỦ','Gửi yêu cầu vào phòng','Xoay ngang điện thoại','Tắt camera','Đang chờ BTC duyệt'])
    assert.ok(room.includes(text),text);
  assert.match(room,/aspectRatio:\{ideal:16\/9\}/);
  assert.match(room,/audio:false/);
  assert.match(room,/publication\.mute\(\)/,'upright phone pauses the published camera');
  assert.match(room,/const ready=!!stream&&landscape\(\)/,'request button needs a landscape camera');
  assert.match(room,/wakeLock/);
  const html=fs.readFileSync(path.join(ROOT,'public/room.html'),'utf8');
  assert.match(html,/lang="vi"/);
});
