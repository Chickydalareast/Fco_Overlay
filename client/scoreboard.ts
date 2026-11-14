import type { Program, Team } from "./contracts.js";
import { Timeline, type MotionStep } from "./motion.js";

/**
 * Scoreboard (v0.4B r2). Design space 2560x1440.
 *
 * Every number below was measured on the FVPL 2K reference frame, in screen
 * pixels. The bar sits right on top of the game's own score box
 * (x 139..833, y 100..149): the bottom edge of the body has exactly that width,
 * only the GAME tab sticks out on the right.
 *
 *   underlay   wider strip under the body, its two bottom corners poke out
 *              as pointed tips (left red, right white)
 *   body       black trapezoid with a notch at the top centre
 *   plate      centre trapezoid (MATCH n), the stage text sits in the notch
 *   cells      score cells: left "\" red, right "/" white
 *   tab        separate GAME n tab
 *
 * The operator can nudge the whole thing (layers.scoreboard.x / y / scale).
 */
export const SB = {
  body: { top: 31, bottom: 88, left: 117, right: 856, slant: 23 },     // top-edge corners; bottom = top ± slant
  notch: { half: 102, depth: 14 },                                     // open notch above the plate
  plate: { top: 45, bottom: 80, halfTop: 75, halfBottom: 61.5 },
  score: { left: 156, width: 64 },                                     // red cell top edge; white cell is the mirror
  code: { centerX: 292, slot: 104 },                                   // team code (C1) centre, left side
  logo: { centerX: 367, size: 44 },
  tab: { top: 31, bottom: 85, left: 877, right: 990, slant: 21 },
  under: { top: 60, bottom: 93, left: 115, right: 994, slant: 17 },     // bottom corners = the two tips
  stage: { centerY: 31.5, maxWidth: 300 },
  streak: { width: 22, gap: 6 },
  font: { code: 48, codeMin: 30, digit: 52, match: 32, stage: 28, stageMin: 20, game: 28 }  // v0.4G: bigger esports caps
} as const;

/** Centre line of the bar; right-half elements mirror the left half around it. */
export const SB_CX = (SB.body.left + SB.body.right) / 2;
const mirror = (x: number) => 2 * SB_CX - x;

/** Origin of the anchor box (top-left), in screen 2K px. Everything inside is relative to it. */
export const SB_ORIGIN = { x: SB.under.left - 5, y: 8 };
export const SB_BOX = { width: SB.under.right + 5 - SB_ORIGIN.x, height: SB.under.bottom + 4 - SB_ORIGIN.y };

type Pt = [number, number];
const r = (n: number) => Math.round(n * 10) / 10;
const local = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x - SB_ORIGIN.x, y - SB_ORIGIN.y]);

/** Shapes in screen coordinates (2K). Exported for tests. */
export const SB_SHAPES = (() => {
  const b = SB.body, n = SB.notch, p = SB.plate, s = SB.score, t = SB.tab, u = SB.under, cx = SB_CX;
  const H = b.bottom - b.top, k = b.slant / H;                         // horizontal lean per px of height
  const body: Pt[] = [[b.left, b.top], [cx - n.half, b.top], [cx - n.half + (n.half - p.halfTop), b.top + n.depth],
    [cx + p.halfTop, b.top + n.depth], [cx + n.half, b.top], [b.right, b.top], [b.right - b.slant, b.bottom], [b.left + b.slant, b.bottom]];
  const plate: Pt[] = [[cx - p.halfTop, p.top], [cx + p.halfTop, p.top], [cx + p.halfBottom, p.bottom], [cx - p.halfBottom, p.bottom]];
  const cellA: Pt[] = [[s.left, b.top], [s.left + s.width, b.top], [s.left + s.width + b.slant, b.bottom], [s.left + b.slant, b.bottom]];
  const cellB: Pt[] = cellA.map(([x, y]) => [mirror(x), y] as Pt).reverse();
  const sx = s.left - SB.streak.gap - SB.streak.width;
  const streakA: Pt[] = [[sx, b.top], [sx + SB.streak.width, b.top], [sx + SB.streak.width + b.slant, b.bottom], [sx + b.slant, b.bottom]];
  const streakB: Pt[] = streakA.map(([x, y]) => [mirror(x), y] as Pt).reverse();
  const tab: Pt[] = [[t.left, t.top], [t.right, t.top], [t.right - t.slant, t.bottom], [t.left - t.slant, t.bottom]];
  const under: Pt[] = [[u.left + u.slant, u.top], [u.right - u.slant, u.top], [u.right, u.bottom], [u.left, u.bottom]];
  return { body, plate, cellA, cellB, streakA, streakB, tab, under, lean: k,
    bottomEdge: [b.left + b.slant, b.right - b.slant] as [number, number] };
})();

const bbox = (pts: Pt[]) => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
/** Absolute box + clip polygon relative to that box. */
function shapeCss(selector: string, pts: Pt[]): string {
  const l = local(pts), bb = bbox(l);
  const clip = `polygon(${l.map(([x, y]) => `${r(x - bb.x)}px ${r(y - bb.y)}px`).join(",")})`;
  return `${selector}{left:${r(bb.x)}px;top:${r(bb.y)}px;width:${r(bb.w)}px;height:${r(bb.h)}px;clip-path:${clip};-webkit-clip-path:${clip}}`;
}
function boxCss(selector: string, cx: number, cy: number, w: number, h: number): string {
  return `${selector}{left:${r(cx - w / 2 - SB_ORIGIN.x)}px;top:${r(cy - h / 2 - SB_ORIGIN.y)}px;width:${r(w)}px;height:${r(h)}px}`;
}

export function scoreboardMarkup(): string {
  const side = (s: "a" | "b") => `
        <div class="sb-score sb-score-${s}"><div class="sb-score-fill"></div><div class="sb-flash"></div><div class="sb-digit"><span class="sb-digit-val">0</span></div></div>
        <div class="sb-name sb-name-${s}"><span class="sb-name-text"></span></div>
        <div class="sb-logo sb-logo-${s}"><img class="sb-logo-img" alt="" decoding="async" /><span class="sb-logo-text"></span></div>`;
  return `
    <section class="graphic-layer sb-layer" data-state="hidden" aria-label="Scoreboard">
      <div class="sb-anchor">
        <div class="sb-under-mask"><div class="sb-under"></div></div>
        <div class="sb-body-mask"><div class="sb-body"><div class="sb-streak sb-streak-a"></div><div class="sb-streak sb-streak-b"></div><div class="sb-gloss"></div></div></div>
        <div class="sb-plate"><div class="sb-match"></div></div>
        ${side("a")}${side("b")}
        <div class="sb-stage-wrap"><div class="sb-stage-text"><span class="sb-stage-label"></span></div></div>
        <div class="sb-tab"><div class="sb-tab-fill"><span class="sb-game"></span></div></div>
      </div>
    </section>`;
}

/** Geometry CSS generated from SB, so one constant change moves everything consistently. */
export function scoreboardStyle(): string {
  const s = SB, sh = SB_SHAPES, b = s.body, midY = (b.top + b.bottom) / 2;
  const bodyBox = bbox(local(sh.body));
  const inBody = (sel: string, pts: Pt[]) => {
    // streaks live inside .sb-body, so their coordinates are relative to the body box
    const l = local(pts).map(([x, y]) => [x - bodyBox.x, y - bodyBox.y] as Pt), bb = bbox(l);
    const clip = `polygon(${l.map(([x, y]) => `${r(x - bb.x)}px ${r(y - bb.y)}px`).join(",")})`;
    return `${sel}{left:${r(bb.x)}px;top:${r(bb.y)}px;width:${r(bb.w)}px;height:${r(bb.h)}px;clip-path:${clip};-webkit-clip-path:${clip}}`;
  };
  // Stage text rises out of the notch: the wrapper ends at the notch bottom (plate top).
  const wrap = { top: 10, bottom: b.top + s.notch.depth }, lineH = 30;
  return `
  .sb-anchor{left:${SB_ORIGIN.x}px;top:${SB_ORIGIN.y}px;width:${r(SB_BOX.width)}px;height:${r(SB_BOX.height)}px}
  ${shapeCss(".sb-under-mask", sh.under)}
  ${shapeCss(".sb-body-mask", sh.body)}
  ${inBody(".sb-streak-a", sh.streakA)}
  ${inBody(".sb-streak-b", sh.streakB)}
  ${shapeCss(".sb-plate", sh.plate)}
  ${shapeCss(".sb-score-a", sh.cellA)}
  ${shapeCss(".sb-score-b", sh.cellB)}
  ${shapeCss(".sb-tab", sh.tab)}
  ${boxCss(".sb-name-a", s.code.centerX + sh.lean * (midY - b.top), midY, s.code.slot, b.bottom - b.top)}
  ${boxCss(".sb-name-b", mirror(s.code.centerX) - sh.lean * (midY - b.top), midY, s.code.slot, b.bottom - b.top)}
  ${boxCss(".sb-logo-a", s.logo.centerX, midY, s.logo.size, s.logo.size)}
  ${boxCss(".sb-logo-b", mirror(s.logo.centerX), midY, s.logo.size, s.logo.size)}
  .sb-stage-wrap{left:${r(SB_CX - s.stage.maxWidth / 2 - SB_ORIGIN.x)}px;top:${wrap.top - SB_ORIGIN.y}px;width:${s.stage.maxWidth}px;height:${wrap.bottom - wrap.top}px}
  .sb-stage-text{top:${r(s.stage.centerY - wrap.top - lineH / 2)}px;line-height:${lineH}px;height:${lineH}px}
  .sb-stage-label{font-size:${s.font.stage}px}
  .sb-name-text{font-size:${s.font.code}px}
  .sb-digit{font-size:${s.font.digit}px}
  .sb-match{font-size:${s.font.match}px}
  .sb-game{font-size:${s.font.game}px}
  .sb-logo-img{width:${s.logo.size}px;height:${s.logo.size}px}
  .sb-gloss{left:-240px;width:200px}`;
}

const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
const EASE_SOFT = "cubic-bezier(.65,0,.35,1)";
const T = (x: number | string) => `translateX(${typeof x === "number" ? `${x}px` : x})`;
const Y = (y: number | string) => `translateY(${typeof y === "number" ? `${y}px` : y})`;

/**
 * IN (1.15 s): plate drops open -> body opens from the centre outwards ->
 * underlay follows so its two tips pop out at the ends -> logos pop, codes
 * slide outwards, score cells wipe in from the outer edges, digits drop ->
 * stage text rises out of the notch, GAME tab slides out -> one light sweep.
 * OUT (~0.7 s) is the IN reversed and compressed (motion.ts), without the sweep.
 */
export const SCOREBOARD_STEPS: MotionStep[] = [
  { target: ".sb-plate", start: 0, duration: 0.26, easing: EASE_OUT, keyframes: [{ opacity: 0, transform: "scaleY(0)" }, { opacity: 1, transform: "scaleY(1)" }] },
  { target: ".sb-match", start: 0.16, duration: 0.24, easing: EASE_OUT, keyframes: [{ transform: Y(28) }, { transform: Y(0) }] },
  { target: ".sb-body", start: 0.1, duration: 0.42, easing: EASE_SOFT, keyframes: [{ clipPath: "inset(0px 50% 0px 50%)" }, { clipPath: "inset(0px 0% 0px 0%)" }] },
  { target: ".sb-under", start: 0.3, duration: 0.42, easing: EASE_SOFT, keyframes: [{ clipPath: "inset(0px 50% 0px 50%)" }, { clipPath: "inset(0px 0% 0px 0%)" }] },
  { target: ".sb-logo-a", start: 0.3, duration: 0.24, easing: "cubic-bezier(.3,1.4,.5,1)", keyframes: [{ opacity: 0, transform: "scale(.5)" }, { opacity: 1, transform: "scale(1)" }] },
  { target: ".sb-logo-b", start: 0.34, duration: 0.24, easing: "cubic-bezier(.3,1.4,.5,1)", keyframes: [{ opacity: 0, transform: "scale(.5)" }, { opacity: 1, transform: "scale(1)" }] },
  { target: ".sb-name-a", start: 0.36, duration: 0.3, easing: EASE_OUT, keyframes: [{ opacity: 0, transform: T(24) }, { opacity: 1, transform: T(0) }] },
  { target: ".sb-name-b", start: 0.4, duration: 0.3, easing: EASE_OUT, keyframes: [{ opacity: 0, transform: T(-24) }, { opacity: 1, transform: T(0) }] },
  { target: ".sb-score-a .sb-score-fill", start: 0.42, duration: 0.24, easing: EASE_OUT, keyframes: [{ transform: T("-110%") }, { transform: T("0%") }] },
  { target: ".sb-score-b .sb-score-fill", start: 0.46, duration: 0.24, easing: EASE_OUT, keyframes: [{ transform: T("110%") }, { transform: T("0%") }] },
  { target: ".sb-score-a .sb-digit", start: 0.56, duration: 0.2, easing: EASE_OUT, keyframes: [{ transform: Y(-46) }, { transform: Y(0) }] },
  { target: ".sb-score-b .sb-digit", start: 0.6, duration: 0.2, easing: EASE_OUT, keyframes: [{ transform: Y(-46) }, { transform: Y(0) }] },
  { target: ".sb-stage-text", start: 0.5, duration: 0.26, easing: EASE_OUT, keyframes: [{ transform: Y(34) }, { transform: Y(0) }] },
  { target: ".sb-tab-fill", start: 0.56, duration: 0.28, easing: EASE_OUT, keyframes: [{ transform: T("-101%") }, { transform: T("0%") }] },
  { target: ".sb-gloss", start: 0.72, duration: 0.43, easing: "cubic-bezier(.4,0,.3,1)", keyframes: [{ transform: T(0) }, { transform: T(SB.body.right - SB.body.left + 420) }], out: null }
];

export interface ScoreboardController {
  update(program: Program, animate: boolean): void;
  setVisible(visible: boolean, animate: boolean): void;
  timeline: Timeline;
}

function logoSources(team: Team): string[] {
  const list: string[] = [];
  if (team.teamId) list.push(`/assets/teams/${team.teamId}-white.png`);
  if (team.clubLogo && /^\/assets\/clubs\/[a-z0-9-]+\.png$/.test(team.clubLogo)) list.push(team.clubLogo);
  return list;
}
function setLogo(box: HTMLElement, team: Team) {
  const img = box.querySelector<HTMLImageElement>(".sb-logo-img")!;
  const label = box.querySelector<HTMLElement>(".sb-logo-text")!;
  const sources = logoSources(team);
  const key = `${sources.join("|")}#${team.shortName}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  label.textContent = team.shortName;
  let index = 0;
  const showText = () => { box.dataset.mode = "text"; img.removeAttribute("src"); };
  img.onerror = () => { index++; if (index < sources.length) img.src = sources[index]!; else showText(); };
  img.onload = () => { box.dataset.mode = "image"; };
  if (sources.length) { box.dataset.mode = "image"; img.src = sources[0]!; } else showText();
}

/** Team code shown on the bar: the short code ("C1"), like "TKO" on the reference. */
export function scoreboardCode(team: Pick<Team, "teamId" | "shortName">): string {
  return (team.shortName || team.teamId || "").toUpperCase();
}

export function createScoreboard(root: HTMLElement): ScoreboardController {
  const style = document.createElement("style");
  style.textContent = scoreboardStyle();
  root.prepend(style);
  const timeline = new Timeline(root, SCOREBOARD_STEPS, 0.6);
  const q = <E extends HTMLElement>(s: string) => root.querySelector<E>(s)!;
  const anchor = q(".sb-anchor");
  let fitKey = "";
  let digits: [string, string] | null = null;

  function fitText(el: HTMLElement, base: number, min: number, max: number) {
    el.style.fontSize = `${base}px`; el.style.transform = "";
    let width = el.scrollWidth;
    if (width <= max) return;
    const size = Math.max(min, Math.floor(base * max / width));
    el.style.fontSize = `${size}px`;
    width = el.scrollWidth;
    if (width > max) el.style.transform = `scaleX(${Math.max(0.7, max / width).toFixed(3)})`;
  }
  function fitAll() {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(".sb-name-text"))) fitText(el, SB.font.code, SB.font.codeMin, SB.code.slot - 8);
    fitText(q(".sb-stage-label"), SB.font.stage, SB.font.stageMin, SB.stage.maxWidth - 10);
  }
  function roll(side: "a" | "b") {
    const value = q(`.sb-score-${side} .sb-digit-val`);
    const flash = q(`.sb-score-${side} .sb-flash`);
    value.animate([{ transform: "translateY(-70%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 380, easing: EASE_OUT });
    flash.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 650, easing: "ease-out" });
  }
  return {
    timeline,
    update(program, animate) {
      const m = program.match, sb = program.layers.scoreboard;
      const x = sb.x ?? 0, y = sb.y ?? 0, scale = (sb.scale ?? 100) / 100;
      const transform = x || y || scale !== 1 ? `translate(${x}px,${y}px) scale(${scale})` : "";
      if (anchor.style.transform !== transform) anchor.style.transform = transform;
      const next: [string, string] = [String(m.teamA.seriesWins), String(m.teamB.seriesWins)];
      (["a", "b"] as const).forEach((side, i) => {
        const team = side === "a" ? m.teamA : m.teamB;
        q(`.sb-name-${side} .sb-name-text`).textContent = scoreboardCode(team);
        setLogo(q(`.sb-logo-${side}`), team);
        const el = q(`.sb-score-${side} .sb-digit-val`);
        if (el.textContent !== next[i]) {
          el.textContent = next[i]!;
          if (animate && digits && timeline.state === "shown") roll(side);
        }
      });
      digits = next;
      q(".sb-match").textContent = `MATCH ${m.matchNumber}`;
      q(".sb-stage-label").textContent = m.stage;
      q(".sb-game").textContent = `GAME ${m.gameNumber}`;
      const key = `${scoreboardCode(m.teamA)}|${scoreboardCode(m.teamB)}|${m.stage}`;
      if (key !== fitKey) {
        fitKey = key;
        fitAll();
        const fonts = document.fonts;
        if (fonts) void Promise.all([fonts.load(`700 ${SB.font.code}px "Barlow Condensed"`), fonts.load(`700 ${SB.font.stage}px "Barlow Condensed"`)])
          .catch(() => undefined).then(() => fonts.ready).then(fitAll);
      }
    },
    setVisible(visible, animate) { if (visible) timeline.show(animate); else timeline.hide(animate); }
  };
}
