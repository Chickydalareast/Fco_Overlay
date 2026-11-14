import { cloneProgram, freshId, identicalDraft, rebaseDraft, resetNewBoDraft, restoreCurrentBoDraft, defaultSlotPlayer, decidedSuffix, SAMPLE_PROGRAM } from './contracts.js';
import { mountStage } from './stage.js';
import { LiveConnection } from './realtime.js';
import { CameraReceiver } from './camera-receiver.js';
import { CAMERA_SLOTS } from './contracts.js';
const app = document.getElementById('app');
let preview = null;
let programStage = null;
let connection = null;
let cameraReceiver = null;
let cameraPlayers = [];
let cameraRequests = [];
let registry = null;
let matches = [];
let history = [];
let editingGameVersion = 0;
let live = null;
let draft = cloneProgram(SAMPLE_PROGRAM);
let baseRevision = 0;
let baseProgram = null; // Program snapshot the Preview was built from (for rebase)
let newBoPrepared = false; // operator explicitly pressed PREPARE NEW BO
let mediaPresence = []; // what the SFU actually carries (Studio receiver)
let renderers = [];
const knownRequestIds = new Set();
let lastPrewarm = 0;
let authChecking = false;
// In-flight Direct LIVE commands: buttons stay locked until ack/error (A9).
const pendingCommands = new Map();
let connected = false;
let rendererCount = 0;
let rendererRevision = -1;
let messageTimer = 0;
let initialized = false;
let pendingTakeId = '';
/**
 * v0.5A Studio UI: a broadcast control desk. Red means ON AIR (Program),
 * white means Preview, amber means "check this". Live controls on the left,
 * Preview / Program + one TAKE in the middle, pre-match setup in tabs on the
 * right. Every id / data-* attribute the logic below uses is unchanged.
 */
const ICON_PATHS = {
    scoreboard: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M9 7v10M15 7v10"/>',
    intro: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M11 20c0-3 2.5-5 5-5s5 2 5 5"/>',
    history: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 14h16M10 4v16"/>',
    camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/>',
    focus: '<circle cx="12" cy="12" r="3"/><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>',
    swap: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    replay: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4"/>',
    link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
    room: '<path d="M12 3a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
    logout: '<path d="M14 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3M10 12h11M18 9l3 3-3 3"/>',
    power: '<path d="M12 3v8M6.5 6.5a8 8 0 1 0 11 0"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
};
const ico = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] ?? ''}</svg>`;
const prevToggle = (attr, title) => `<label class="prev-toggle" title="${title}"><input type="checkbox" ${attr}/><span>PREV</span></label>`;
const cameraLayersMarkup = CAMERA_SLOTS.map(slot => `
  <div class="cam-slot" data-camera-row="${slot}">
    <span class="cam-slot-id">${slot}</span>
    <span class="cam-slot-name" id="cam-player-${slot}">—</span>
    ${prevToggle(`data-camera-preview="${slot}"`, `${slot} in Preview`)}
    <button class="live-btn live-btn-sm" data-camera-live="${slot}" title="${slot} on Program">LIVE <span id="live-cam-${slot}">OFF</span></button>
    <select class="cam-slot-assign" data-camera-assign="${slot}" aria-label="Camera ${slot} source (Preview)"><option value="">Unassigned</option></select>
  </div>`).join('');
const graphicLayersMarkup = [
    { id: 'scoreboard', title: 'Scoreboard', detail: 'Manual BO score', icon: 'scoreboard' },
    { id: 'intro', title: 'Player Intro', detail: 'Team & player reveal', icon: 'intro' },
    { id: 'history', title: 'BO History', detail: 'Full-screen results', icon: 'history' }
].map(item => `
  <div class="rail-tile" data-graphic-row="${item.id}">
    <span class="tile-icon">${ico(item.icon)}</span>
    <span class="tile-copy"><strong>${item.title}</strong><small>${item.detail}</small></span>
    ${prevToggle(`data-layer="${item.id}"`, `${item.title} in Preview`)}
    <button class="live-btn" data-live-toggle="${item.id}" title="${item.title} on Program (on / off)"><span id="${item.id}-live-indicator">OFF</span></button>
  </div>`).join('');
const $ = (selector) => app.querySelector(selector);
const text = (selector, value) => { const el = $(selector); if (el)
    el.textContent = value; };
function showLogin() {
    app.innerHTML = `<main class="login-wrap"><section class="login-box">
    <img class="login-logo" src="/assets/brand/league-logo.png" alt="" />
    <h1>GRAPHICS STUDIO</h1>
    <form id="login-form"><input id="password" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required autofocus /><button type="submit" class="btn btn-onair full">Log in</button></form>
    <div id="login-error" class="login-error" aria-live="polite"></div>
  </section></main>`;
    $('#login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = app.querySelector('#password').value;
        try {
            const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
            const json = await response.json();
            if (!response.ok)
                throw new Error(json.error || 'Login failed');
            startStudio();
        }
        catch (err) {
            text('#login-error', err instanceof Error ? err.message : 'Login error');
        }
    });
}
function studioMarkup() {
    app.innerHTML = `
  <div class="studio-shell">
    <header class="topbar">
      <div class="topbar-brand"><img class="brand-logo" src="/assets/brand/league-logo.png" alt="" /><strong>GRAPHICS STUDIO</strong></div>
      <div class="topbar-status">
        <span class="status-pill" id="ws-pill" title="Studio ↔ server control link"><i class="status-dot"></i><span id="ws-status">OFFLINE</span></span>
        <span class="status-pill" id="obs-pill" title="OBS Browser Source"><i class="status-dot"></i><span id="obs-status">OBS NOT CONNECTED</span></span>
        <span class="revision-badge" id="revision" title="Program revision">REV —</span>
      </div>
      <div class="topbar-actions">
        <button id="cam-requests-badge" class="btn btn-alert request-badge" hidden title="Camera join requests">CAM REQUESTS <b id="cam-requests-count">0</b></button>
        <a id="open-btc-room" class="btn btn-ghost" href="/admin-room" target="_blank" rel="noopener" title="Phòng BTC: xem 4 cam, nói với tuyển thủ, chuyển tiếp âm thanh Discord">${ico('room')}BTC Room</a>
        <button id="copy-room" class="btn btn-ghost" title="Copy the Player Room invite link">${ico('link')}Player Link</button>
        <button id="copy-obs" class="btn btn-ghost" title="Copy the OBS Browser Source URL">${ico('link')}OBS URL</button>
        <button id="logout" class="btn btn-icon" title="Log out" aria-label="Log out">${ico('logout')}</button>
      </div>
    </header>
    <div class="workspace">
      <aside class="rail">
        <div class="rail-label"><span>GRAPHICS</span><span>PREV · LIVE</span></div>
        <div class="rail-stack">${graphicLayersMarkup}</div>
        <div class="rail-label"><span>CAMERAS</span></div>
        <div class="rail-tile rail-group" id="camera-group-control">
          <div class="rail-group-head">
            <button id="camera-expand" class="tile-icon tile-expand" aria-expanded="false" aria-controls="camera-subcontrols" title="Show A1–B2">${ico('camera')}</button>
            <span class="tile-copy"><strong>All cameras</strong><small id="camera-group-status">Preview 0/4 · Live 0/4</small></span>
            ${prevToggle('id="camera-all-preview"', 'All 4 cameras in Preview')}
            <button id="camera-all-live" class="live-btn" title="All 4 cameras on Program (on / off)"><span id="camera-all-live-state">OFF</span></button>
          </div>
          <div id="camera-subcontrols" class="cam-slots" hidden>${cameraLayersMarkup}</div>
        </div>
        <div class="rail-tile rail-group" id="focus-control">
          <div class="rail-group-head">
            <span class="tile-icon">${ico('focus')}</span>
            <span class="tile-copy"><strong>Cam Focus</strong><small id="focus-status">Turn cameras on first</small></span>
            ${prevToggle('id="focus-preview"', 'Cam Focus in Preview')}
            <button id="focus-live" class="live-btn" title="Cam Focus on Program (on / off)"><span id="focus-live-indicator">OFF</span></button>
          </div>
          <div class="focus-teams" role="group" aria-label="Focused team">
            <button class="focus-team" data-focus-team="A" title="Focus the left team's cameras"><span class="team-chip chip-a">A</span><span id="focus-name-a">TEAM A</span></button>
            <button class="focus-team" data-focus-team="B" title="Focus the right team's cameras"><span class="team-chip chip-b">B</span><span id="focus-name-b">TEAM B</span></button>
          </div>
        </div>
        <div class="rail-label"><span>BO SCORE</span><span>LIVE</span></div>
        <div class="score-rows">
          ${['A', 'B'].map(side => `<div class="score-row"><span class="team-chip chip-${side.toLowerCase()}">${side}</span><strong class="score-team" id="live-name-${side.toLowerCase()}">TEAM ${side}</strong><button class="score-btn" data-score-team="${side}" data-score-delta="-1" aria-label="Team ${side} −1">${ico('minus')}</button><strong class="score-value" id="live-score-${side.toLowerCase()}">0</strong><button class="score-btn" data-score-team="${side}" data-score-delta="1" aria-label="Team ${side} +1">${ico('plus')}</button></div>`).join('')}
        </div>
        <div class="spacer"></div>
        <button class="btn btn-clear full" id="clear-live" title="Hold to take every graphic and camera off air"><span class="hold-fill"></span><span class="hold-label">${ico('power')}HOLD TO CLEAR ALL</span></button>
      </aside>
      <main class="center">
        <div class="monitors">
          <section class="monitor monitor-preview">
            <header class="monitor-head"><span class="monitor-name"><i class="tally tally-preview"></i>PREVIEW</span><span id="draft-flag" class="monitor-flag">IN SYNC</span></header>
            <div id="preview-stage" class="monitor-screen"></div>
          </section>
          <section class="monitor monitor-program">
            <header class="monitor-head"><span class="monitor-name"><i class="tally tally-program"></i>PROGRAM</span><span class="monitor-flag" id="program-version">REV —</span></header>
            <div id="program-stage" class="monitor-screen"></div>
          </section>
        </div>
        <div class="take-bar">
          <div class="reference-toolbar" aria-label="Studio-only reference">
            <label class="ref-chip"><input type="checkbox" data-reference="image" checked/><span>Gameplay</span></label>
            <label class="ref-chip"><input type="checkbox" data-reference="grid"/><span>Grid</span></label>
            <label class="ref-chip"><input type="checkbox" data-reference="safeZones"/><span>Safe zones</span></label>
          </div>
          <strong id="take-title" class="take-title">In sync with Program</strong>
          <div class="take-actions">
            <button class="btn btn-ghost" id="replay-intro">${ico('replay')}Test Intro</button>
            <button class="btn btn-ghost" id="sync-draft">${ico('sync')}Sync from live</button>
            <button class="btn btn-take" id="take-live">TAKE</button>
          </div>
        </div>
        <section class="panel results-panel">
          <header class="panel-head"><h2>BO RESULTS</h2><span id="selected-match-note" class="panel-note">—</span><span class="panel-head-spacer"></span><span id="history-status" class="panel-note"></span><button id="show-history-audit" class="btn btn-text">Edit audit</button></header>
          <div class="results-body">
            <div id="history-rows" class="history-rows">—</div>
            <div class="result-editor history-fields">
              <div class="field field-game"><label>Game</label><select id="history-game"><option>1</option></select></div>
              <div class="field"><label id="history-left-label">Left goals</label><input id="history-left" type="number" min="0" max="25" value="0"/></div>
              <div class="field"><label id="history-right-label">Right goals</label><input id="history-right" type="number" min="0" max="25" value="0"/></div>
              <div class="field"><label>Decided by</label><select id="history-decided"><option value="regular">Regular time</option><option value="extra_time">Extra time</option><option value="penalties">Penalties</option></select></div>
              <div class="field history-pens" id="history-pens" hidden><label id="history-pens-label">Penalties (L – R)</label><span class="pens-pair"><input id="history-left-pens" type="number" min="0" max="30" value="0" aria-label="Left penalties"/><b>–</b><input id="history-right-pens" type="number" min="0" max="30" value="0" aria-label="Right penalties"/></span></div>
              <div class="field"><label>Winner (auto)</label><output id="history-winner" class="winner-auto">—</output></div>
              <div class="field field-note"><label>Note</label><input id="history-note" maxlength="240" placeholder="Optional"/></div>
              <button class="btn btn-solid" id="save-history">Save game</button>
            </div>
          </div>
        </section>
      </main>
      <aside class="setup">
        <nav class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="match" aria-selected="true">${ico('flag')}MATCH</button>
          <button class="tab" role="tab" data-tab="cameras" aria-selected="false">${ico('camera')}CAMERAS <b id="camera-roster" class="tab-count">—</b></button>
          <button class="tab" role="tab" data-tab="settings" aria-selected="false">${ico('settings')}SETTINGS</button>
        </nav>
        <div class="tab-panel" data-tab-panel="match">
          <div class="team-pick">
            <label class="field-label">TEAM A · LEFT</label>
            <div class="team-select"><img data-registry-logo="A" alt=""/><select data-registry-team="A"><option value="">Loading…</option></select></div>
            <small class="team-players" data-registry-label="A"></small>
          </div>
          <button class="btn btn-ghost full swap-btn" id="swap-sides">${ico('swap')}Swap sides</button>
          <div class="team-pick">
            <label class="field-label">TEAM B · RIGHT</label>
            <div class="team-select"><img data-registry-logo="B" alt=""/><select data-registry-team="B"><option value="">Loading…</option></select></div>
            <small class="team-players" data-registry-label="B"></small>
          </div>
          <small id="registry-status" class="panel-note"></small>
          <div class="field-row three"><div class="field"><label>Best of</label><select data-path="match.bestOf"><option value="3">BO3</option><option value="5">BO5</option><option value="7">BO7</option></select></div><div class="field"><label>Match #</label><input data-path="match.matchNumber" type="number" min="1" max="99" /></div><div class="field"><label>Game #</label><input data-path="match.gameNumber" type="number" min="1" max="9" /></div></div>
          <div class="field"><label>Stage / Round</label><input data-path="match.stage" maxlength="48" /></div>
          ${['A', 'B'].map(side => `
          <div class="custom-team" data-custom-team="${side}">
            <div class="field-label">CUSTOM TEAM ${side}</div>
            <div class="field-row"><div class="field"><label>Code</label><input data-path="match.team${side}.shortName" maxlength="9" /></div><div class="field"><label>Color</label><input type="color" data-path="match.team${side}.color" /></div></div>
            <div class="field"><label>Team name</label><input data-path="match.team${side}.name" maxlength="40" /></div>
            <div class="field"><label>Player</label><input data-path="match.team${side}.player" maxlength="28" /></div>
          </div>`).join('')}
          <div class="setup-foot"><button class="btn btn-ghost full" id="new-bo">Prepare new BO</button><small class="panel-note">Changes here go to Preview. Press TAKE to publish.</small></div>
        </div>
        <div class="tab-panel" data-tab-panel="cameras" hidden>
          <section class="camera-manager" id="camera-manager">
            <div class="cam-service"><span>Camera service</span><b id="camera-service-status">MEDIA OFFLINE</b></div>
            <div id="camera-requests" class="camera-requests"></div>
            <div id="camera-diagnostics" class="camera-diagnostics" aria-live="polite"></div>
            <small id="media-status" class="panel-note">—</small>
          </section>
        </div>
        <div class="tab-panel" data-tab-panel="settings" hidden>
          <div class="field-label placement-title"><span>SCOREBOARD POSITION</span><button type="button" class="btn btn-text" id="scoreboard-reset" title="X 0 · Y 0 · Scale 100%">Reset</button></div>
          <div class="field-row three"><div class="field"><label>X (px)</label><input data-path="layers.scoreboard.x" type="number" min="-640" max="640" step="1" title="Move right (+) / left (−), 2K pixels. Shift+arrow = 10 px" /></div><div class="field"><label>Y (px)</label><input data-path="layers.scoreboard.y" type="number" min="-360" max="360" step="1" title="Move down (+) / up (−), 2K pixels" /></div><div class="field"><label>Scale %</label><input data-path="layers.scoreboard.scale" type="number" min="50" max="200" step="1" title="Size, 100 = design size" /></div></div>
          <small class="panel-note">Preview first, then TAKE. 2K pixels (a 1080p output moves 0.75×). Shift + arrow = 10 px.</small>
        </div>
      </aside>
    </div>
    <footer class="footer-status"><div class="footer-left"><span class="footer-online-dot" id="footer-dot"></span><span id="footer-message">Connecting…</span></div><span id="renderer-list" class="renderer-list">No OBS renderer</span><span class="footer-version">v0.5F</span></footer>
    <div id="toast-stack" class="toast-stack" aria-live="assertive"></div>
  </div>`;
}
function refreshCameraGroup() {
    const draftCount = CAMERA_SLOTS.filter(slot => draft.cameras.slots[slot].visible).length;
    const liveCount = live ? CAMERA_SLOTS.filter(slot => live.cameras.slots[slot].visible).length : 0;
    const allPreview = app.querySelector('#camera-all-preview');
    if (allPreview) {
        allPreview.checked = draftCount === 4;
        allPreview.indeterminate = draftCount > 0 && draftCount < 4;
    }
    text('#camera-all-live-state', liveCount === 4 ? 'ON AIR' : liveCount === 0 ? 'OFF' : `${liveCount}/4`);
    text('#camera-group-status', `Preview ${draftCount}/4 · Live ${liveCount}/4`);
    $('#camera-group-control')?.classList.toggle('all-on-air', liveCount === 4);
    $('#camera-group-control')?.classList.toggle('on-air', liveCount > 0);
    refreshFocusControl();
}
/** v0.4H: Cam Focus control. Needs at least one camera slot on (Preview for PREV, Program for LIVE). */
function refreshFocusControl() {
    const draftCams = CAMERA_SLOTS.some(slot => draft.cameras.slots[slot].visible);
    const liveCams = !!live && CAMERA_SLOTS.some(slot => live.cameras.slots[slot].visible);
    const liveFocus = live?.layers.focus;
    const onAir = !!liveFocus?.visible && liveCams;
    const prev = app.querySelector('#focus-preview');
    if (prev) {
        prev.checked = draft.layers.focus.visible;
        prev.disabled = !draftCams && !draft.layers.focus.visible;
    }
    const liveBtn = app.querySelector('#focus-live');
    if (liveBtn)
        liveBtn.disabled = !live || (!liveCams && !liveFocus?.visible);
    text('#focus-live-indicator', onAir ? 'ON AIR' : 'OFF');
    $('#focus-live-indicator')?.classList.toggle('on', onAir);
    $('#focus-control')?.classList.toggle('on-air', onAir);
    const team = liveFocus?.team ?? draft.layers.focus.team;
    app.querySelectorAll('[data-focus-team]').forEach(btn => {
        btn.classList.toggle('is-selected', btn.dataset.focusTeam === team);
        btn.classList.toggle('is-on-air', onAir && btn.dataset.focusTeam === team);
        btn.setAttribute('aria-pressed', String(btn.dataset.focusTeam === team));
    });
    const names = live?.match ?? draft.match;
    text('#focus-name-a', names.teamA.teamId || names.teamA.shortName);
    text('#focus-name-b', names.teamB.teamId || names.teamB.shortName);
    const side = (t) => t === 'A' ? (names.teamA.teamId || names.teamA.shortName) : (names.teamB.teamId || names.teamB.shortName);
    text('#focus-status', !liveCams && !draftCams ? 'Turn cameras on first' : onAir ? `On air: ${side(team)} on top` : `Ready: ${side(team)}`);
}
/** Human status of one registered player: approval (server) + video (SFU). */
function cameraState(playerId) {
    if (!playerId)
        return { label: 'NO PLAYER', state: 'offline' };
    const player = cameraPlayers.find(p => p.playerId === playerId);
    const media = mediaPresence.find(m => m.playerId === playerId);
    if (media?.hasVideo)
        return { label: media.subscribed ? 'VIDEO ON SFU · RECEIVING' : 'VIDEO ON SFU', state: 'online' };
    if (player?.published)
        return { label: 'PUBLISHING', state: 'online' };
    if (player?.status === 'approved')
        return { label: player.connected ? 'APPROVED · NO VIDEO' : 'APPROVED · OFFLINE', state: 'pending' };
    if (player?.status === 'pending')
        return { label: 'WAITING APPROVAL', state: 'pending' };
    return { label: 'NOT JOINED', state: 'offline' };
}
const playerName = (playerId) => {
    if (!playerId)
        return 'Unassigned';
    const roster = cameraPlayers.find(p => p.playerId === playerId);
    if (roster)
        return roster.name;
    for (const team of registry?.teams ?? []) {
        const p = team.players.find(x => x.id === playerId);
        if (p)
            return p.displayName;
    }
    return playerId;
};
function refreshCameraControls() {
    // Never place untrusted player names into innerHTML; native Option escapes text.
    const summary = $('#camera-roster');
    if (summary) {
        const online = cameraPlayers.filter(p => cameraState(p.playerId).state === 'online');
        summary.textContent = `${online.length}/4`;
    }
    app.querySelectorAll('[data-camera-assign]').forEach(select => {
        const slot = select.dataset.cameraAssign;
        const selected = draft.cameras.slots[slot].playerId || '';
        const team = findRegistryTeam(slot[0] === 'A' ? draft.match.teamA.teamId : draft.match.teamB.teamId);
        select.replaceChildren();
        if (!team)
            select.add(new Option('Choose a registry team first', ''));
        // Only the two players of the team on this side can ever be selected.
        for (const player of team?.players ?? []) {
            const state = cameraState(player.id).state;
            select.add(new Option(`${state === 'online' ? '●' : state === 'pending' ? '◐' : '○'} ${player.id} · ${player.displayName}`, player.id));
        }
        select.value = selected;
        select.disabled = !team;
    });
    app.querySelectorAll('[data-camera-preview]').forEach(check => {
        check.checked = draft.cameras.slots[check.dataset.cameraPreview].visible;
    });
    refreshCameraGroup();
    const diagnostics = $('#camera-diagnostics');
    if (diagnostics) {
        diagnostics.replaceChildren();
        for (const slot of CAMERA_SLOTS) {
            const playerId = draft.cameras.slots[slot].playerId ?? defaultSlotPlayer(draft.match, slot);
            const teamId = slot[0] === 'A' ? draft.match.teamA.teamId : draft.match.teamB.teamId;
            const own = cameraState(playerId);
            const mate = playerId ? cameraState(playerId.replace(/-P([12])$/, (_m, n) => n === '1' ? '-P2' : '-P1')) : own;
            const label = own.state === 'online' ? own.label : mate.state === 'online' ? `${own.label} · TEAMMATE FALLBACK` : own.label;
            text(`#cam-player-${slot}`, playerName(playerId));
            const card = document.createElement('div');
            card.className = 'camera-diag-card';
            card.dataset.state = own.state === 'online' ? 'online' : mate.state === 'online' || own.state === 'pending' ? 'pending' : 'offline';
            const heading = document.createElement('strong');
            heading.textContent = `${slot} · ${teamId ?? 'NO TEAM'}`;
            const title = document.createElement('span');
            title.textContent = playerName(playerId);
            const badge = document.createElement('small');
            badge.textContent = label;
            badge.dataset.state = own.state === 'online' ? 'online' : mate.state === 'online' || own.state === 'pending' ? 'pending' : 'offline';
            const description = document.createElement('small');
            description.textContent = `Preview: ${draft.cameras.slots[slot].visible ? 'ON' : 'OFF'} · Program: ${live?.cameras.slots[slot].visible ? 'ON' : 'OFF'}`;
            card.append(heading, title, badge, description);
            const rosterEntry = cameraPlayers.find(p => p.playerId === playerId);
            if (rosterEntry && rosterEntry.status !== 'none') {
                // REVOKE ends the approval AND removes the publisher from LiveKit.
                const revoke = document.createElement('button');
                revoke.className = 'btn btn-text btn-danger-text';
                revoke.textContent = 'Revoke';
                revoke.addEventListener('click', async () => {
                    if (!confirm(`Revoke camera of ${rosterEntry.name} (${rosterEntry.playerId})?\nThe player is disconnected from LiveKit and must request access again.`))
                        return;
                    try {
                        await apiJSON('/api/camera/revoke', 'POST', { playerId: rosterEntry.playerId });
                        setStatus(`${rosterEntry.name}: camera revoked.`);
                    }
                    catch (e) {
                        showError(e instanceof Error ? e.message : 'Cannot revoke camera');
                    }
                });
                card.append(revoke);
            }
            diagnostics.append(card);
        }
    }
}
function beep() {
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.06;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
        osc.onended = () => void ctx.close();
    }
    catch { }
}
function refreshRequestBadge() {
    const badge = $('#cam-requests-badge');
    if (!badge)
        return;
    badge.hidden = cameraRequests.length === 0;
    text('#cam-requests-count', String(cameraRequests.length));
    badge.classList.toggle('pulse', cameraRequests.length > 0);
    let fresh = false;
    for (const r of cameraRequests)
        if (!knownRequestIds.has(r.id)) {
            knownRequestIds.add(r.id);
            fresh = true;
        }
    if (fresh) {
        beep();
        showToast(`Camera request: ${cameraRequests.map(r => `${r.teamId} · ${r.playerName}`).join(', ')}`, 'info');
    }
}
function refreshCameraRequests() {
    refreshRequestBadge();
    const root = $('#camera-requests');
    if (!root)
        return;
    root.replaceChildren();
    if (!cameraRequests.length)
        return;
    for (const item of cameraRequests) {
        const row = document.createElement('div');
        row.className = 'request-row';
        const label = document.createElement('span');
        label.textContent = `${item.teamId} · ${item.playerName}${item.replaces ? ' · REPLACES CURRENT DEVICE' : ''}`;
        row.append(label);
        for (const [title, approved] of [['APPROVE', true], ['REJECT', false]]) {
            const button = document.createElement('button');
            button.className = approved ? 'btn btn-solid' : 'btn btn-ghost';
            button.textContent = title;
            button.addEventListener('click', async () => {
                try {
                    await apiJSON('/api/camera/review', 'POST', { requestId: item.id, approved });
                    setStatus(`${item.playerName}: ${approved ? 'approved' : 'rejected'}.`);
                    await loadCameraRequests();
                }
                catch (e) {
                    setStatus(e instanceof Error ? e.message : 'Cannot review join request', true);
                }
            });
            row.append(button);
        }
        root.append(row);
    }
}
async function loadCameraRequests() {
    try {
        const result = await apiJSON('/api/camera/requests');
        cameraRequests = result.requests;
        refreshCameraRequests();
    }
    catch { /* server session may be reconnecting */ }
}
function findRegistryTeam(id) {
    return registry?.teams.find(team => team.id === id) ?? null;
}
function refreshRegistrySelectors() {
    for (const side of ['A', 'B']) {
        const key = side === 'A' ? 'teamA' : 'teamB';
        const current = draft.match[key];
        const teamSelect = app.querySelector(`[data-registry-team="${side}"]`);
        const playerSelect = app.querySelector(`[data-registry-player="${side}"]`);
        const logo = app.querySelector(`[data-registry-logo="${side}"]`);
        const label = app.querySelector(`[data-registry-label="${side}"]`);
        if (!teamSelect || !logo)
            continue;
        teamSelect.replaceChildren(new Option(registry ? '— Custom team —' : 'Registry offline', ''));
        for (const team of registry?.teams ?? []) {
            teamSelect.add(new Option(`${team.id} · ${team.club.name} (Group ${team.group})`, team.id));
        }
        teamSelect.value = findRegistryTeam(current.teamId) ? current.teamId : '';
        const team = findRegistryTeam(current.teamId);
        // v0.4A: the Intro shows both players of the team; no per-player selector.
        if (playerSelect) {
            playerSelect.replaceChildren(new Option('—', ''));
            playerSelect.disabled = true;
        }
        if (label)
            label.textContent = team ? team.players.map(p => p.displayName).join(' · ') : '';
        logo.hidden = !team;
        if (team)
            logo.src = team.club.logo;
        else
            logo.removeAttribute('src');
    }
}
function applyRegistryTeam(side, id) {
    const found = findRegistryTeam(id);
    if (!found)
        return;
    const key = side === 'A' ? 'teamA' : 'teamB';
    const opposite = side === 'A' ? 'teamB' : 'teamA';
    if (draft.match[opposite].teamId === id) {
        setStatus('Two sides cannot select the same tournament team.', true);
        refreshRegistrySelectors();
        return;
    }
    const original = draft.match[key];
    const first = found.players[0];
    const hadSession = !!draft.match.matchId;
    draft.match[key] = {
        teamId: found.id, playerId: first?.id, clubLogo: found.club.logo, name: found.club.name, shortName: found.id,
        player: first?.displayName ?? 'Player', color: found.club.colors.primary, portrait: '',
        seriesWins: original.seriesWins, gameGoals: original.gameGoals
    };
    // Slots on this side bind to the new team's players (A1->P1, A2->P2).
    for (const suffix of ['1', '2']) {
        const slot = `${side}${suffix}`;
        draft.cameras.slots[slot] = { playerId: `${found.id}-P${suffix}`, visible: false };
    }
    const opensNewBo = reconcileMatchId();
    if (!draft.match.matchId)
        resetNewBoPreview();
    else if (!hadSession && !newBoPrepared)
        restoreCurrentBoPreview();
    setInputValues();
    preview?.render(draft);
    if (preview)
        cameraReceiver?.setComposition(preview, draft);
    refreshFlags();
    void loadMatchHistory();
    setStatus(opensNewBo
        ? `${side}: ${found.id} · ${found.club.name} staged. ⚠ Different teams from the live BO: TAKE will OPEN A NEW BO.`
        : `${side}: ${found.id} · ${found.club.name} staged. Same BO as live. TAKE to publish.`, opensNewBo);
}
/**
 * Keep the live BO session when Preview still shows the same two teams (even
 * after changing a team and changing it back, or swapping sides). Returns true
 * when the next TAKE would open a new BO. (v0.3F A4)
 */
function reconcileMatchId() {
    const liveId = live?.match.matchId;
    const sameTeams = !!liveId && !!draft.match.teamA.teamId && !!draft.match.teamB.teamId &&
        [draft.match.teamA.teamId, draft.match.teamB.teamId].sort().join() === [live.match.teamA.teamId, live.match.teamB.teamId].sort().join();
    if (sameTeams && !newBoPrepared)
        draft.match.matchId = liveId;
    else
        draft.match.matchId = undefined;
    return !draft.match.matchId && !!draft.match.teamA.teamId && !!draft.match.teamB.teamId;
}
function applyRegistryPlayer(side, id) {
    const key = side === 'A' ? 'teamA' : 'teamB';
    const team = findRegistryTeam(draft.match[key].teamId);
    const player = team?.players.find(p => p.id === id);
    if (!player)
        return;
    draft.match[key].playerId = player.id;
    draft.match[key].player = player.displayName;
    setInputValues();
    preview?.render(draft);
    refreshFlags();
}
async function loadTournamentRegistry() {
    try {
        const response = await fetch('/api/tournament/registry', { cache: 'no-store' });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload.schemaVersion !== 1 || !Array.isArray(payload.teams) || payload.teams.length !== 16)
            throw new Error('Unexpected tournament registry schema');
        registry = payload;
        refreshRegistrySelectors();
        text('#registry-status', '');
        void loadMatchList();
    }
    catch (err) {
        text('#registry-status', `Registry unavailable: ${err instanceof Error ? err.message : 'Error'}. Manual fields still work.`);
    }
}
async function apiJSON(path, method = 'GET', payload) {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok)
        throw new Error(result.error || `HTTP ${response.status}`);
    return result;
}
function selectedMatch() { return matches.find(m => m.id === draft.match.matchId) ?? null; }
function refreshMatchList() {
    const m = selectedMatch();
    text('#selected-match-note', draft.match.matchId
        ? (m ? `${m.leftTeamId} vs ${m.rightTeamId} · BO${m.bestOf} · #${draft.match.matchId.slice(-6)}` : 'Loading…')
        : 'New BO in Preview — opens on TAKE');
    refreshHistoryWinnerOptions();
}
async function loadMatchList() {
    try {
        const result = await apiJSON('/api/bo/current');
        matches = result.match ? [result.match] : [];
        refreshMatchList();
        await loadMatchHistory();
    }
    catch (e) {
        setStatus(`Current BO unavailable: ${e instanceof Error ? e.message : 'Error'}`, true);
    }
}
/** Prepare a clean BO payload; the server independently rejects stale scores. */
function resetNewBoPreview() {
    draft = resetNewBoDraft(draft);
    history = [];
    editingGameVersion = 0;
    preview?.setHistoryData(null, []);
}
/** Returning to the currently live teams must not accidentally zero that BO. */
function restoreCurrentBoPreview() {
    if (live)
        draft = restoreCurrentBoDraft(draft, live);
}
function prepareNewBo() {
    if (!draft.match.teamA.teamId || !draft.match.teamB.teamId || draft.match.teamA.teamId === draft.match.teamB.teamId) {
        setStatus('Choose two distinct tournament teams before preparing the BO.', true);
        return;
    }
    if (!window.confirm('Prepare a NEW BO in Preview? This resets the manual BO scoreboard and camera slot assignments in Preview only. Saved Game History from the previous BO remains in SQLite.'))
        return;
    newBoPrepared = true;
    draft.match.matchId = undefined;
    resetNewBoPreview();
    setInputValues();
    preview?.render(draft);
    if (preview)
        cameraReceiver?.setComposition(preview, draft);
    refreshFlags();
    refreshMatchList();
    refreshHistoryRows();
    setStatus('New BO prepared. TAKE to activate its new camera room and save a BO session ID.');
}
function teamFromRegistry(id, old) {
    const team = findRegistryTeam(id);
    if (!team)
        throw new Error(`Team ${id} is missing from registry`);
    const first = team.players[0];
    return { teamId: id, playerId: first?.id, clubLogo: team.club.logo, name: team.club.name,
        shortName: id, player: first?.displayName ?? 'Player', color: team.club.colors.primary, portrait: '',
        seriesWins: old.seriesWins, gameGoals: old.gameGoals };
}
function swapPreviewSides() {
    if (!draft.match.teamA.teamId || !draft.match.teamB.teamId) {
        setStatus('Select two registry teams first', true);
        return;
    }
    [draft.match.teamA, draft.match.teamB] = [draft.match.teamB, draft.match.teamA];
    // Slot assignments move with the corresponding on-screen side; no media reconnection.
    for (const suffix of ['1', '2']) {
        const a = `A${suffix}`, b = `B${suffix}`;
        [draft.cameras.slots[a], draft.cameras.slots[b]] = [draft.cameras.slots[b], draft.cameras.slots[a]];
    }
    setInputValues();
    preview?.render(draft);
    if (preview)
        cameraReceiver?.setComposition(preview, draft);
    refreshFlags();
    refreshMatchList();
    refreshHistoryWinnerOptions();
    setStatus('Sides swapped in PREVIEW (teams, scores & camera assignments). TAKE to go live.');
}
function getMatchSides() {
    const m = selectedMatch();
    if (!m)
        return null;
    // Game results always use stable database left/right, even after a display-side swap.
    return { left: m.leftTeamId, right: m.rightTeamId };
}
const inputValue = (id) => app.querySelector(`#${id}`).value;
const numberField = (id) => { const raw = inputValue(id).trim(); return raw === '' ? NaN : Number(raw); };
/** v0.4E: read the form; the winner always follows the score (penalties when level). */
function historyFormState() {
    const sides = getMatchSides();
    const leftGoals = numberField('history-left'), rightGoals = numberField('history-right');
    const decidedBy = app.querySelector('#history-decided').value;
    const penalties = decidedBy === 'penalties';
    const leftPens = penalties ? numberField('history-left-pens') : null, rightPens = penalties ? numberField('history-right-pens') : null;
    let winner = null;
    if (sides && Number.isInteger(leftGoals) && Number.isInteger(rightGoals)) {
        if (!penalties && leftGoals !== rightGoals)
            winner = leftGoals > rightGoals ? sides.left : sides.right;
        if (penalties && leftGoals === rightGoals && Number.isInteger(leftPens) && Number.isInteger(rightPens) && leftPens !== rightPens)
            winner = leftPens > rightPens ? sides.left : sides.right;
    }
    return { sides, leftGoals, rightGoals, decidedBy, leftPens, rightPens, winner };
}
function refreshDecidedUi() {
    const select = app.querySelector('#history-decided');
    if (!select)
        return;
    const f = historyFormState();
    const level = Number.isInteger(f.leftGoals) && f.leftGoals === f.rightGoals;
    // A level score can only be decided by penalties; penalties need a level score.
    if (level && select.value !== 'penalties')
        select.value = 'penalties';
    if (!level && select.value === 'penalties')
        select.value = 'regular';
    for (const option of Array.from(select.options))
        option.disabled = level ? option.value !== 'penalties' : option.value === 'penalties';
    app.querySelector('#history-pens').hidden = select.value !== 'penalties';
    const now = historyFormState();
    const name = (id) => id ? `${id} — ${findRegistryTeam(id)?.club.name ?? id}` : '—';
    text('#history-winner', now.winner ? name(now.winner) : level ? 'Enter penalties' : '—');
}
function refreshHistoryWinnerOptions() {
    const sides = getMatchSides();
    if (!sides)
        return;
    text('#history-left-label', `${sides.left} · ${findRegistryTeam(sides.left)?.club.name ?? ''} goals`);
    text('#history-right-label', `${sides.right} · ${findRegistryTeam(sides.right)?.club.name ?? ''} goals`);
    text('#history-pens-label', `Penalties ${sides.left} – ${sides.right}`);
    refreshDecidedUi();
}
function refreshHistoryRows() {
    const rows = $('#history-rows');
    if (!rows)
        return;
    rows.replaceChildren();
    const match = selectedMatch();
    const sides = getMatchSides();
    if (!match || !sides) {
        rows.textContent = 'No live BO yet.';
        return;
    }
    for (let i = 1; i <= match.bestOf; i++) {
        const entry = history.find(g => g.gameNumber === i);
        const row = document.createElement('div');
        row.className = 'history-row';
        row.classList.toggle('is-selected', app.querySelector('#history-game')?.value === String(i));
        row.classList.toggle('is-saved', !!entry);
        const title = document.createElement('span');
        title.className = 'history-game';
        title.textContent = `G${i}`;
        row.append(title);
        const suffix = entry ? decidedSuffix(entry) : '';
        const score = document.createElement('strong');
        score.textContent = entry ? `${entry.leftGoals} – ${entry.rightGoals}` : '—';
        if (suffix) {
            const how = document.createElement('small');
            how.className = 'history-decided-tag';
            how.textContent = suffix;
            score.append(how);
        }
        row.append(score);
        const winner = document.createElement('span');
        winner.className = 'history-winner';
        winner.textContent = entry ? entry.winnerTeamId : '';
        row.append(winner);
        const action = document.createElement('button');
        action.className = 'btn btn-text';
        action.textContent = entry ? 'Edit' : 'Enter';
        action.addEventListener('click', () => {
            app.querySelector('#history-game').value = String(i);
            fillHistoryForm(i);
            refreshHistoryRows();
            app.querySelector('#history-left').focus();
        });
        row.append(action);
        rows.append(row);
    }
    text('#history-status', `${history.length}/${match.bestOf} saved`);
}
function fillHistoryForm(gameNumber) {
    const record = history.find(g => g.gameNumber === gameNumber);
    editingGameVersion = record?.version ?? 0;
    app.querySelector('#history-left').value = String(record?.leftGoals ?? 0);
    app.querySelector('#history-right').value = String(record?.rightGoals ?? 0);
    app.querySelector('#history-note').value = record?.note ?? '';
    app.querySelector('#history-decided').value = record?.decidedBy ?? 'regular';
    app.querySelector('#history-left-pens').value = String(record?.leftPens ?? 0);
    app.querySelector('#history-right-pens').value = String(record?.rightPens ?? 0);
    refreshHistoryWinnerOptions();
}
async function loadMatchHistory() {
    if (!draft.match.matchId) {
        history = [];
        editingGameVersion = 0;
        refreshHistoryRows();
        return;
    }
    try {
        const payload = await apiJSON(`/api/matches/${encodeURIComponent(draft.match.matchId)}/games`);
        history = payload.games;
        refreshHistoryRows();
        if (draft.match.matchId)
            preview?.setHistoryData(draft.match.matchId, history, payload.match?.leftTeamId, payload.match?.rightTeamId);
        const number = Number(app.querySelector('#history-game').value) || 1;
        fillHistoryForm(number);
    }
    catch (error) {
        setStatus(`History unavailable: ${error instanceof Error ? error.message : 'Error'}`, true);
    }
}
async function saveHistory() {
    const match = selectedMatch();
    const sides = getMatchSides();
    if (!match || !sides)
        return setStatus('Prepare a linked match first', true);
    const gameNumber = Number(app.querySelector('#history-game').value);
    const f = historyFormState();
    const note = app.querySelector('#history-note').value.trim();
    const valid = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
    if (!valid(gameNumber, match.bestOf) || gameNumber < 1 || !valid(f.leftGoals, 25) || !valid(f.rightGoals, 25))
        return setStatus('Invalid game number/goals (0-25)', true);
    if (f.decidedBy === 'penalties') {
        if (f.leftGoals !== f.rightGoals)
            return setStatus('Penalties need a level score', true);
        if (!valid(f.leftPens, 30) || !valid(f.rightPens, 30))
            return setStatus('Enter both penalty scores (0-30)', true);
        if (f.leftPens === f.rightPens)
            return setStatus('Penalty scores cannot be level', true);
    }
    else if (f.leftGoals === f.rightGoals)
        return setStatus('Level score: decide the game by penalties', true);
    if (!f.winner)
        return setStatus('Winner cannot be determined from the score', true);
    const old = history.find(g => g.gameNumber === gameNumber);
    const label = old ? 'EDIT an existing result' : 'CREATE a new result';
    const how = f.decidedBy === 'penalties' ? `\nPenalties: ${sides.left} ${f.leftPens} – ${f.rightPens} ${sides.right}` : f.decidedBy === 'extra_time' ? '\nDecided in extra time' : '';
    if (!window.confirm(`${label} for Game ${gameNumber}?\n${sides.left}: ${f.leftGoals}   —   ${sides.right}: ${f.rightGoals}${how}\nWinner: ${f.winner}${note ? `\nNote: ${note}` : ''}\n\nThis saves to DATABASE only. Manual BO scoreboard will NOT change.`))
        return;
    try {
        await apiJSON(`/api/matches/${encodeURIComponent(match.id)}/games`, 'PUT', {
            gameNumber, leftGoals: f.leftGoals, rightGoals: f.rightGoals, winnerTeamId: f.winner, note,
            decidedBy: f.decidedBy, leftPens: f.decidedBy === 'penalties' ? f.leftPens : null, rightPens: f.decidedBy === 'penalties' ? f.rightPens : null,
            expectedVersion: old?.version ?? 0
        });
        await loadMatchHistory();
        setStatus(`Game ${gameNumber} saved. Manual BO score unchanged.`);
    }
    catch (error) {
        setStatus(`Save failed: ${error instanceof Error ? error.message : 'Error'}`, true);
        await loadMatchHistory();
    }
}
function draftDirty() { return live !== null && !identicalDraft(draft, live); }
/** Errors stay visible as a toast; routine ACKs never overwrite them. */
function showToast(message, kind = 'error') {
    const stack = $('#toast-stack');
    if (!stack)
        return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${kind}`;
    toast.textContent = message;
    toast.addEventListener('click', () => toast.remove());
    stack.append(toast);
    while (stack.children.length > 4)
        stack.firstElementChild?.remove();
    window.setTimeout(() => toast.remove(), kind === 'error' ? 9000 : 5000);
}
function showError(message) { setStatus(message, true); }
function setStatus(message, isError = false) {
    if (isError)
        showToast(message, 'error');
    text('#footer-message', message);
    const el = $('#footer-message');
    if (el)
        el.classList.toggle('error-text', isError);
    clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => {
        text('#footer-message', connected ? 'Connected · Ready for commands' : 'Connection lost · Reconnecting…');
        el?.classList.remove('error-text');
    }, 5000);
}
/** Scoreboard placement limits; same as server/state.mjs SCOREBOARD_PLACEMENT. */
const PLACEMENT = { x: { min: -640, max: 640, def: 0 }, y: { min: -360, max: 360, def: 0 }, scale: { min: 50, max: 200, def: 100 } };
function resetScoreboardPlacement() {
    Object.assign(draft.layers.scoreboard, { x: PLACEMENT.x.def, y: PLACEMENT.y.def, scale: PLACEMENT.scale.def });
    setInputValues();
    preview?.render(draft);
    refreshFlags();
}
// Fields the server overwrites from the registry on TAKE when a C1–C16 team is
// selected. They are locked so edits are never silently discarded (A8).
const REGISTRY_FIELDS = new Set(['name', 'shortName', 'color', 'player']);
function refreshHistoryGameOptions() {
    const select = app.querySelector('#history-game');
    if (!select)
        return;
    const bestOf = selectedMatch()?.bestOf ?? draft.match.bestOf;
    const before = select.value;
    select.replaceChildren(...Array.from({ length: bestOf }, (_v, i) => new Option(String(i + 1), String(i + 1))));
    select.value = Number(before) <= bestOf ? before : '1';
}
function setInputValues() {
    app.querySelectorAll('[data-path]').forEach(el => {
        const parts = el.dataset.path.split('.');
        let value = draft;
        for (const part of parts)
            value = value[part];
        if (document.activeElement !== el)
            el.value = String(value ?? '');
        if (parts.length === 3 && REGISTRY_FIELDS.has(parts[2])) {
            const team = parts[1] === 'teamA' ? draft.match.teamA : draft.match.teamB;
            el.disabled = !!team.teamId;
            el.title = team.teamId ? 'Set by the tournament registry (choose team/player in the registry box above)' : '';
        }
    });
    app.querySelectorAll('[data-layer]').forEach(el => {
        el.checked = draft.layers[el.dataset.layer].visible;
    });
    app.querySelectorAll('[data-custom-team]').forEach(box => {
        box.hidden = !!(box.dataset.customTeam === 'A' ? draft.match.teamA : draft.match.teamB).teamId;
    });
    refreshCameraControls();
    refreshRegistrySelectors();
    if (matches.length)
        refreshMatchList();
}
function setProperty(path, raw) {
    const parts = path.split('.');
    let obj = draft;
    for (const key of parts.slice(0, -1))
        obj = obj[key];
    const key = parts.at(-1);
    const placement = path.startsWith('layers.scoreboard.') ? PLACEMENT[key] : undefined;
    if (placement) {
        // v0.4B: scoreboard nudge. Empty / invalid input keeps the last value.
        const value = Number(raw);
        if (raw.trim() === '' || !Number.isFinite(value))
            return;
        obj[key] = Math.max(placement.min, Math.min(placement.max, Math.round(value)));
    }
    else if (typeof obj[key] === 'number') {
        const value = Number(raw);
        if (!Number.isFinite(value))
            return;
        const maximum = key === 'seriesWins' ? Math.ceil(draft.match.bestOf / 2) : key === 'gameGoals' ? 25 : key === 'gameNumber' ? 9 : key === 'matchNumber' ? 99 : 9999;
        obj[key] = Math.max(key === 'gameNumber' || key === 'matchNumber' ? 1 : 0, Math.min(maximum, Math.trunc(value)));
    }
    else
        obj[key] = raw;
    if (path === 'match.bestOf') {
        // v0.3F: correcting BO3/5/7 updates the SAME BO session on TAKE (no new BO).
        const max = Math.ceil(draft.match.bestOf / 2);
        for (const team of [draft.match.teamA, draft.match.teamB])
            team.seriesWins = Math.min(team.seriesWins, max);
        refreshHistoryGameOptions();
        setInputValues();
    }
    preview?.render(draft);
    if (preview)
        cameraReceiver?.setComposition(preview, draft);
    refreshFlags();
}
function refreshFlags() {
    const changed = draftDirty();
    const stale = live !== null && baseRevision !== live.revision;
    text('#draft-flag', stale ? 'STALE DRAFT' : changed ? 'MODIFIED' : 'IN SYNC');
    text('#take-title', stale ? 'Stale preview — Sync from live' : changed ? 'Unpublished changes' : 'In sync with Program');
    text('#take-desc', stale ? 'Use Sync from live or resolve before TAKE.' : changed ? 'Take when the preview is ready.' : 'You can edit fields or use live quick cues.');
    text('#stage-validity', stale ? '⚠ Stale draft: sync required' : changed ? '● Unpublished changes' : '✓ No pending draft changes');
    // v0.5A: amber = Preview differs from Program (not on air yet).
    $('#draft-flag')?.classList.toggle('is-warn', stale || changed);
    $('.take-bar')?.classList.toggle('is-dirty', stale || changed);
    // TAKE is one command even though two responsive layouts contain buttons.
    const takeLocked = !connected || stale || !changed || !!pendingTakeId;
    $('#take-live')?.toggleAttribute('disabled', takeLocked);
    $('#take-right')?.toggleAttribute('disabled', takeLocked);
    refreshCameraGroup();
}
/** Each output tab is listed by label (OBS URL uses label=OBS), so a test tab is never mistaken for OBS. */
function refreshRenderers() {
    const current = live?.revision ?? -1;
    const obs = renderers.filter(r => r.label.toUpperCase() === 'OBS');
    const behind = obs.some(r => r.revision !== current);
    const visible = live ? CAMERA_SLOTS.filter(slot => live.cameras.slots[slot].visible) : [];
    const mediaWaiting = obs.some(r => r.revision === current && visible.length > 0 &&
        (r.mediaRevision !== current || !!r.cameraWaiting?.length));
    const label = obs.length === 0 ? 'OBS OFFLINE' : behind ? 'OBS SYNC PENDING' : mediaWaiting ? 'OBS CAMERA WAIT' :
        `OBS SYNCED${obs.length > 1 ? ` ×${obs.length}` : ''}`;
    text('#obs-status', label);
    $('#obs-pill')?.classList.toggle('is-online', obs.length > 0 && !behind && !mediaWaiting);
    $('#obs-pill')?.classList.toggle('is-pending', obs.length > 0 && (behind || mediaWaiting));
    text('#renderer-list', renderers.length ? renderers.map(r => {
        const revision = r.revision === current ? '✓' : '…';
        const media = r.revision !== current ? '' : !visible.length ? ' · cameras OFF' :
            r.mediaRevision !== current ? ' · media ?' : ` · camera ${r.cameraReady?.length ?? 0}/${visible.length} frames`;
        return `${r.label}: ${revision} rev ${r.revision ?? '—'}${media}`;
    }).join(' · ') : 'No OBS renderer');
}
function refreshLive() {
    if (!live)
        return;
    refreshRenderers();
    text('#revision', `REV ${live.revision}`);
    text('#program-version', `REV ${live.revision}`);
    for (const layer of ['scoreboard', 'intro', 'history'])
        text(`#${layer}-live-indicator`, live.layers[layer].visible ? 'ON AIR' : 'OFF');
    for (const layer of ['scoreboard', 'intro', 'history'])
        $(`[data-graphic-row="${layer}"]`)?.classList.toggle('on-air', live.layers[layer].visible);
    for (const slot of CAMERA_SLOTS)
        text(`#live-cam-${slot}`, live.cameras.slots[slot].visible ? 'ON' : 'OFF');
    for (const layer of ['scoreboard', 'intro', 'history'])
        $('#' + layer + '-live-indicator')?.classList.toggle('on', live.layers[layer].visible);
    for (const slot of CAMERA_SLOTS)
        $(`[data-camera-row="${slot}"]`)?.classList.toggle('on-air', live.cameras.slots[slot].visible);
    text('#live-name-a', live.match.teamA.shortName);
    text('#live-name-b', live.match.teamB.shortName);
    text('#live-score-a', String(live.match.teamA.seriesWins));
    text('#live-score-b', String(live.match.teamB.seriesWins));
    programStage?.render(live, initialized);
    if (programStage)
        cameraReceiver?.setComposition(programStage, live);
    initialized = true;
    refreshCameraControls();
    refreshFlags();
}
function settleCommand(id) {
    if (!id)
        return;
    const entry = pendingCommands.get(id);
    if (!entry)
        return;
    window.clearTimeout(entry.timer);
    pendingCommands.delete(id);
    if (entry.button) {
        entry.button.disabled = false;
        entry.button.classList.remove('is-pending');
    }
    if (entry.button?.dataset.scoreTeam)
        app.querySelectorAll('[data-score-team]').forEach(b => { b.disabled = false; });
    if (id === pendingTakeId) {
        pendingTakeId = '';
        refreshFlags();
    }
}
function sendCommand(command, button) {
    if (!connection || !connected) {
        showError('Cannot send: not connected');
        return;
    }
    if (button?.disabled || (command.type === 'program.take' && pendingTakeId))
        return;
    const outgoing = { ...command, id: freshId() };
    if (!connection.send(outgoing)) {
        showError('Could not send command');
        return;
    }
    // Only mark pending AFTER send succeeded, otherwise a rejected send can
    // permanently disable both TAKE controls until the page is reloaded.
    if (command.type === 'program.take') {
        pendingTakeId = outgoing.id;
        refreshFlags();
    }
    if (button) {
        // Lock until the server answers, so a double-click cannot send twice.
        button.disabled = true;
        button.classList.add('is-pending');
        if (button.dataset.scoreTeam)
            app.querySelectorAll('[data-score-team]').forEach(b => { b.disabled = true; });
    }
    pendingCommands.set(outgoing.id, { button, timer: window.setTimeout(() => {
            if (pendingCommands.has(outgoing.id)) {
                settleCommand(outgoing.id);
                showToast('No answer from server for 4 s. Check the connection and the Program monitor before pressing again.', 'warn');
            }
        }, 4000) });
}
function maybePrewarm() {
    // Tell OBS to join LiveKit while cameras are only staged in Preview, so the
    // LIVE camera cue shows video instead of a placeholder.
    if (!connection || !connected)
        return;
    if (!CAMERA_SLOTS.some(slot => draft.cameras.slots[slot].visible))
        return;
    if (Date.now() - lastPrewarm < 30_000)
        return;
    const boId = live?.match.matchId;
    if (!boId || draft.match.matchId !== boId)
        return; // no room exists for an un-TOKENED next BO yet
    const playerIds = new Set();
    for (const slot of CAMERA_SLOTS) {
        if (!draft.cameras.slots[slot].visible)
            continue;
        const team = slot[0] === 'A' ? draft.match.teamA.teamId : draft.match.teamB.teamId;
        if (team) {
            playerIds.add(`${team}-P1`);
            playerIds.add(`${team}-P2`);
        }
    }
    if (!playerIds.size)
        return;
    if (connection.send({ type: 'camera.prewarm', boId, playerIds: [...playerIds] }))
        lastPrewarm = Date.now();
}
function syncFromLive() {
    if (!live)
        return;
    newBoPrepared = false;
    draft = cloneProgram(live);
    baseProgram = cloneProgram(live);
    baseRevision = live.revision;
    setInputValues();
    preview?.render(draft);
    if (preview)
        cameraReceiver?.setComposition(preview, draft);
    refreshFlags();
    void loadMatchHistory();
    setStatus('Preview synced to current live state');
}
function takeLive() {
    if (pendingTakeId || !connected || !live || !draftDirty())
        return;
    if (!draft.match.teamA.teamId || !draft.match.teamB.teamId) {
        setStatus('Select two registry teams before TAKE to activate Player Room.', true);
        return;
    }
    if (baseRevision !== live.revision) {
        setStatus('Draft is stale — sync before Take', true);
        return;
    }
    // Safety net for a new BO, even if an older browser kept an old Preview.
    if (!draft.match.matchId && (draft.match.gameNumber !== 1 || [draft.match.teamA, draft.match.teamB].some(t => t.seriesWins !== 0 || t.gameGoals !== 0))) {
        setStatus('New BO must start at GAME 1, BO 0-0 and goals 0-0. Use PREPARE NEW BO.', true);
        return;
    }
    if (live.match.matchId && !draft.match.matchId) {
        const a = draft.match.teamA, b = draft.match.teamB;
        if (!confirm(`TAKE will OPEN A NEW BO: ${a.teamId} ${a.name} vs ${b.teamId} ${b.name} (BO${draft.match.bestOf}).\n\n• The current Player Room link stops working\n• All 4 player cameras of the current BO are disconnected\n• New Game History starts (old BO history stays saved)\n\nContinue?`))
            return;
    }
    const liveSession = selectedMatch();
    if (draft.match.matchId && liveSession && liveSession.bestOf !== draft.match.bestOf &&
        !confirm(`Change the CURRENT BO format from BO${liveSession.bestOf} to BO${draft.match.bestOf}? (Same BO, history kept.)`))
        return;
    sendCommand({ type: 'program.take', expectedRevision: baseRevision, match: structuredClone(draft.match), layers: structuredClone(draft.layers), cameras: structuredClone(draft.cameras) });
}
function startStudio() {
    studioMarkup();
    preview = mountStage($('#preview-stage'), 'preview');
    programStage = mountStage($('#program-stage'), 'program');
    const referencePrefs = { image: true, grid: false, safeZones: false };
    const refreshReference = () => {
        preview?.setReferenceOptions(referencePrefs);
        programStage?.setReferenceOptions(referencePrefs);
    };
    refreshReference();
    app.querySelectorAll('[data-reference]').forEach(input => input.addEventListener('change', () => {
        const key = input.dataset.reference;
        referencePrefs[key] = input.checked;
        refreshReference();
    }));
    cameraReceiver = new CameraReceiver([preview, programStage], { adaptiveStream: false, videoQuality: 'low' });
    // A hidden Studio tab does not need its own LiveKit video subscriptions.
    // The streamer OBS output uses an independent HIGH-quality connection.
    document.addEventListener('visibilitychange', () => cameraReceiver?.setMonitoringEnabled(!document.hidden));
    cameraReceiver.setMonitoringEnabled(!document.hidden);
    cameraReceiver.onStatus = message => text('#media-status', message);
    cameraReceiver.onMedia = players => { mediaPresence = players; refreshCameraControls(); };
    // v0.5A: setup lives in tabs (Match / Cameras / Settings); the last tab is remembered.
    const showTab = (name) => {
        app.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
        app.querySelectorAll('[data-tab-panel]').forEach(p => { p.hidden = p.dataset.tabPanel !== name; });
        try {
            localStorage.setItem('studio.tab', name);
        }
        catch { }
    };
    app.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
    try {
        const saved = localStorage.getItem('studio.tab');
        if (saved && app.querySelector(`[data-tab="${saved}"]`))
            showTab(saved);
    }
    catch { }
    $('#cam-requests-badge')?.addEventListener('click', () => { showTab('cameras'); $('#camera-requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    void cameraReceiver.connect();
    preview.render(draft, false);
    cameraReceiver.setComposition(preview, draft);
    programStage.render({ ...cloneProgram(draft), layers: { scoreboard: { visible: false }, intro: { visible: false }, history: { visible: false }, focus: { visible: false, team: 'A' } } }, false);
    setInputValues();
    void loadTournamentRegistry();
    $('#new-bo')?.addEventListener('click', prepareNewBo);
    $('#swap-sides')?.addEventListener('click', swapPreviewSides);
    $('#history-game')?.addEventListener('change', () => { fillHistoryForm(Number(app.querySelector('#history-game').value)); refreshHistoryRows(); });
    $('#save-history')?.addEventListener('click', () => void saveHistory());
    for (const id of ['history-left', 'history-right', 'history-decided', 'history-left-pens', 'history-right-pens'])
        $(`#${id}`)?.addEventListener('input', refreshDecidedUi);
    $('#show-history-audit')?.addEventListener('click', async () => {
        const m = selectedMatch();
        if (!m)
            return setStatus('Prepare a match first', true);
        try {
            const result = await apiJSON(`/api/matches/${encodeURIComponent(m.id)}/audit`);
            alert(result.audit.length ? result.audit.slice(0, 15).map((a) => `${a.createdAt} · GAME ${a.gameNumber} · ${a.action.toUpperCase()} · ${a.previous ? JSON.stringify(a.previous) : '(new)'} → ${JSON.stringify(a.next)}`).join('\n\n') : 'No history changes recorded yet.');
        }
        catch (e) {
            setStatus(e instanceof Error ? e.message : 'Audit unavailable', true);
        }
    });
    app.querySelectorAll('[data-registry-team]').forEach(select => {
        select.addEventListener('change', () => applyRegistryTeam(select.dataset.registryTeam, select.value));
    });
    app.querySelectorAll('[data-registry-player]').forEach(select => {
        select.addEventListener('change', () => applyRegistryPlayer(select.dataset.registryPlayer, select.value));
    });
    app.querySelectorAll('[data-path]').forEach(input => {
        input.addEventListener('input', () => setProperty(input.dataset.path, input.value));
    });
    $('#scoreboard-reset')?.addEventListener('click', resetScoreboardPlacement);
    // Shift+Arrow steps the placement by 10 (plain arrows step by 1).
    app.querySelectorAll('[data-path^="layers.scoreboard."]').forEach(input => {
        input.addEventListener('keydown', e => {
            if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown'))
                return;
            e.preventDefault();
            setProperty(input.dataset.path, String((Number(input.value) || 0) + (e.key === 'ArrowUp' ? 10 : -10)));
            const key = input.dataset.path.split('.').pop();
            input.value = String(draft.layers.scoreboard[key] ?? PLACEMENT[key].def);
        });
    });
    app.querySelectorAll('[data-layer]').forEach(input => {
        input.addEventListener('change', () => {
            draft.layers[input.dataset.layer].visible = input.checked;
            preview?.render(draft);
            refreshFlags();
        });
    });
    app.querySelectorAll('[data-live-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
            const layer = btn.dataset.liveToggle;
            if (!live)
                return;
            sendCommand({ type: 'layer.setVisible', layer, visible: !live.layers[layer].visible }, btn);
        });
    });
    app.querySelector('#focus-preview')?.addEventListener('change', event => {
        draft.layers.focus.visible = event.currentTarget.checked;
        preview?.render(draft);
        refreshFocusControl();
        refreshFlags();
    });
    $('#focus-live')?.addEventListener('click', event => {
        if (!live)
            return;
        sendCommand({ type: 'layer.setVisible', layer: 'focus', visible: !live.layers.focus.visible }, event.currentTarget);
    });
    app.querySelectorAll('[data-focus-team]').forEach(btn => {
        btn.addEventListener('click', () => {
            const team = btn.dataset.focusTeam;
            // One choice for both monitors: Preview follows at once, Program swaps the rows if Focus is on air.
            draft.layers.focus.team = team;
            preview?.render(draft);
            if (live && live.layers.focus.team !== team)
                sendCommand({ type: 'focus.setTeam', team }, btn);
            refreshFocusControl();
            refreshFlags();
        });
    });
    $('#camera-expand')?.addEventListener('click', () => {
        const details = $('#camera-subcontrols');
        const button = $('#camera-expand');
        if (!details || !button)
            return;
        details.hidden = !details.hidden;
        button.setAttribute('aria-expanded', String(!details.hidden));
    });
    app.querySelector('#camera-all-preview')?.addEventListener('change', event => {
        const visible = event.currentTarget.checked;
        for (const slot of CAMERA_SLOTS)
            draft.cameras.slots[slot].visible = visible;
        preview?.render(draft);
        if (preview)
            cameraReceiver?.setComposition(preview, draft);
        refreshCameraControls();
        refreshFlags();
        maybePrewarm();
    });
    $('#camera-all-live')?.addEventListener('click', event => {
        if (!live)
            return;
        const allVisible = CAMERA_SLOTS.every(slot => live.cameras.slots[slot].visible);
        sendCommand({ type: 'camera.setAllVisible', visible: !allVisible }, event.currentTarget);
    });
    app.querySelectorAll('[data-camera-assign]').forEach(select => {
        select.addEventListener('change', () => {
            draft.cameras.slots[select.dataset.cameraAssign].playerId = select.value || null;
            preview?.render(draft);
            if (preview)
                cameraReceiver?.setComposition(preview, draft);
            refreshCameraControls();
            refreshFlags();
        });
    });
    app.querySelectorAll('[data-camera-preview]').forEach(check => {
        check.addEventListener('change', () => {
            draft.cameras.slots[check.dataset.cameraPreview].visible = check.checked;
            preview?.render(draft);
            if (preview)
                cameraReceiver?.setComposition(preview, draft);
            refreshCameraGroup();
            refreshFlags();
            maybePrewarm();
        });
    });
    app.querySelectorAll('[data-camera-live]').forEach(button => {
        button.addEventListener('click', () => {
            const slot = button.dataset.cameraLive;
            if (!live)
                return;
            sendCommand({ type: 'camera.setVisible', slot, visible: !live.cameras.slots[slot].visible }, button);
        });
    });
    $('#copy-room')?.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/camera/invite-url');
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Cannot copy Player Room');
            }
            const payload = await response.json();
            await navigator.clipboard.writeText(payload.url);
            setStatus('Player Room invite link copied. Only send to players.');
        }
        catch (e) {
            setStatus(e instanceof Error ? e.message : 'Could not copy invite', true);
        }
    });
    app.querySelectorAll('[data-score-team]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!live)
                return;
            const team = btn.dataset.scoreTeam;
            // "from" = score the operator is looking at; the server rejects a second
            // click that was based on the same value (no accidental +2 on air).
            const from = (team === 'A' ? live.match.teamA : live.match.teamB).seriesWins;
            sendCommand({ type: 'score.adjust', team, kind: 'seriesWins', delta: Number(btn.dataset.scoreDelta), from }, btn);
        });
    });
    // v0.5A: EMERGENCY CLEAR needs a 0.9 s hold (mouse or Enter / Space), so a stray click never blanks the show.
    const clearBtn = app.querySelector('#clear-live');
    if (clearBtn) {
        let holdTimer = 0;
        const cancelHold = () => { window.clearTimeout(holdTimer); holdTimer = 0; clearBtn.classList.remove('is-holding'); };
        const startHold = () => {
            if (clearBtn.disabled || holdTimer)
                return;
            clearBtn.classList.add('is-holding');
            holdTimer = window.setTimeout(() => { cancelHold(); sendCommand({ type: 'program.clear' }, clearBtn); }, 900);
        };
        clearBtn.addEventListener('pointerdown', e => { if (e.button === 0)
            startHold(); });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur'])
            clearBtn.addEventListener(ev, cancelHold);
        clearBtn.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            e.preventDefault();
            startHold();
        } });
        clearBtn.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ')
            cancelHold(); });
    }
    $('#replay-intro')?.addEventListener('click', () => {
        if (!draft.layers.intro.visible) {
            draft.layers.intro.visible = true;
            setInputValues();
            preview?.render(draft);
        }
        else
            preview?.replayIntro();
        refreshFlags();
    });
    $('#sync-draft')?.addEventListener('click', () => {
        if (draftDirty() && !confirm('Discard unpublished preview changes and sync from Program?'))
            return;
        syncFromLive();
    });
    $('#take-live')?.addEventListener('click', takeLive);
    $('#take-right')?.addEventListener('click', takeLive);
    $('#copy-obs')?.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/obs-url');
            if (!response.ok)
                throw new Error('Not authorized');
            const payload = await response.json();
            await navigator.clipboard.writeText(payload.url);
            setStatus('OBS output URL copied. Add it to one Browser Source.');
        }
        catch {
            setStatus('Copy failed. Open Studio on localhost or HTTPS to enable clipboard.', true);
        }
    });
    $('#logout')?.addEventListener('click', async () => {
        connection?.close();
        void cameraReceiver?.disconnect();
        preview?.dispose();
        programStage?.dispose();
        await fetch('/api/logout', { method: 'POST' });
        location.reload();
    });
    connection = new LiveConnection('admin');
    connection.onStatus = (online) => {
        connected = online;
        text('#ws-status', online ? 'CONTROL' : 'DISCONNECTED');
        $('#ws-pill')?.classList.toggle('is-online', online);
        $('#footer-dot')?.classList.toggle('is-online', online);
        refreshFlags();
        if (online) {
            setStatus('Connected · Waiting for state');
            return;
        }
        for (const id of [...pendingCommands.keys()])
            settleCommand(id);
        text('#footer-message', 'Connection lost · Reconnecting…');
        // After 2 failed reconnects, check whether the login itself expired; if so
        // show the login form instead of looping on "DISCONNECTED" forever (A10).
        if (connection && connection.failures >= 2 && !authChecking) {
            authChecking = true;
            void fetch('/api/me', { cache: 'no-store' }).then(r => r.json()).then(me => {
                if (me && me.authenticated === false) {
                    connection?.close();
                    void cameraReceiver?.disconnect();
                    preview?.dispose();
                    programStage?.dispose();
                    showLogin();
                    text('#login-error', 'Studio session expired. Please log in again.');
                }
            }).catch(() => { }).finally(() => { authChecking = false; });
        }
    };
    connection.onEvent = (event) => {
        if (event.type === 'program.state') {
            const wasDirty = draftDirty();
            const previousLive = live;
            live = event.program;
            if (previousLive?.match.matchId !== live.match.matchId)
                lastPrewarm = 0;
            const wasOwnTake = !!pendingTakeId && event.commandId === pendingTakeId;
            if (wasOwnTake) {
                newBoPrepared = false;
                settleCommand(event.commandId);
            }
            if (!wasDirty || wasOwnTake || !baseProgram) {
                draft = cloneProgram(live);
                baseProgram = cloneProgram(live);
                baseRevision = live.revision;
            }
            else {
                // v0.3F: rebase the edited Preview onto the new Program instead of
                // leaving it STALE. Untouched fields (e.g. a live +1) follow Program.
                const result = rebaseDraft(baseProgram, draft, live);
                draft = result.program;
                baseProgram = cloneProgram(live);
                baseRevision = live.revision;
                if (result.conflicts.length)
                    showToast(`Preview and LIVE both changed: ${result.conflicts.join(', ')}. Preview kept your edit${result.conflicts.some(c => c.endsWith('seriesWins')) ? ' (BO score follows LIVE)' : ''}; check before TAKE.`, 'warn');
                else if (previousLive)
                    setStatus('Preview updated with the latest LIVE change; your edits are kept.');
            }
            setInputValues();
            preview?.render(draft, initialized);
            if (preview)
                cameraReceiver?.setComposition(preview, draft);
            refreshLive();
            refreshHistoryGameOptions();
            void cameraReceiver?.setSession(live.match.matchId);
            maybePrewarm(); // restore short-lived OBS warm subscriptions after WS reconnect
            if (!matches.some(m => m.id === live.match.matchId))
                void loadMatchList();
        }
        else if (event.type === 'match.history.snapshot') {
            programStage?.setHistoryData(event.matchId, event.games, event.leftTeamId, event.rightTeamId);
            if (draft.match.matchId === event.matchId)
                preview?.setHistoryData(event.matchId, event.games, event.leftTeamId, event.rightTeamId);
        }
        else if (event.type === 'match.history.changed') {
            if (draft.match.matchId === event.matchId)
                void loadMatchHistory();
        }
        else if (event.type === 'camera.roster') {
            cameraPlayers = event.players;
            preview?.setCameraPlayers(cameraPlayers);
            programStage?.setCameraPlayers(cameraPlayers);
            cameraReceiver?.setRoster(cameraPlayers);
            refreshCameraControls();
        }
        else if (event.type === 'camera.requests') {
            cameraRequests = event.requests;
            refreshCameraRequests();
        }
        else if (event.type === 'presence') {
            rendererCount = event.rendererCount;
            rendererRevision = event.rendererRevision ?? rendererRevision;
            renderers = event.renderers ?? [];
            refreshRenderers();
        }
        else if (event.type === 'renderer.ack') {
            rendererRevision = event.revision;
            // Presence is the authoritative per-output snapshot. The ACK alone
            // does not prove a camera has decoded its first frame.
            text('#footer-message', `Renderer ${event.label ?? ''} received layout revision ${event.revision} (camera status follows)`);
        }
        else if (event.type === 'command.ack') {
            // TAKE is complete only when the authoritative Program snapshot arrives,
            // not just when VPS accepts the command. Other commands settle on ACK.
            if (event.id !== pendingTakeId)
                settleCommand(event.id);
            text('#footer-message', `Server accepted command · revision ${event.revision}${event.id === pendingTakeId ? ' · waiting for Program state' : ''}`);
        }
        else if (event.type === 'command.error') {
            settleCommand(event.id);
            showError(event.reason);
        }
    };
    connection.connect();
    void loadCameraRequests();
    void fetch('/api/camera/config').then(r => r.json()).then(data => text('#camera-service-status', data.enabled ? 'READY' : 'NOT CONFIGURED')).catch(() => { });
    refreshFlags();
}
async function bootstrap() {
    try {
        const response = await fetch('/api/me');
        const me = await response.json();
        if (me.authenticated)
            startStudio();
        else
            showLogin();
    }
    catch {
        app.textContent = 'Cannot reach local Studio server.';
    }
}
bootstrap();
