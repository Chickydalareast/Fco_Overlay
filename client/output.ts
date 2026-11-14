import { mountStage } from './stage.js';
import { CameraReceiver } from './camera-receiver.js';
import { LiveConnection } from './realtime.js';
import { cloneProgram, SAMPLE_PROGRAM } from './contracts.js';

const root=document.getElementById('output-root')!;
const stage=mountStage(root,'output');
// OBS: one video layer per publisher, so adaptiveStream only risks pausing
// video when CEF reports the page hidden. Joins LiveKit only when needed.
const receiver=new CameraReceiver([stage],{adaptiveStream:false,videoQuality:'high'});
const initial=cloneProgram(SAMPLE_PROGRAM);
initial.layers.scoreboard.visible=false;
initial.layers.intro.visible=false;
initial.layers.history.visible=false;
stage.render(initial,false);
receiver.setComposition(stage,initial);
const params=new URL(location.href).searchParams;
const token=params.get('token')||'';
const label=(params.get('label')||'output').slice(0,24);
const connection=new LiveConnection('output',token,label);
let first=true;
let renderedRevision=-1;
let activeProgram=initial;
let layoutAcked=false;
let lastMediaSignature='';
const sendMediaStatus=()=>{
  if(!layoutAcked||renderedRevision<0)return;
  const {ready,waiting}=receiver.getReadiness(stage);
  const signature=JSON.stringify([renderedRevision,ready,waiting]);
  if(signature===lastMediaSignature)return;
  if(connection.send({type:'renderer.media',revision:renderedRevision,ready,waiting}))lastMediaSignature=signature;
};
receiver.onReadiness=changed=>{if(changed===stage)sendMediaStatus();};
connection.onStatus=(connected)=>{
  if(!connected){first=true;layoutAcked=false;lastMediaSignature='';}
};
connection.onEvent=(event)=>{
  if(event.type==='match.history.snapshot') {stage.setHistoryData(event.matchId,event.games,event.leftTeamId,event.rightTeamId);return;}
  if(event.type==='camera.roster') {stage.setCameraPlayers(event.players);receiver.setRoster(event.players);return;}
  if(event.type==='camera.prewarm') {if(event.boId===activeProgram.match.matchId)receiver.prewarm(45_000,event.playerIds??[]);return;}
  if (event.type==='program.state') {
    // A fresh OBS source settles at the authoritative visibility without replaying
    // an intro that may have played minutes earlier. Subsequent patches animate.
    layoutAcked=false;
    activeProgram=event.program;
    renderedRevision=event.program.revision;
    lastMediaSignature='';
    stage.render(event.program,!first);
    void receiver.setSession(event.program.match.matchId);
    receiver.setComposition(stage,event.program);
    first=false;
    // ACK confirms layout processing only. Camera media has a separate frame-status report.
    layoutAcked=connection.send({type:'renderer.ready',revision:renderedRevision});
    sendMediaStatus();
  }
};
connection.connect();
void receiver.connect(token);
window.addEventListener('pagehide',()=>{connection.close();void receiver.disconnect();stage.dispose();});
