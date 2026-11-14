import type {CameraPlayer,CameraSlot,Program} from './contracts.js';
import {CAMERA_SLOTS,defaultSlotPlayer,identityForPlayer,playerIdFromIdentity,teammateOf} from './contracts.js';
import type {StageHandle} from './stage.js';
declare global {interface Window {LivekitClient?:any}}

export interface ReceiverOptions {
  /** LiveKit adaptiveStream. Off by default: publishers send one layer only. */
  adaptiveStream?: boolean;
  /** Disconnect from the SFU after this long with no visible camera slot. */
  idleMs?: number;
  /** Keep the last frame attached while a tile plays its exit animation. */
  exitHoldMs?: number;
  /** SFU simulcast layer requested by this browser. OBS=high, Studio=low. */
  videoQuality?: 'low'|'medium'|'high';
}
export interface MediaPresence {playerId:string;hasVideo:boolean;subscribed:boolean}
export interface CameraReadiness {ready:CameraSlot[];waiting:CameraSlot[]}

/**
 * One LiveKit room per browser. WebRTC feeds never pass through the app VPS.
 * v0.3F: which players are publishing is read from the SFU itself (identity
 * player-<playerId> is signed by the server), so OBS keeps showing cameras even
 * if the Node server restarts. The room is joined only while a camera slot is
 * visible (or pre-warmed) to save LiveKit participant minutes.
 */
export class CameraReceiver {
  private room:any=null;
  private stages:StageHandle[];
  private tracked=new Map<HTMLVideoElement,any>();
  private hideTimers=new Map<HTMLVideoElement,number>();
  private live=new Map<HTMLVideoElement,boolean>();
  private assignments=new Map<StageHandle,Program>();
  private token?:string;
  private boId='';
  private epoch=0;
  private connecting=false;
  private reconnectTimer=0;
  private idleTimer=0;
  private retry=0;
  private graceTimer=0;
  private warmUntil=0;
  private warmTimer=0;
  private lastMedia='';
  private desiredSince=new Map<string,number>();
  // A publication is an SDK object, NOT a trackSid. A fresh Room after reconnect
  // may reuse the same trackSid with a new publication that needs a fresh subscribe.
  private subscriptionRequests=new WeakMap<object,boolean>();
  private warmIdentities=new Set<string>();
  private readyByStage=new Map<StageHandle,Map<CameraSlot,boolean>>();
  private frameGeneration=new WeakMap<HTMLVideoElement,number>();
  private readonly graceMs=7000;
  private readonly idleMs:number;
  private readonly exitHoldMs:number;
  private readonly adaptiveStream:boolean;
  private readonly videoQuality:'low'|'medium'|'high';
  private monitoringEnabled=true;
  onStatus:(message:string)=>void=()=>{};
  onMedia:(players:MediaPresence[])=>void=()=>{};
  onReadiness:(stage:StageHandle,state:CameraReadiness)=>void=()=>{};
  constructor(stages:StageHandle[],options:ReceiverOptions={}){
    this.stages=stages;
    this.idleMs=options.idleMs??180_000;
    this.exitHoldMs=options.exitHoldMs??750;
    this.adaptiveStream=options.adaptiveStream??false;
    this.videoQuality=options.videoQuality??'high';
  }

  async connect(outputToken?:string){
    this.token=outputToken;
    if(!this.boId)this.onStatus('Waiting for current BO session');
    this.sync();
  }
  async setSession(boId?:string){
    const next=boId||'';
    if(next===this.boId)return;
    this.boId=next;
    this.retry=0;
    await this.teardown();
    this.sync();
  }
  /** Kept for compatibility; media presence now comes from the SFU. */
  setRoster(_players:CameraPlayer[]){this.sync();}
  setComposition(stage:StageHandle,program:Program){
    this.assignments.set(stage,program);this.sync();this.reportReadiness(stage);
  }
  /** Subscribe the *specific* upcoming camera feeds, not just the empty SFU room.
   * Prewarm is short-lived: Studio can reissue it on a new preview cue. */
  prewarm(ms=45_000,playerIds:string[]=[]){
    const duration=Math.max(0,ms);
    this.warmUntil=Date.now()+duration;
    this.warmIdentities=new Set(playerIds.filter(id=>/^[A-Za-z0-9_-]+-P[12]$/.test(id)).map(identityForPlayer));
    window.clearTimeout(this.warmTimer);
    this.warmTimer=window.setTimeout(()=>{
      this.warmTimer=0;
      if(Date.now()<this.warmUntil)return; // replaced by a newer prewarm
      this.warmIdentities.clear();this.warmUntil=0;
      // Prewarm-only sessions must not consume another idleMs of participant minutes.
      if(!this.anyVisible())void this.teardown();else this.sync();
    },duration+20);
    this.sync();
  }
  /** Studio background tabs should not keep downloading four camera streams.
   * Program and OBS are independent and are never affected by this toggle. */
  setMonitoringEnabled(enabled:boolean){
    if(this.monitoringEnabled===enabled)return;
    this.monitoringEnabled=enabled;
    if(!enabled){void this.teardown();}
    else this.sync();
  }
  getReadiness(stage:StageHandle):CameraReadiness{
    const program=this.assignments.get(stage),values=this.readyByStage.get(stage);
    const ready:CameraSlot[]=[],waiting:CameraSlot[]=[];
    for(const slot of CAMERA_SLOTS){
      if(!program?.cameras.slots[slot].visible)continue;
      (values?.get(slot)?ready:waiting).push(slot);
    }
    return {ready,waiting};
  }
  private reportReadiness(stage:StageHandle){this.onReadiness(stage,this.getReadiness(stage));}
  private setReady(stage:StageHandle,slot:CameraSlot,value:boolean){
    const values=this.readyByStage.get(stage)??new Map<CameraSlot,boolean>();
    if(!this.readyByStage.has(stage))this.readyByStage.set(stage,values);
    if(values.get(slot)===value)return;
    values.set(slot,value);stage.setCameraStreamState(slot,value);
    this.reportReadiness(stage);
  }

  private anyVisible(){
    for(const program of this.assignments.values())for(const slot of CAMERA_SLOTS)if(program.cameras.slots[slot].visible)return true;
    return false;
  }
  private wanted(){return this.monitoringEnabled&&!!this.boId&&(this.anyVisible()||Date.now()<this.warmUntil);}
  private ensureConnection(){
    if(this.wanted()){
      window.clearTimeout(this.idleTimer);this.idleTimer=0;
      if(!this.room&&!this.connecting&&!this.reconnectTimer)void this.open();
    }else if(this.room&&!this.idleTimer){
      const remaining=Math.max(this.idleMs,this.warmUntil-Date.now());
      this.idleTimer=window.setTimeout(()=>{this.idleTimer=0;if(!this.wanted()){void this.teardown();this.onStatus('Camera SFU idle — disconnected to save minutes');}},remaining);
    }
  }
  private async teardown(){
    this.epoch++;
    window.clearTimeout(this.reconnectTimer);this.reconnectTimer=0;
    window.clearTimeout(this.graceTimer);window.clearTimeout(this.idleTimer);this.idleTimer=0;
    window.clearTimeout(this.warmTimer);this.warmTimer=0;
    this.connecting=false;
    this.desiredSince.clear();this.subscriptionRequests=new WeakMap();
    this.warmIdentities.clear();this.warmUntil=0;
    const old=this.room;this.room=null;this.detachAll();
    if(old)try{await old.disconnect();}catch{}
  }
  private scheduleRetry(current:number,max:number){
    if(current!==this.epoch||!this.wanted())return;
    this.reconnectTimer=window.setTimeout(()=>{this.reconnectTimer=0;void this.open();},Math.min(max,800*(2**Math.min(this.retry++,4))));
  }
  private async open(){
    const current=++this.epoch;
    this.connecting=true;
    const LK=window.LivekitClient;
    if(!LK){this.connecting=false;this.onStatus('LiveKit SDK unavailable');return;}
    try{
      const path='/api/camera/viewer-token'+(this.token?`?outputToken=${encodeURIComponent(this.token)}`:'');
      const response=await fetch(path,{cache:'no-store'});
      if(current!==this.epoch)return;
      if(!response.ok){this.connecting=false;this.onStatus('Camera receiver: no active BO or media service');this.scheduleRetry(current,15000);return;}
      const creds=await response.json();
      if(current!==this.epoch||creds.boId!==this.boId){this.connecting=false;return;}
      const room=new LK.Room({adaptiveStream:this.adaptiveStream,dynacast:false,autoSubscribe:false});
      const sync=()=>this.sync();
      for(const event of [LK.RoomEvent.TrackPublished,LK.RoomEvent.TrackUnpublished,
        LK.RoomEvent.TrackSubscribed,LK.RoomEvent.TrackUnsubscribed,
        LK.RoomEvent.ParticipantConnected,LK.RoomEvent.ParticipantDisconnected,
        LK.RoomEvent.TrackMuted,LK.RoomEvent.TrackUnmuted]) {
        if(event)room.on(event,sync);
      }
      if(LK.RoomEvent.Reconnecting)room.on(LK.RoomEvent.Reconnecting,()=>{
        if(this.room!==room||this.epoch!==current)return;
        this.onStatus('Camera SFU reconnecting — waiting for fresh video frames');
        for(const stage of this.stages)for(const slot of CAMERA_SLOTS)this.setReady(stage,slot,false);
      });
      if(LK.RoomEvent.Reconnected)room.on(LK.RoomEvent.Reconnected,()=>{
        if(this.room!==room||this.epoch!==current)return;
        // LiveKit may keep publications through ICE recovery. Re-assert subscriptions.
        this.subscriptionRequests=new WeakMap();
        this.onStatus('Camera SFU reconnected — checking tracks');
        this.sync();
        for(const stage of this.stages){
          const program=this.assignments.get(stage);if(!program)continue;
          for(const slot of CAMERA_SLOTS){
            const video=stage.getCameraVideo(slot),track=this.tracked.get(video);
            if(track&&program.cameras.slots[slot].visible&&this.live.get(video))this.markReady(stage,slot,video,track);
          }
        }
      });
      room.on(LK.RoomEvent.Disconnected,()=>{
        if(this.room!==room||this.epoch!==current)return;
        this.room=null;
        this.subscriptionRequests=new WeakMap(); // a new Room is a new subscription lifecycle
        this.connecting=false;
        this.detachAll();
        this.onStatus('Camera SFU disconnected — reconnecting');
        this.scheduleRetry(current,8000);
      });
      await room.connect(creds.url,creds.token,{autoSubscribe:false});
      if(current!==this.epoch){await room.disconnect();return;}
      this.room=room;this.retry=0;this.connecting=false;
      this.onStatus('Camera SFU connected (selective subscription)');
      this.sync();
    }catch(e){
      if(current!==this.epoch)return;
      this.connecting=false;
      this.onStatus(`Camera receiver: ${e instanceof Error?e.message:'connection failed'}`);
      this.scheduleRetry(current,12000);
    }
  }

  private teamOf(slot:CameraSlot,program:Program){return slot[0]==='A'?program.match.teamA.teamId:program.match.teamB.teamId;}
  private requestedIdentities(){
    const ids=new Set<string>();
    if(Date.now()<this.warmUntil)for(const identity of this.warmIdentities)ids.add(identity);
    for(const program of this.assignments.values()){
      for(const slot of CAMERA_SLOTS){
        if(!program.cameras.slots[slot].visible)continue;
        const teamId=this.teamOf(slot,program);
        // Subscribe both team members so same-team fallback is instantaneous
        // without duplicating uploads.
        if(teamId){ids.add(identityForPlayer(`${teamId}-P1`));ids.add(identityForPlayer(`${teamId}-P2`));}
      }
    }
    return ids;
  }
  private manageSubscriptions(){
    const room=this.room;if(!room)return;
    const LK=window.LivekitClient;
    const now=Date.now();
    const active=this.requestedIdentities();
    for(const identity of active)this.desiredSince.set(identity,now+this.graceMs);
    if(now>=this.warmUntil)this.warmIdentities.clear();
    let pendingGrace=false;
    const media:MediaPresence[]=[];
    for(const participant of room.remoteParticipants.values()){
      const identity=participant.identity;
      const keep=active.has(identity)||(this.desiredSince.get(identity)??0)>now;
      if(!active.has(identity)&&keep)pendingGrace=true;
      const publication=participant.getTrackPublication(LK?.Track?.Source?.Camera);
      const playerId=playerIdFromIdentity(identity);
      if(playerId)media.push({playerId,hasVideo:!!publication&&!publication.isMuted,subscribed:!!publication?.videoTrack});
      if(!publication)continue;
      if(this.subscriptionRequests.get(publication)!==keep){
        publication.setSubscribed(keep);
        // The 2-layer publisher serves LOW to Studio, HIGH to OBS.
        // A lower SFU layer reduces receiver bandwidth/decoder load without
        // changing what OBS receives on the separate browser connection.
        if(keep)try{
          const quality=LK?.VideoQuality?.[this.videoQuality.toUpperCase()];
          publication.setVideoQuality?.(quality??(this.videoQuality==='low'?0:this.videoQuality==='medium'?1:2));
        }catch{}
        this.subscriptionRequests.set(publication,keep);
      }
    }
    for(const [identity,deadline] of this.desiredSince){if(deadline<=now&&!active.has(identity))this.desiredSince.delete(identity);}
    window.clearTimeout(this.graceTimer);
    if(pendingGrace)this.graceTimer=window.setTimeout(()=>this.sync(),this.graceMs+60);
    const signature=JSON.stringify(media.sort((a,b)=>a.playerId.localeCompare(b.playerId)));
    if(signature!==this.lastMedia){this.lastMedia=signature;this.onMedia(media);}
  }

  private publicationOf(playerId:string|null){
    if(!playerId||!this.room)return null;
    const participant=this.room.remoteParticipants.get(identityForPlayer(playerId));
    return participant?.getTrackPublication(window.LivekitClient?.Track.Source.Camera)||null;
  }
  /**
   * v0.4C: what a slot shows.
   * - The assigned player is in the room: always their own camera. If they
   *   paused it (phone turned upright) the tile shows the league-logo
   *   placeholder, never the teammate.
   * - The assigned player has left the room: the teammate's camera (same-team
   *   fallback only, so both tiles may show the same person).
   * - Nobody: placeholder.
   */
  private effectiveSource(slot:CameraSlot,program:Program):{track:any;live:boolean;playerId:string}|null{
    const teamId=this.teamOf(slot,program);
    if(!teamId)return null;
    // Never show the opposite team: a foreign or missing ID falls back to the
    // slot default (A1 -> team A player 1).
    const assigned=program.cameras.slots[slot].playerId;
    const playerId=assigned&&assigned.startsWith(`${teamId}-`)?assigned:defaultSlotPlayer(program.match,slot);
    if(!playerId)return null;
    const own=this.publicationOf(playerId);
    if(own)return own.videoTrack?{track:own.videoTrack,live:!own.isMuted,playerId}:null;
    const mate=this.publicationOf(teammateOf(playerId));
    return mate?.videoTrack&&!mate.isMuted?{track:mate.videoTrack,live:true,playerId:teammateOf(playerId)}:null;
  }
  private markReady(stage:StageHandle,slot:CameraSlot,video:HTMLVideoElement,track:any){
    const generation=(this.frameGeneration.get(video)??0)+1;
    this.frameGeneration.set(video,generation);
    this.setReady(stage,slot,false);
    const ready=()=>{
      if(this.frameGeneration.get(video)===generation&&this.tracked.get(video)===track&&this.live.get(video))this.setReady(stage,slot,true);
    };
    // Prefer a frame callback (actually decoded by CEF); fall back for old OBS.
    // This describes browser decode/readiness, NOT pixels verified on Twitch.
    if(typeof video.requestVideoFrameCallback==='function'){
      video.requestVideoFrameCallback(()=>ready());return;
    }
    if(typeof video.addEventListener!=='function'){ready();return;} // isolated unit-test mocks
    video.addEventListener('loadeddata',ready,{once:true});
    video.addEventListener('playing',ready,{once:true});
    if((video.readyState??0)>=2)window.setTimeout(()=>{
      if((video.readyState??0)>=2&&video.videoWidth>0)ready();
    },150);
  }
  private sync(){
    this.ensureConnection();
    this.manageSubscriptions();
    for(const stage of this.stages){
      const program=this.assignments.get(stage);if(!program)continue;
      for(const slot of CAMERA_SLOTS){
        const video=stage.getCameraVideo(slot);
        const visible=!!program.cameras.slots[slot].visible;
        const source=visible?this.effectiveSource(slot,program):null;
        const track=source?.track??null;
        // v0.4E: name tag shows who is actually on the tile (teammate on fallback).
        stage.setCameraSource?.(slot,source?.playerId??null);
        const previous=this.tracked.get(video);
        if(track){
          const hold=this.hideTimers.get(video);if(hold){window.clearTimeout(hold);this.hideTimers.delete(video);}
          const wasLive=this.live.get(video)??false;
          if(previous!==track){
            if(previous){try{previous.detach(video);}catch{}}
            track.attach(video);video.muted=true;video.autoplay=true;video.playsInline=true;
            this.tracked.set(video,track);
            video.play?.().catch(()=>{});
            this.live.set(video,source!.live);
            if(source!.live)this.markReady(stage,slot,video,track);else this.setReady(stage,slot,false);
          }else if(source!.live!==wasLive){
            // Paused <-> resumed on the same track (player turned the phone).
            this.live.set(video,source!.live);
            if(source!.live){video.play?.().catch(()=>{});this.markReady(stage,slot,video,track);}
            else this.setReady(stage,slot,false);
          }
          continue;
        }
        this.frameGeneration.set(video,(this.frameGeneration.get(video)??0)+1);
        this.setReady(stage,slot,false);
        if(previous&&!visible&&this.room){
          // Tile is animating out: keep its last frame instead of flashing
          // "WAITING FOR PLAYER", then release the element.
          if(!this.hideTimers.has(video))this.hideTimers.set(video,window.setTimeout(()=>{
            this.hideTimers.delete(video);
            if(this.tracked.get(video)!==previous)return;
            try{previous.detach(video);}catch{}
            this.tracked.delete(video);this.live.delete(video);video.srcObject=null;this.setReady(stage,slot,false);
          },this.exitHoldMs));
          continue;
        }
        if(previous){try{previous.detach(video);}catch{}this.tracked.delete(video);this.live.delete(video);}
        if(!this.hideTimers.has(video)){video.srcObject=null;this.setReady(stage,slot,false);}
      }
    }
  }
  private detachAll(){
    for(const timer of this.hideTimers.values())window.clearTimeout(timer);
    this.hideTimers.clear();
    for(const [video,track] of this.tracked){try{track.detach(video);}catch{}video.srcObject=null;}
    this.tracked.clear();this.live.clear();
    for(const stage of this.stages)for(const slot of CAMERA_SLOTS)this.setReady(stage,slot,false);
    if(this.lastMedia!=='[]'){this.lastMedia='[]';this.onMedia([]);}
  }
  async disconnect(){
    this.assignments.clear();this.warmUntil=0;
    await this.teardown();
  }
}
