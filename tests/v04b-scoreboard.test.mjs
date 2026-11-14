import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { createStore, validateLayers, SCOREBOARD_PLACEMENT } from '../server/state.mjs';
import { SB, SB_CX, SB_SHAPES, SCOREBOARD_STEPS, scoreboardMarkup, scoreboardCode } from '../public/build/scoreboard.js';
import { totalDuration, derivedOut } from '../public/build/motion.js';
import { rebaseDraft, cloneProgram, SAMPLE_PROGRAM } from '../public/build/contracts.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fixture(t, initial) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fc-v04b-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'state.json');
  if (initial) fs.writeFileSync(file, JSON.stringify(initial));
  return {file, store:createStore(file)};
}
const layers=(sb={})=>({scoreboard:{visible:true,...sb},intro:{visible:false},history:{visible:false}});

test('v0.4B placement: validation ranges', ()=>{
  assert.equal(validateLayers(layers({x:-640,y:360,scale:50})),true);
  assert.equal(validateLayers(layers({x:641})),false);
  assert.equal(validateLayers(layers({y:-361})),false);
  assert.equal(validateLayers(layers({scale:201})),false);
  assert.equal(validateLayers(layers({scale:1.5})),false, 'scale is an integer percent');
  assert.equal(validateLayers(layers({x:'10'})),false);
  assert.equal(validateLayers(layers()),true, 'older clients may omit placement');
  assert.deepEqual(Object.keys(SCOREBOARD_PLACEMENT),['x','y','scale']);
});

test('v0.4B placement: old saved state gets defaults; TAKE stores and keeps values', async t=>{
  const old=JSON.parse(fs.readFileSync(path.join(ROOT,'server/default-program.json'),'utf8'));
  old.revision=7; old.layers={scoreboard:{visible:true},intro:{visible:false}};
  const {store}=fixture(t, old);
  assert.deepEqual(store.get().layers.scoreboard,{visible:true,x:0,y:0,scale:100});
  const p=store.get();
  const take=await store.command({id:'take-v04b-1',type:'program.take',expectedRevision:p.revision,match:p.match,layers:layers({x:40,y:-12,scale:110}),cameras:p.cameras});
  assert.equal(take.ok,true,take.reason);
  assert.deepEqual(take.program.layers.scoreboard,{visible:true,x:40,y:-12,scale:110});
  // An older Studio tab sends layers without placement: values are kept, not reset.
  const old2=await store.command({id:'take-v04b-2',type:'program.take',expectedRevision:take.program.revision,match:p.match,layers:{scoreboard:{visible:false},intro:{visible:false},history:{visible:false}},cameras:p.cameras});
  assert.equal(old2.ok,true,old2.reason);
  assert.deepEqual(old2.program.layers.scoreboard,{visible:false,x:40,y:-12,scale:110});
  // Visibility cues and emergency clear never touch placement.
  const on=await store.command({id:'v04b-cue-1',type:'layer.setVisible',layer:'scoreboard',visible:true});
  const clear=await store.command({id:'v04b-clear-1',type:'program.clear'});
  assert.deepEqual([on.program.layers.scoreboard.x,clear.program.layers.scoreboard.scale],[40,110]);
  const bad=await store.command({id:'take-v04b-3',type:'program.take',expectedRevision:clear.program.revision,match:p.match,layers:layers({x:9999}),cameras:p.cameras});
  assert.equal(bad.ok,false);
});

test('v0.4B placement: Preview nudge survives a live score change (rebase)', ()=>{
  const base=cloneProgram(SAMPLE_PROGRAM);
  const draft=cloneProgram(base); Object.assign(draft.layers.scoreboard,{x:30,y:6,scale:105});
  const live=cloneProgram(base); live.revision=1; live.match.teamA.seriesWins=2;
  const {program,conflicts}=rebaseDraft(base,draft,live);
  assert.deepEqual(conflicts,[]);
  assert.deepEqual([program.layers.scoreboard.x,program.layers.scoreboard.scale,program.match.teamA.seriesWins],[30,105,2]);
});

test('v0.4B geometry: matches the FVPL 2K frame and the game score box', ()=>{
  const sh=SB_SHAPES, GAME_BOX={left:139,right:833,top:100};
  // Body bottom edge has the width of the game's own score box (±3 px)
  assert.ok(Math.abs(sh.bottomEdge[0]-GAME_BOX.left)<=3, `left ${sh.bottomEdge[0]}`);
  assert.ok(Math.abs(sh.bottomEdge[1]-GAME_BOX.right)<=3, `right ${sh.bottomEdge[1]}`);
  assert.equal(SB.body.bottom-SB.body.top,57);
  assert.ok(SB.under.bottom<GAME_BOX.top, 'nothing covers the game score box');
  // Only the GAME tab sits outside the game box on the right
  const maxX=pts=>Math.max(...pts.map(p=>p[0]));
  for (const k of ['body','plate','cellA','cellB','streakA','streakB']) assert.ok(maxX(sh[k])<=SB.body.right, k);
  assert.ok(sh.tab[0][0]>SB.body.right);
  // Underlay tips poke out past the body on both ends, at the bottom
  assert.ok(SB.under.left<sh.bottomEdge[0] && SB.under.right>SB.tab.right);
  assert.ok(SB.under.bottom>SB.body.bottom);
  // Mirror symmetry of the score cells around the centre line
  const a=sh.cellA.map(p=>p[0]).sort((x,y)=>x-y), b=sh.cellB.map(p=>2*SB_CX-p[0]).sort((x,y)=>x-y);
  a.forEach((x,i)=>assert.ok(Math.abs(x-b[i])<0.01));
  // Plate sits in the body, narrower at the bottom, below the notch
  assert.ok(SB.plate.top===SB.body.top+SB.notch.depth && SB.plate.bottom<SB.body.bottom && SB.plate.halfBottom<SB.plate.halfTop);
  // Team code: short code, like TKO on the reference
  assert.equal(scoreboardCode({teamId:'C1',shortName:'C1'}),'C1');
  assert.equal(scoreboardCode({shortName:'fury'}),'FURY');
});

test('v0.4B motion: IN ~1.15 s, OUT under 0.8 s, every target exists', ()=>{
  const total=totalDuration(SCOREBOARD_STEPS);
  assert.ok(total>1 && total<1.3, `IN ${total}`);
  const out=Math.max(...SCOREBOARD_STEPS.filter(s=>s.out!==null).map(s=>{const o=derivedOut(s,total,0.6);return o.start+o.duration;}));
  assert.ok(out<0.8, `OUT ${out}`);
  const html=scoreboardMarkup();
  for (const step of SCOREBOARD_STEPS) for (const sel of step.target.split(',')) {
    const last=sel.trim().split(/\s+/).pop().replace(/^\./,'');
    assert.ok(html.includes(last), `${sel} missing in markup`);
  }
  // Hidden poses in CSS match the first IN keyframe of each step (no jump at start)
  const css=fs.readFileSync(path.join(ROOT,'public/assets/scoreboard.css'),'utf8');
  for (const [cls,pose] of [['.sb-body','inset(0px 50% 0px 50%)'],['.sb-under','inset(0px 50% 0px 50%)'],['.sb-score-a .sb-score-fill','translateX(-110%)'],['.sb-score-b .sb-score-fill','translateX(110%)'],['.sb-tab-fill','translateX(-101%)'],['.sb-stage-text','translateY(34px)'],['.sb-digit','translateY(-46px)']]) {
    const rule=new RegExp(cls.replace(/[.]/g,'\\.')+'\\s*\\{[^}]*'+pose.replace(/[()%.-]/g,m=>'\\'+m));
    assert.match(css,rule,`${cls} hidden pose`);
  }
});

test('v0.4B assets: Barlow Condensed self-hosted, pages load scoreboard.css, legacy scoreboard removed', ()=>{
  for (const w of [600,700]) for (const s of ['latin','latin-ext','vietnamese'])
    assert.ok(fs.existsSync(path.join(ROOT,`public/assets/fonts/barlow-condensed-${s}-${w}-normal.woff2`)));
  assert.match(fs.readFileSync(path.join(ROOT,'public/assets/fonts/fonts.css'),'utf8'),/Barlow Condensed/);
  for (const page of ['studio.html','output.html']) assert.match(fs.readFileSync(path.join(ROOT,'public',page),'utf8'),/\/assets\/scoreboard\.css/);
  const stage=fs.readFileSync(path.join(ROOT,'client/stage.ts'),'utf8');
  assert.doesNotMatch(stage,/scoreboard-layer|g-a-series/);
});
