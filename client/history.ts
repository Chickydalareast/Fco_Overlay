import type { CameraPlayer, HistoryGame, Program, Team } from "./contracts.js";
import { decidedSuffix } from "./contracts.js";
import { Timeline, type MotionStep } from "./motion.js";

/**
 * BO History (v0.4F). Full-screen board between games, laid out like the
 * FVPL "Vòng đồng đội" board (1080p measurements x4/3), in the tournament
 * colours: left team red, right team white, black background.
 *
 *   logo (tournament only)
 *   left panel: 2 player strips + both player names | rows | right panel
 *   rows: [team name]  score / NEXT / GAME n  [team name]
 *   title: stage name (Stage / Round field)
 *
 * The background is drawn (SVG + CSS): moving red corner glows, running
 * diagonal lines, stars and embers on a loop, plus a scrolling hashtag band.
 * It only runs while the board is on air.
 */
export const BH = {
  panel: { x: 164, y: 151, w: 527, h: 1078, names: 109 },    // left panel; right = mirror (x 1872)
  logo: { centerY: 200, width: 500 },
  rows: { boxW: 419, gap: 268, centerY: 637, maxPitch: 171, area: 630, ratio: 0.78 },
  title: { baseline: 1224, size: 180, maxWidth: 1400 },
  // Cut-outs are fitted from their alpha (head ~45 px from the top, bottom on the names block).
  portrait: { headGap: 45 },
  // v0.4G: esports caps (Barlow Condensed 700), shrink to fit
  text: { name: 44, nameMin: 28, team: 56, teamMin: 30 },
  maxRows: 7
} as const;

/** Row geometry for n visible rows (BO3 = reference spacing; BO5/BO7 shrink to fit). */
export function rowLayout(n: number) {
  const r = BH.rows;
  const pitch = Math.min(r.maxPitch, r.area / Math.max(1, n));
  const height = Math.round(pitch * r.ratio);
  const block = (n - 1) * pitch + height;
  const top = Math.round(r.centerY - block / 2);
  return { pitch, height, top, rows: Array.from({ length: n }, (_, i) => Math.round(top + i * pitch)) };
}

export type RowKind = "played" | "next" | "upcoming";
export interface HistoryRow { gameNumber: number; kind: RowKind; main: string; sub: string }

/**
 * Rows of the board for the displayed sides. Games are stored with the
 * database left/right; when the sides are swapped on screen the score flips.
 * After one team has won enough games, the unplayed rows are hidden.
 */
export function historyRows(bestOf: number, games: HistoryGame[], flipped: boolean, leftTeamId: string | null): HistoryRow[] {
  const need = Math.floor(bestOf / 2) + 1;
  const byNumber = new Map(games.map(g => [g.gameNumber, g]));
  let leftWins = 0, rightWins = 0;
  for (const g of games) { if (leftTeamId && g.winnerTeamId === leftTeamId) leftWins++; else rightWins++; }
  const decided = leftWins >= need || rightWins >= need;
  const rows: HistoryRow[] = [];
  let nextGiven = false;
  for (let n = 1; n <= bestOf; n++) {
    const g = byNumber.get(n);
    if (g) {
      const [a, b] = flipped ? [g.rightGoals, g.leftGoals] : [g.leftGoals, g.rightGoals];
      const how = decidedSuffix(g, flipped);
      rows.push({ gameNumber: n, kind: "played", main: `${a} - ${b}`, sub: how ? `- ${how} -` : `- GAME ${n} -` });
    } else if (!decided) {
      rows.push(nextGiven
        ? { gameNumber: n, kind: "upcoming", main: `GAME ${n}`, sub: "" }
        : { gameNumber: n, kind: "next", main: "NEXT", sub: `- GAME ${n} -` });
      nextGiven = true;
    }
  }
  return rows;
}

const r = (n: number) => Math.round(n * 10) / 10;
const sparks: [number, number, number, string, number][] = [
  // x, y, size, colour, delay (s)
  [120, 1020, 26, "#ffb020", 0.2], [2440, 300, 30, "#ffffff", 1.1], [760, 120, 18, "#ff4242", 2.3], [1830, 70, 22, "#ffb020", 3.0],
  [96, 470, 16, "#ffffff", 3.8], [2480, 1180, 24, "#ff4242", 4.6], [640, 1380, 20, "#ffffff", 5.5], [1960, 1330, 28, "#ffb020", 6.4],
  [1280, 40, 14, "#ffffff", 7.2], [2330, 760, 18, "#ffb020", 8.1]
];
const embers = Array.from({ length: 14 }, (_, i) => ({ x: 80 + ((i * 337) % 2400), d: (i * 0.73) % 9, t: 7 + (i % 4) * 1.3, c: i % 3 === 0 ? "#ffb020" : "#ff3b40" }));

function backgroundSvg(): string {
  return `
    <svg class="bh-art" viewBox="0 0 2560 1440" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <path id="bh-star" d="M0 -20 L5 -5 L20 0 L5 5 L0 20 L-5 5 L-20 0 L-5 -5 Z"/>
        <radialGradient id="bh-glow" cx="50%" cy="78%" r="60%"><stop offset="0" stop-color="#5a0308" stop-opacity=".75"/><stop offset=".55" stop-color="#1c0103" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="2560" height="1440" fill="url(#bh-glow)"/>
      ${sparks.map(([x, y, s, c, d]) => `<g transform="translate(${x} ${y}) scale(${r(s / 20)})"><use href="#bh-star" class="bh-spark" fill="${c}" style="animation-delay:${d}s"/></g>`).join("")}
    </svg>`;
}

/**
 * v0.4G: small mascots (public/assets/brand/bg-mascot.png) fade in and out at
 * random, mostly in the corners, tilted less than 45 degrees.
 * v0.4H: 2-3 at a time and more often. Zones are the free areas of each scene
 * (2K centre points): BO History uses the corners and edges, Cam Focus only
 * the bottom (its background is masked above).
 */
export const MASCOT = {
  src: "/assets/brand/bg-mascot.png",
  max: 3,
  size: [130, 190] as [number, number],
  maxTilt: 30,
  opacity: 0.65,
  life: [4.5, 6.5] as [number, number],   // seconds per appearance
  pause: [0.6, 1.6] as [number, number],  // seconds between spawns
  minActive: 2,                           // below this a new one always joins
  joinChance: 0.5,                        // chance a 3rd one joins
  zones: [
    { id: "tl", x: [80, 520], y: [70, 100], weight: 3, scenes: ["history"] },
    { id: "tr", x: [2040, 2480], y: [70, 100], weight: 3, scenes: ["history"] },
    { id: "bl", x: [80, 520], y: [1288, 1300], weight: 3, scenes: ["history", "focus"] },
    { id: "br", x: [2040, 2480], y: [1288, 1300], weight: 3, scenes: ["history", "focus"] },
    { id: "l", x: [70, 90], y: [380, 1080], weight: 1, scenes: ["history"] },
    { id: "r", x: [2470, 2490], y: [380, 1080], weight: 1, scenes: ["history"] },
    { id: "bl2", x: [300, 600], y: [1130, 1170], weight: 2, scenes: ["focus"] },
    { id: "br2", x: [1960, 2260], y: [1130, 1170], weight: 2, scenes: ["focus"] }
  ]
} as const;
export type MascotScene = "history" | "focus";
export interface MascotSpawn { zone: string; x: number; y: number; size: number; tilt: number; life: number }
/** Pure picker (tested): a spawn in a zone not already in use, or null. */
export function pickMascot(rand: () => number, busy: string[], scene: MascotScene = "history"): MascotSpawn | null {
  const free = MASCOT.zones.filter(z => (z.scenes as readonly string[]).includes(scene) && !busy.includes(z.id));
  if (!free.length) return null;
  let roll = rand() * free.reduce((t, z) => t + z.weight, 0);
  const zone = free.find(z => (roll -= z.weight) < 0) ?? free[free.length - 1]!;
  const span = (range: readonly [number, number]) => range[0] + rand() * (range[1] - range[0]);
  const tilt = (rand() * 2 - 1) * MASCOT.maxTilt;
  return { zone: zone.id, x: Math.round(span(zone.x)), y: Math.round(span(zone.y)), size: Math.round(span(MASCOT.size)), tilt: Math.round(tilt), life: span(MASCOT.life) };
}

/** v0.4F r2: looping hashtag band at the bottom (red / grey, normal speed). */
export const BH_TICKER = { text: "#ABUxOHMYCASHCUP", items: 8, top: 1372, height: 68, speed: 60 };

/** v0.4H: the BO History background + hashtag band, shared with the Cam Focus scene. */
export function backdropMarkup(): string {
  return `
      <div class="bh-bg">
        <div class="bh-base"></div>
        <div class="bh-glow bh-glow-tl"></div><div class="bh-glow bh-glow-tr"></div><div class="bh-glow bh-glow-bl"></div><div class="bh-glow bh-glow-br"></div>
        <div class="bh-mascots">${Array.from({ length: MASCOT.max }, () => `<img class="bh-mascot" src="${MASCOT.src}" alt="" decoding="async" />`).join("")}</div>
        <div class="bh-speed"></div>
        ${backgroundSvg()}
        <div class="bh-embers">${embers.map(e => `<i style="left:${e.x}px;background:${e.c};animation-duration:${e.t}s;animation-delay:-${r(e.d)}s"></i>`).join("")}</div>
      </div>`;
}
export function tickerMarkup(): string {
  return `<div class="bh-ticker"><div class="bh-ticker-track">${Array.from({ length: BH_TICKER.items * 2 }, (_, i) => `<span class="${i % 2 ? "bh-tick-grey" : "bh-tick-red"}">${BH_TICKER.text}</span>`).join("")}</div></div>`;
}

export function historyMarkup(): string {
  const panel = (side: "a" | "b") => `
      <div class="bh-panel bh-panel-${side}">
        <div class="bh-strip bh-strip-1"><img class="bh-portrait" alt="" decoding="async" /><i class="bh-wave"></i></div>
        <div class="bh-strip bh-strip-2"><img class="bh-portrait" alt="" decoding="async" /><i class="bh-wave"></i></div>
        <div class="bh-names"><span class="bh-name bh-name-1"></span><span class="bh-name bh-name-2"></span></div>
      </div>`;
  const box = (side: "a" | "b") => `<div class="bh-box bh-box-${side}"><i class="bh-acc-tl"></i><i class="bh-acc-br"></i><i class="bh-acc-edge"></i><i class="bh-acc-tab"></i><span class="bh-team"></span></div>`;
  return `
    <section class="graphic-layer bh-layer" data-state="hidden" aria-label="BO history">
      ${backdropMarkup()}
      <img class="bh-logo" src="/assets/brand/league-logo.png" alt="" decoding="async" />
      ${panel("a")}${panel("b")}
      <div class="bh-rows">${Array.from({ length: BH.maxRows }, (_, i) => `
        <div class="bh-row bh-row-${i}" data-row="${i}" hidden>${box("a")}<div class="bh-mid"><b class="bh-main"></b><small class="bh-sub"></small></div>${box("b")}</div>`).join("")}
      </div>
      <div class="bh-title-wrap"><div class="bh-title"><span class="bh-title-text"></span></div></div>
      ${tickerMarkup()}
    </section>`;
}

export function historyStyle(): string {
  const p = BH.panel, rows = BH.rows;
  const stripW = p.w / 2, stripH = p.h - p.names;
  const midX = 1280, boxA = midX - rows.gap / 2 - rows.boxW, boxB = midX + rows.gap / 2;
  return `
  .bh-panel{top:${p.y}px;width:${p.w}px;height:${p.h}px}
  .bh-panel-a{left:${p.x}px}.bh-panel-b{left:${2560 - p.x - p.w}px}
  .bh-strip{width:${r(stripW)}px;height:${stripH}px}.bh-strip-2{left:${r(stripW)}px}
  .bh-portrait{height:${r(stripH * 1.18)}px;bottom:0}
  .bh-names{height:${p.names}px}
  .bh-logo{width:${BH.logo.width}px;left:${1280 - BH.logo.width / 2}px;top:${r(BH.logo.centerY - BH.logo.width * 407 / 1200 / 2)}px}
  .bh-box{width:${rows.boxW}px}.bh-box-a{left:${boxA}px}.bh-box-b{left:${boxB}px}
  .bh-mid{left:${boxA + rows.boxW}px;width:${rows.gap}px}
  .bh-title-wrap{top:${BH.title.baseline - BH.title.size}px;height:${r(BH.title.size * 1.25)}px}
  .bh-title-text{font-size:${BH.title.size}px}
  .bh-ticker{top:${BH_TICKER.top}px;height:${BH_TICKER.height}px}
  .bh-ticker-track{animation-duration:${BH_TICKER.items * 400 / BH_TICKER.speed}s}`;
}

const OUT = "cubic-bezier(.2,.8,.2,1)";
const SOFT = "cubic-bezier(.65,0,.35,1)";
/** IN ~1.2 s: background -> panels slide in -> logo drops -> rows one by one -> title wipes open. */
export const HISTORY_STEPS: MotionStep[] = [
  { target: ".bh-bg", start: 0, duration: 0.35, easing: "linear", keyframes: [{ opacity: 0 }, { opacity: 1 }] },
  { target: ".bh-panel-a", start: 0.12, duration: 0.42, easing: OUT, keyframes: [{ transform: "translateX(-120%)" }, { transform: "translateX(0%)" }] },
  { target: ".bh-panel-b", start: 0.16, duration: 0.42, easing: OUT, keyframes: [{ transform: "translateX(120%)" }, { transform: "translateX(0%)" }] },
  { target: ".bh-ticker", start: 0.2, duration: 0.36, easing: OUT, keyframes: [{ transform: "translateY(100%)" }, { transform: "translateY(0%)" }] },
  { target: ".bh-logo", start: 0.3, duration: 0.34, easing: OUT, keyframes: [{ opacity: 0, transform: "translateY(-60px)" }, { opacity: 1, transform: "translateY(0px)" }] },
  ...Array.from({ length: BH.maxRows }, (_, i): MotionStep[] => [
    { target: `.bh-row-${i} .bh-box-a`, start: 0.42 + i * 0.07, duration: 0.3, easing: OUT, keyframes: [{ opacity: 0, transform: "translateX(-60px)" }, { opacity: 1, transform: "translateX(0px)" }] },
    { target: `.bh-row-${i} .bh-box-b`, start: 0.42 + i * 0.07, duration: 0.3, easing: OUT, keyframes: [{ opacity: 0, transform: "translateX(60px)" }, { opacity: 1, transform: "translateX(0px)" }] },
    { target: `.bh-row-${i} .bh-mid`, start: 0.5 + i * 0.07, duration: 0.24, easing: "cubic-bezier(.3,1.4,.5,1)", keyframes: [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1)" }] }
  ]).flat(),
  { target: ".bh-title", start: 0.72, duration: 0.42, easing: SOFT, keyframes: [{ clipPath: "inset(0% 50% 0% 50%)" }, { clipPath: "inset(0% 0% 0% 0%)" }] },
  { target: ".bh-title-wrap", start: 0.72, duration: 0.42, easing: OUT, keyframes: [{ opacity: 0, transform: "translateY(30px)" }, { opacity: 1, transform: "translateY(0px)" }] }
];

/** Where the person is in a portrait (ratios of the image): head centre, head top, bottom of the cut-out. */
export interface PortraitBox { cx: number; top: number; bottom: number; opaque: boolean }
/** Read from the alpha channel of a small copy. Photos without transparency are "opaque". Same-origin only. */
export function portraitBox(img: HTMLImageElement): PortraitBox {
  try {
    const w = 64, h = Math.max(8, Math.round(64 * img.naturalHeight / Math.max(1, img.naturalWidth)));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!ctx) return { cx: 0.5, top: 0, bottom: 1, opaque: true };
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    return portraitBoxFromAlpha(i => data[i * 4 + 3]!, w, h);
  } catch { return { cx: 0.5, top: 0, bottom: 1, opaque: true }; }
}
/** Pure part of portraitBox (tested): alpha(index) for a w x h image. */
export function portraitBoxFromAlpha(alpha: (index: number) => number, w: number, h: number): PortraitBox {
  const solid = (x: number, y: number) => alpha(y * w + x) > 40;
  let top = -1, bottom = -1, filled = 0;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) if (solid(x, y)) row++;
    filled += row;
    if (row) { if (top < 0) top = y; bottom = y; }
  }
  if (top < 0 || filled > w * h * 0.97) return { cx: 0.5, top: 0, bottom: 1, opaque: true };
  const rows = Math.max(2, Math.round(h * 0.12));
  let sum = 0, count = 0;
  for (let y = top; y < Math.min(h, top + rows); y++) for (let x = 0; x < w; x++) if (solid(x, y)) { sum += x + 0.5; count++; }
  const cx = count ? Math.min(0.85, Math.max(0.15, sum / count / w)) : 0.5;
  return { cx, top: top / h, bottom: (bottom + 1) / h, opaque: false };
}
/**
 * Place a portrait in a strip: cut-outs are scaled so the head sits ~45 px
 * from the top and the bottom of the cut-out reaches the names block (the
 * strip's bottom fade hides the cut line). Photos fill the strip height.
 */
export function placePortrait(box: PortraitBox, stripH: number, aspect: number): { height: number; top: number; shiftX: number } {
  if (box.opaque) return { height: stripH, top: 0, shiftX: 0.5 };
  const span = Math.max(0.2, box.bottom - box.top);
  const height = Math.min(stripH * 2.4, Math.max(stripH, (stripH + 12 - BH.portrait.headGap) / span));
  return { height: Math.round(height), top: Math.round(BH.portrait.headGap - box.top * height), shiftX: box.cx };
}

/** Runs the mascot spawner while a scene is on air (never in Studio monitors). */
export function createMascots(root: HTMLElement, scene: MascotScene = "history") {
  let timer = 0, running = false, missing = false;
  const busy = new Map<HTMLImageElement, string>();
  const imgs = () => Array.from(root.querySelectorAll<HTMLImageElement>(".bh-mascot"));
  for (const img of imgs()) img.addEventListener("error", () => { missing = true; }, { once: true });
  const span = (range: readonly [number, number]) => range[0] + Math.random() * (range[1] - range[0]);
  function tick() {
    if (!running) return;
    const free = imgs().find(img => !busy.has(img));
    // v0.4H: 2-3 at a time: below minActive one always joins, a 3rd one sometimes
    if (free && !missing && (busy.size < MASCOT.minActive || Math.random() < MASCOT.joinChance)) {
      const spawn = pickMascot(Math.random, Array.from(busy.values()), scene);
      if (spawn) {
        busy.set(free, spawn.zone);
        Object.assign(free.style, { left: `${spawn.x - spawn.size / 2}px`, top: `${spawn.y - spawn.size / 2}px`, width: `${spawn.size}px`, height: `${spawn.size}px` });
        const rot = `rotate(${spawn.tilt}deg)`, drift = spawn.tilt > 0 ? 10 : -10;
        const anim = free.animate([
          { opacity: 0, transform: `translateY(14px) ${rot} scale(.9)` },
          { opacity: MASCOT.opacity, transform: `translateY(0) ${rot} scale(1)`, offset: 0.3 },
          { opacity: MASCOT.opacity, transform: `translate(${drift}px,-6px) ${rot} scale(1.02)`, offset: 0.7 },
          { opacity: 0, transform: `translate(${drift * 1.5}px,-12px) ${rot} scale(1.05)` }
        ], { duration: spawn.life * 1000, easing: "ease-in-out", fill: "both" });
        anim.onfinish = anim.oncancel = () => { busy.delete(free); anim.cancel(); };
      }
    }
    timer = window.setTimeout(tick, span(MASCOT.pause) * 1000);
  }
  return {
    start() {
      if (running || root.closest(".stage-monitor")) return;
      running = true; timer = window.setTimeout(tick, 400);
    },
    stop() {
      running = false; window.clearTimeout(timer);
      for (const img of imgs()) for (const a of img.getAnimations()) a.cancel();
      busy.clear();
    }
  };
}

export interface HistoryController {
  update(program: Program, games: HistoryGame[], historyMatchId: string | null, historyLeftTeamId: string | null, players: CameraPlayer[]): void;
  setVisible(visible: boolean, animate: boolean): void;
  timeline: Timeline;
}

export function createHistory(root: HTMLElement): HistoryController {
  const style = document.createElement("style");
  style.textContent = historyStyle();
  root.prepend(style);
  const timeline = new Timeline(root, HISTORY_STEPS, 0.6);
  const q = <E extends HTMLElement>(sel: string, from: ParentNode = root) => from.querySelector<E>(sel)!;
  let fitKey = "";
  const mascots = createMascots(root);

  function portrait(img: HTMLImageElement, team: Team, slot: number) {
    const src = team.teamId ? `/assets/players/${team.teamId}-P${slot}.png` : "/assets/players/unknown.svg";
    if (img.dataset.src === src) return;
    img.dataset.src = src;
    img.style.transform = ""; img.style.height = ""; img.style.top = ""; img.style.bottom = "";
    img.onerror = () => { if (!img.src.endsWith("/unknown.svg")) img.src = "/assets/players/unknown.svg"; };
    img.onload = () => {
      const stripH = BH.panel.h - BH.panel.names;
      const fit = placePortrait(portraitBox(img), stripH, img.naturalWidth / Math.max(1, img.naturalHeight));
      img.style.height = `${fit.height}px`; img.style.top = `${fit.top}px`; img.style.bottom = "auto";
      img.style.transform = `translateX(-${(fit.shiftX * 100).toFixed(1)}%)`;
    };
    img.src = src;
  }
  function fit(el: HTMLElement, base: number, min: number, max: number) {
    el.style.fontSize = `${base}px`; el.style.transform = "";
    const width = el.scrollWidth;
    if (width <= max) return;
    const size = Math.max(min, Math.floor(base * max / width));
    el.style.fontSize = `${size}px`;
    if (el.scrollWidth > max) el.style.transform = `scaleX(${Math.max(0.65, max / el.scrollWidth).toFixed(3)})`;
  }
  return {
    timeline,
    update(program, games, historyMatchId, historyLeftTeamId, players) {
      const m = program.match;
      (["a", "b"] as const).forEach(side => {
        const team = side === "a" ? m.teamA : m.teamB;
        const panel = q(`.bh-panel-${side}`);
        [1, 2].forEach(slot => {
          portrait(q<HTMLImageElement>(`.bh-strip-${slot} .bh-portrait`, panel), team, slot);
          const name = players.find(p => p.teamId === team.teamId && p.rosterSlot === slot)?.name ?? (slot === 1 && !team.teamId ? team.player : "");
          q(`.bh-name-${slot}`, panel).textContent = name;
        });
      });
      const sameSession = !!m.matchId && m.matchId === historyMatchId;
      const flipped = !!historyLeftTeamId && m.teamB.teamId === historyLeftTeamId;
      const list = historyRows(m.bestOf, sameSession ? games : [], flipped, historyLeftTeamId);
      const layout = rowLayout(list.length);
      Array.from(root.querySelectorAll<HTMLElement>(".bh-row")).forEach((row, i) => {
        const data = list[i];
        row.hidden = !data;
        if (!data) return;
        row.dataset.kind = data.kind;
        row.style.top = `${layout.rows[i]}px`;
        row.style.height = `${layout.height}px`;
        row.style.setProperty("--row-h", `${layout.height}px`);
        q(".bh-box-a .bh-team", row).textContent = m.teamA.name;
        q(".bh-box-b .bh-team", row).textContent = m.teamB.name;
        q(".bh-main", row).textContent = data.main;
        q(".bh-sub", row).textContent = data.sub;
      });
      q(".bh-title-text").textContent = m.stage;
      const names = Array.from(root.querySelectorAll(".bh-name")).map(el => el.textContent).join(",");
      const key = `${m.stage}|${m.teamA.name}|${m.teamB.name}|${names}|${layout.height}|${list.map(x => x.main).join(",")}`;
      if (key !== fitKey) {
        fitKey = key;
        const fitAll = () => {
          fit(q(".bh-title-text"), BH.title.size, 110, BH.title.maxWidth);
          const teamSize = Math.max(BH.text.teamMin, Math.min(BH.text.team, Math.round(layout.height * 0.46)));
          for (const el of Array.from(root.querySelectorAll<HTMLElement>(".bh-row:not([hidden]) .bh-team")))
            fit(el, teamSize, 22, BH.rows.boxW - 70);
          for (const el of Array.from(root.querySelectorAll<HTMLElement>(".bh-name")))
            fit(el, BH.text.name, BH.text.nameMin, Math.round(BH.panel.w * 0.92));
          for (const el of Array.from(root.querySelectorAll<HTMLElement>(".bh-row:not([hidden]) .bh-main")))
            fit(el, Math.round(layout.height * 0.82), 30, BH.rows.gap - 24);
        };
        fitAll();
        const fonts = document.fonts;
        if (fonts) void Promise.all([fonts.load(`400 ${BH.title.size}px "Anton"`, m.stage || "A"), fonts.load(`700 ${BH.text.name}px "Barlow Condensed"`, "ÁỄ")]).catch(() => undefined).then(() => fonts.ready).then(fitAll);
      }
    },
    setVisible(visible, animate) {
      if (visible) { timeline.show(animate); mascots.start(); } else { timeline.hide(animate); mascots.stop(); }
    }
  };
}
