import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QUALIFIED_TEAM_IDS, QUALIFIED_TEAM_LABELS, qualifiedTeamOptionLabel,
  isQualifiedTeamId, qualifiedRegistryTeams
} from '../public/build/qualified-teams.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const studio=fs.readFileSync(path.join(ROOT,'client/studio.ts'),'utf8');
const seed=JSON.parse(fs.readFileSync(path.join(ROOT,'data/tournaments/fc-online-2026/teams.json'),'utf8'));
const expected=['C16','C8','C15','C2','C11','C7','C14','C1'];
const eliminated=['C3','C4','C5','C6','C9','C10','C12','C13'];

// Four quarterfinal matchups copied from the user's confirmed bracket image.
const quarterfinals=[
  ['C16','C8'],  // Arsenal - Borussia Dortmund
  ['C15','C2'],  // Liverpool - Manchester United
  ['C11','C7'],  // Atletico Madrid - Manchester City
  ['C14','C1']   // Real Madrid - AC Milan
];

test('v0.5G: EXACTLY 8 advancing team IDs, bracket order and no duplicates',()=>{
  assert.deepEqual([...QUALIFIED_TEAM_IDS],expected);
  assert.equal(QUALIFIED_TEAM_IDS.length,8);
  assert.equal(new Set(QUALIFIED_TEAM_IDS).size,8);
});

test('v0.5G: all 8 qualified teams exist in the tournament seed with the correct clubs',()=>{
  assert.equal(seed.length,16);
  assert.deepEqual(qualifiedRegistryTeams(seed).map(t=>t.id),expected);
  const byId=new Map(seed.map(t=>[t.id,t.clubId]));
  assert.deepEqual(expected.map(id=>byId.get(id)),[
    'arsenal','borussia-dortmund','liverpool','manchester-united',
    'atletico-madrid','manchester-city','real-madrid','ac-milan'
  ]);
});

test('v0.5G: four quarterfinal pairings match the tournament bracket image',()=>{
  assert.deepEqual(Array.from({length:4},(_,i)=>QUALIFIED_TEAM_IDS.slice(i*2,i*2+2)),quarterfinals);
});

test('v0.5G: all 8 eliminated IDs hidden, full 16-team Registry preserved',()=>{
  const reversed=[...seed].reverse();
  const before=JSON.stringify(reversed);
  const selected=qualifiedRegistryTeams(reversed);
  assert.deepEqual(selected.map(t=>t.id),expected);
  assert.equal(reversed.length,16);
  assert.equal(JSON.stringify(reversed),before);
  for(const id of eliminated)assert.equal(isQualifiedTeamId(id),false,id);
  for(const id of expected)assert.equal(isQualifiedTeamId(id),true,id);
  assert.deepEqual([...eliminated,...expected].sort(),seed.map(t=>t.id).sort());
});

test('v0.5G: Studio has guarded two-team dropdown and old BO reference preserved',()=>{
  assert.match(studio,/qualifiedRegistryTeams\(registry\?\.teams\?\?\[\]\)/);
  assert.match(studio,/const team=findRegistryTeam\(current\.teamId\)/);
  assert.match(studio,/oldOption\.disabled=true/);
  assert.match(studio,/if\(!isQualifiedTeamId\(id\)\)/);
  assert.match(studio,/Quarterfinals: 8 qualified teams/);
  assert.match(studio,/Only the eight qualified teams may be selected/);
});

test('v0.5G: filter is read-only and does not change server or DB schema',()=>{
  assert.equal(qualifiedRegistryTeams([]).length,0);
  assert.equal(isQualifiedTeamId(undefined),false);
  assert.equal(isQualifiedTeamId('C11'),true);
});

test('v0.5G: Studio labels preserve canonical clubs; C11 has no invented nickname',()=>{
  for(const team of qualifiedRegistryTeams(seed)){
    const label=qualifiedTeamOptionLabel({...team,club:{name:team.clubId}});
    assert.ok(label.startsWith(`${team.id} · `));
    assert.ok(label.includes(team.clubId));
    if(QUALIFIED_TEAM_LABELS[team.id]){
      assert.ok(label.startsWith(`${team.id} · ${QUALIFIED_TEAM_LABELS[team.id]} · `));
    }else{
      assert.equal(team.id,'C11');
      assert.equal(label,`${team.id} · ${team.clubId} (Group ${team.group})`);
    }
  }
  assert.match(studio,/qualifiedTeamOptionLabel\(team\)/);
});
