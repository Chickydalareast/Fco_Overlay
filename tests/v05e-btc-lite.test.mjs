import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BtcMicController} from '../public/build/btc-mic-controller.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const src=read('client/admin-room.ts'),css=read('public/assets/admin-room.css');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};};
function setup(t,{acquire,publish}={}){
  const tracks=[],events=[],calls=[];
  const makeTrack=()=>{const tr={enabled:true,readyState:'live',stopped:false,stop(){this.stopped=true;this.readyState='ended';}};tracks.push(tr);return tr;};
  const room={localParticipant:{
    async publishTrack(track){calls.push('publish');return publish?publish(track):pub;},
    async unpublishTrack(){calls.push('unpublish');}
  }};
  const pub={track:{},isMuted:false,async mute(){calls.push('mute');this.isMuted=true;},async unmute(){calls.push('unmute');this.isMuted=false;}};
  const mic=new BtcMicController({
    acquire:acquire??(async()=>makeTrack()),publishOptions:()=>({source:'microphone',name:'btc-mic'}),
    onTrack:track=>events.push(track?'track':'no-track'),onState:()=>{},onError:error=>{throw error;}
  });
  t.after(()=>mic.dispose());
  mic.setRoom(room);
  return {mic,room,pub,makeTrack,tracks,events,calls};
}

test('v0.5E: BTC room never auto-subscribes and does not store watch preference in localStorage',()=>{
  assert.match(src,/let watch=false;/);
  assert.doesNotMatch(src,/localStorage|sessionStorage/);
  assert.match(src,/id="adm-watch" aria-pressed="false"/);
  assert.match(src,/watch=!watch;renderWatch\(\);sync\(\)/);
  assert.match(src,/pub\.setVideoQuality\(LK\.VideoQuality\.LOW\)/);
  assert.match(src,/pub\.setSubscribed\(wanted\)/);
  assert.match(src,/requestWatch\(pub,watch&&allowed\.has\(playerId\),LK\)/);
  assert.match(css,/\.adm\[data-watch="off"\] \.adm-tile video/);
  assert.match(css,/\.adm\[data-watch="off"\] \.adm-tile-label/);
  assert.match(src,/Đang tắt nhận video để tiết kiệm băng thông LiveKit/);
});

test('v0.5E: PTT release while permission prompt is pending never publishes an audible track',async t=>{
  const gate=deferred();const f=setup(t,{acquire:()=>gate.promise});
  f.mic.setWanted(true);await Promise.resolve();
  f.mic.setWanted(false);
  const track=f.makeTrack();gate.resolve(track);
  await f.mic.idle();
  assert.equal(track.enabled,false);
  assert.equal(track.stopped,true,'orphan permission result disposed');
  assert.deepEqual(f.calls,[],'no publish after key release');
  assert.equal(f.mic.state().active,false);
});

test('v0.5E: release gates audio immediately during delayed LiveKit publish and leaves pub muted',async t=>{
  const gate=deferred();
  let f; f=setup(t,{publish:()=>gate.promise});
  f.mic.setWanted(true);
  while(!f.calls.includes('publish'))await new Promise(r=>setImmediate(r));
  const track=f.tracks[0];
  f.mic.setWanted(false);
  assert.equal(track.enabled,false,'audio gate closes before any LiveKit ACK');
  gate.resolve(f.pub);
  await f.mic.idle();
  assert.equal(track.enabled,false);
  assert.equal(f.pub.isMuted,true);
  assert.equal(f.mic.state().active,false);
});

test('v0.5E: rapid ON/OFF/ON is serialized and ends with exactly one published track',async t=>{
  const f=setup(t);
  f.mic.setWanted(true);f.mic.setWanted(false);f.mic.setWanted(true);
  await f.mic.idle();
  assert.equal(f.calls.filter(x=>x==='publish').length,1);
  assert.equal(f.mic.state().active,true);
  assert.equal(f.tracks[0].enabled,true);
  f.mic.setWanted(false);assert.equal(f.tracks[0].enabled,false);
  await f.mic.idle();assert.equal(f.pub.isMuted,true);
});

test('v0.5E: releasing PTT while LiveKit unmute is pending remains muted',async t=>{
  const gate=deferred();const f=setup(t);
  f.pub.unmute=async()=>{f.calls.push('unmute');await gate.promise;f.pub.isMuted=false;};
  f.mic.setWanted(true);
  while(!f.calls.includes('unmute'))await new Promise(r=>setImmediate(r));
  f.mic.setWanted(false);
  gate.resolve();await f.mic.idle();
  assert.equal(f.mic.state().active,false);
  assert.equal(f.tracks[0].enabled,false);
  assert.equal(f.pub.isMuted,true);
});

test('v0.5E: switching mic devices retires publication and track before republishing',async t=>{
  const f=setup(t);f.mic.setWanted(true);await f.mic.idle();
  const old=f.tracks[0];f.mic.restartTrack();assert.equal(old.enabled,false);
  await f.mic.idle();
  assert.equal(old.stopped,true);
  assert.equal(f.calls.filter(x=>x==='unpublish').length,1);
  assert.equal(f.calls.filter(x=>x==='publish').length,2);
  assert.equal(f.tracks[1].enabled,true);
});

test('v0.5E: room swap while publish is pending cannot attach old-room publication',async t=>{
  const gate=deferred();const f=setup(t,{publish:()=>gate.promise});
  f.mic.setWanted(true);
  while(!f.calls.includes('publish'))await new Promise(r=>setImmediate(r));
  const track=f.tracks[0];
  const newPub={track:{},async mute(){},async unmute(){}};
  const newRoom={localParticipant:{async publishTrack(){f.calls.push('publish-new');return newPub;},async unpublishTrack(){}}};
  f.mic.setRoom(newRoom);assert.equal(track.enabled,false);
  gate.resolve(f.pub);await f.mic.idle();
  assert.ok(f.calls.includes('unpublish'));
  assert.ok(f.calls.includes('publish-new'));
  assert.equal(f.mic.state().active,true);
});

test('v0.5E: browser blur/hidden releases held Space and media meters stop with no tracks',()=>{
  assert.match(src,/window\.addEventListener\('blur'/);
  assert.match(src,/document\.addEventListener\('visibilitychange'/);
  assert.match(src,/if\(pttDown\)\{pttDown=false;setMicIntent\(\);\}/);
  assert.match(src,/if\(!meters\.size&&meterFrame\)\{cancelAnimationFrame\(meterFrame\)/);
  assert.match(src,/previous\.source\.disconnect\(\)/);
  assert.doesNotMatch(src,/requestAnimationFrame\(tickMeters\);\s*\/\* ---------- microphone/);
});


test('v0.5E: rapid watch ON/OFF overrides an in-flight subscription request',()=>{
  const body=src.match(/function requestWatch\(pub:any,wanted:boolean,LK:any\)\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body,'subscription implementation found');
  const request=new Function('pub','wanted','LK','watchRequests',body);
  const calls=[];
  const pub={isSubscribed:false,_fcLow:false,setSubscribed(v){calls.push(['subscribe',v]);},setVideoQuality(v){calls.push(['quality',v]);}};
  const requested=new WeakMap(),LK={VideoQuality:{LOW:0}};
  request(pub,true,LK,requested);request(pub,true,LK,requested);
  // SDK still says false because its first request has not finished.
  request(pub,false,LK,requested);request(pub,false,LK,requested);
  assert.deepEqual(calls,[['subscribe',true],['quality',0],['subscribe',false]]);
});

test('v0.5E: camera subscription rejects removed roster players and releases video immediately on OFF',()=>{
  assert.match(src,/const allowed=new Set\(grant\.roster\.map\(p=>p\.playerId\)\)/);
  assert.match(src,/if\(!videoTrack&&video\._track\)\{try\{video\._track\.detach\(video\)/);
  assert.match(src,/video\.srcObject=null/);
  assert.match(src,/watchRequests=new WeakMap\(\)/,'reconnect invalidates subscription cache');
});
