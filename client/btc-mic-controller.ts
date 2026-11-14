/**
 * BTC microphone state reconciler. Only the latest talk intent is allowed to
 * enable a microphone track. A released PTT key closes the local audio gate
 * synchronously, even if browser permission or LiveKit operations are pending.
 * This module has no DOM or LiveKit import so delayed operations can be tested.
 */
export type BtcMicTrack={enabled:boolean;readyState:string;stop():void};
export type BtcMicPublication={track?:unknown;mute():Promise<unknown>|unknown;unmute():Promise<unknown>|unknown};
export type BtcMicRoom={localParticipant:{publishTrack(track:BtcMicTrack,options:unknown):Promise<BtcMicPublication>;unpublishTrack(track:unknown,stop:boolean):Promise<unknown>}};
export type BtcMicState={wanted:boolean;active:boolean;pending:boolean};
export type BtcMicOptions={
  acquire:()=>Promise<BtcMicTrack>;
  publishOptions:()=>unknown;
  onTrack:(track:BtcMicTrack|null)=>void;
  onState:(state:BtcMicState)=>void;
  onError:(error:unknown)=>void;
};

export class BtcMicController {
  private room:BtcMicRoom|null=null;
  private track:BtcMicTrack|null=null;
  private publication:BtcMicPublication|null=null;
  private publicationRoom:BtcMicRoom|null=null;
  private wanted=false;
  private revision=0;
  private processedRevision=-1;
  private running:Promise<void>|null=null;
  private resetPending=false;
  private disposed=false;
  constructor(private readonly options:BtcMicOptions){}

  state():BtcMicState {
    const active=!!this.wanted&&!!this.room&&!!this.publication&&!!this.track?.enabled;
    return {wanted:this.wanted,active,pending:this.wanted&&!active};
  }
  setWanted(wanted:boolean):void {
    if(this.disposed)return;
    this.wanted=wanted;
    // HARD GATE: PTT release cannot wait for getUserMedia, publish or mute ACK.
    if(!wanted&&this.track)this.track.enabled=false;
    this.schedule();
  }
  setRoom(room:BtcMicRoom|null):void {
    if(this.disposed)return;
    if(this.room!==room){
      if(this.track)this.track.enabled=false;
      this.room=room;
      this.publication=null;
      this.publicationRoom=null;
    }
    this.schedule();
  }
  restartTrack():void {
    if(this.disposed)return;
    if(this.track)this.track.enabled=false;
    this.resetPending=true;
    this.schedule();
  }
  /** Terminate current capture on page exit; never resurrect it afterwards. */
  dispose():void {
    this.disposed=true;this.wanted=false;this.room=null;
    if(this.track){this.track.enabled=false;this.track.stop();this.track=null;this.options.onTrack(null);}
    this.publication=null;this.publicationRoom=null;
    this.revision++;this.options.onState(this.state());
  }
  /** For deterministic tests; caller need not wait in normal UI code. */
  async idle():Promise<void> {
    while(this.running)await this.running;
  }
  private schedule():void {
    this.revision++;
    this.options.onState(this.state());
    if(!this.running)this.kick();
  }
  private kick():void {
    this.running=this.drain().finally(()=>{
      this.running=null;
      // An intent can arrive between drain() completing and its finalizer.
      if(!this.disposed&&this.processedRevision!==this.revision)this.kick();
    });
  }
  private async drain():Promise<void> {
    let seen=-1;
    while(!this.disposed&&seen!==this.revision){
      seen=this.revision;
      try{await this.reconcile();}
      catch(error){
        if(this.track)this.track.enabled=false;
        this.wanted=false;
        this.options.onError(error);
      }
      this.processedRevision=seen;
      this.options.onState(this.state());
    }
  }
  private async reconcile():Promise<void> {
    if(this.resetPending){
      this.resetPending=false;
      const pub=this.publication,owner=this.publicationRoom;
      this.publication=null;this.publicationRoom=null;
      // No new capture may start until the old publication has been retired.
      if(pub&&owner)try{await owner.localParticipant.unpublishTrack(pub.track,false);}catch{}
      if(this.track){this.track.enabled=false;this.track.stop();this.track=null;this.options.onTrack(null);}
    }
    const owner=this.room;
    if(!owner||!this.wanted){
      if(this.track)this.track.enabled=false;
      if(this.publication)await this.publication.mute();
      return;
    }
    if(!this.track||this.track.readyState!=='live'){
      const track=await this.options.acquire();
      track.enabled=false;
      if(this.disposed||!this.wanted||this.room!==owner||this.resetPending){track.stop();return;}
      this.track=track;this.options.onTrack(track);
    }
    const track=this.track;
    if(!track||!this.wanted||this.room!==owner||this.resetPending)return;
    if(!this.publication){
      const pub=await owner.localParticipant.publishTrack(track,this.options.publishOptions());
      if(this.disposed||this.room!==owner||this.track!==track||this.resetPending){
        track.enabled=false;
        try{await owner.localParticipant.unpublishTrack(pub.track,false);}catch{}
        return;
      }
      this.publication=pub;this.publicationRoom=owner;
    }
    const pub=this.publication;
    if(!pub)return;
    if(!this.wanted){track.enabled=false;await pub.mute();return;}
    await pub.unmute();
    if(!this.disposed&&this.wanted&&this.room===owner&&this.publication===pub&&!this.resetPending){
      track.enabled=true;
    }else{
      track.enabled=false;
      await pub.mute();
    }
  }
}
