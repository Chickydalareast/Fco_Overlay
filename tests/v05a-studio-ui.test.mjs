import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const studio=fs.readFileSync(path.join(ROOT,'client/studio.ts'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'public/assets/studio.css'),'utf8');

test('v0.5A Studio UI: every element the logic looks up by id still exists in the markup',()=>{
  // Optional elements read with ?. that the v0.5A layout dropped on purpose.
  const optional=new Set(['take-desc','stage-validity','take-right']);
  const ids=new Set([...studio.matchAll(/(?:\$|text)\('#([\w-]+)'/g)].map(m=>m[1]).filter(id=>!optional.has(id)));
  for (const id of ['history-left','history-right','history-note','history-game','history-decided','history-left-pens','history-right-pens','history-pens','history-winner']) ids.add(id);
  assert.ok(ids.size>40);
  for (const id of ids) {
    const prefix=id.slice(0,id.lastIndexOf('-')+1); // ids built from a template, e.g. live-name-${side}
    assert.ok(studio.includes(`id="${id}"`)||(prefix&&studio.includes(`id="${prefix}\${`)),`#${id} missing from the markup`);
  }
  for (const attr of ['data-live-toggle','data-layer','data-camera-live','data-camera-preview','data-camera-assign','data-focus-team','data-score-team','data-registry-team','data-registry-logo','data-registry-label','data-reference','data-custom-team'])
    assert.match(studio,new RegExp(attr),attr);
  for (const p of ['match.bestOf','match.matchNumber','match.gameNumber','match.stage','layers.scoreboard.x','layers.scoreboard.y','layers.scoreboard.scale'])
    assert.ok(studio.includes(`data-path="${p}"`),p);
  assert.equal((studio.match(/id="take-live"/g)||[]).length,1,'a single TAKE button');
  assert.match(studio,/href="\/admin-room" target="_blank"/);
});

test('v0.5A Studio UI: readable sizes, tournament colours only, hold-to-clear',()=>{
  const sizes=[...css.matchAll(/(?:font-size:|font:\s*\d+\s+)(\d+)px/g)].map(m=>+m[1]);
  assert.ok(sizes.length>30);
  assert.ok(Math.min(...sizes)>=12,'no text below 12 px');
  assert.doesNotMatch(css,/#366cdb|#4f9bff|#2052bb|#5295fa/i,'old blue palette removed');
  assert.match(css,/--red:#ea0d12/);
  assert.match(css,/\.btn-clear\.is-holding \.hold-fill\{transform:scaleX\(1\);transition:transform \.9s linear\}/);
  assert.match(studio,/holdTimer=window\.setTimeout\(\(\)=>\{cancelHold\(\);sendCommand\(\{type:'program\.clear'\}/);
  assert.doesNotMatch(studio,/[▤◈▦◎⇄↺✕➜]/,'no unicode pseudo-icons');
});
