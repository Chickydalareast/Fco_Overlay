import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MASCOT,pickMascot,historyMarkup,BH} from '../public/build/history.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const seq=(...v)=>{let i=0;return()=>v[i++%v.length];};

test('v0.4G background: red/white swooshes removed, waves in the portrait fade, mascot slots',()=>{
  const m=historyMarkup(), css=read('public/assets/history.css');
  assert.doesNotMatch(m,/bh-swoosh/); assert.doesNotMatch(css,/bh-swoosh/);
  assert.equal((m.match(/class="bh-wave"/g)||[]).length,4,'one wave per portrait strip');
  assert.equal((m.match(/class="bh-mascot"/g)||[]).length,MASCOT.max);
  assert.equal(MASCOT.max,3,'v0.4H: up to 3 at a time');
  assert.match(css,/\.bh-layer\[data-state="hidden"\] \.bh-wave::before/);
  assert.match(css,/\.stage-monitor \.bh-wave::before, \.stage-monitor \.bh-wave::after \{ animation:none/);
  assert.ok(fs.existsSync(path.join(ROOT,'public',MASCOT.src)),'mascot image shipped');
});

test('v0.4G/H mascots: tilt < 45 deg, inside a zone, never two in the same zone, mostly corners',()=>{
  for (let i=0;i<500;i++){
    const s=pickMascot(Math.random,[]);
    assert.ok(Math.abs(s.tilt)<45);
    const z=MASCOT.zones.find(z=>z.id===s.zone);
    assert.ok(s.x>=z.x[0]&&s.x<=z.x[1]&&s.y>=z.y[0]&&s.y<=z.y[1]);
    assert.ok(s.size>=MASCOT.size[0]&&s.size<=MASCOT.size[1]);
  }
  assert.equal(pickMascot(seq(0,.5,.5,.5,.5),['tl']).zone,'tr','busy zone skipped');
  assert.equal(pickMascot(Math.random,MASCOT.zones.map(z=>z.id)),null);
  const hz=MASCOT.zones.filter(z=>z.scenes.includes('history'));
  const corner=hz.filter(z=>z.id.length===2).reduce((t,z)=>t+z.weight,0), all=hz.reduce((t,z)=>t+z.weight,0);
  assert.ok(corner/all>=.75);
  assert.match(read('client/history.ts'),/root\.closest\("\.stage-monitor"\)/,'no mascots in Studio monitors');
});

test('v0.4G type: esports caps (Barlow Condensed, uppercase) and bigger on every on-air layout',()=>{
  const rule=(css,sel)=>{const i=css.indexOf(sel+' {');assert.ok(i>=0,sel);return css.slice(i,css.indexOf('}',i));};
  const checks=[['public/assets/intro.css',['.intro-team-name','.intro-match','.intro-game']],
    ['public/assets/scoreboard.css',['.sb-game','.sb-name-text']],
    ['public/assets/history.css',['.bh-name','.bh-team','.bh-sub']]];
  for (const [f,sels] of checks){const css=read(f);for(const s of sels){const r=rule(css,s);assert.match(r,/Barlow Condensed/,s);assert.match(r,/text-transform:uppercase/,s);}}
  assert.match(read('public/assets/stage.css'),/\.camera-tag \{[^}]*text-transform:uppercase/);
  assert.ok(BH.text.name>=40&&BH.text.team>=50);
});
