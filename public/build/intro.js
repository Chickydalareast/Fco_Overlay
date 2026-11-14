import { teamLabel } from "./contracts.js";
import { Timeline } from "./motion.js";
/**
 * Team Intro (v0.4A.1) — rebuilt from the FVPL reference, adapted to 2v2.
 * All coordinates are in the 2560x1440 design space (FVPL 1080p x 4/3).
 * Change numbers here to tune the layout; the timeline is INTRO_STEPS.
 */
export const INTRO = {
    center: 1280,
    bar: { top: 989, height: 131 }, // name panels + logo squares
    square: 131, gap: 13, // logo square, transparent gap
    side: { outerX: 400 }, // left side outer edge (v0.4A.1: wide enough for 2 players); right is mirrored
    plate: { top: 971, height: 116, halfTop: 172, halfBottom: 121 },
    logo: { width: 470, centerY: 740 }, // tournament logo (behind players)
    portrait: { width: 1188, height: 1250, headTop: 251, raiseBack: 22 }, // 1900x2000 canvas x 0.625
    players: { frontX: 862, backX: 660 }, // left side centre X; right side mirrored
    beam: { top: 180, waveOpacity: 1 }, // backlight: spans the whole side, edges parallel to the plate tip
    nameFont: 50, nameMinFont: 28, nameMaxWidth: 520 // v0.4G: esports caps (Barlow Condensed)
};
/** X of the plate's left slanted edge at height y. The bar tips and the beam
 *  edges sit on this same line, so all the points line up exactly. */
export const PLATE_SLOPE = (INTRO.plate.halfTop - INTRO.plate.halfBottom) / INTRO.plate.height;
export const plateEdgeX = (y) => INTRO.center - INTRO.plate.halfTop + PLATE_SLOPE * (y - INTRO.plate.top);
export const SIDE_INNER_TOP = plateEdgeX(INTRO.bar.top);
export const SIDE_INNER_BOTTOM = plateEdgeX(INTRO.bar.top + INTRO.bar.height);
export const BEAM = (() => {
    const bottom = INTRO.bar.top, rise = PLATE_SLOPE * (bottom - INTRO.beam.top);
    const bottomX = [INTRO.side.outerX, SIDE_INNER_TOP];
    return { top: INTRO.beam.top, bottom, bottomX, topX: [bottomX[0] - rise, bottomX[1] - rise] };
})();
// league-logo.png is 1200x407; keep this ratio if the file is replaced.
const LOGO_ASPECT = 407 / 1200;
// Canvas of player portraits: subject centred on x=980, head top y=360 (1900x2000).
const PORTRAIT_SCALE = INTRO.portrait.width / 1900;
const portraitLeft = (cx) => Math.round(cx - 980 * PORTRAIT_SCALE);
const portraitTop = (raise = 0) => Math.round(INTRO.portrait.headTop - 360 * PORTRAIT_SCALE - raise);
function sideMarkup(side) {
    return `
    <div class="intro-side intro-side-${side}">
      <div class="intro-base"></div>
      <div class="intro-square"><div class="intro-square-fill"><img class="intro-team-logo" alt="" decoding="async"/></div></div>
      <div class="intro-name-wrap"><div class="intro-name-fill"><span class="intro-team-name"></span></div></div>
    </div>`;
}
export function introMarkup() {
    return `
    <section class="graphic-layer intro-layer" data-state="hidden" aria-label="Team introduction">
      <div class="intro-beam intro-beam-a"><div class="intro-beam-fill"><div class="intro-beam-wave wave-1"></div><div class="intro-beam-wave wave-2"></div></div></div>
      <div class="intro-beam intro-beam-b"><div class="intro-beam-fill"><div class="intro-beam-wave wave-1"></div><div class="intro-beam-wave wave-2"></div></div></div>
      <div class="intro-logo-mask"><div class="intro-logo">
        <img class="intro-logo-ghost ghost-1" src="/assets/brand/league-logo.png" alt=""/>
        <img class="intro-logo-ghost ghost-2" src="/assets/brand/league-logo.png" alt=""/>
        <img class="intro-logo-ghost ghost-3" src="/assets/brand/league-logo.png" alt=""/>
        <img class="intro-logo-main" src="/assets/brand/league-logo.png" alt="Tournament logo"/>
      </div></div>
      <div class="intro-players">
        <img class="intro-portrait portrait-a2" data-slot="A2" alt=""/>
        <img class="intro-portrait portrait-b2" data-slot="B2" alt=""/>
        <img class="intro-portrait portrait-a1" data-slot="A1" alt=""/>
        <img class="intro-portrait portrait-b1" data-slot="B1" alt=""/>
      </div>
      ${sideMarkup("a")}${sideMarkup("b")}
      <div class="intro-plate">
        <div class="intro-plate-white"></div>
        <div class="intro-plate-grad"></div>
        <div class="intro-plate-text"><strong class="intro-match"></strong><span class="intro-game"></span></div>
      </div>
    </section>`;
}
/** Geometry that depends on the constants above (kept out of the CSS file). */
export function introStyle() {
    const I = INTRO, top = I.bar.top, h = I.bar.height, sideW = SIDE_W;
    const nameX = I.square + I.gap, innerTopLocal = SIDE_INNER_TOP - I.side.outerX;
    const pl = I.plate, plateW = pl.halfTop * 2, inset = pl.halfTop - pl.halfBottom;
    const b = BEAM, beamW = Math.max(b.topX[1], b.bottomX[1]) - Math.min(b.topX[0], b.bottomX[0]);
    const beamLeft = Math.min(b.topX[0], b.bottomX[0]), beamH = b.bottom - b.top;
    const r = (n) => Math.round(n * 10) / 10;
    const poly = (pts) => `polygon(${pts.map(([x, y]) => `${r(x)}px ${r(y)}px`).join(",")})`;
    const beamPoly = poly([[b.topX[0] - beamLeft, 0], [b.topX[1] - beamLeft, 0], [b.bottomX[1] - beamLeft, beamH], [b.bottomX[0] - beamLeft, beamH]]);
    const beamPolyB = poly([[beamW - (b.topX[1] - beamLeft), 0], [beamW - (b.topX[0] - beamLeft), 0], [beamW - (b.bottomX[0] - beamLeft), beamH], [beamW - (b.bottomX[1] - beamLeft), beamH]]);
    const p = I.portrait, pTop = portraitTop(), pTopBack = portraitTop(p.raiseBack);
    return `
  .intro-side{top:${top}px;width:${r(sideW)}px;height:${h}px}
  .intro-side-a{left:${I.side.outerX}px;clip-path:${poly([[0, 0], [innerTopLocal, 0], [sideW, h], [0, h]])}}
  .intro-side-b{left:${r(2560 - I.side.outerX - sideW)}px;clip-path:${poly([[sideW - innerTopLocal, 0], [sideW, 0], [sideW, h], [0, h]])}}
  .intro-square{width:${I.square}px}
  .intro-side-a .intro-square{left:0}.intro-side-b .intro-square{right:0}
  .intro-name-wrap{width:${r(sideW - nameX)}px}
  .intro-beam-wave{opacity:${I.beam.waveOpacity}}
  .intro-side-a .intro-name-wrap{left:${nameX}px}.intro-side-b .intro-name-wrap{right:${nameX}px}
  .intro-team-name{font-size:${I.nameFont}px}
  .intro-plate{left:${I.center - pl.halfTop}px;top:${pl.top}px;width:${plateW}px;height:${pl.height}px;clip-path:${poly([[0, 0], [plateW, 0], [plateW - inset, pl.height], [inset, pl.height]])}}
  .intro-logo-mask{height:${pl.top}px}
  .intro-logo{left:${I.center - I.logo.width / 2}px;width:${I.logo.width}px;top:${Math.round(I.logo.centerY - I.logo.width * LOGO_ASPECT / 2)}px}
  .intro-players{height:${top}px}
  .intro-portrait{width:${p.width}px;height:${p.height}px;top:${pTop}px}
  .portrait-a2,.portrait-b2{top:${pTopBack}px}
  .portrait-a1{left:${portraitLeft(I.players.frontX)}px}.portrait-a2{left:${portraitLeft(I.players.backX)}px}
  .portrait-b1{left:${portraitLeft(2560 - I.players.frontX)}px}.portrait-b2{left:${portraitLeft(2560 - I.players.backX)}px}
  .intro-beam{top:${b.top}px;width:${r(beamW)}px;height:${beamH}px}
  .intro-beam-a{left:${r(beamLeft)}px;clip-path:${beamPoly}}
  .intro-beam-b{left:${r(2560 - beamLeft - beamW)}px;clip-path:${beamPolyB}}`;
}
const T = (px) => `translateX(${px}px)`;
const Y = (px) => `translateY(${px}px)`;
const SIDE_W = SIDE_INNER_BOTTOM - INTRO.side.outerX;
const NAME_W = SIDE_W - INTRO.square - INTRO.gap;
const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
const EASE_SOFT = "cubic-bezier(.25,.7,.3,1)";
/**
 * Timeline in seconds, measured frame by frame on the FVPL video.
 * IN: t=0 when the logo appears, ends at 1.78 s.
 * OUT (outTiming / out): t=0 when HIDE is pressed, ends at 1.38 s. Keyframes
 * are the IN keyframes reversed, except the logo and the plate text.
 */
export const INTRO_STEPS = [
    // 1. Tournament logo: pop + coin flip (never shows the mirrored side) + echo ghosts
    { target: ".intro-logo", start: 0, duration: 0.45, easing: "linear",
        keyframes: [
            { opacity: 0, transform: "rotateY(0deg)", offset: 0, easing: "ease-in" },
            { opacity: 1, transform: "rotateY(0deg)", offset: 0.08, easing: "cubic-bezier(.55,0,.9,.6)" },
            { opacity: 1, transform: "rotateY(90deg)", offset: 0.39 },
            { opacity: 1, transform: "rotateY(-90deg)", offset: 0.3901, easing: "cubic-bezier(.1,.4,.45,1)" },
            { opacity: 1, transform: "rotateY(0deg)", offset: 1 }
        ],
        out: { start: 0.88, duration: 0.28, easing: "cubic-bezier(.5,0,.85,.5)",
            keyframes: [{ opacity: 1, transform: "translateY(0px)" }, { opacity: 1, transform: "translateY(110px)", offset: 0.6 }, { opacity: 0, transform: "translateY(185px)" }] } },
    { target: ".ghost-1", start: 0, duration: 0.45, easing: "ease-out", keyframes: [{ opacity: 0.55, transform: T(-90) }, { opacity: 0, transform: T(0) }], out: null },
    { target: ".ghost-2", start: 0.04, duration: 0.42, easing: "ease-out", keyframes: [{ opacity: 0.45, transform: T(110) }, { opacity: 0, transform: T(0) }], out: null },
    { target: ".ghost-3", start: 0.1, duration: 0.33, easing: "ease-out", keyframes: [{ opacity: 0.35, transform: T(-50) }, { opacity: 0, transform: T(0) }], out: null },
    // 2. Plate: white base, then black->red gradient wipes top->down, then text drops in
    { target: ".intro-plate-white", start: 0.5, duration: 0.1, easing: EASE_OUT, keyframes: [{ opacity: 0, transform: "scaleX(.35)" }, { opacity: 1, transform: "scaleX(1)" }],
        // leaves as a thin white band at the bottom, like the reference
        out: { start: 1.2, duration: 0.18, easing: "cubic-bezier(.5,0,.8,.5)", keyframes: [{ opacity: 1, transform: "scaleX(1)", clipPath: "inset(0px 0px 0px 0px)" }, { opacity: 1, transform: "scaleX(.92)", clipPath: "inset(72% 0px 0px 0px)", offset: 0.7 }, { opacity: 0, transform: "scaleX(.8)", clipPath: "inset(100% 0px 0px 0px)" }] } },
    { target: ".intro-plate-grad", start: 0.52, duration: 0.23, easing: EASE_SOFT, keyframes: [{ clipPath: "inset(0px 0px 100% 0px)" }, { clipPath: "inset(0px 0px 0% 0px)" }], outTiming: { start: 1.12, duration: 0.18 } },
    { target: ".intro-plate-text", start: 0.73, duration: 0.12, easing: EASE_OUT, keyframes: [{ transform: Y(-120), clipPath: "inset(0px 0% 0px 0%)" }, { transform: Y(0), clipPath: "inset(0px 0% 0px 0%)" }],
        out: { start: 1.0, duration: 0.12, easing: "cubic-bezier(.6,0,.9,.5)", keyframes: [{ transform: Y(0), clipPath: "inset(0px 0% 0px 0%)" }, { transform: Y(0), clipPath: "inset(0px 50% 0px 50%)" }] } },
    // 3. Name panels slide out from behind the plate (base colour: left white / right red)
    { target: ".intro-side-a .intro-base", start: 0.63, duration: 0.27, easing: EASE_OUT, keyframes: [{ transform: T(SIDE_W) }, { transform: T(0) }], outTiming: { start: 0.78, duration: 0.3, easing: "cubic-bezier(.4,0,.7,.6)" } },
    { target: ".intro-side-b .intro-base", start: 0.63, duration: 0.27, easing: EASE_OUT, keyframes: [{ transform: T(-SIDE_W) }, { transform: T(0) }], outTiming: { start: 0.78, duration: 0.3, easing: "cubic-bezier(.4,0,.7,.6)" } },
    // 4. Team colour wipes inner -> outer, team name rides with it
    { target: ".intro-side-a .intro-name-fill", start: 0.9, duration: 0.26, easing: EASE_OUT, keyframes: [{ transform: T(NAME_W) }, { transform: T(0) }], outTiming: { start: 0.56, duration: 0.27, easing: "cubic-bezier(.4,0,.7,.6)" } },
    { target: ".intro-side-b .intro-name-fill", start: 0.9, duration: 0.26, easing: EASE_OUT, keyframes: [{ transform: T(-NAME_W) }, { transform: T(0) }], outTiming: { start: 0.56, duration: 0.27, easing: "cubic-bezier(.4,0,.7,.6)" } },
    // 5. Logo squares slide outward into place, base colour left in the gap fades
    { target: ".intro-side-a .intro-square-fill", start: 1.03, duration: 0.23, easing: EASE_OUT, keyframes: [{ transform: T(INTRO.square + INTRO.gap) }, { transform: T(0) }], outTiming: { start: 0.38, duration: 0.29, easing: "cubic-bezier(.4,0,.7,.6)" } },
    { target: ".intro-side-b .intro-square-fill", start: 1.03, duration: 0.23, easing: EASE_OUT, keyframes: [{ transform: T(-(INTRO.square + INTRO.gap)) }, { transform: T(0) }], outTiming: { start: 0.38, duration: 0.29, easing: "cubic-bezier(.4,0,.7,.6)" } },
    { target: ".intro-base", start: 1.2, duration: 0.08, easing: "linear", keyframes: [{ opacity: 1 }, { opacity: 0 }], outTiming: { start: 0.5, duration: 0.05 } },
    // 6. Players rise from behind the bar (masked at the bar top line): back player (P2) first, front (P1) +0.12 s
    { target: ".portrait-a2,.portrait-b2", start: 0.88, duration: 0.28, easing: EASE_OUT, keyframes: [{ transform: Y(1110) }, { transform: Y(0) }], outTiming: { start: 0.18, duration: 0.24 } },
    { target: ".portrait-a1,.portrait-b1", start: 1.0, duration: 0.28, easing: EASE_OUT, keyframes: [{ transform: Y(1110) }, { transform: Y(0) }], outTiming: { start: 0.12, duration: 0.24 } },
    // 7. Spotlight beams grow bottom -> top
    { target: ".intro-beam-fill", start: 1.58, duration: 0.2, easing: EASE_SOFT, keyframes: [{ opacity: 0, transform: "translateY(100%)" }, { opacity: 1, transform: "translateY(0%)" }], outTiming: { start: 0, duration: 0.2, easing: "ease-in" } }
];
const PORTRAIT_FALLBACK = "/assets/players/unknown.svg";
function setImage(img, src, fallback) {
    if (img.dataset.src === src)
        return;
    img.dataset.src = src;
    img.onerror = () => { if (fallback && img.getAttribute("src") !== fallback)
        img.src = fallback;
    else
        img.style.visibility = "hidden"; };
    img.style.visibility = "";
    img.src = src;
}
export function createIntro(root) {
    const style = document.createElement("style");
    style.textContent = introStyle();
    root.prepend(style);
    const timeline = new Timeline(root, INTRO_STEPS);
    const q = (s) => root.querySelector(s);
    let fitKey = "";
    function fitNames() {
        // Shrink long names ("C11 - Atlético de Madrid") so they fit the panel.
        for (const el of Array.from(root.querySelectorAll(".intro-team-name"))) {
            el.style.fontSize = `${INTRO.nameFont}px`;
            const width = el.scrollWidth;
            if (width > INTRO.nameMaxWidth)
                el.style.fontSize = `${Math.max(INTRO.nameMinFont, Math.floor(INTRO.nameFont * INTRO.nameMaxWidth / width))}px`;
        }
    }
    function sideData(team, side) {
        const prefix = `.intro-side-${side}`;
        q(`${prefix} .intro-team-name`).textContent = teamLabel(team);
        const logo = q(`${prefix} .intro-team-logo`);
        if (team.teamId)
            setImage(logo, `/assets/teams/${team.teamId}-${side === "a" ? "white" : "red"}.png`);
        else {
            logo.removeAttribute("src");
            logo.dataset.src = "";
            logo.style.visibility = "hidden";
        }
        for (const n of [1, 2]) {
            const img = q(`.portrait-${side}${n}`);
            setImage(img, team.teamId ? `/assets/players/${team.teamId}-P${n}.png` : PORTRAIT_FALLBACK, PORTRAIT_FALLBACK);
        }
    }
    return {
        timeline,
        update(program) {
            const m = program.match;
            sideData(m.teamA, "a");
            sideData(m.teamB, "b");
            q(".intro-match").textContent = `MATCH ${m.matchNumber}`;
            q(".intro-game").textContent = `GAME ${m.gameNumber}`;
            const key = `${teamLabel(m.teamA)}|${teamLabel(m.teamB)}`;
            if (key !== fitKey) {
                fitKey = key;
                fitNames();
                void (document.fonts ? document.fonts.load(`700 ${INTRO.nameFont}px "Barlow Condensed"`, "ÁÊ").catch(() => undefined).then(() => document.fonts.ready) : Promise.resolve()).then(fitNames);
            }
        },
        setVisible(visible, animate) { if (visible)
            timeline.show(animate);
        else
            timeline.hide(animate); },
        replay() { timeline.replay(); }
    };
}
