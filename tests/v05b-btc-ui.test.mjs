import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ts=fs.readFileSync(path.join(ROOT,'client/admin-room.ts'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'public/assets/admin-room.css'),'utf8');

test('v0.5B BTC room: same elements for the logic, red only while the players can hear you',()=>{
  for (const id of ['adm-login','adm-password','adm-match','adm-conn','adm-watch','mic-device','mic-toggle','mic-meter','relay-source','relay-toggle','relay-meter','relay-warn','adm-presence'])
    assert.match(ts,new RegExp(`id="${id}"`),id);
  for (const cls of ['adm-tile-name','adm-tile-state','adm-tile-empty','data-team-name']) assert.ok(ts.includes(cls),cls);
  assert.match(ts,/id="mic-toggle" class="btn btn-live"/,'mic is neutral until switched on');
  assert.match(ts,/id="relay-toggle" class="btn btn-live"/);
  assert.match(css,/\.btn-live\[data-live="true"\]\{background:var\(--red\)/);
  assert.match(css,/\.adm-tile::after\{[^}]*border:2px solid var\(--cam-a\)/,'team frame drawn above the video');
  assert.match(css,/--red:#ea0d12/);
  const sizes=[...css.matchAll(/(?:font-size:|font:\s*\d+\s+)(\d+)px/g)].map(m=>+m[1]);
  assert.ok(Math.min(...sizes)>=12,'no text below 12 px');
});
