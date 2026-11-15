/**
 * FC Online C11 Atlético roster display-name correction.
 * Usage: node scripts/rename-c11-players.mjs --check | --apply | --rollback <backupDir>
 * This is an explicit, idempotent operator migration, not an automatic server migration.
 * Stop the FC Online service before applying or rolling back: registry is cached on startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'data/tournaments/fc-online-2026/players.json');
const DB = path.join(ROOT, '.runtime/fc-online.sqlite');
const BACKUPS = path.join(ROOT, '.backups');
const TARGETS = [
  { id: 'C11-P1', teamId: 'C11', slot: 1, displayName: 'Văn Nhật' },
  { id: 'C11-P2', teamId: 'C11', slot: 2, displayName: 'Lý Tiểu Long' },
];

function assert(condition, message) { if (!condition) throw new Error(message); }
function jsonRead(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function safeWriteJson(file, content) {
  const tmp = file + '.c11-tmp-' + crypto.randomBytes(4).toString('hex');
  try {
    fs.writeFileSync(tmp, JSON.stringify(content, null, 2) + '\n', { encoding:'utf8', flag:'wx' });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force:true });
  }
}
function validateSeed() {
  assert(fs.existsSync(SEED), 'Missing tracked seed players.json');
  const seed = jsonRead(SEED);
  assert(Array.isArray(seed) && seed.length === 32, 'Unexpected seed player count');
  for (const target of TARGETS) {
    const rows = seed.filter(p => p.id === target.id);
    assert(rows.length === 1, `Missing/duplicate ${target.id} in players.json`);
    assert(rows[0].teamId === target.teamId && rows[0].slot === target.slot, `Seed mapping mismatch for ${target.id}`);
  }
  return seed;
}
function openDb() {
  assert(fs.existsSync(DB), 'Missing SQLite runtime database. Do not create a new one.');
  const db = new DatabaseSync(DB, { timeout:5000 });
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  const team = db.prepare('SELECT club_id FROM teams WHERE id=?').get('C11');
  assert(team?.club_id === 'atletico-madrid', `C11 is not Atlético Madrid (found ${team?.club_id ?? 'none'})`);
  const rows = db.prepare('SELECT id, team_id, roster_slot, display_name FROM players WHERE team_id=? ORDER BY roster_slot').all('C11');
  assert(rows.length === 2, 'C11 must have exactly 2 players');
  for (const target of TARGETS) {
    const row = rows.find(p => p.id === target.id);
    assert(row && row.team_id === target.teamId && row.roster_slot === target.slot, `SQLite mapping mismatch for ${target.id}`);
  }
  return { db, rows };
}
function activeRequests(db) {
  const has = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='camera_requests'").get();
  return has ? db.prepare("SELECT id,player_id,player_name FROM camera_requests WHERE team_id='C11' AND status IN ('pending','approved')").all() : [];
}
function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const value=callback(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function updateDb(db, names, requestNameMap) {
  return transaction(db, () => {
    const updatePlayer = db.prepare('UPDATE players SET display_name=? WHERE id=? AND team_id=? AND roster_slot=?');
    for (const target of TARGETS) {
      const changed = updatePlayer.run(names[target.id], target.id, 'C11', target.slot);
      assert(changed.changes === 1, `Cannot update ${target.id}`);
    }
    if (requestNameMap) {
      const updateRequest = db.prepare("UPDATE camera_requests SET player_name=? WHERE id=? AND team_id='C11' AND status IN ('pending','approved')");
      for (const [id, value] of Object.entries(requestNameMap)) updateRequest.run(value, id);
    } else {
      const has = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='camera_requests'").get();
      if (has) {
        const updateRequest = db.prepare("UPDATE camera_requests SET player_name=? WHERE player_id=? AND team_id='C11' AND status IN ('pending','approved')");
        for (const target of TARGETS) updateRequest.run(names[target.id], target.id);
      }
    }
  });
}
function status(seed, rows, pending) {
  const seedNames = Object.fromEntries(seed.filter(p => p.teamId==='C11').map(p=>[p.id,p.displayName]));
  const dbNames = Object.fromEntries(rows.map(p=>[p.id,p.display_name]));
  const needs = TARGETS.some(p=>seedNames[p.id]!==p.displayName||dbNames[p.id]!==p.displayName) || pending.some(r => dbNames[r.player_id] !== r.player_name);
  console.log('C11 club: atletico-madrid');
  for(const p of TARGETS) console.log(`${p.id}: seed=${JSON.stringify(seedNames[p.id])} | db=${JSON.stringify(dbNames[p.id])} | target=${JSON.stringify(p.displayName)}`);
  console.log(`ACTIVE CAMERA REQUESTS: ${pending.length}`);
  return { seedNames, dbNames, needs };
}
function apply() {
  const seed = validateSeed();
  const {db,rows} = openDb();
  try {
    const pending = activeRequests(db);
    const check = status(seed, rows, pending);
    if (!check.needs) { console.log('ALREADY UPDATED: both sources and current requests are correct.'); return; }
    fs.mkdirSync(BACKUPS, { recursive:true });
    const backup = fs.mkdtempSync(path.join(BACKUPS, 'c11_names_'));
    const backupSqlite = path.join(backup, 'fc-online-before.sqlite');
    fs.copyFileSync(SEED, path.join(backup, 'players-before.json'));
    // VACUUM INTO is a transactionally consistent SQLite backup, including WAL data.
    db.prepare('VACUUM INTO ?').run(backupSqlite);
    const original = {
      createdAt: new Date().toISOString(),
      seedNames: check.seedNames,
      dbNames: check.dbNames,
      activeRequests: pending.map(r=>({id:r.id, playerId:r.player_id, playerName:r.player_name})),
    };
    safeWriteJson(path.join(backup, 'manifest.json'), original);
    const newNames = Object.fromEntries(TARGETS.map(p=>[p.id,p.displayName]));
    const nextSeed = seed.map(p=>newNames[p.id]===undefined?p:{...p,displayName:newNames[p.id]});
    let dbCommitted = false;
    try {
      updateDb(db, newNames);
      dbCommitted = true;
      if (TARGETS.some(p=>check.seedNames[p.id]!==newNames[p.id])) safeWriteJson(SEED, nextSeed);
    } catch (e) {
      if (dbCommitted) {
        try {
          updateDb(db, original.dbNames, Object.fromEntries(original.activeRequests.map(r=>[r.id,r.playerName])));
          fs.copyFileSync(path.join(backup, 'players-before.json'), SEED);
        } catch (restoreError) {
          console.error('WARNING: Automatic rollback failed. Backup:', backup, restoreError);
        }
      }
      throw e;
    }
    const after = db.prepare('SELECT id,display_name FROM players WHERE team_id=? ORDER BY roster_slot').all('C11');
    assert(after.every(r=>r.display_name===newNames[r.id]), 'Post-update SQLite validation failed');
    console.log('SUCCESS: C11 names updated in SQLite and seed.');
    console.log('BACKUP:', backup);
    console.log('NOTE: Restart FC Online service so cached Registry reloads.');
  } finally { db.close(); }
}
function rollback(folder) {
  assert(folder, 'Usage: --rollback <backupDir>');
  const absolute = path.resolve(folder);
  assert(path.relative(BACKUPS,absolute) !== '..' && !path.relative(BACKUPS,absolute).startsWith('..'+path.sep), 'Backup must be under project .backups');
  const manifest = jsonRead(path.join(absolute, 'manifest.json'));
  const originalSeed = jsonRead(path.join(absolute, 'players-before.json'));
  const current = validateSeed();
  for(const t of TARGETS) assert(originalSeed.some(p=>p.id===t.id&&p.teamId==='C11'&&p.slot===t.slot),'Invalid backup seed mapping');
  const {db} = openDb();
  try {
    // Roll back only C11 names; never restore the entire SQLite file, to preserve new BO / Game History.
    updateDb(db, manifest.dbNames, Object.fromEntries((manifest.activeRequests||[]).map(r=>[r.id,r.playerName])));
    const oldSeed = Object.fromEntries(originalSeed.filter(p=>p.teamId==='C11').map(p=>[p.id,p.displayName]));
    safeWriteJson(SEED, current.map(p=>oldSeed[p.id]===undefined?p:{...p,displayName:oldSeed[p.id]}));
    console.log('SUCCESS: C11 names restored without touching scores, matches, or other teams.');
    console.log('Restart FC Online service to refresh cached Registry.');
  } finally { db.close(); }
}

const cmd = process.argv[2] ?? '--check';
try {
  if (cmd === '--apply') apply();
  else if (cmd === '--rollback') rollback(process.argv[3]);
  else if (cmd === '--check') {
    const seed = validateSeed();
    const {db,rows} = openDb();
    try { status(seed,rows,activeRequests(db)); } finally { db.close(); }
  } else throw new Error('Usage: --check | --apply | --rollback <backupDir>');
} catch(e) { console.error('ERROR:', e instanceof Error ? e.message : String(e)); process.exitCode=1; }
