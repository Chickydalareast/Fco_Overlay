export class BtcMicController {
    options;
    room = null;
    track = null;
    publication = null;
    publicationRoom = null;
    wanted = false;
    revision = 0;
    processedRevision = -1;
    running = null;
    resetPending = false;
    disposed = false;
    constructor(options) {
        this.options = options;
    }
    state() {
        const active = !!this.wanted && !!this.room && !!this.publication && !!this.track?.enabled;
        return { wanted: this.wanted, active, pending: this.wanted && !active };
    }
    setWanted(wanted) {
        if (this.disposed)
            return;
        this.wanted = wanted;
        // HARD GATE: PTT release cannot wait for getUserMedia, publish or mute ACK.
        if (!wanted && this.track)
            this.track.enabled = false;
        this.schedule();
    }
    setRoom(room) {
        if (this.disposed)
            return;
        if (this.room !== room) {
            if (this.track)
                this.track.enabled = false;
            this.room = room;
            this.publication = null;
            this.publicationRoom = null;
        }
        this.schedule();
    }
    restartTrack() {
        if (this.disposed)
            return;
        if (this.track)
            this.track.enabled = false;
        this.resetPending = true;
        this.schedule();
    }
    /** Terminate current capture on page exit; never resurrect it afterwards. */
    dispose() {
        this.disposed = true;
        this.wanted = false;
        this.room = null;
        if (this.track) {
            this.track.enabled = false;
            this.track.stop();
            this.track = null;
            this.options.onTrack(null);
        }
        this.publication = null;
        this.publicationRoom = null;
        this.revision++;
        this.options.onState(this.state());
    }
    /** For deterministic tests; caller need not wait in normal UI code. */
    async idle() {
        while (this.running)
            await this.running;
    }
    schedule() {
        this.revision++;
        this.options.onState(this.state());
        if (!this.running)
            this.kick();
    }
    kick() {
        this.running = this.drain().finally(() => {
            this.running = null;
            // An intent can arrive between drain() completing and its finalizer.
            if (!this.disposed && this.processedRevision !== this.revision)
                this.kick();
        });
    }
    async drain() {
        let seen = -1;
        while (!this.disposed && seen !== this.revision) {
            seen = this.revision;
            try {
                await this.reconcile();
            }
            catch (error) {
                if (this.track)
                    this.track.enabled = false;
                this.wanted = false;
                this.options.onError(error);
            }
            this.processedRevision = seen;
            this.options.onState(this.state());
        }
    }
    async reconcile() {
        if (this.resetPending) {
            this.resetPending = false;
            const pub = this.publication, owner = this.publicationRoom;
            this.publication = null;
            this.publicationRoom = null;
            // No new capture may start until the old publication has been retired.
            if (pub && owner)
                try {
                    await owner.localParticipant.unpublishTrack(pub.track, false);
                }
                catch { }
            if (this.track) {
                this.track.enabled = false;
                this.track.stop();
                this.track = null;
                this.options.onTrack(null);
            }
        }
        const owner = this.room;
        if (!owner || !this.wanted) {
            if (this.track)
                this.track.enabled = false;
            if (this.publication)
                await this.publication.mute();
            return;
        }
        if (!this.track || this.track.readyState !== 'live') {
            const track = await this.options.acquire();
            track.enabled = false;
            if (this.disposed || !this.wanted || this.room !== owner || this.resetPending) {
                track.stop();
                return;
            }
            this.track = track;
            this.options.onTrack(track);
        }
        const track = this.track;
        if (!track || !this.wanted || this.room !== owner || this.resetPending)
            return;
        if (!this.publication) {
            const pub = await owner.localParticipant.publishTrack(track, this.options.publishOptions());
            if (this.disposed || this.room !== owner || this.track !== track || this.resetPending) {
                track.enabled = false;
                try {
                    await owner.localParticipant.unpublishTrack(pub.track, false);
                }
                catch { }
                return;
            }
            this.publication = pub;
            this.publicationRoom = owner;
        }
        const pub = this.publication;
        if (!pub)
            return;
        if (!this.wanted) {
            track.enabled = false;
            await pub.mute();
            return;
        }
        await pub.unmute();
        if (!this.disposed && this.wanted && this.room === owner && this.publication === pub && !this.resetPending) {
            track.enabled = true;
        }
        else {
            track.enabled = false;
            await pub.mute();
        }
    }
}
