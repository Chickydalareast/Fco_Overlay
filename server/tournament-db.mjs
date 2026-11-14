/**
 * FC Online v0.3A: canonical tournament registry and persisted Program snapshot.
 * Requires Node >=22.16 (node:sqlite). Zero third-party native dependencies.
 * SQLite is the database of record once the legacy v0.2 JSON snapshot is imported.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DB_FILE = path.resolve(process.env.FC_DB_FILE || path.join(ROOT,'.runtime','fc-online.sqlite'));
const SEED_DIR = path.join(ROOT,'data','tournaments','fc-online-2026');
const isoNow = () => new Date().toISOString();
const assert = (condition, message) => { if (!condition) throw new Error(`Tournament seed invalid: ${message}`); };
const color = value => typeof value==='string' && /^#[0-9a-fA-F]{6}$/.test(value);
const id = value => typeof value==='string' && /^[a-zA-Z0-9-]{2,64}$/.test(value);

function readSeed(dir) {
  const read = filename => JSON.parse(fs.readFileSync(path.join(dir,filename),'utf8'));
  const tournament=read('tournament.json');
  const clubs=read('clubs.json');
  const teams=read('teams.json');
  const players=read('players.json');
  const fixtures=read('fixtures.json');
  assert(id(tournament.id)&&typeof tournament.name==='string','invalid tournament');
  assert(clubs.length===16 && teams.length===16 && players.length===32 && fixtures.length===8,'expected 16 clubs, 16 teams, 32 players, 8 fixtures');
  const unique=(items,key)=>new Set(items.map(x=>x[key])).size===items.length;
  assert(unique(clubs,'id') && unique(teams,'id') && unique(players,'id') && unique(fixtures,'id'),'duplicate ids');
  const clubsById=new Set(clubs.map(c=>c.id));
  const teamsById=new Set(teams.map(t=>t.id));
  for(const c of clubs) assert(id(c.id) && color(c.colors?.primary) && color(c.colors?.secondary) && color(c.colors?.foreground) && /^\/assets\/clubs\/[a-z0-9-]+\.png$/.test(c.logo),`club ${c.id}`);
  for(const t of teams) assert(/^C(?:[1-9]|1[0-6])$/.test(t.id) && ['A','B','C','D'].includes(t.group) && clubsById.has(t.clubId) && t.tournamentId===tournament.id,`team ${t.id}`);
  for(const p of players) assert(/^C(?:[1-9]|1[0-6])-P[12]$/.test(p.id) && teamsById.has(p.teamId) && [1,2].includes(p.slot) && typeof p.displayName==='string' && p.displayName.length>0 && p.displayName.length<=28,`player ${p.id}`);
  for(const t of teams) assert(players.filter(p=>p.teamId===t.id).length===2,`team ${t.id} roster count`);
  for(const f of fixtures) assert(id(f.id) && teamsById.has(f.leftTeamId) && teamsById.has(f.rightTeamId) && f.leftTeamId!==f.rightTeamId && [3,5,7].includes(f.bestOf),`fixture ${f.id}`);
  return {tournament,clubs,teams,players,fixtures};
}

function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=callback(); db.exec('COMMIT'); return result; }
  catch(error) { db.exec('ROLLBACK'); throw error; }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    ) STRICT;
  `);
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=1').get()) transaction(db,()=>{
    db.exec(`
      CREATE TABLE tournaments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        default_best_of INTEGER NOT NULL CHECK(default_best_of IN (3,5,7))
      ) STRICT;
      CREATE TABLE clubs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL,
        primary_color TEXT NOT NULL, secondary_color TEXT NOT NULL, foreground_color TEXT NOT NULL,
        logo_path TEXT NOT NULL, logo_status TEXT NOT NULL, logo_source TEXT NOT NULL
      ) STRICT;
      CREATE TABLE teams (
        id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
        club_id TEXT NOT NULL REFERENCES clubs(id), group_code TEXT NOT NULL CHECK(group_code IN ('A','B','C','D')),
        display_name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        UNIQUE(tournament_id, club_id)
      ) STRICT;
      CREATE TABLE players (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id),
        roster_slot INTEGER NOT NULL CHECK(roster_slot IN (1,2)),
        display_name TEXT NOT NULL, portrait_path TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        UNIQUE(team_id, roster_slot)
      ) STRICT;
      CREATE TABLE fixtures (
        id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
        group_code TEXT NOT NULL, left_team_id TEXT NOT NULL REFERENCES teams(id),
        right_team_id TEXT NOT NULL REFERENCES teams(id), best_of INTEGER NOT NULL CHECK(best_of IN (3,5,7)),
        status TEXT NOT NULL DEFAULT 'planned', CHECK(left_team_id <> right_team_id)
      ) STRICT;
      CREATE TABLE program_state (
        id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL,
        state_json TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_teams_group ON teams(tournament_id,group_code);
      CREATE INDEX idx_players_team ON players(team_id);
      CREATE INDEX idx_fixtures_group ON fixtures(tournament_id,group_code);
    `);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(1,?,?)').run('initial tournament registry & program state',isoNow());
  });

  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=2').get()) transaction(db,()=>{
    db.exec(`
      CREATE TABLE broadcast_matches (
        id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
        fixture_id TEXT REFERENCES fixtures(id), left_team_id TEXT NOT NULL REFERENCES teams(id),
        right_team_id TEXT NOT NULL REFERENCES teams(id), best_of INTEGER NOT NULL CHECK(best_of IN (3,5,7)),
        status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','finished')),
        created_at TEXT NOT NULL, CHECK(left_team_id<>right_team_id)
      ) STRICT;
      CREATE TABLE game_results (
        match_id TEXT NOT NULL REFERENCES broadcast_matches(id), game_number INTEGER NOT NULL CHECK(game_number BETWEEN 1 AND 9),
        left_goals INTEGER NOT NULL CHECK(left_goals BETWEEN 0 AND 25),
        right_goals INTEGER NOT NULL CHECK(right_goals BETWEEN 0 AND 25),
        winner_team_id TEXT NOT NULL REFERENCES teams(id),
        note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(match_id,game_number)
      ) STRICT;
      CREATE TABLE game_result_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, game_number INTEGER NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('create','edit')),
        previous_json TEXT, next_json TEXT NOT NULL, operator TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_broadcast_matches_teams ON broadcast_matches(left_team_id,right_team_id);
      CREATE INDEX idx_game_results_match ON game_results(match_id,game_number);
      CREATE INDEX idx_game_audit_match ON game_result_audit(match_id,game_number,id);
    `);
    // Import eight defined fixtures once; future custom matches use generated IDs.
    const fixtures=db.prepare('SELECT * FROM fixtures').all();
    const insert=db.prepare(`INSERT INTO broadcast_matches(id,tournament_id,fixture_id,left_team_id,right_team_id,best_of,status,created_at) VALUES(?,?,?,?,?,?,?,?)`);
    for(const f of fixtures) insert.run('match-'+f.id,f.tournament_id,f.id,f.left_team_id,f.right_team_id,f.best_of,f.status==='finished'?'finished':'planned',isoNow());
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(2,?,?)').run('match manager, game history & audit',isoNow());
  });

  // v0.3F: durable admin logins and camera admissions survive a Node restart.
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=3').get()) transaction(db,()=>{
    db.exec(`
      CREATE TABLE admin_sessions (
        sid_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE camera_requests (
        id TEXT PRIMARY KEY, bo_id TEXT NOT NULL, team_id TEXT NOT NULL, player_id TEXT NOT NULL,
        team_side TEXT NOT NULL, player_name TEXT NOT NULL, roster_slot INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled','expired','replaced','revoked')),
        claim_hash TEXT NOT NULL, session_hash TEXT, error TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX idx_camera_requests_bo ON camera_requests(bo_id,player_id,status);
      CREATE INDEX idx_camera_requests_session ON camera_requests(session_hash);
    `);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(3,?,?)').run('durable admin sessions & camera admissions',isoNow());
  });

  // v0.4E: how a game was decided + penalty shoot-out score. Existing rows
  // become 'regular' with no penalties; older app versions ignore the columns.
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=4').get()) transaction(db,()=>{
    db.exec(`
      ALTER TABLE game_results ADD COLUMN decided_by TEXT NOT NULL DEFAULT 'regular' CHECK(decided_by IN ('regular','extra_time','penalties'));
      ALTER TABLE game_results ADD COLUMN left_pens INTEGER CHECK(left_pens IS NULL OR left_pens BETWEEN 0 AND 30);
      ALTER TABLE game_results ADD COLUMN right_pens INTEGER CHECK(right_pens IS NULL OR right_pens BETWEEN 0 AND 30);
    `);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(4,?,?)').run('game decided-by & penalty score',isoNow());
  });
}

/** v0.4E: one game result row -> API object. */
const DECIDED_BY=['regular','extra_time','penalties'];
function gameRow(r){
  return {gameNumber:r.game_number,leftGoals:r.left_goals,rightGoals:r.right_goals,winnerTeamId:r.winner_team_id,note:r.note,version:r.version,updatedAt:r.updated_at,
    decidedBy:r.decided_by??'regular',leftPens:r.left_pens??null,rightPens:r.right_pens??null};
}

function seedIfEmpty(db, dir) {
  if (db.prepare('SELECT COUNT(*) AS count FROM teams').get().count>0) return false;
  // Validate the entire seed BEFORE writing, avoiding half-imported rosters.
  const s=readSeed(dir);
  transaction(db,()=>{
    db.prepare('INSERT INTO tournaments VALUES(?,?,?,?)').run(s.tournament.id,s.tournament.name,s.tournament.description,s.tournament.defaultBestOf);
    const addClub=db.prepare('INSERT INTO clubs VALUES(?,?,?,?,?,?,?,?,?)');
    for(const c of s.clubs) addClub.run(c.id,c.name,c.shortName,c.colors.primary,c.colors.secondary,c.colors.foreground,c.logo,c.logoStatus,c.logoSource);
    const addTeam=db.prepare('INSERT INTO teams VALUES(?,?,?,?,?,?)');
    for(const t of s.teams) addTeam.run(t.id,t.tournamentId,t.clubId,t.group,t.displayName,t.active?1:0);
    const addPlayer=db.prepare('INSERT INTO players VALUES(?,?,?,?,?,?)');
    for(const p of s.players) addPlayer.run(p.id,p.teamId,p.slot,p.displayName,p.portrait,p.active?1:0);
    const addFixture=db.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?,?,?)');
    for(const f of s.fixtures) addFixture.run(f.id,f.tournamentId,f.group,f.leftTeamId,f.rightTeamId,f.bestOf,f.status);
  });
  return true;
}

function cameraRow(r) {
  return {id:r.id,boId:r.bo_id,teamId:r.team_id,playerId:r.player_id,team:r.team_side,playerName:r.player_name,
    rosterSlot:r.roster_slot,status:r.status,claimHash:r.claim_hash,sessionHash:r.session_hash,error:r.error,
    createdAt:r.created_at,updatedAt:r.updated_at};
}

function registrySnapshot(db) {
  const t=db.prepare('SELECT id,name,description,default_best_of FROM tournaments LIMIT 1').get();
  const clubs=db.prepare('SELECT * FROM clubs ORDER BY id').all().map(c=>({
    id:c.id,name:c.name,shortName:c.short_name,
    colors:{primary:c.primary_color,secondary:c.secondary_color,foreground:c.foreground_color},
    logo:c.logo_path,logoStatus:c.logo_status,logoSource:c.logo_source
  }));
  const players=db.prepare('SELECT * FROM players ORDER BY team_id,roster_slot').all().map(p=>({
    id:p.id,teamId:p.team_id,slot:p.roster_slot,displayName:p.display_name,
    portrait:p.portrait_path,active:!!p.active
  }));
  const clubMap=new Map(clubs.map(c=>[c.id,c]));
  const teams=db.prepare('SELECT * FROM teams ORDER BY CAST(SUBSTR(id,2) AS INT)').all().map(t=>({
    id:t.id,tournamentId:t.tournament_id,group:t.group_code,clubId:t.club_id,
    club:clubMap.get(t.club_id),players:players.filter(p=>p.teamId===t.id),
    displayName:t.display_name,active:!!t.active
  }));
  const fixtures=db.prepare('SELECT * FROM fixtures ORDER BY group_code,id').all().map(f=>({
    id:f.id,tournamentId:f.tournament_id,group:f.group_code,
    leftTeamId:f.left_team_id,rightTeamId:f.right_team_id,bestOf:f.best_of,status:f.status
  }));
  return {schemaVersion:1,tournament:{id:t.id,name:t.name,description:t.description,defaultBestOf:t.default_best_of},clubs,teams,players,fixtures};
}

export function openTournamentDB({dbFile=DB_FILE,seedDir=SEED_DIR}={}) {
  if (dbFile!==':memory:') fs.mkdirSync(path.dirname(dbFile),{recursive:true});
  const db=new DatabaseSync(dbFile, {timeout:5000});
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (dbFile!==':memory:') db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    migrate(db);
    seedIfEmpty(db,seedDir);
    // On a fresh DB, v2 schema migration happens before seeding the v1 fixture rows.
    transaction(db,()=>{
      const fixtures=db.prepare('SELECT * FROM fixtures').all();
      const insert=db.prepare(`INSERT OR IGNORE INTO broadcast_matches(id,tournament_id,fixture_id,left_team_id,right_team_id,best_of,status,created_at) VALUES(?,?,?,?,?,?,?,?)`);
      for(const f of fixtures) insert.run('match-'+f.id,f.tournament_id,f.id,f.left_team_id,f.right_team_id,f.best_of,'planned',isoNow());
    });
    const cached=registrySnapshot(db);
    return {
      path:dbFile,
      registry:()=>structuredClone(cached),
      counts:()=>({teams:cached.teams.length,players:cached.players.length,clubs:cached.clubs.length,fixtures:cached.fixtures.length}),
      listMatches() {
        return db.prepare(`SELECT bm.*,f.group_code FROM broadcast_matches bm LEFT JOIN fixtures f ON f.id=bm.fixture_id ORDER BY bm.created_at,bm.id`).all().map(m=>({
          id:m.id, fixtureId:m.fixture_id, tournamentId:m.tournament_id,
          leftTeamId:m.left_team_id,rightTeamId:m.right_team_id,bestOf:m.best_of,
          status:m.status,group:m.group_code||null
        }));
      },
      getMatch(matchId) {
        const m=db.prepare('SELECT * FROM broadcast_matches WHERE id=?').get(matchId);
        return m?{id:m.id,leftTeamId:m.left_team_id,rightTeamId:m.right_team_id,bestOf:m.best_of,status:m.status,fixtureId:m.fixture_id}:null;
      },
      createMatch({leftTeamId,rightTeamId,bestOf,id:requestedId}) {
        if (!cached.teams.some(t=>t.id===leftTeamId) || !cached.teams.some(t=>t.id===rightTeamId) || leftTeamId===rightTeamId || ![3,5,7].includes(bestOf)) throw new Error('Invalid match pairing or BO format');
        if (requestedId!==undefined && !/^match-custom-[a-f0-9-]{36}$/.test(requestedId)) throw new Error('Invalid BO session ID');
        const id=requestedId||'match-custom-'+crypto.randomUUID();
        db.prepare('INSERT INTO broadcast_matches(id,tournament_id,fixture_id,left_team_id,right_team_id,best_of,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,cached.tournament.id,null,leftTeamId,rightTeamId,bestOf,'planned',isoNow());
        return this.getMatch(id);
      },
      // Hidden from the operator: each TAKE of a new BO creates a session record.
      // Existing game history remains archived after NEW BO; UI never asks for a fixture.
      startBo({leftTeamId,rightTeamId,bestOf,id}) {
        const created=this.createMatch({leftTeamId,rightTeamId,bestOf,id});
        db.prepare("UPDATE broadcast_matches SET status='in_progress' WHERE id=?").run(created.id);
        return this.getMatch(created.id);
      },
      finishBo(matchId) {
        if(matchId)db.prepare("UPDATE broadcast_matches SET status='finished' WHERE id=? AND status='in_progress'").run(matchId);
      },
      // Correct BO3/5/7 of the running BO without opening a new BO session.
      updateBoFormat(matchId,bestOf) {
        if(![3,5,7].includes(bestOf))throw new Error('Invalid BO format');
        const top=db.prepare('SELECT MAX(game_number) AS n FROM game_results WHERE match_id=?').get(matchId)?.n||0;
        if(top>bestOf)throw new Error(`BO${bestOf} is too short: game ${top} is already saved`);
        db.prepare('UPDATE broadcast_matches SET best_of=? WHERE id=?').run(bestOf,matchId);
      },
      // Runs callback atomically (BO start/finish + Program snapshot in one commit).
      transaction:(callback)=>transaction(db,callback),
      // Consistent online copy, safe while WAL is active.
      backup(reason='manual',keep=20) {
        if(dbFile===':memory:')return null;
        const dir=path.join(path.dirname(dbFile),'db-backups');
        fs.mkdirSync(dir,{recursive:true});
        const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\..+/,'');
        const target=path.join(dir,`fc-online_${stamp}_${String(reason).replace(/[^a-z0-9-]/gi,'').slice(0,24)||'backup'}.sqlite`);
        if(fs.existsSync(target))return target;
        db.prepare('VACUUM INTO ?').run(target);
        const old=fs.readdirSync(dir).filter(f=>/^fc-online_.*\.sqlite$/.test(f)).sort();
        for(const f of old.slice(0,Math.max(0,old.length-keep)))fs.rmSync(path.join(dir,f),{force:true});
        return target;
      },
      adminSessions:{
        add(hash,expiresAt){db.prepare('INSERT OR REPLACE INTO admin_sessions(sid_hash,expires_at) VALUES(?,?)').run(hash,expiresAt);},
        valid(hash,now){const row=db.prepare('SELECT expires_at FROM admin_sessions WHERE sid_hash=?').get(hash);return !!row&&row.expires_at>now;},
        remove(hash){db.prepare('DELETE FROM admin_sessions WHERE sid_hash=?').run(hash);},
        prune(now){db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(now);}
      },
      cameraRequests:{
        insert(r){db.prepare(`INSERT INTO camera_requests(id,bo_id,team_id,player_id,team_side,player_name,roster_slot,status,claim_hash,session_hash,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(r.id,r.boId,r.teamId,r.playerId,r.team,r.playerName,r.rosterSlot,r.status,r.claimHash,r.sessionHash??null,r.error??null,r.createdAt,r.updatedAt);},
        update(id,patch){
          const row=this.get(id);if(!row)return;
          const next={...row,...patch,updatedAt:Date.now()};
          db.prepare('UPDATE camera_requests SET status=?,session_hash=?,error=?,updated_at=? WHERE id=?').run(next.status,next.sessionHash??null,next.error??null,next.updatedAt,id);
        },
        get(id){const r=db.prepare('SELECT * FROM camera_requests WHERE id=?').get(id);return r?cameraRow(r):null;},
        bySession(hash){const r=db.prepare("SELECT * FROM camera_requests WHERE session_hash=? AND status='approved'").get(hash);return r?cameraRow(r):null;},
        list(boId){return db.prepare('SELECT * FROM camera_requests WHERE bo_id=? ORDER BY created_at').all(boId).map(cameraRow);},
        expireOther(boId){db.prepare("UPDATE camera_requests SET status='expired',error='BO has changed',updated_at=? WHERE bo_id<>? AND status IN ('pending','approved')").run(Date.now(),boId);},
        prune(before){db.prepare("DELETE FROM camera_requests WHERE updated_at<? AND status<>'approved'").run(before);}
      },
      getGameResults(matchId) {
        if (!this.getMatch(matchId)) throw new Error('Unknown match');
        const rows=db.prepare('SELECT * FROM game_results WHERE match_id=? ORDER BY game_number').all(matchId).map(gameRow);
        return {match:this.getMatch(matchId),games:rows};
      },
      getGameAudit(matchId) {
        if (!this.getMatch(matchId)) throw new Error('Unknown match');
        return db.prepare('SELECT id,game_number,action,previous_json,next_json,operator,created_at FROM game_result_audit WHERE match_id=? ORDER BY id DESC LIMIT 100').all(matchId).map(r=>({id:r.id,gameNumber:r.game_number,action:r.action,previous:r.previous_json?JSON.parse(r.previous_json):null,next:JSON.parse(r.next_json),operator:r.operator,createdAt:r.created_at}));
      },
      /**
       * v0.4E rules:
       * - the winner is derived from the score (penalties when the score is level);
       *   a winnerTeamId sent by an older client must agree with it
       * - a level score must be decided by penalties (shoot-out scores differ)
       * - penalties only with a level score
       */
      saveGameResult({matchId,gameNumber,leftGoals,rightGoals,winnerTeamId,note='',decidedBy='regular',leftPens=null,rightPens=null,expectedVersion=0,operator='studio'}) {
        const match=this.getMatch(matchId);
        if (!match) throw new Error('Unknown match');
        const validInt=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max;
        if (!validInt(gameNumber,9)||gameNumber<1||gameNumber>match.bestOf || !validInt(leftGoals,25)||!validInt(rightGoals,25)||
            !DECIDED_BY.includes(decidedBy) || typeof note!=='string'||note.length>240 || !validInt(expectedVersion,9999999)) throw new Error('Invalid game result');
        const penalties=decidedBy==='penalties';
        if (penalties) {
          if (leftGoals!==rightGoals) throw new Error('Penalties need a level score');
          if (!validInt(leftPens,30)||!validInt(rightPens,30)) throw new Error('Enter both penalty scores (0-30)');
          if (leftPens===rightPens) throw new Error('Penalty scores cannot be level');
        } else {
          if (leftPens!=null||rightPens!=null) throw new Error('Penalty scores are only allowed when decided by penalties');
          if (leftGoals===rightGoals) throw new Error('Level score: decide the game by penalties');
          leftPens=null;rightPens=null;
        }
        const leftWins=penalties?leftPens>rightPens:leftGoals>rightGoals;
        const winner=leftWins?match.leftTeamId:match.rightTeamId;
        if (winnerTeamId!==undefined && winnerTeamId!==null && winnerTeamId!=='' && winnerTeamId!==winner) throw new Error('Winner conflicts with goal score');
        const existing=db.prepare('SELECT * FROM game_results WHERE match_id=? AND game_number=?').get(matchId,gameNumber);
        if ((existing?.version??0)!==expectedVersion) throw new Error('STALE_GAME_VERSION: Reload history before saving');
        // New game rows cannot be added after an already-recorded BO clinch.
        // Earlier rows remain editable (including historic corrections), and
        // gaps are allowed for backfilling older tournament records.
        if (!existing) {
          const winners=new Map(db.prepare('SELECT game_number,winner_team_id FROM game_results WHERE match_id=?').all(matchId)
            .map(r=>[r.game_number,r.winner_team_id]));
          const winsNeeded=Math.floor(match.bestOf/2)+1;
          let left=0,right=0;
          for(let n=1;n<gameNumber;n++){
            const who=winners.get(n);
            if(!who)break;
            if(who===match.leftTeamId)left++;
            else if(who===match.rightTeamId)right++;
            if(left>=winsNeeded||right>=winsNeeded)
              throw new Error(`BO_FINISHED: Game ${n} already decided the series`);
          }
        }
        const now=isoNow();
        const previous=existing?(({updatedAt,...rest})=>rest)(gameRow(existing)):null;
        const next={gameNumber,leftGoals,rightGoals,winnerTeamId:winner,note,decidedBy,leftPens,rightPens,version:expectedVersion+1};
        transaction(db,()=>{
          if (existing) db.prepare(`UPDATE game_results SET left_goals=?,right_goals=?,winner_team_id=?,note=?,decided_by=?,left_pens=?,right_pens=?,version=?,updated_at=? WHERE match_id=? AND game_number=? AND version=?`).run(leftGoals,rightGoals,winner,note,decidedBy,leftPens,rightPens,expectedVersion+1,now,matchId,gameNumber,expectedVersion);
          else db.prepare(`INSERT INTO game_results(match_id,game_number,left_goals,right_goals,winner_team_id,note,decided_by,left_pens,right_pens,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(matchId,gameNumber,leftGoals,rightGoals,winner,note,decidedBy,leftPens,rightPens,1,now,now);
          db.prepare('INSERT INTO game_result_audit(match_id,game_number,action,previous_json,next_json,operator,created_at) VALUES(?,?,?,?,?,?,?)').run(matchId,gameNumber,existing?'edit':'create',previous?JSON.stringify(previous):null,JSON.stringify(next),operator,now);
        });
        return {...next,updatedAt:now};
      },
      validSelection(teamId,playerId) {
        if (!teamId) return !playerId; // v0.2 custom team data remains valid
        const team=cached.teams.find(t=>t.id===teamId);
        return !!team && (!playerId || team.players.some(p=>p.id===playerId));
      },
      loadProgram() {
        const row=db.prepare('SELECT state_json FROM program_state WHERE id=1').get();
        return row?JSON.parse(row.state_json):null;
      },
      saveProgram(program) {
        const json=JSON.stringify(program);
        db.prepare(`INSERT INTO program_state(id,revision,state_json,updated_at) VALUES(1,?,?,?)
          ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,updated_at=excluded.updated_at`)
          .run(program.revision,json,program.updatedAt);
      },
      ping(){return db.prepare('SELECT 1 AS ok').get().ok===1;},
      close:()=>db.close()
    };
  } catch(error) { db.close(); throw error; }
}
