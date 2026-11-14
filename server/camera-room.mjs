import crypto from 'node:crypto';

const nowSec=()=>Math.floor(Date.now()/1000);
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const sha256=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function signToken(key,secret,identity,name,video,extra={}) {
  const now=nowSec();
  // Short-lived join token: connected LiveKit clients refresh tokens themselves.
  const body={iss:key,sub:identity,name,iat:now,nbf:now-5,exp:now+600,video,...extra};
  const encoded=`${encode({alg:'HS256',typ:'JWT'})}.${encode(body)}`;
  return `${encoded}.${crypto.createHmac('sha256',secret).update(encoded).digest('base64url')}`;
}
const safeEqual=(a,b)=>{
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
};
const alphanumeric=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{5,120}$/.test(value);
export const CAMERA_SLOTS=Object.freeze(['A1','A2','B1','B2']);
export const validPlayerName=value=>typeof value==='string'&&value.trim().length>=2&&value.trim().length<=28&&!/[\x00-\x1f<>]/.test(value);
// v0.3F: camera slots bind to the stable tournament player ID (C10-P1), never
// to a per-join LiveKit identity. The publisher identity is derived from it.
export const validPlayerId=value=>typeof value==='string'&&/^C(?:[1-9]|1[0-6])-P[12]$/.test(value);
export const identityFor=playerId=>`player-${playerId}`;
/** v0.4D: operator identities in the media room (players subscribe to their audio only). */
export const ADMIN_PREFIX='admin-';
export const playerIdFromIdentity=identity=>{
  const m=typeof identity==='string'&&identity.match(/^player-(C(?:[1-9]|1[0-6])-P[12])$/);
  return m?m[1]:null;
};

/** In-memory admission store used by unit tests / non-SQLite mode. */
export function createMemoryCameraStore() {
  const rows=new Map();
  return {
    insert(r){rows.set(r.id,{...r});},
    update(id,patch){const r=rows.get(id);if(r)rows.set(id,{...r,...patch,updatedAt:Date.now()});},
    get(id){const r=rows.get(id);return r?{...r}:null;},
    bySession(hash){for(const r of rows.values())if(r.sessionHash===hash&&r.status==='approved')return {...r};return null;},
    list(boId){return [...rows.values()].filter(r=>r.boId===boId).sort((a,b)=>a.createdAt-b.createdAt).map(r=>({...r}));},
    expireOther(boId){for(const r of rows.values())if(r.boId!==boId&&['pending','approved'].includes(r.status))Object.assign(r,{status:'expired',error:'BO has changed',updatedAt:Date.now()});},
    prune(before){for(const [id,r] of rows)if(r.updatedAt<before&&r.status!=='approved')rows.delete(id);}
  };
}

/**
 * Camera room is scoped to a single on-air BO (Program.match.matchId).
 * The application VPS signs tokens; a managed LiveKit SFU transports video.
 * Admission is explicitly approved by the operator, persisted in SQLite, and
 * revocation is enforced on the SFU (RemoveParticipant / DeleteRoom).
 */
export function createCameraService({inviteSecret,livekitUrl,livekitKey,livekitSecret,roomName='fc-online-camera-primary',
  getProgram,registry,store=createMemoryCameraStore(),fetchImpl=globalThis.fetch,log=console}) {
  const enabled=!!(livekitUrl&&/^wss:\/\//.test(livekitUrl)&&livekitKey&&livekitSecret);
  const sessionKey=`${livekitSecret||''}:${inviteSecret}`;
  const presence=new Map(); // `${boId}:${playerId}` -> {connected,published,updatedAt}
  const adminCalls=new Set();
  let lastBoId=null;
  let lastPrune=0;
  const activeBo=()=>{
    const match=getProgram()?.match;
    if(!match?.matchId||!match.teamA?.teamId||!match.teamB?.teamId||match.teamA.teamId===match.teamB.teamId)return null;
    const teams=registry().teams;
    const mapSide=(side,teamId)=>{
      const team=teams.find(t=>t.id===teamId&&t.active);
      return team?{side,teamId,name:team.club.name,clubLogo:team.club.logo,players:team.players.filter(p=>p.active).map(p=>({id:p.id,name:p.displayName,slot:p.slot}))}:null;
    };
    const left=mapSide('A',match.teamA.teamId),right=mapSide('B',match.teamB.teamId);
    return left&&right?{id:match.matchId,teams:[left,right]}:null;
  };
  const mediaRoom=boId=>`${roomName}-${crypto.createHash('sha256').update(boId).digest('hex').slice(0,16)}`;
  // Player session = HMAC(server key, request ID + claim hash). Nothing that
  // grants access is stored in clear text in SQLite.
  const sessionFor=r=>crypto.createHmac('sha256',sessionKey).update(`${r.id}:${r.claimHash}`).digest('base64url');

  function liveKitAdmin(method,body,video) {
    if(!enabled||typeof fetchImpl!=='function')return Promise.resolve(false);
    const base=livekitUrl.replace(/^wss:/,'https:').replace(/\/+$/,'');
    const token=signToken(livekitKey,livekitSecret,'fc-studio-server','FC Studio server',video);
    const call=Promise.resolve().then(()=>fetchImpl(`${base}/twirp/livekit.RoomService/${method}`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify(body),signal:AbortSignal.timeout?.(5000)
    })).then(response=>{
      // 404 = participant/room already gone; that is the desired end state.
      if(!response.ok&&response.status!==404)log.warn?.(`[camera] LiveKit ${method} failed: HTTP ${response.status}`);
      return response.ok;
    }).catch(error=>{log.warn?.(`[camera] LiveKit ${method} error: ${error?.message||error}`);return false;});
    adminCalls.add(call);call.finally(()=>adminCalls.delete(call));
    return call;
  }
  const kick=(boId,playerId)=>liveKitAdmin('RemoveParticipant',{room:mediaRoom(boId),identity:identityFor(playerId)},{roomAdmin:true,room:mediaRoom(boId)});
  const closeRoom=boId=>liveKitAdmin('DeleteRoom',{room:mediaRoom(boId)},{roomCreate:true});

  function syncSession() {
    const current=activeBo()?.id||'';
    if(lastBoId===null){lastBoId=current;}
    else if(current!==lastBoId){
      const previous=lastBoId;lastBoId=current;
      store.expireOther(current);
      for(const key of presence.keys())if(!key.startsWith(`${current}:`))presence.delete(key);
      // Old BO publishers must not keep consuming SFU minutes or reappear.
      if(previous)void closeRoom(previous);
    }
    if(Date.now()-lastPrune>60_000){lastPrune=Date.now();store.prune(Date.now()-24*60*60*1000);}
    return current;
  }
  const approvedFor=(boId,playerId)=>store.list(boId).filter(r=>r.playerId===playerId&&r.status==='approved');
  function cameraRoster(){
    const bo=activeBo();syncSession();
    if(!bo)return [];
    const rows=store.list(bo.id);
    const out=[];
    for(const team of bo.teams)for(const p of team.players){
      const approved=rows.some(r=>r.playerId===p.id&&r.status==='approved');
      const pending=rows.some(r=>r.playerId===p.id&&r.status==='pending');
      const live=presence.get(`${bo.id}:${p.id}`)||{connected:false,published:false,updatedAt:0};
      out.push({identity:identityFor(p.id),playerId:p.id,name:p.name,team:team.side,teamId:team.teamId,rosterSlot:p.slot,
        status:approved?'approved':pending?'pending':'none',
        connected:approved&&live.connected,published:approved&&live.connected&&live.published,updatedAt:live.updatedAt});
    }
    return out;
  }
  function requestList(){
    const id=syncSession();if(!id)return [];
    const rows=store.list(id);
    return rows.filter(x=>x.status==='pending').map(({id,playerId,teamId,team,playerName,createdAt})=>({id,playerId,teamId,team,playerName,createdAt,
      replaces:rows.some(r=>r.playerId===playerId&&r.status==='approved')}));
  }
  return {
    enabled,activeBo,syncSession,mediaRoom,
    getConfig(){return {enabled,transport:'LiveKit managed WebRTC SFU',roomScope:'current BO'};},
    checkInvite(invite){return safeEqual(invite,inviteSecret);},
    getOptions({invite,boId}){
      if(!this.checkInvite(invite))return {error:'Invalid room invite'};
      const bo=activeBo();
      if(!bo||bo.id!==boId)return {error:'This BO room is unavailable or has changed. Ask the operator for a new link.'};
      return {boId:bo.id,teams:bo.teams,enabled};
    },
    getInvitePath(){const bo=activeBo();return bo?`/room?invite=${encodeURIComponent(inviteSecret)}&bo=${encodeURIComponent(bo.id)}`:null;},
    issueViewer(){
      const bo=activeBo();if(!enabled||!bo)return null;
      const identity=`viewer-${crypto.randomBytes(12).toString('hex')}`;
      return {url:livekitUrl,token:signToken(livekitKey,livekitSecret,identity,'OBS/Studio viewer',{
        roomJoin:true,room:mediaRoom(bo.id),canPublish:false,canSubscribe:true,canPublishData:false
      }),identity,boId:bo.id};
    },
    /**
     * v0.4D: operator (BTC) participant. Same media room as the players.
     * Publishes only audio (microphone + relayed app audio such as Discord),
     * watches the cameras at low quality. No limit on how many operators join.
     */
    issueAdmin(){
      const bo=activeBo();if(!enabled||!bo)return null;
      const identity=`${ADMIN_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
      return {url:livekitUrl,identity,boId:bo.id,teams:bo.teams,roster:cameraRoster(),
        token:signToken(livekitKey,livekitSecret,identity,'BTC',{
          roomJoin:true,room:mediaRoom(bo.id),canPublish:true,canPublishSources:['microphone','screen_share_audio'],canSubscribe:true,canPublishData:false
        })};
    },
    requestJoin({invite,boId,teamId,playerId}){
      if(!enabled)return {error:'LiveKit is not configured'};
      const options=this.getOptions({invite,boId});if(options.error)return options;
      const team=options.teams.find(x=>x.teamId===teamId);
      const player=team?.players.find(x=>x.id===playerId);
      if(!player)return {error:'Choose an allowed team and player for the active BO'};
      syncSession();
      const rows=store.list(boId).filter(r=>r.playerId===playerId);
      const online=rows.some(r=>r.status==='approved')&&presence.get(`${boId}:${playerId}`)?.connected;
      if(online)return {error:'This player camera is already online. Ask the operator to REVOKE it first.'};
      if(rows.some(r=>r.status==='pending'))return {error:'This player already has a pending request. Ask the operator to review it.'};
      const id=`join-${crypto.randomBytes(12).toString('hex')}`;
      const claim=crypto.randomBytes(24).toString('base64url');
      const now=Date.now();
      store.insert({id,boId,teamId,playerId,team:team.side,playerName:player.name,rosterSlot:player.slot,status:'pending',
        claimHash:sha256(claim),sessionHash:null,error:null,createdAt:now,updatedAt:now});
      return {requestId:id,claim,status:'pending',boId,playerName:player.name};
    },
    getRequestStatus({requestId,claim}){
      if(!alphanumeric(requestId)||typeof claim!=='string')return {error:'Invalid request'};
      const r=store.get(requestId);
      if(!r||!safeEqual(sha256(claim),r.claimHash))return {error:'Request expired or not found'};
      if(r.boId!==activeBo()?.id)return {status:'expired',error:'BO has changed'};
      if(r.status!=='approved')return {status:r.status,error:r.error||undefined};
      const identity=identityFor(r.playerId);
      return {status:'approved',identity,playerId:r.playerId,name:r.playerName,team:r.team,
        url:livekitUrl,session:sessionFor(r),room:mediaRoom(r.boId),
        token:signToken(livekitKey,livekitSecret,identity,r.playerName,{
          roomJoin:true,room:mediaRoom(r.boId),canPublish:true,canPublishSources:['camera'],canSubscribe:true,canPublishData:false
        },{metadata:JSON.stringify({playerId:r.playerId,teamId:r.teamId})})};
    },
    cancelRequest({requestId,claim}){
      if(!alphanumeric(requestId))return {error:'Request not found'};
      const r=store.get(requestId);
      if(!r||typeof claim!=='string'||!safeEqual(sha256(claim),r.claimHash))return {error:'Request not found'};
      if(!['pending','approved'].includes(r.status))return {ok:true,status:r.status};
      store.update(r.id,{status:'cancelled'});
      if(r.status==='approved'){presence.delete(`${r.boId}:${r.playerId}`);void kick(r.boId,r.playerId);}
      return {ok:true,status:'cancelled'};
    },
    reviewRequest({requestId,approved}){
      if(!alphanumeric(requestId)||typeof approved!=='boolean')return {error:'Invalid operator review'};
      const r=store.get(requestId);
      if(!r||r.status!=='pending'||r.boId!==activeBo()?.id)return {error:'No pending request for current BO'};
      if(!approved){store.update(r.id,{status:'rejected'});return {ok:true,status:'rejected'};}
      // Exactly one approved session per player: a new approval replaces the
      // old one. LiveKit also disconnects the old tab (same identity).
      const replaced=approvedFor(r.boId,r.playerId);
      for(const old of replaced)store.update(old.id,{status:'replaced',error:'Replaced by a newer approved device'});
      store.update(r.id,{status:'approved',sessionHash:sha256(sessionFor(r))});
      return {ok:true,status:'approved',identity:identityFor(r.playerId),playerId:r.playerId,replaced:replaced.length};
    },
    revoke({playerId}){
      const bo=activeBo();
      if(!bo||!validPlayerId(playerId))return {error:'No such player in the current BO'};
      const rows=store.list(bo.id).filter(r=>r.playerId===playerId&&['approved','pending'].includes(r.status));
      for(const r of rows)store.update(r.id,{status:'revoked',error:'Revoked by operator'});
      presence.delete(`${bo.id}:${playerId}`);
      void kick(bo.id,playerId);
      return {ok:true,revoked:rows.length};
    },
    authenticatePlayer(session){
      if(typeof session!=='string'||session.length>200)return null;
      const r=store.bySession(sha256(session));
      return r&&r.boId===activeBo()?.id?r.playerId:null;
    },
    updatePlayer(playerId,patch){
      const bo=activeBo();
      if(!bo||!validPlayerId(playerId)||!approvedFor(bo.id,playerId).length)return false;
      const key=`${bo.id}:${playerId}`;
      const p=presence.get(key)||{connected:false,published:false,updatedAt:0};
      if(typeof patch.connected==='boolean')p.connected=patch.connected;
      if(typeof patch.published==='boolean')p.published=patch.published;
      p.updatedAt=Date.now();presence.set(key,p);return true;
    },
    roster:cameraRoster,pending:requestList,
    flushAdmin(){return Promise.all([...adminCalls]);}
  };
}
