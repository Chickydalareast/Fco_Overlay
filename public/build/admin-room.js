import { BtcMicController } from './btc-mic-controller.js';
const app = document.getElementById('admin-app');
const PLAYER_PREFIX = 'player-', ADMIN_PREFIX = 'admin-';
let grant = null;
let room = null;
let epoch = 0;
let watch = false; // Session-only local view preference; always OFF on entry.
let micLatched = false, pttDown = false;
let relayStream = null, relayPub = null;
let audioCtx = null;
const meters = new Map();
let meterFrame = 0;
let pollTimer = 0, reconnectTimer = 0;
let relayError = '';
const $ = (sel) => app.querySelector(sel);
function renderLogin(message = '') {
    app.innerHTML = `<main class="adm-login"><section class="adm-login-box"><img src="/assets/brand/league-logo.png" alt="" /><h1>PHÒNG BTC</h1>
    <form id="adm-login"><input id="adm-password" type="password" placeholder="Mật khẩu Studio" autocomplete="current-password" required autofocus />
    <button class="btn btn-red" type="submit">Vào phòng</button></form><p class="adm-error">${message}</p></section></main>`;
    $('#adm-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#adm-password').value }) });
        if (r.ok)
            void start();
        else
            renderLogin(r.status === 429 ? 'Thử quá nhiều lần, đợi 1 phút.' : 'Sai mật khẩu.');
    });
}
function tile(team, slot) {
    return `<div class="adm-tile" data-team="${team}" data-slot="${slot}" data-state="off">
    <video muted playsinline autoplay></video><div class="adm-tile-empty">Chưa vào phòng</div>
    <div class="adm-tile-label"><b class="adm-tile-slot">P${slot}</b><span class="adm-tile-name">—</span><span class="adm-tile-state">Chưa vào phòng</span></div></div>`;
}
function renderRoom() {
    app.innerHTML = `<main class="adm" data-watch="off">
  <header class="adm-head"><img src="/assets/brand/league-logo.png" alt="" class="adm-logo" />
    <div class="adm-head-copy"><div class="adm-title">PHÒNG BTC</div><div class="adm-match" id="adm-match">—</div></div>
    <div class="adm-conn" id="adm-conn" data-tone="wait">Đang kết nối…</div></header>
  <div class="adm-body">
    <section class="adm-cams">
      <div class="adm-cams-head"><h2>CAMERA TUYỂN THỦ</h2>
        <button class="adm-watch-btn" type="button" id="adm-watch" aria-pressed="false" title="Chỉ tải video khi bật xem">BẬT XEM 4 CAM</button></div>
      <p class="adm-cam-note" id="adm-watch-note" role="status">Đang tắt nhận video để tiết kiệm băng thông LiveKit. Vẫn theo dõi được trạng thái tuyển thủ.</p>
      <div class="adm-team" data-side="A"><div class="adm-team-name" data-team-name="A">Đội trái</div><div class="adm-grid">${tile('A', 1)}${tile('A', 2)}</div></div>
      <div class="adm-team" data-side="B"><div class="adm-team-name" data-team-name="B">Đội phải</div><div class="adm-grid">${tile('B', 1)}${tile('B', 2)}</div></div>
    </section>
    <aside class="adm-side">
      <section class="adm-card">
        <h3>MICRO CỦA BẠN</h3>
        <select id="mic-device" aria-label="Chọn micro"><option value="">Micro mặc định</option></select>
        <button id="mic-toggle" class="btn btn-live" type="button">Bật mic</button>
        <div class="adm-meter"><i id="mic-meter"></i></div>
        <p class="adm-warn" id="mic-warn" hidden></p>
        <p class="adm-hint">Giữ phím <kbd>Space</kbd> để nói nhanh. Tuyển thủ nghe qua tab phòng camera của họ, không lên stream.</p>
      </section>
      <section class="adm-card">
        <h3>CHUYỂN TIẾP ÂM THANH (DISCORD)</h3>
        <select id="relay-source" aria-label="Nguồn âm thanh"><option value="display">Âm thanh tab / màn hình (Chrome, Edge)</option></select>
        <button id="relay-toggle" class="btn btn-live" type="button">Bắt đầu chuyển tiếp</button>
        <div class="adm-meter"><i id="relay-meter"></i></div>
        <p class="adm-warn" id="relay-warn" hidden></p>
        <details class="adm-hint"><summary>Cách dẫn âm thanh Discord bằng VB-Cable</summary><ol>
          <li>Cài <b>VB-Audio Virtual Cable</b> (miễn phí) rồi khởi động lại máy.</li>
          <li>Discord → Cài đặt → Giọng nói &amp; Video → Thiết bị đầu ra: <b>CABLE Input</b>.</li>
          <li>Để bạn vẫn nghe Discord: Windows Sound → Recording → <b>CABLE Output</b> → Properties → Listen → tick "Listen to this device", chọn tai nghe.</li>
          <li>Ở đây chọn nguồn <b>CABLE Output</b> rồi bấm "Bắt đầu chuyển tiếp".</li>
        </ol><p>Discord mở trên trình duyệt: chọn "Âm thanh tab", chọn tab Discord và tick "Chia sẻ âm thanh tab".</p></details>
      </section>
      <section class="adm-card"><h3>TRONG PHÒNG</h3><div id="adm-presence" class="adm-presence">—</div></section>
    </aside>
  </div></main>`;
    $('#adm-watch').addEventListener('click', () => { watch = !watch; renderWatch(); sync(); });
    renderWatch();
    $('#mic-toggle').addEventListener('click', () => { micLatched = !micLatched; setMicIntent(); });
    $('#mic-device').addEventListener('change', () => micController.restartTrack());
    $('#relay-toggle').addEventListener('click', () => { void (relayStream ? stopRelay() : startRelay()); });
    void listDevices();
}
function setConn(text, tone) { const c = $('#adm-conn'); c.textContent = text; c.dataset.tone = tone; }
async function listDevices() {
    if (!navigator.mediaDevices?.enumerateDevices)
        return;
    const devices = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(d => d.kind === 'audioinput');
    const mic = $('#mic-device'), relay = $('#relay-source');
    const keepMic = mic.value, keepRelay = relay.value;
    mic.replaceChildren(new Option('Micro mặc định', ''));
    relay.replaceChildren(new Option('Âm thanh tab / màn hình (Chrome, Edge)', 'display'));
    devices.forEach((d, i) => {
        const label = d.label || `Thiết bị ${i + 1}`;
        if (d.deviceId !== 'default' && d.deviceId !== 'communications')
            mic.add(new Option(label, d.deviceId));
        relay.add(new Option(label, d.deviceId));
    });
    if ([...mic.options].some(o => o.value === keepMic))
        mic.value = keepMic;
    if ([...relay.options].some(o => o.value === keepRelay))
        relay.value = keepRelay;
    else {
        const cable = [...relay.options].find(o => /cable output|vb-audio/i.test(o.text));
        if (cable)
            relay.value = cable.value;
    }
}
/* ---------- low-cost audio meters ---------- */
function releaseMeter(id) {
    const previous = meters.get(id);
    if (previous) {
        try {
            previous.source.disconnect();
            previous.analyser.disconnect();
        }
        catch { }
        meters.delete(id);
    }
    const bar = app.querySelector(`#${id}`);
    if (bar)
        bar.style.width = '0%';
    if (!meters.size && meterFrame) {
        cancelAnimationFrame(meterFrame);
        meterFrame = 0;
    }
}
function meter(id, track) {
    releaseMeter(id);
    try {
        audioCtx ??= new AudioContext();
        const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        meters.set(id, { source, analyser, bar: $(`#${id}`), data: new Uint8Array(new ArrayBuffer(analyser.fftSize)) });
        startMeters();
    }
    catch { }
}
function startMeters() {
    if (!meterFrame && meters.size && !document.hidden)
        meterFrame = requestAnimationFrame(tickMeters);
}
function tickMeters() {
    meterFrame = 0;
    if (document.hidden || !meters.size)
        return;
    for (const [id, m] of meters) {
        m.analyser.getByteTimeDomainData(m.data);
        let peak = 0;
        for (const v of m.data)
            peak = Math.max(peak, Math.abs(v - 128));
        const muted = id === 'mic-meter' && !micController.state().active;
        m.bar.style.width = `${muted ? 0 : Math.min(100, peak / 1.1)}%`;
    }
    startMeters();
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (meterFrame) {
            cancelAnimationFrame(meterFrame);
            meterFrame = 0;
        }
        if (pttDown) {
            pttDown = false;
            setMicIntent();
        }
    }
    else
        startMeters();
});
/* ---------- serialized microphone / push-to-talk ---------- */
function renderMic(state) {
    const button = app.querySelector('#mic-toggle');
    if (!button)
        return;
    button.textContent = state.active ? (micLatched ? 'Tắt mic' : 'Đang nói (Space)') :
        state.pending ? 'Đang bật micro…' : 'Bật mic';
    button.dataset.live = String(state.active);
}
const micController = new BtcMicController({
    acquire: async () => {
        const device = $('#mic-device').value;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(device ? { deviceId: { exact: device } } : {}) } });
        return stream.getAudioTracks()[0];
    },
    publishOptions: () => ({ source: window.LivekitClient.Track.Source.Microphone, name: 'btc-mic' }),
    onTrack: (track) => {
        if (track) {
            meter('mic-meter', track);
            void listDevices();
        }
        else
            releaseMeter('mic-meter');
    },
    onState: renderMic,
    onError: error => {
        micLatched = false;
        pttDown = false;
        const warn = app.querySelector('#mic-warn');
        if (warn) {
            warn.hidden = false;
            warn.textContent = error instanceof DOMException && error.name === 'NotAllowedError' ?
                'Chưa cho phép dùng micro.' : 'Không mở được micro. Hãy thử lại hoặc chọn thiết bị khác.';
        }
    }
});
function setMicIntent() {
    const warn = app.querySelector('#mic-warn');
    if (warn)
        warn.hidden = true;
    micController.setWanted(micLatched || pttDown);
}
function typingTarget(target) {
    const el = target instanceof HTMLElement ? target : null;
    return !!el && (!!el.closest('input, select, textarea, button, [contenteditable="true"], [role="button"]'));
}
window.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat || e.altKey || e.ctrlKey || e.metaKey || typingTarget(e.target) || !grant || document.hidden)
        return;
    e.preventDefault();
    if (!pttDown) {
        pttDown = true;
        setMicIntent();
    }
});
window.addEventListener('keyup', e => {
    if (e.code !== 'Space' || !pttDown)
        return;
    e.preventDefault();
    pttDown = false;
    setMicIntent();
});
window.addEventListener('blur', () => { if (pttDown) {
    pttDown = false;
    setMicIntent();
} });
/* ---------- relay (Discord / app audio) ---------- */
async function startRelay() {
    const button = $('#relay-toggle'), source = $('#relay-source').value;
    relayError = '';
    const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    button.disabled = true;
    try {
        let stream;
        if (source === 'display') {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: raw, systemAudio: 'include', selfBrowserSurface: 'exclude' });
            stream.getVideoTracks().forEach(t => t.stop());
            if (!stream.getAudioTracks().length)
                throw new Error('Bạn chưa tick "Chia sẻ âm thanh" khi chọn tab / màn hình.');
        }
        else {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { ...raw, deviceId: { exact: source }, channelCount: { ideal: 2 } } });
        }
        relayStream = new MediaStream(stream.getAudioTracks());
        const track = relayStream.getAudioTracks()[0];
        track.addEventListener('ended', () => { void stopRelay(); });
        meter('relay-meter', track);
        await publishRelay();
        void listDevices();
    }
    catch (e) {
        relayStream?.getTracks().forEach(t => t.stop());
        relayStream = null;
        relayError = e instanceof DOMException && e.name === 'NotAllowedError' ? 'Bạn đã huỷ hoặc chưa cho phép chia sẻ âm thanh.' : e instanceof Error ? e.message : 'Không bắt được âm thanh.';
    }
    finally {
        button.disabled = false;
        relayUi();
    }
}
async function publishRelay() {
    const LK = window.LivekitClient;
    const track = relayStream?.getAudioTracks()[0];
    if (!room || !track || relayPub)
        return;
    relayPub = await room.localParticipant.publishTrack(track, { source: LK.Track.Source.ScreenShareAudio, name: 'btc-relay', dtx: false, red: false, audioPreset: { maxBitrate: 64000 } });
}
async function stopRelay() {
    if (relayPub && room) {
        try {
            await room.localParticipant.unpublishTrack(relayPub.track, false);
        }
        catch { }
    }
    relayPub = null;
    relayStream?.getTracks().forEach(t => t.stop());
    relayStream = null;
    meters.delete('relay-meter');
    releaseMeter('relay-meter');
    relayUi();
}
function relayUi() {
    const b = $('#relay-toggle');
    b.textContent = relayStream ? 'Dừng chuyển tiếp' : 'Bắt đầu chuyển tiếp';
    b.dataset.live = String(!!relayStream);
    $('#relay-source').disabled = !!relayStream;
    sync();
}
/* ---------- cameras + presence ---------- */
function renderWatch() {
    const root = app.querySelector('.adm');
    if (root)
        root.dataset.watch = watch ? 'on' : 'off';
    const button = app.querySelector('#adm-watch');
    if (button) {
        button.setAttribute('aria-pressed', String(watch));
        button.textContent = watch ? 'TẮT XEM 4 CAM' : 'BẬT XEM 4 CAM';
    }
    const note = app.querySelector('#adm-watch-note');
    if (note)
        note.textContent = watch ? 'Đang nhận hình bản nhỏ (LOW) chỉ cho Phòng BTC. OBS không bị ảnh hưởng.' :
            'Đang tắt nhận video để tiết kiệm băng thông LiveKit. Vẫn theo dõi được trạng thái tuyển thủ.';
}
let watchRequests = new WeakMap();
function requestWatch(pub, wanted, LK) {
    // A newer OFF must override an ON request still in flight even if the SDK
    // currently reports isSubscribed=false. Never rely on a persisted preference.
    const previous = watchRequests.get(pub);
    if (previous !== wanted) {
        if (pub.isSubscribed !== wanted || previous !== undefined) {
            try {
                pub.setSubscribed(wanted);
            }
            catch {
                watchRequests.delete(pub);
                return;
            }
        }
        watchRequests.set(pub, wanted);
    }
    if (wanted && !pub._fcLow) {
        try {
            pub.setVideoQuality(LK.VideoQuality.LOW);
            pub._fcLow = true;
        }
        catch { }
    }
}
function sync() {
    if (!grant)
        return;
    const LK = window.LivekitClient;
    const players = new Map(), admins = [];
    if (room)
        for (const p of room.remoteParticipants.values()) {
            if (p.identity.startsWith(PLAYER_PREFIX))
                players.set(p.identity.slice(PLAYER_PREFIX.length), p);
            else if (p.identity.startsWith(ADMIN_PREFIX))
                admins.push(p);
        }
    for (const team of grant.teams)
        app.querySelector(`[data-team-name="${team.side}"]`).textContent = `${team.side === 'A' ? 'Đội trái' : 'Đội phải'} · ${team.teamId} - ${team.name}`;
    // Act on all room players, including removed/reassigned roster participants.
    // Never allow a stale video subscription to keep consuming BTC bandwidth.
    const allowed = new Set(grant.roster.map(p => p.playerId));
    for (const [playerId, p] of players) {
        const pub = p.getTrackPublication(LK.Track.Source.Camera);
        if (pub)
            requestWatch(pub, watch && allowed.has(playerId), LK);
    }
    let online = 0;
    for (const t of Array.from(app.querySelectorAll('.adm-tile'))) {
        const side = t.dataset.team, slot = Number(t.dataset.slot);
        const info = grant.roster.find(p => p.team === side && p.rosterSlot === slot);
        t.querySelector('.adm-tile-name').textContent = info?.name ?? '—';
        const participant = info ? players.get(info.playerId) : null;
        const pub = participant?.getTrackPublication(LK.Track.Source.Camera);
        if (participant)
            online++;
        const state = !participant ? 'off' : !pub ? 'joined' : pub.isMuted ? 'paused' : 'live';
        t.dataset.state = state;
        t.querySelector('.adm-tile-state').textContent = { off: 'Chưa vào phòng', joined: 'Đang kết nối', paused: 'Tạm dừng (đang dọc)', live: 'Đang gửi hình' }[state];
        t.querySelector('.adm-tile-empty').textContent = state === 'paused' ? 'Tạm dừng' : state === 'off' ? 'Chưa vào phòng' : watch ? 'Đang tải hình…' : 'Đã tắt xem cam';
        const video = t.querySelector('video');
        const videoTrack = pub && watch && !pub.isMuted ? pub.videoTrack : null;
        if (videoTrack && video._track !== videoTrack) {
            videoTrack.attach(video);
            video._track = videoTrack;
            video.onloadeddata = () => sync();
        }
        if (!videoTrack && video._track) {
            try {
                video._track.detach(video);
            }
            catch { }
            video._track = null;
            video.srcObject = null;
        }
        t.dataset.video = String(!!videoTrack && video.readyState >= 2);
    }
    const relaying = admins.filter(p => p.getTrackPublication(LK.Track.Source.ScreenShareAudio));
    const warn = $('#relay-warn');
    if (relayError) {
        warn.hidden = false;
        warn.textContent = relayError;
    }
    else if (relaying.length) {
        warn.hidden = false;
        warn.textContent = relayStream ? 'BTC khác cũng đang chuyển tiếp. Tuyển thủ sẽ nghe 2 nguồn, nên dừng một bên.' : 'Một BTC khác đang chuyển tiếp âm thanh.';
    }
    else
        warn.hidden = true;
    $('#adm-presence').innerHTML = `<div class="adm-stat"><b>${online}/4</b><span>tuyển thủ trong phòng</span></div><div class="adm-stat"><b>${admins.length + 1}</b><span>BTC (tính cả bạn)</span></div>`;
}
/* ---------- connection ---------- */
async function fetchGrant() {
    const r = await fetch('/api/camera/admin-token', { cache: 'no-store' }).catch(() => null);
    if (!r)
        return null;
    if (r.status === 401)
        return 'login';
    if (!r.ok)
        return null;
    return r.json();
}
async function connect(next) {
    const LK = window.LivekitClient;
    const current = ++epoch;
    micController.setRoom(null);
    watchRequests = new WeakMap();
    if (room) {
        const old = room;
        room = null;
        relayPub = null;
        try {
            await old.disconnect();
        }
        catch { }
    }
    grant = next;
    const a = next.teams.find(t => t.side === 'A'), b = next.teams.find(t => t.side === 'B');
    $('#adm-match').textContent = a && b ? `${a.teamId} ${a.name}  vs  ${b.teamId} ${b.name}` : 'Trận hiện tại';
    const r = new LK.Room({ autoSubscribe: false, adaptiveStream: false, dynacast: false });
    for (const event of [LK.RoomEvent.ParticipantConnected, LK.RoomEvent.ParticipantDisconnected, LK.RoomEvent.TrackPublished, LK.RoomEvent.TrackUnpublished,
        LK.RoomEvent.TrackSubscribed, LK.RoomEvent.TrackUnsubscribed, LK.RoomEvent.TrackMuted, LK.RoomEvent.TrackUnmuted])
        if (event)
            r.on(event, sync);
    r.on(LK.RoomEvent.Reconnecting, () => setConn('Mất mạng, đang nối lại…', 'wait'));
    r.on(LK.RoomEvent.Reconnected, () => { watchRequests = new WeakMap(); setConn('Đã kết nối', 'ok'); sync(); });
    r.on(LK.RoomEvent.Disconnected, () => {
        if (room !== r || current !== epoch)
            return;
        room = null;
        micController.setRoom(null);
        relayPub = null;
        setConn('Mất kết nối, đang vào lại…', 'bad');
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => { void refresh(true); }, 3000);
    });
    setConn('Đang kết nối…', 'wait');
    await r.connect(next.url, next.token, { autoSubscribe: false });
    if (current !== epoch) {
        await r.disconnect();
        return;
    }
    room = r;
    micController.setRoom(r);
    setConn('Đã kết nối', 'ok');
    if (relayStream)
        await publishRelay();
    sync();
}
/** Every 20 s: new BO -> move to the new room; roster names refresh. */
async function refresh(force = false) {
    window.clearTimeout(pollTimer);
    try {
        const next = await fetchGrant();
        if (next === 'login') {
            await teardown();
            renderLogin('Phiên đăng nhập đã hết, đăng nhập lại.');
            return;
        }
        if (!next) {
            setConn('Chưa có BO đang chạy hoặc LiveKit chưa cấu hình', 'bad');
        }
        else if (force || !room || next.boId !== grant?.boId)
            await connect(next);
        else {
            grant = { ...grant, roster: next.roster, teams: next.teams };
            sync();
        }
    }
    catch (e) {
        setConn(e instanceof Error ? `Lỗi kết nối: ${e.message}` : 'Lỗi kết nối', 'bad');
    }
    pollTimer = window.setTimeout(() => { void refresh(); }, 20_000);
}
async function teardown() {
    epoch++;
    window.clearTimeout(pollTimer);
    window.clearTimeout(reconnectTimer);
    const old = room;
    room = null;
    micController.setRoom(null);
    micLatched = false;
    pttDown = false;
    micController.setWanted(false);
    micController.restartTrack();
    relayPub = null;
    grant = null;
    if (old)
        try {
            await old.disconnect();
        }
        catch { }
}
async function start() {
    if (!window.LivekitClient) {
        app.textContent = 'Không tải được thư viện LiveKit. Tải lại trang.';
        return;
    }
    const first = await fetchGrant();
    if (first === 'login') {
        renderLogin();
        return;
    }
    renderRoom();
    if (!first) {
        setConn('Chưa có BO đang chạy hoặc LiveKit chưa cấu hình', 'bad');
        pollTimer = window.setTimeout(() => { void refresh(); }, 20_000);
        return;
    }
    try {
        await connect(first);
    }
    catch (e) {
        setConn(e instanceof Error ? `Không vào được phòng: ${e.message}` : 'Không vào được phòng', 'bad');
    }
    pollTimer = window.setTimeout(() => { void refresh(); }, 20_000);
}
window.addEventListener('pagehide', () => { micController.dispose(); relayStream?.getTracks().forEach(t => t.stop()); releaseMeter('relay-meter'); void audioCtx?.close(); void room?.disconnect(); });
void start();
