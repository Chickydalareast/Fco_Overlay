declare global { interface Window {LivekitClient?:any} }

/**
 * v0.4C Player Camera Room (Vietnamese).
 * Flow: open camera -> pick team + player -> send request -> operator approves
 * -> camera published (video only). Camera must be landscape: an upright phone
 * cannot send a request, and turning it upright while live pauses the camera
 * (the broadcast shows the league-logo placeholder) until it is turned back.
 */
type RoomTeam={side:'A'|'B';teamId:string;name:string;clubLogo:string;players:{id:string;name:string;slot:number}[]};
type Tone='idle'|'wait'|'ok'|'bad';
const root=document.getElementById('room-app')!;
const params=new URL(location.href).searchParams;
const invite=params.get('invite')||'',boId=params.get('bo')||'';
let teams:RoomTeam[]=[];
let stream:MediaStream|null=null;        // published track lives here
let preview:MediaStream|null=null;       // clone, so pausing the broadcast never blanks the preview
let room:any=null;
let socket:WebSocket|null=null;
let presenceSession='';
let joined=false;
let closing=false;
let paused=false;
let wakeLock:any=null;
let retryTimer=0,pollTimer=0;
let pending:{requestId:string;claim:string}|null=null;
const pendingKey=(playerId:string)=>`fc-camera-pending:${boId}:${playerId}`;

root.innerHTML=`<main class="room">
  <header class="room-head">
    <img src="/assets/brand/league-logo.png" alt="" class="room-logo" />
    <div><div class="room-kicker">PHÒNG CAMERA TUYỂN THỦ</div><div class="room-match" id="room-match">Đang tải trận đấu…</div></div>
  </header>
  <section class="room-preview" id="preview-box" data-state="off">
    <video id="self-video" autoplay muted playsinline></video>
    <div class="preview-off"><p>Camera chưa bật</p><button id="camera-on" class="btn btn-light">Bật camera</button></div>
    <div class="preview-portrait"><div class="rotate-icon" aria-hidden="true"></div><p>Xoay ngang điện thoại</p><span>Camera chỉ nhận khung hình ngang</span></div>
    <div class="preview-tag" id="preview-tag">XEM TRƯỚC</div>
  </section>
  <section class="room-form">
    <label>Đội<select id="team" disabled><option value="">Đang tải…</option></select></label>
    <label>Tuyển thủ<select id="player" disabled><option value="">Chọn đội trước</option></select></label>
    <label class="wide">Camera<select id="device"><option value="">Camera mặc định</option></select></label>
  </section>
  <div class="room-status" id="room-status" data-tone="idle"><i></i><span>Đang tải phòng…</span></div>
  <section class="room-audio" id="room-audio" hidden>
    <div class="audio-head"><span class="audio-dot" id="btc-speaking"></span><strong>Âm thanh từ BTC</strong><span class="audio-state" id="btc-state">Chưa có BTC trong phòng</span></div>
    <div class="audio-row">
      <button id="btc-mute" class="btn btn-ghost btn-small" type="button">Tắt tiếng</button>
      <input id="btc-volume" type="range" min="0" max="100" step="5" aria-label="Âm lượng BTC" />
      <span id="btc-volume-label" class="audio-value">80%</span>
    </div>
    <button id="btc-unlock" class="btn btn-light btn-small" type="button" hidden>Bấm để bật âm thanh</button>
  </section>
  <button id="join" class="btn btn-red" disabled>Gửi yêu cầu vào phòng</button>
  <button id="leave" class="btn btn-ghost" disabled>Tắt camera</button>
  <ul class="room-notes">
    <li>Giữ tab này mở suốt trận. Không cần micro. BTC có thể nói với bạn qua tab này.</li>
    <li>Điện thoại: đặt nằm ngang, cắm sạc, không tắt màn hình.</li>
    <li>Hình xem trước bị lật như gương; trên sóng hiển thị bình thường.</li>
  </ul>
</main>`;
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const joinButton=el<HTMLButtonElement>('join'),leaveButton=el<HTMLButtonElement>('leave');
const cameraButton=el<HTMLButtonElement>('camera-on');
const teamSelect=el<HTMLSelectElement>('team'),playerSelect=el<HTMLSelectElement>('player');
const device=el<HTMLSelectElement>('device'),video=el<HTMLVideoElement>('self-video');
const previewBox=el<HTMLElement>('preview-box'),previewTag=el<HTMLElement>('preview-tag');

/** Server messages are English; players see Vietnamese. */
const VI:Record<string,string>={
  'Invalid room invite':'Link phòng không hợp lệ. Xin BTC gửi lại link mới.',
  'This BO room is unavailable or has changed. Ask the operator for a new link.':'Trận này đã đổi hoặc đã kết thúc. Xin BTC gửi lại link mới.',
  'LiveKit is not configured':'Hệ thống camera chưa sẵn sàng. Báo BTC.',
  'Choose an allowed team and player for the active BO':'Chọn đúng đội và tên của bạn trong trận hiện tại.',
  'This player camera is already online. Ask the operator to REVOKE it first.':'Camera của bạn đang online ở thiết bị khác. Báo BTC tắt camera cũ trước.',
  'This player already has a pending request. Ask the operator to review it.':'Bạn đã gửi yêu cầu rồi, đang chờ BTC duyệt.',
  'Request expired or not found':'Yêu cầu đã hết hạn. Gửi lại yêu cầu.',
  'Request not found':'Không tìm thấy yêu cầu. Gửi lại yêu cầu.',
  'BO has changed':'Trận đã đổi. Xin BTC gửi lại link mới.',
  'Too many join attempts':'Bạn thử quá nhiều lần. Đợi một chút rồi thử lại.',
  'Invalid join request':'Yêu cầu không hợp lệ. Tải lại trang và thử lại.'
};
const vi=(message:string)=>VI[message]??message;
function setStatus(message:string,tone:Tone='idle'){
  const box=el<HTMLElement>('room-status');box.dataset.tone=tone;box.querySelector('span')!.textContent=message;
}
const landscape=()=>!video.videoWidth||video.videoWidth>=video.videoHeight;
function previewState(){
  previewBox.dataset.state=!stream?'off':!landscape()?'portrait':'on';
  previewTag.textContent=joined?(paused?'TẠM DỪNG':'ĐÃ KẾT NỐI'):'XEM TRƯỚC';
  previewTag.dataset.live=String(joined&&!paused);
}
function refreshControls(){
  const ready=!!stream&&landscape()&&!!playerSelect.value&&!joined&&!pending;
  joinButton.disabled=!ready;
  joinButton.hidden=joined;
  leaveButton.disabled=!stream&&!pending&&!joined;
  teamSelect.disabled=!teams.length||joined||!!pending;
  playerSelect.disabled=!teamSelect.value||joined||!!pending;
  device.disabled=joined||!!pending;
  if(!joined&&!pending&&playerSelect.value)
    joinButton.textContent=sessionStorage.getItem(pendingKey(playerSelect.value))?'Tiếp tục yêu cầu đã gửi':'Gửi yêu cầu vào phòng';
  previewState();
}
function hint(){
  if(joined||pending)return;
  if(!stream)setStatus('Bấm "Bật camera" để kiểm tra hình.');
  else if(!landscape())setStatus('Camera đang dọc. Xoay ngang điện thoại để tiếp tục.','bad');
  else if(!playerSelect.value)setStatus('Chọn đội và tên của bạn.');
  else setStatus('Sẵn sàng. Bấm "Gửi yêu cầu vào phòng".');
}
function updateRoster(){
  const previous=playerSelect.value,team=teams.find(t=>t.teamId===teamSelect.value);
  playerSelect.replaceChildren(new Option(team?'Chọn tên của bạn':'Chọn đội trước',''));
  for(const p of team?.players??[])playerSelect.add(new Option(p.name,p.id));
  if(team?.players.some(p=>p.id===previous))playerSelect.value=previous;
  refreshControls();hint();
}
async function loadRoom(){
  if(!invite||!boId){setStatus('Link thiếu hoặc đã hết hạn. Xin BTC gửi lại link phòng.','bad');return;}
  try{
    const r=await fetch(`/api/camera/room-options?invite=${encodeURIComponent(invite)}&bo=${encodeURIComponent(boId)}`,{cache:'no-store'});
    const data=await r.json();if(!r.ok)throw new Error(data.error||'Room is unavailable');
    teams=data.teams;
    const a=teams.find(t=>t.side==='A'),b=teams.find(t=>t.side==='B');
    el<HTMLElement>('room-match').textContent=a&&b?`${a.teamId} ${a.name}  vs  ${b.teamId} ${b.name}`:'Trận hiện tại';
    teamSelect.replaceChildren(new Option('Chọn đội',''));
    for(const t of teams)teamSelect.add(new Option(`${t.teamId} - ${t.name}`,t.teamId));
    teamSelect.addEventListener('change',updateRoster);
    playerSelect.addEventListener('change',updateRoster);
    updateRoster();
  }catch(e){setStatus(vi(e instanceof Error?e.message:'Phòng không khả dụng'),'bad');}
}
async function populateDevices(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  try{
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    const old=device.value;device.replaceChildren(new Option('Camera mặc định',''));
    devices.forEach((d,i)=>device.add(new Option(d.label||`Camera ${i+1}`,d.deviceId)));
    if([...device.options].some(x=>x.value===old))device.value=old;
  }catch{}
}
function releaseCamera(){
  stream?.getTracks().forEach(t=>t.stop());preview?.getTracks().forEach(t=>t.stop());
  stream=null;preview=null;video.srcObject=null;
}
async function openCamera(){
  if(!navigator.mediaDevices?.getUserMedia){setStatus('Trình duyệt cần HTTPS để mở camera.','bad');return;}
  cameraButton.disabled=true;
  try{
    releaseCamera();
    setStatus('Đang xin quyền camera…','wait');
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{
      width:{ideal:640},height:{ideal:360},aspectRatio:{ideal:16/9},frameRate:{ideal:20,max:20},
      ...(device.value?{deviceId:{exact:device.value}}:{})}});
    const track=stream.getVideoTracks()[0]!;
    preview=new MediaStream([track.clone()]);
    video.srcObject=preview;await video.play().catch(()=>{});
    await populateDevices();
    track.addEventListener('ended',()=>{if(!closing)setStatus('Mất camera (bị rút hoặc app khác đang dùng). Bấm "Tắt camera" rồi bật lại.','bad');});
    refreshControls();hint();
  }catch(e){
    releaseCamera();refreshControls();
    const name=e instanceof DOMException?e.name:'';
    setStatus(name==='NotAllowedError'?'Bạn chưa cho phép dùng camera. Bật quyền camera trong trình duyệt rồi thử lại.'
      :name==='NotReadableError'?'Camera đang bị app khác dùng. Tắt app đó rồi thử lại.'
      :name==='NotFoundError'||name==='OverconstrainedError'?'Không tìm thấy camera này. Chọn camera khác.'
      :'Không mở được camera.','bad');
  }finally{cameraButton.disabled=false;}
}
/** Landscape guard: pause / resume the published camera when the phone turns. */
async function onOrientation(){
  refreshControls();
  if(!joined){hint();return;}
  const LK=window.LivekitClient;
  const publication=room?.localParticipant?.getTrackPublication?.(LK?.Track?.Source?.Camera);
  const shouldPause=!landscape();
  if(shouldPause===paused||!publication)return;
  paused=shouldPause;
  try{if(paused)await publication.mute();else await publication.unmute();}catch{}
  previewState();
  setStatus(paused?'Camera tạm dừng vì đang dọc. Xoay ngang để lên hình lại.':'Đã kết nối. BTC sẽ bật camera của bạn lên sóng khi cần.',paused?'bad':'ok');
}
async function keepAwake(on:boolean){
  try{
    if(on&&!wakeLock&&(navigator as any).wakeLock)wakeLock=await (navigator as any).wakeLock.request('screen');
    if(!on&&wakeLock){await wakeLock.release();wakeLock=null;}
  }catch{wakeLock=null;}
}
async function stop(message='Đã tắt camera. Bạn có thể bật lại và gửi yêu cầu mới.'){
  closing=true;clearTimeout(pollTimer);clearTimeout(retryTimer);
  if(pending){
    const {requestId,claim}=pending;
    sessionStorage.removeItem(pendingKey(playerSelect.value));
    void fetch('/api/camera/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,claim})}).catch(()=>{});
  }
  try{socket?.close();}catch{}socket=null;
  if(room){try{await room.disconnect();}catch{}room=null;}
  clearAudio();
  releaseCamera();void keepAwake(false);
  pending=null;presenceSession='';joined=false;paused=false;
  closing=false;refreshControls();setStatus(message);
}
let presenceRetry=0,mediaRetry=0;
function endedByOperator(message:string){
  void stop(message).then(()=>{joinButton.disabled=true;teamSelect.disabled=true;playerSelect.disabled=true;setStatus(message,'bad');});
}
function connectPresence(){
  if(!presenceSession||closing)return;
  const scheme=location.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(`${scheme}//${location.host}/ws?role=player&session=${encodeURIComponent(presenceSession)}`);
  socket=ws;
  ws.onopen=()=>{presenceRetry=0;ws.send(JSON.stringify({type:'camera.status',published:joined}));};
  ws.onmessage=event=>{
    try{if(JSON.parse(event.data)?.type==='camera.session.ended'){
      // Approval revoked, replaced by another device, or BO ended. Check which.
      void checkSessionStillValid();
    }}catch{}
  };
  // Backoff: a Node restart must not make every player hammer the server.
  ws.onclose=()=>{if(socket!==ws||closing||!joined)return;retryTimer=window.setTimeout(connectPresence,Math.min(15000,1500*(2**Math.min(presenceRetry++,4))));};
  ws.onerror=()=>ws.close();
}
async function fetchStatus(){
  if(!pending)throw new Error('No camera request');
  const r=await fetch(`/api/camera/join-status?requestId=${encodeURIComponent(pending.requestId)}&claim=${encodeURIComponent(pending.claim)}`,{cache:'no-store'});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'Request unavailable');
  return data;
}
const statusMessage=(status:string,error?:string)=>status==='revoked'?'BTC đã tắt camera của bạn. Hỏi BTC nếu đây là nhầm lẫn.'
  :status==='replaced'?'Camera của bạn đã được thay bằng thiết bị khác.'
  :status==='expired'?'Trận đã kết thúc. Xin BTC gửi link phòng mới.'
  :status==='rejected'?'BTC đã từ chối yêu cầu. Kiểm tra lại đội và tên rồi gửi lại.'
  :error?vi(error):'Yêu cầu không còn hiệu lực. Hỏi BTC.';
async function checkSessionStillValid(){
  try{const data=await fetchStatus();if(data.status!=='approved')endedByOperator(statusMessage(data.status,data.error));}
  catch(e){endedByOperator(vi(e instanceof Error?e.message:'Phiên camera đã kết thúc'));}
}
/* ---- v0.4D: hear the BTC (operators). Only audio from admin-* identities. ---- */
const ADMIN_PREFIX='admin-';
const audioBox=el<HTMLElement>('room-audio'),volumeInput=el<HTMLInputElement>('btc-volume');
const muteButton=el<HTMLButtonElement>('btc-mute'),unlockButton=el<HTMLButtonElement>('btc-unlock');
const audioEls=new Map<string,{track:any;element:HTMLMediaElement}>();
let volume=Number(localStorage.getItem('fc-btc-volume')??'80');if(!Number.isFinite(volume))volume=80;
let muted=localStorage.getItem('fc-btc-muted')==='1';
function applyVolume(){
  volumeInput.value=String(volume);el<HTMLElement>('btc-volume-label').textContent=muted?'Tắt':`${volume}%`;
  muteButton.textContent=muted?'Bật tiếng':'Tắt tiếng';
  for(const {track,element} of audioEls.values()){
    try{track.setVolume?.(muted?0:volume/100);}catch{}
    element.muted=muted;element.volume=muted?0:volume/100;
  }
}
function adminAudioState(){
  const r=room;if(!r){audioBox.hidden=true;return;}
  audioBox.hidden=false;
  const admins=[...r.remoteParticipants.values()].filter((p:any)=>p.identity.startsWith(ADMIN_PREFIX));
  el<HTMLElement>('btc-state').textContent=!admins.length?'Chưa có BTC trong phòng':audioEls.size?'Đang nghe BTC':'BTC đã vào phòng';
  unlockButton.hidden=r.canPlaybackAudio!==false;
}
function subscribeAdminAudio(){
  const r=room;const LK=window.LivekitClient;if(!r||!LK)return;
  for(const participant of r.remoteParticipants.values()){
    if(!participant.identity.startsWith(ADMIN_PREFIX))continue;
    for(const publication of participant.trackPublications.values()){
      if(publication.kind===LK.Track.Kind.Audio&&!publication.isSubscribed)publication.setSubscribed(true);
    }
  }
  adminAudioState();
}
function wireAudio(next:any,LK:any){
  next.on(LK.RoomEvent.ParticipantConnected,subscribeAdminAudio);
  next.on(LK.RoomEvent.TrackPublished,subscribeAdminAudio);
  next.on(LK.RoomEvent.ParticipantDisconnected,adminAudioState);
  next.on(LK.RoomEvent.TrackSubscribed,(track:any,publication:any,participant:any)=>{
    if(track.kind!==LK.Track.Kind.Audio||!participant.identity.startsWith(ADMIN_PREFIX))return;
    const element=track.attach() as HTMLMediaElement;element.hidden=true;document.body.append(element);
    audioEls.set(publication.trackSid,{track,element});applyVolume();adminAudioState();
  });
  next.on(LK.RoomEvent.TrackUnsubscribed,(track:any,publication:any)=>{
    const entry=audioEls.get(publication.trackSid);if(!entry)return;
    try{track.detach(entry.element);}catch{}entry.element.remove();audioEls.delete(publication.trackSid);adminAudioState();
  });
  next.on(LK.RoomEvent.ActiveSpeakersChanged,(speakers:any[])=>{
    el<HTMLElement>('btc-speaking').dataset.on=String(speakers.some(p=>p.identity?.startsWith(ADMIN_PREFIX)));
  });
  next.on(LK.RoomEvent.AudioPlaybackStatusChanged,adminAudioState);
}
function clearAudio(){
  for(const {track,element} of audioEls.values()){try{track.detach(element);}catch{}element.remove();}
  audioEls.clear();audioBox.hidden=true;
}
volumeInput.addEventListener('input',()=>{volume=Number(volumeInput.value);muted=false;localStorage.setItem('fc-btc-volume',String(volume));localStorage.setItem('fc-btc-muted','0');applyVolume();});
muteButton.addEventListener('click',()=>{muted=!muted;localStorage.setItem('fc-btc-muted',muted?'1':'0');applyVolume();});
unlockButton.addEventListener('click',()=>{void room?.startAudio?.().then(adminAudioState);});
applyVolume();

async function connectMedia(data:any){
  const LK=window.LivekitClient;
  if(!LK)throw new Error('Không tải được thư viện camera. Tải lại trang.');
  const track=stream?.getVideoTracks()[0];
  if(!track||track.readyState==='ended')throw new Error('Mất camera. Bấm "Tắt camera" rồi bật lại.');
  // v0.4D: dynacast pauses the small layer while no BTC is watching.
  const next=new LK.Room({autoSubscribe:false,adaptiveStream:false,dynacast:true});
  room=next;
  wireAudio(next,LK);
  next.on(LK.RoomEvent.Disconnected,(reason:unknown)=>{
    if(closing||room!==next)return;
    joined=false;room=null;clearAudio();refreshControls();
    const R=LK.DisconnectReason||{};
    if(reason===R.DUPLICATE_IDENTITY){endedByOperator(statusMessage('replaced'));return;}
    if(reason===R.PARTICIPANT_REMOVED){endedByOperator(statusMessage('revoked'));return;}
    if(reason===R.ROOM_DELETED){endedByOperator(statusMessage('expired'));return;}
    // Network drop: rejoin automatically while the approval is still valid.
    setStatus('Mất kết nối, đang tự nối lại…','bad');
    scheduleMediaRejoin();
  });
  await next.connect(data.url,data.token,{autoSubscribe:false});
  if(room!==next||closing){try{await next.disconnect();}catch{}return;}
  // v0.4D: two layers. OBS takes the 640x360 layer; the BTC room watches the
  // small 320x180 layer to save LiveKit bandwidth.
  const small=LK.VideoPresets?.h180??new LK.VideoPreset(320,180,150000,15);
  const publication=await next.localParticipant.publishTrack(track,{
    source:LK.Track.Source.Camera,simulcast:true,videoSimulcastLayers:[small],videoEncoding:{maxBitrate:700000,maxFramerate:20}
  });
  subscribeAdminAudio();
  joined=true;mediaRetry=0;presenceSession=data.session;
  paused=!landscape();
  if(paused)try{await publication?.mute?.();}catch{}
  void keepAwake(true);
  refreshControls();
  setStatus(paused?'Camera tạm dừng vì đang dọc. Xoay ngang để lên hình lại.':'Đã kết nối. BTC sẽ bật camera của bạn lên sóng khi cần.',paused?'bad':'ok');
  if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'camera.status',published:true}));
  else connectPresence();
}
function scheduleMediaRejoin(){
  clearTimeout(pollTimer);
  pollTimer=window.setTimeout(async()=>{
    if(closing||!pending)return;
    try{
      const data=await fetchStatus();
      if(data.status!=='approved'){endedByOperator(statusMessage(data.status,data.error));return;}
      await connectMedia(data);
    }catch(e){
      if(e instanceof Error&&/Mất camera/.test(e.message)){endedByOperator(e.message);return;}
      setStatus('Vẫn đang nối lại… giữ tab này mở.','bad');scheduleMediaRejoin();
    }
  },Math.min(15000,2000*(2**Math.min(mediaRetry++,3))));
}
async function checkApproval(){
  if(!pending||closing)return;
  try{
    const data=await fetchStatus();
    if(data.status==='pending'){
      setStatus('Đang chờ BTC duyệt… giữ tab này mở.','wait');
      pollTimer=window.setTimeout(()=>{void checkApproval();},1500);return;
    }
    if(data.status!=='approved')throw new Error(statusMessage(data.status,data.error));
    setStatus('Đã duyệt. Đang kết nối camera…','wait');
    await connectMedia(data);
  }catch(err){const message=err instanceof Error?vi(err.message):'Không vào được phòng';await stop(message);setStatus(message,'bad');}
}
joinButton.addEventListener('click',async()=>{
  const teamId=teamSelect.value,playerId=playerSelect.value;
  if(!teams.find(t=>t.teamId===teamId)?.players.some(p=>p.id===playerId))return;
  if(!stream||!landscape()){hint();return;}
  if(!window.LivekitClient){setStatus('Không tải được thư viện camera. Tải lại trang.','bad');return;}
  joinButton.disabled=true;closing=false;
  try{
    const saved=sessionStorage.getItem(pendingKey(playerId));
    if(saved){
      try{pending=JSON.parse(saved) as {requestId:string;claim:string};}
      catch{sessionStorage.removeItem(pendingKey(playerId));}
    }
    if(!pending){
      setStatus('Đang gửi yêu cầu…','wait');
      const r=await fetch('/api/camera/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invite,boId,teamId,playerId})});
      const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');
      pending={requestId:data.requestId,claim:data.claim};
      sessionStorage.setItem(pendingKey(playerId),JSON.stringify(pending));
    }
    refreshControls();
    await checkApproval();
  }catch(err){const message=err instanceof Error?vi(err.message):'Gửi yêu cầu thất bại';pending=null;refreshControls();setStatus(message,'bad');}
});
cameraButton.addEventListener('click',()=>{void openCamera();});
device.addEventListener('change',()=>{if(stream&&!joined&&!pending)void openCamera();});
leaveButton.addEventListener('click',()=>{void stop();});
for(const event of ['resize','loadedmetadata'])video.addEventListener(event,()=>{void onOrientation();});
window.addEventListener('orientationchange',()=>window.setTimeout(()=>{void onOrientation();},300));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&joined)void keepAwake(true);});
window.addEventListener('pagehide',()=>{closing=true;releaseCamera();socket?.close();void room?.disconnect();});
void populateDevices();void loadRoom();refreshControls();
export {};
