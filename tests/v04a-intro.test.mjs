import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mirrorEasing,totalDuration,derivedOut} from '../public/build/motion.js';
import {INTRO_STEPS,INTRO,introMarkup} from '../public/build/intro.js';
import {teamLabel,cloneProgram,SAMPLE_PROGRAM} from '../public/build/contracts.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const props=frames=>new Set(frames.flatMap(f=>Object.keys(f).filter(k=>!['offset','easing','composite'].includes(k))));

test('easing mirror turns ease-out into the matching ease-in',()=>{
  assert.equal(mirrorEasing('cubic-bezier(.2,.8,.2,1)'),'cubic-bezier(0.8,0,0.8,0.2)');
  assert.equal(mirrorEasing('ease-out'),'ease-in');
  assert.equal(mirrorEasing('linear'),'linear');
  const out=derivedOut({start:0.5,duration:0.2},2,0.5);
  assert.deepEqual([out.start,out.duration],[0.65,0.1]);
});

test('Team Intro timing matches the FVPL reference (IN 1.78 s, OUT <= 1.4 s)',()=>{
  assert.equal(Math.round(totalDuration(INTRO_STEPS)*100)/100,1.78);
  const outEnd=Math.max(...INTRO_STEPS.filter(s=>s.out!==null).map(s=>{const t=s.out??s.outTiming;assert.ok(t,`OUT timing missing for ${s.target}`);return t.start+t.duration;}));
  assert.ok(outEnd<=1.4,`OUT ends at ${outEnd}`);
  // Back player (P2) appears before front player (P1).
  const back=INTRO_STEPS.find(s=>s.target.includes('portrait-a2')),front=INTRO_STEPS.find(s=>s.target.includes('portrait-a1'));
  assert.ok(back.start<front.start);
});

test('every custom OUT animates all properties of its IN (no jump when IN is cancelled)',()=>{
  for(const step of INTRO_STEPS){
    if(!step.out)continue;
    const missing=[...props(step.keyframes)].filter(p=>!props(step.out.keyframes).has(p));
    assert.deepEqual(missing,[],`${step.target} OUT is missing ${missing.join(',')}`);
  }
});

test('every animated selector exists in the intro markup',()=>{
  const html=introMarkup();
  for(const step of INTRO_STEPS)for(const sel of step.target.split(',')){
    const cls=sel.trim().split(/\s+/).pop().replace(/^\./,'');
    assert.ok(html.includes(cls),`${cls} missing from markup`);
  }
});

test('layout is symmetric around the centre of the 2560x1440 stage',()=>{
  assert.equal(INTRO.center,1280);
  const left=INTRO.side.outerX, right=2560-INTRO.side.outerX;
  assert.equal(left+right,2560);
  assert.ok(INTRO.bar.top+INTRO.bar.height<=1440);
});

test('display name is "C1 - AC Milan"; clone works without structuredClone',()=>{
  assert.equal(teamLabel({teamId:'C1',name:'AC Milan'}),'C1 - AC Milan');
  assert.equal(teamLabel({name:'Custom FC'}),'Custom FC');
  const copy=cloneProgram(SAMPLE_PROGRAM);copy.match.teamA.name='x';
  assert.notEqual(SAMPLE_PROGRAM.match.teamA.name,'x');
});

test('graphics assets exist: 32 team logos (white/red), placeholder portrait, league logo, fonts',()=>{
  for(let n=1;n<=16;n++)for(const v of ['white','red'])assert.ok(fs.existsSync(path.join(ROOT,'public/assets/teams',`C${n}-${v}.png`)),`C${n}-${v}.png`);
  for(const f of ['public/assets/players/unknown.svg','public/assets/brand/league-logo.png','public/assets/intro.css'])assert.ok(fs.existsSync(path.join(ROOT,f)),f);
  const css=fs.readFileSync(path.join(ROOT,'public/assets/fonts/fonts.css'),'utf8');
  for(const m of css.matchAll(/url\('\/assets\/fonts\/([^']+)'\)/g))assert.ok(fs.existsSync(path.join(ROOT,'public/assets/fonts',m[1])),m[1]);
});

// v0.4A.1: bar tips on the plate edge line, bars wide enough for 2 players, beams cover them
test('v0.4A.1 bar tips are collinear with the plate edge', async () => {
  const m = await import('../public/build/intro.js');
  const { INTRO, plateEdgeX, SIDE_INNER_TOP, SIDE_INNER_BOTTOM } = m;
  assert.ok(Math.abs(SIDE_INNER_TOP - plateEdgeX(INTRO.bar.top)) < 0.01);
  assert.ok(Math.abs(SIDE_INNER_BOTTOM - plateEdgeX(INTRO.bar.top + INTRO.bar.height)) < 0.01);
  // plate left corners lie on the same line
  assert.equal(plateEdgeX(INTRO.plate.top), INTRO.center - INTRO.plate.halfTop);
  assert.ok(Math.abs(plateEdgeX(INTRO.plate.top + INTRO.plate.height) - (INTRO.center - INTRO.plate.halfBottom)) < 0.01);
});
test('v0.4A.1 bars and beams cover both players', async () => {
  const { INTRO, BEAM } = await import('../public/build/intro.js');
  const backHalfWidth = 200; // placeholder silhouette shoulders at 2K
  assert.ok(INTRO.side.outerX <= INTRO.players.backX - backHalfWidth, 'bar reaches past the back player');
  assert.equal(BEAM.bottomX[0], INTRO.side.outerX);
  assert.ok(BEAM.top < INTRO.portrait.headTop, 'beam is taller than the players');
  assert.equal(BEAM.bottom, INTRO.bar.top);
});
test('v0.4A.1 wave loop exists and pauses while hidden', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/assets/intro.css'), 'utf8');
  assert.match(css, /@keyframes intro-wave-1/);
  assert.match(css, /data-state="hidden"\] \.intro-beam-wave \{ animation-play-state:paused/);
  assert.equal((introMarkup().match(/intro-beam-wave/g) || []).length, 4);
});
