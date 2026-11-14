import type { Program, LayerKey, CameraSlot, CameraPlayer, HistoryGame, TeamKey } from "./contracts.js";
import { decidedSuffix } from "./contracts.js";
import { createIntro, introMarkup, type IntroController } from "./intro.js";
import { createScoreboard, scoreboardMarkup, type ScoreboardController } from "./scoreboard.js";
import { createHistory, historyMarkup, backdropMarkup, tickerMarkup, createMascots, type HistoryController } from "./history.js";
import { Timeline, type MotionStep } from "./motion.js";

/** v0.4A: design space is 2K. 1080p outputs scale the whole stage by 0.75. */
export const STAGE_W = 2560, STAGE_H = 1440;

export type StageMode = "preview" | "program" | "output";
export interface StageHandle {
  render: (state: Program, animate?: boolean) => void;
  setLayer: (layer: LayerKey, visible: boolean) => void;
  replayIntro: () => void;
  getCameraVideo: (slot:CameraSlot) => HTMLVideoElement;
  setCameraStreamState: (slot:CameraSlot,ready:boolean) => void;
  setCameraPlayers: (players:CameraPlayer[]) => void;
  /** v0.4E: player whose camera a tile is showing (for the name tag). */
  setCameraSource?: (slot:CameraSlot,playerId:string|null) => void;
  setHistoryData: (matchId:string|null, games:HistoryGame[], leftTeamId?:string|null, rightTeamId?:string|null) => void;
  setReferenceOptions: (options:{image:boolean; grid:boolean; safeZones:boolean}) => void;
  /** Visual tests only: freeze the intro timeline at a time (ms). */
  seekIntro: (ms:number) => void;
  seekScoreboard: (ms:number) => void;
  seekHistory: (ms:number) => void;
  dispose: () => void;
}

function markup(mode: StageMode): string {
  return `
    <div class="stage-frame ${mode === "output" ? "stage-output" : "stage-monitor"}" data-instant="true">
      <div class="stage-world">
        ${mode !== "output" ? `<div class="studio-reference" aria-hidden="true"><div class="reference-grid"></div><div class="reference-safe-zones"><span class="reference-sz-top">SCOREBOARD AREA</span><span class="reference-sz-bottom">CAMERA STRIP</span></div></div>` : ""}
        <div class="graphics-root">
          ${introMarkup()}
          ${scoreboardMarkup()}
          ${focusMarkup()}
          ${camerasMarkup(mode)}
          ${historyMarkup()}
          <div class="legacy-1080">
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * v0.4C: four player cameras on the 2K stage, positions measured on the FVPL
 * frame (1080p x4/3). Left team = red frame (slots 1-2), right team = orange
 * frame (slots 3-4). Player 1 sits on the inner tile next to the game minimap,
 * player 2 on the outer tile, like the Intro. No names on air.
 */
export const CAMERA_TILES: Record<CameraSlot, { x: number; y: number }> = {
  A2: { x: 48, y: 1028 },    // 1 - left, outer
  A1: { x: 693, y: 1164 },   // 2 - left, inner
  B1: { x: 1495, y: 1164 },  // 3 - right, inner
  B2: { x: 2144, y: 1028 }   // 4 - right, outer (FVPL 1080: 1608..1887)
};
export const CAMERA_TILE_SIZE = { width: 372, height: 210, border: 5 };
export const CAMERA_FRAME_COLORS = { A: "#ff4242", B: "#fe9500" } as const;
/** v0.4E: small name tag sitting on top of the frame (never over the video). */
export const CAMERA_TAG = { height: 40, font: 31, minFont: 22, padding: 14, slant: 12 }; // v0.4G: esports caps

/**
 * v0.4H Cam Focus: the focused team's two cameras move up (a bit bigger),
 * the other team's two sit below them, centred, just above the hashtag band.
 * Row order keeps the on-air order of the bottom strip: A2 A1 | B1 B2.
 * Sizes are "a little bigger than the normal 372x210 tiles": x1.4 and x1.15.
 */
export const CAMERA_FOCUS = {
  top: { y: 753, width: 520, height: 293 },
  bottom: { y: 1106, width: 430, height: 242 },
  gap: 40,
  /**
   * BO History background shown only at the bottom: fully transparent above
   * `from` %, solid from `to` %. v0.4H r2: a long eased ramp (smootherstep,
   * many stops) so the background cross-fades into the game with no cut line.
   */
  mask: { from: 40, to: 90, stops: 14 },
  fadeOutMs: 200, fadeInMs: 320, rowDelayMs: 140
} as const;
export interface TileRect { x: number; y: number; width: number; height: number }
const ROW: Record<TeamKey, [CameraSlot, CameraSlot]> = { A: ["A2", "A1"], B: ["B1", "B2"] };
/** Tile rectangles for a layout: "normal" (bottom strip) or a focused team. */
export function cameraRects(layout: "normal" | TeamKey): Record<CameraSlot, TileRect> {
  const out = {} as Record<CameraSlot, TileRect>;
  if (layout === "normal") {
    for (const slot of ["A1", "A2", "B1", "B2"] as CameraSlot[]) out[slot] = { ...CAMERA_TILES[slot], width: CAMERA_TILE_SIZE.width, height: CAMERA_TILE_SIZE.height };
    return out;
  }
  const place = (team: TeamKey, row: { y: number; width: number; height: number }) => {
    const left = Math.round(STAGE_W / 2 - (row.width * 2 + CAMERA_FOCUS.gap) / 2);
    ROW[team].forEach((slot, i) => { out[slot] = { x: left + i * (row.width + CAMERA_FOCUS.gap), y: row.y, width: row.width, height: row.height }; });
  };
  place(layout, CAMERA_FOCUS.top);
  place(layout === "A" ? "B" : "A", CAMERA_FOCUS.bottom);
  return out;
}
/** Focus is on air only while at least one camera slot is on. */
export function focusLayout(program: Program): "normal" | TeamKey {
  const focus = program.layers.focus;
  const anyCamera = (["A1", "A2", "B1", "B2"] as CameraSlot[]).some(slot => program.cameras?.slots[slot]?.visible);
  return focus?.visible && anyCamera ? (focus.team === "B" ? "B" : "A") : "normal";
}
const FOCUS_STEPS: MotionStep[] = [
  { target: ".cf-backdrop", start: 0, duration: 0.42, easing: "cubic-bezier(.2,.8,.2,1)", keyframes: [{ transform: "translateY(260px)" }, { transform: "translateY(0px)" }] },
  { target: ".cf-backdrop .bh-bg", start: 0, duration: 0.3, easing: "linear", keyframes: [{ opacity: 0 }, { opacity: 1 }] },
  { target: ".cf-layer .bh-ticker", start: 0.12, duration: 0.34, easing: "cubic-bezier(.2,.8,.2,1)", keyframes: [{ transform: "translateY(100%)" }, { transform: "translateY(0%)" }] }
];
/** Eased mask: alpha follows smootherstep (zero slope at both ends, so no visible edge). */
export function focusMaskGradient(): string {
  const m = CAMERA_FOCUS.mask;
  const stops = Array.from({ length: m.stops + 1 }, (_, i) => {
    const t = i / m.stops, a = t * t * t * (t * (t * 6 - 15) + 10);
    return `rgba(0,0,0,${a.toFixed(3)}) ${(m.from + (m.to - m.from) * t).toFixed(1)}%`;
  });
  return `linear-gradient(180deg,rgba(0,0,0,0) 0%,${stops.join(",")},#000 100%)`;
}
function focusMarkup(): string {
  const mask = focusMaskGradient();
  return `
          <section class="graphic-layer cf-layer" data-state="hidden" aria-label="Camera focus background">
            <div class="cf-backdrop" style="-webkit-mask-image:${mask};mask-image:${mask}">${backdropMarkup()}</div>
            ${tickerMarkup()}
          </section>`;
}
function camerasMarkup(mode: StageMode): string {
  const { width, height } = CAMERA_TILE_SIZE;
  return `
          <section class="cameras-layer" aria-label="Player cameras">
            ${(["A2","A1","B1","B2"] as const).map((slot) => `
              <div class="camera-tile camera-slot-${slot} camera-side-${slot[0]}" data-slot="${slot}" data-visible="false" data-ready="false" style="left:${CAMERA_TILES[slot].x}px;top:${CAMERA_TILES[slot].y}px;width:${width}px;height:${height}px">
                <video data-camera-video="${slot}" muted autoplay playsinline disablepictureinpicture></video>
                <div class="camera-placeholder"><img src="/assets/brand/league-logo.png" alt="" decoding="async" />${mode !== "output" ? `<span class="camera-slot-label">${slot}</span>` : ""}</div>
              </div>
              <div class="camera-tag camera-tag-${slot} camera-side-${slot[0]}" data-slot="${slot}" data-show="false" style="${slot[0] === "A" ? `left:${CAMERA_TILES[slot].x}px` : `right:${2560 - CAMERA_TILES[slot].x - width}px`};top:${CAMERA_TILES[slot].y - CAMERA_TAG.height}px;height:${CAMERA_TAG.height}px;max-width:${width}px"><span class="camera-tag-name"></span></div>`).join("")}
          </section>`;
}

function getText(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Stage element ${selector} is missing`);
  return el;
}
export function mountStage(host: HTMLElement, mode: StageMode): StageHandle {
  host.classList.add("stage-host");
  host.innerHTML = markup(mode);
  const frame = host.querySelector<HTMLElement>(".stage-frame")!;
  const world = host.querySelector<HTMLElement>(".stage-world")!;
  const cameraElements={} as Record<CameraSlot,HTMLElement>;
  const cameraVideos={} as Record<CameraSlot,HTMLVideoElement>;
  for (const slot of ["A1","A2","B1","B2"] as CameraSlot[]) {
    cameraElements[slot]=getText(world,`.camera-tile[data-slot="${slot}"]`);
    cameraVideos[slot]=getText(world,`video[data-camera-video="${slot}"]`) as HTMLVideoElement;
  }
  // v0.4E: roster names for the camera name tags.
  let cameraPlayers: CameraPlayer[]=[];
  const cameraSource={} as Record<CameraSlot,string|null>;
  const cameraTags={} as Record<CameraSlot,HTMLElement>;
  for (const slot of ["A1","A2","B1","B2"] as CameraSlot[]) { cameraSource[slot]=null; cameraTags[slot]=getText(world,`.camera-tag[data-slot="${slot}"]`); }
  function updateCameraTag(slot:CameraSlot){
    const tag=cameraTags[slot],tile=cameraElements[slot];
    const name=cameraPlayers.find(p=>p.playerId===cameraSource[slot])?.name??'';
    const label=getText(tag,'.camera-tag-name');
    if(label.textContent!==name){
      label.textContent=name;label.style.fontSize=`${CAMERA_TAG.font}px`;
      const max=(tileRects[slot]?.width??CAMERA_TILE_SIZE.width)-CAMERA_TAG.padding*2-CAMERA_TAG.slant;
      if(name&&label.scrollWidth>max)label.style.fontSize=`${Math.max(CAMERA_TAG.minFont,Math.floor(CAMERA_TAG.font*max/label.scrollWidth))}px`;
    }
    tag.dataset.show=String(!!name&&tile.dataset.visible==="true"&&tile.dataset.ready==="true");
  }
  // v0.4H: Cam Focus. Tiles keep their <video> (no re-attach, no black frame):
  // they fade out, jump to the new rectangles while invisible, then fade in.
  const camerasLayer=getText(world,".cameras-layer");
  const focusRoot=getText(world,".cf-layer");
  const focusTimeline=new Timeline(focusRoot,FOCUS_STEPS,0.75);
  const focusMascots=createMascots(focusRoot,"focus");
  let tileRects=cameraRects("normal");
  let appliedLayout:"normal"|TeamKey="normal";
  let focusGen=0;
  function placeTiles(layout:"normal"|TeamKey){
    tileRects=cameraRects(layout);
    for(const slot of ["A1","A2","B1","B2"] as CameraSlot[]){
      const r=tileRects[slot],tile=cameraElements[slot],tag=cameraTags[slot];
      Object.assign(tile.style,{left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`});
      tag.style.top=`${r.y-CAMERA_TAG.height}px`;tag.style.maxWidth=`${r.width}px`;
      if(slot[0]==="A")tag.style.left=`${r.x}px`;else tag.style.right=`${STAGE_W-r.x-r.width}px`;
      const label=tag.querySelector<HTMLElement>(".camera-tag-name");if(label)label.textContent="";
      updateCameraTag(slot);
    }
    camerasLayer.dataset.focus=layout==="normal"?"":layout;
  }
  const fadeTargets=(slots:CameraSlot[])=>slots.flatMap(slot=>[cameraElements[slot],cameraTags[slot]]);
  function fade(els:HTMLElement[],to:0|1,delay:number,duration:number):Promise<unknown>{
    return Promise.all(els.map(el=>{
      for(const a of el.getAnimations?.()??[])if((a as unknown as {id?:string}).id==="cf")a.cancel();
      const from=to?{opacity:0,transform:"translateY(18px) scale(.94)"}:{opacity:Number(getComputedStyle(el).opacity),transform:"none"};
      // fade-in ends at the element's own on-air state (a slot that is off stays off)
      const shown=el.classList.contains("camera-tag")?el.dataset.show==="true":el.dataset.visible==="true";
      const end=to?{opacity:shown?1:0,transform:"none"}:{opacity:0,transform:"translateY(10px) scale(.97)"};
      const anim=el.animate([from,end],{delay,duration,easing:to?"cubic-bezier(.2,.8,.2,1)":"cubic-bezier(.4,0,1,1)",fill:"both"});
      (anim as unknown as {id:string}).id="cf";
      return anim.finished.catch(()=>undefined);
    }));
  }
  const clearFades=()=>{for(const el of fadeTargets(["A1","A2","B1","B2"]))for(const a of el.getAnimations?.()??[])if((a as unknown as {id?:string}).id==="cf")a.cancel();};
  function applyFocus(program:Program,animate:boolean){
    const target=focusLayout(program);
    const on=target!=="normal";
    if(on)focusMascots.start();else focusMascots.stop();
    if(target===appliedLayout){ if(on)focusTimeline.show(animate);else focusTimeline.hide(animate); return; }
    const gen=++focusGen;
    appliedLayout=target;
    if(!animate){ clearFades(); placeTiles(target); if(on)focusTimeline.show(false);else focusTimeline.hide(false); return; }
    // 1. tiles fade out where they are; the background rises at the same time (IN)
    if(on)focusTimeline.show(true);
    void fade(fadeTargets(["A1","A2","B1","B2"]),0,0,CAMERA_FOCUS.fadeOutMs).then(()=>{
      if(gen!==focusGen)return;
      if(!on)focusTimeline.hide(true);
      // 2. jump to the new layout while invisible, 3. fade in: focused team first, then the others
      placeTiles(target);
      const first=on?ROW[target]:(["A2","A1","B1","B2"] as CameraSlot[]);
      const second=on?ROW[target==="A"?"B":"A"]:[];
      const delay=on?120:CAMERA_FOCUS.fadeOutMs;
      void Promise.all([fade(fadeTargets(first),1,delay,CAMERA_FOCUS.fadeInMs),fade(fadeTargets(second),1,delay+CAMERA_FOCUS.rowDelayMs,CAMERA_FOCUS.fadeInMs)]).then(()=>{ if(gen===focusGen)clearFades(); });
    });
  }
  let historyMatchId:string|null=null;
  let historyGames:HistoryGame[]=[];
  let historyLeftTeamId:string|null=null;
  let last: Program | null = null;
  const intro: IntroController = createIntro(getText(world, ".intro-layer"));
  const scoreboard: ScoreboardController = createScoreboard(getText(world, ".sb-layer"));
  const historyBoard: HistoryController = createHistory(getText(world, ".bh-layer"));

  function resize() {
    const available = host.getBoundingClientRect();
    if (!available.width || !available.height) return;
    const scale = Math.min(available.width / STAGE_W, available.height / STAGE_H);
    world.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function applyData(program: Program, animate: boolean) {
    // v0.4B: Scoreboard and Intro own their markup, data and timelines.
    scoreboard.update(program, animate && last !== null);
    intro.update(program);
  }
  function updateHistory(program:Program) {
    // v0.4F: the board owns its markup, data and timeline.
    historyBoard.update(program,historyGames,historyMatchId,historyLeftTeamId,cameraPlayers);
  }
  function updateCameraTiles(program:Program) {
    for (const slot of ["A1","A2","B1","B2"] as CameraSlot[]) {
      const entry=program.cameras?.slots[slot];
      const tile=cameraElements[slot];
      // Slot presence and media readiness are separate: four visible slots stay
      // on screen even if a player is offline; the placeholder remains visible.
      tile.dataset.visible=String(!!entry?.visible);
      tile.dataset.assigned=entry?.playerId||'';
      updateCameraTag(slot);
    }
  }
  function setLayer(layer: LayerKey, visible: boolean) {
    if (layer === "intro") { intro.setVisible(visible, true); return; }
    if (layer === "scoreboard") { scoreboard.setVisible(visible, true); return; }
    if (layer === "focus") { if (last) applyFocus({ ...last, layers: { ...last.layers, focus: { ...last.layers.focus, visible } } }, true); return; }
    historyBoard.setVisible(visible, true);
  }
  function render(program: Program, animate = true) {
    if (!animate) frame.dataset.instant = "true";
    applyData(program, animate);
    scoreboard.setVisible(program.layers.scoreboard.visible, animate && last !== null);
    // Intro runs its own timeline (IN/OUT, interrupt-safe); a snapshot or
    // reconnect settles instantly at the final pose without replaying.
    intro.setVisible(program.layers.intro.visible, animate && last !== null);
    historyBoard.setVisible(!!program.layers.history?.visible, animate && last !== null);
    updateHistory(program);
    updateCameraTiles(program);
    applyFocus(program, animate && last !== null);
    last = program;
    if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => { delete frame.dataset.instant; }));
  }
  function replayIntro() { intro.replay(); }
  return {
    render,
    setLayer,
    replayIntro,
    getCameraVideo:(slot)=>cameraVideos[slot],
    setCameraStreamState:(slot,ready)=>{cameraElements[slot].dataset.ready=String(ready);updateCameraTag(slot);},
    setCameraPlayers:(players)=>{ cameraPlayers=players; if(last) { updateCameraTiles(last); updateHistory(last); } },
    setCameraSource:(slot,playerId)=>{ if(cameraSource[slot]===playerId) return; cameraSource[slot]=playerId; updateCameraTag(slot); },
    setHistoryData:(matchId,games,leftTeamId=null)=>{historyMatchId=matchId;historyGames=games;historyLeftTeamId=leftTeamId;if(last)updateHistory(last);},
    setReferenceOptions:({image,grid,safeZones})=>{
      if(mode==='output')return; // Output has no reference markup and is always transparent.
      frame.dataset.reference=String(image);
      frame.dataset.grid=String(grid);
      frame.dataset.safeZones=String(safeZones);
    },
    seekIntro: (ms:number) => intro.timeline.seek(ms),
    seekScoreboard: (ms:number) => scoreboard.timeline.seek(ms),
    seekHistory: (ms:number) => historyBoard.timeline.seek(ms),
    dispose: () => {
      observer.disconnect();
      intro.setVisible(false, false);
      scoreboard.setVisible(false, false);
      historyBoard.setVisible(false, false);
      focusMascots.stop();
      host.innerHTML = "";
    }
  };
}
