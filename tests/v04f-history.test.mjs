import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BH,BH_TICKER,rowLayout,historyRows,HISTORY_STEPS,historyMarkup,portraitBoxFromAlpha,placePortrait} from '../public/build/history.js';
import {totalDuration,derivedOut} from '../public/build/motion.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const g=(n,l,r,w,extra={})=>({gameNumber:n,leftGoals:l,rightGoals:r,winnerTeamId:w,note:'',version:1,...extra});

test('v0.4F rows: played score, NEXT, upcoming GAME n; penalties / extra time in the sub line',()=>{
  const rows=historyRows(5,[g(1,2,2,'C1',{decidedBy:'penalties',leftPens:4,rightPens:3}),g(2,1,3,'C12',{decidedBy:'extra_time'})],false,'C1');
  assert.deepEqual(rows.map(r=>[r.kind,r.main,r.sub]),[
    ['played','2 - 2','- PEN 4-3 -'],['played','1 - 3','- HIỆP PHỤ -'],['next','NEXT','- GAME 3 -'],['upcoming','GAME 4',''],['upcoming','GAME 5','']]);
  assert.equal(historyRows(3,[g(1,2,0,'C1')],false,'C1')[0].sub,'- GAME 1 -');
});

test('v0.4F rows: unplayed games disappear once a team has won the BO',()=>{
  assert.equal(historyRows(3,[g(1,1,0,'C1'),g(2,2,0,'C1')],false,'C1').length,2,'BO3 2-0');
  assert.equal(historyRows(5,[g(1,1,0,'C1'),g(2,0,1,'C12'),g(3,1,0,'C1'),g(4,3,1,'C1')],false,'C1').length,4,'BO5 3-1');
  assert.equal(historyRows(7,[],false,'C1').length,7);
  assert.equal(historyRows(7,[],false,'C1').filter(r=>r.kind==='next').length,1);
});

test('v0.4F rows: swapped sides flip the score and the shoot-out',()=>{
  const rows=historyRows(3,[g(1,2,2,'C1',{decidedBy:'penalties',leftPens:4,rightPens:3}),g(2,0,1,'C12')],true,'C1');
  assert.deepEqual(rows.slice(0,2).map(r=>[r.main,r.sub]),[['2 - 2','- PEN 3-4 -'],['1 - 0','- GAME 2 -']]);
});

test('v0.4F layout: BO3 uses the FVPL spacing, BO5/BO7 shrink and stay clear of logo and title',()=>{
  const bo3=rowLayout(3);
  assert.equal(bo3.pitch,171);assert.equal(bo3.height,133);
  assert.ok(Math.abs(bo3.top-400)<=2,'first row at 300 (1080p) x4/3');
  for (const n of [1,2,3,4,5,6,7]) {
    const l=rowLayout(n);
    const logoBottom=BH.logo.centerY+BH.logo.width*407/1200/2;
    assert.ok(l.top>logoBottom+20,`n=${n} below the logo`);
    assert.ok(l.rows.at(-1)+l.height<BH.title.baseline-BH.title.size,`n=${n} above the title`);
    assert.ok(l.height>=60,`n=${n} rows stay readable`);
  }
  // Panels: FVPL 1080p x 123..518, y 113..922 -> 2K
  assert.ok(Math.abs(BH.panel.x-164)<=1 && Math.abs(BH.panel.w-527)<=1 && Math.abs(BH.panel.h-1078)<=2);
});

test('v0.4F motion + markup: IN ~1.2 s, OUT < 0.8 s, all targets exist, 7 rows max',()=>{
  const total=totalDuration(HISTORY_STEPS);
  assert.ok(total>1 && total<1.4,`IN ${total}`);
  const out=Math.max(...HISTORY_STEPS.filter(s=>s.out!==null).map(s=>{const o=derivedOut(s,total,0.6);return o.start+o.duration;}));
  assert.ok(out<0.8,`OUT ${out}`);
  const html=historyMarkup();
  for (const step of HISTORY_STEPS) for (const part of step.target.split(/\s+/)) assert.ok(html.includes(part.replace(/^\./,'')),step.target);
  assert.equal((html.match(/class="bh-row bh-row-/g)||[]).length,7);
  assert.ok(html.includes('/assets/brand/league-logo.png'),'tournament logo only');
});

test('v0.4F background: drawn (no video), pauses off air, still in Studio monitors; Anton font self-hosted',()=>{
  const css=fs.readFileSync(path.join(ROOT,'public/assets/history.css'),'utf8');
  assert.doesNotMatch(historyMarkup(),/<video/);
  assert.match(css,/\.bh-layer\[data-state="hidden"\] \.bh-bg \*[^{]*\{ animation-play-state:paused/);
  assert.match(css,/\.stage-monitor \.bh-bg \* \{ animation:none/);
  assert.doesNotMatch(css,/filter:\s*blur/,'no animated blur');
  for (const s of ['latin','latin-ext','vietnamese']) assert.ok(fs.existsSync(path.join(ROOT,`public/assets/fonts/anton-${s}-400-normal.woff2`)));
  for (const page of ['studio.html','output.html']) assert.match(fs.readFileSync(path.join(ROOT,'public',page),'utf8'),/\/assets\/history\.css/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT,'client/stage.ts'),'utf8'),/history-core/,'old placeholder removed');
});

test('v0.4F r2: no lightning / dots, hashtag ticker, corner glows; portraits fitted to the names block',()=>{
  const m=historyMarkup(), css=fs.readFileSync(path.join(ROOT,'public/assets/history.css'),'utf8');
  assert.doesNotMatch(m,/bh-bolt|bh-crack|bh-dots|bh-flash/,'lightning and dots removed');
  assert.equal(BH_TICKER.text,'#ABUxOHMYCASHCUP');
  assert.equal((m.match(/bh-tick-red/g)||[]).length,(m.match(/bh-tick-grey/g)||[]).length,'red / grey alternate');
  for (const c of ['tl','tr','bl','br']) assert.match(m,new RegExp(`bh-glow-${c}`));
  assert.match(css,/\.stage-monitor \.bh-ticker-track[^{]*\{[^}]*animation:none/);
  // 64x64 cut-out: head at x 40..48 from row 10, body to row 60 -> centred on the head, head 45 px from the top
  const w=64,h=64,a=i=>{const x=i%w,y=(i/w)|0;return (y>=10&&y<16&&x>=40&&x<48)||(y>=16&&y<60&&x>=28&&x<60)?255:0;};
  const box=portraitBoxFromAlpha(a,w,h);
  assert.ok(Math.abs(box.cx-44/64)<0.02 && !box.opaque);
  const stripH=BH.panel.h-BH.panel.names, fit=placePortrait(box,stripH,1);
  assert.equal(Math.round(fit.top+box.top*fit.height),BH.portrait.headGap);
  assert.ok(fit.top+box.bottom*fit.height>=stripH,'cut-out reaches the names block (no gap)');
  assert.deepEqual(placePortrait(portraitBoxFromAlpha(()=>255,w,h),stripH,1),{height:stripH,top:0,shiftX:.5},'photos fill the strip');
});
