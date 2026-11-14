/**
 * Tiny timeline engine on top of the Web Animations API (no library).
 * Works on old OBS/CEF builds (Chromium 84+): only Element.animate,
 * Animation.finished/reverse/finish/cancel are used.
 *
 * Every step describes ONE element going hidden -> shown (IN). The OUT
 * (hide) sequence is derived automatically: reversed keyframes, reversed
 * order, scaled by `outScale`, mirrored easing (ease-out becomes ease-in).
 * A step may provide its own `out` instead (e.g. logo slides down).
 *
 * Interrupts: hide() during IN (or show() during OUT) reverses the running
 * animations from the current frame, so nothing ever jumps.
 */
export interface StepTiming { start: number; duration: number; easing?: string }
export interface MotionStep extends StepTiming {
  /** CSS selector inside the timeline root. All matches are animated. */
  target: string;
  /** Keyframes from the hidden pose to the shown pose. */
  keyframes: Keyframe[];
  /** Custom OUT. `null` = no OUT animation (element already invisible at the end of IN). */
  out?: (StepTiming & { keyframes: Keyframe[] }) | null;
  /** OUT timing only (keyframes = IN reversed). Without it, timing is derived from the IN position. */
  outTiming?: StepTiming;
}
export type TimelineState = "hidden" | "entering" | "shown" | "exiting";

const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
/** cubic-bezier(a,b,c,d) played backwards in time = cubic-bezier(1-c,1-d,1-a,1-b). */
export function mirrorEasing(easing = EASE_OUT): string {
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(easing);
  if (!m) return easing === "ease-out" ? "ease-in" : easing === "ease-in" ? "ease-out" : easing;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return `cubic-bezier(${r(1 - c)},${r(1 - d)},${r(1 - a)},${r(1 - b)})`;
}
/** Total IN duration in seconds. */
export function totalDuration(steps: StepTiming[]): number {
  return steps.reduce((max, s) => Math.max(max, s.start + s.duration), 0);
}
/** OUT timing of a step: mirrored position on the IN timeline, scaled. */
export function derivedOut(step: StepTiming, total: number, scale: number): StepTiming {
  return { start: (total - (step.start + step.duration)) * scale, duration: step.duration * scale, easing: mirrorEasing(step.easing) };
}

export class Timeline {
  state: TimelineState = "hidden";
  onStateChange: (state: TimelineState) => void = () => {};
  private animations: Animation[] = [];
  private token = 0;
  private readonly total: number;
  constructor(private root: HTMLElement, private steps: MotionStep[], private outScale = 0.78, private speed = 1) {
    this.total = totalDuration(steps);
  }
  private elements(selector: string): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>(selector));
  }
  private set(state: TimelineState) { this.state = state; this.root.dataset.state = state; this.onStateChange(state); }
  private clear() { for (const a of this.animations) { try { a.cancel(); } catch { /* ignore */ } } this.animations = []; }
  private run(kind: "in" | "out"): Animation[] {
    const created: Animation[] = [];
    const ms = (s: number) => Math.max(0, s * 1000 / this.speed);
    for (const step of this.steps) {
      let frames = step.keyframes; let timing: StepTiming = step;
      if (kind === "out") {
        if (step.out === null) continue;
        if (step.out) { frames = step.out.keyframes; timing = step.out; }
        else {
          frames = [...step.keyframes].reverse().map(f => ({ ...f, offset: typeof f.offset === "number" ? 1 - f.offset : f.offset }));
          timing = step.outTiming ? { ...step.outTiming, easing: step.outTiming.easing ?? mirrorEasing(step.easing) } : derivedOut(step, this.total, this.outScale);
        }
      }
      for (const el of this.elements(step.target)) {
        created.push(el.animate(frames, { delay: ms(timing.start), duration: Math.max(1, ms(timing.duration)), easing: timing.easing ?? EASE_OUT, fill: "both" }));
      }
    }
    return created;
  }
  private settle(token: number, done: () => void) {
    const pending = this.animations.map(a => a.finished.catch(() => undefined));
    void Promise.all(pending).then(() => { if (token === this.token) done(); });
  }
  /** Play IN (animate=false jumps straight to the final shown pose). */
  show(animate = true) {
    if (this.state === "shown" || (this.state === "entering" && animate)) return;
    const token = ++this.token;
    if (this.state === "exiting" && animate) {
      for (const a of this.animations) a.reverse();
      this.set("entering");
      this.settle(token, () => this.set("shown"));
      return;
    }
    this.clear();
    this.set("entering");
    this.animations = this.run("in");
    if (!animate) { for (const a of this.animations) a.finish(); this.set("shown"); return; }
    this.settle(token, () => this.set("shown"));
  }
  /** Play OUT (animate=false hides immediately). */
  hide(animate = true) {
    if (this.state === "hidden" || (this.state === "exiting" && animate)) return;
    const token = ++this.token;
    if (!animate) { this.clear(); this.set("hidden"); return; }
    if (this.state === "entering") {
      for (const a of this.animations) a.reverse();
    } else {
      this.clear();
      this.animations = this.run("out");
    }
    this.set("exiting");
    this.settle(token, () => { this.clear(); this.set("hidden"); });
  }
  /** Restart the IN animation from the hidden pose (Studio "Test Intro"). */
  replay() { this.hide(false); this.show(true); }
  /** Pause every running animation at an absolute time (ms) — used by visual tests. */
  seek(ms: number) { for (const a of this.animations) { a.pause(); a.currentTime = ms; } }
}
