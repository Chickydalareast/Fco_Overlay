import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import defaultProgram from './default-program.json' with { type: 'json' };
import { CAMERA_SLOTS, validPlayerId } from './camera-room.mjs';

export const STATE_FILE = path.resolve(process.env.FC_STATE_FILE || '.runtime/program.json');
const deepClone = value => structuredClone(value);
const integer = (v,lo,hi) => Number.isInteger(v) && v>=lo && v<=hi;
const word = (v,n) => typeof v==='string' && v.length<=n && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const hex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const logo = v => v===undefined || (typeof v==='string' && (v==='' || /^\/assets\/clubs\/[a-z0-9-]+\.png$/.test(v)));
const portrait = v => typeof v === 'string' && (v==='' || (v.length<=2048 && (/^https:\/\//i.test(v) || /^\/assets\/players\/[\w.-]+$/i.test(v))));
const TEAM_KEYS=['teamId','playerId','name','shortName','clubLogo','player','seriesWins','gameGoals','color','portrait'];
const MATCH_KEYS=['matchId','competition','stage','matchNumber','gameNumber','bestOf'];
export function validateMatch(match) {
  if (!match || typeof match!=='object') return false;
  if (match.matchId!==undefined && (typeof match.matchId!=='string' || !/^match-(?:GROUP-[A-D]-[0-9]+|custom-[a-f0-9-]{36})$/.test(match.matchId))) return false;
  if (!word(match.competition,50) || !word(match.stage,48) || !integer(match.matchNumber,1,99) || !integer(match.gameNumber,1,9) || ![3,5,7].includes(match.bestOf)) return false;
  for (const key of ['teamA','teamB']) {
    const team = match[key];
    if (!team || (team.teamId!==undefined && !/^C(?:[1-9]|1[0-6])$/.test(team.teamId)) || (team.playerId!==undefined && (typeof team.playerId!=="string" || !/^C(?:[1-9]|1[0-6])-P[12]$/.test(team.playerId) || (team.teamId && !team.playerId.startsWith(team.teamId+"-")))) || !word(team.name,40) || !word(team.shortName,9) || !word(team.player,28) || !hex(team.color) || !logo(team.clubLogo) || !portrait(team.portrait)) return false;
    if (!integer(team.seriesWins,0,Math.ceil(match.bestOf/2)) || !integer(team.gameGoals,0,25)) return false;
  }
  return true;
}
/** Drop any field outside the Program contract (A11). Call after validateMatch. */
function normalizeMatch(match) {
  const out={};
  for (const key of MATCH_KEYS) if (match[key]!==undefined) out[key]=match[key];
  for (const side of ['teamA','teamB']) {
    out[side]={};
    for (const key of TEAM_KEYS) if (match[side][key]!==undefined) out[side][key]=match[side][key];
  }
  return deepClone(out);
}
/** v0.4B: scoreboard position nudge (2K pixels) and scale (percent). */
export const SCOREBOARD_PLACEMENT={x:{min:-640,max:640,def:0},y:{min:-360,max:360,def:0},scale:{min:50,max:200,def:100}};
const placementValid=sb=>Object.entries(SCOREBOARD_PLACEMENT).every(([k,r])=>sb[k]===undefined||integer(sb[k],r.min,r.max));
/** v0.4H: Cam Focus layer: {visible, team:'A'|'B'} (older Studio tabs omit it). */
const focusValid=f=>!!f && typeof f==='object' && typeof f.visible==='boolean' && (f.team===undefined || ['A','B'].includes(f.team));
export function validateLayers(layers) {
  return !!layers && typeof layers==='object' && ['scoreboard','intro'].every(k=>layers[k] && typeof layers[k].visible === 'boolean') && (layers.history===undefined || typeof layers.history?.visible==='boolean') && (layers.focus===undefined || focusValid(layers.focus)) && placementValid(layers.scoreboard);
}
/** Fields an older Studio tab does not send keep their current value (never reset on TAKE). */
const placement=(sb,fallback)=>Object.fromEntries(Object.entries(SCOREBOARD_PLACEMENT).map(([k,r])=>[k,sb?.[k]??fallback?.[k]??r.def]));
const normalizeLayers=(layers,current)=>({
  scoreboard:{visible:layers.scoreboard.visible,...placement(layers.scoreboard,current?.scoreboard)},intro:{visible:layers.intro.visible},history:{visible:!!layers.history?.visible},
  focus:{visible:layers.focus?.visible??current?.focus?.visible??false,team:layers.focus?.team??current?.focus?.team??'A'}
});
/**
 * Accepts v0.3F slots ({playerId}) and legacy slots ({participantId}: an old
 * LiveKit identity). Legacy identities are migrated by normalizeCameras().
 */
export function validateCameras(cameras) {
  return !!cameras && typeof cameras==='object' && cameras.layout==='bottom4' &&
    !!cameras.slots && CAMERA_SLOTS.every(slot => {
      const value=cameras.slots[slot];
      if (!value || typeof value.visible!=='boolean') return false;
      if ('playerId' in value) return value.playerId===null || validPlayerId(value.playerId);
      return value.participantId===undefined || value.participantId===null || (typeof value.participantId==='string' && value.participantId.length<=80);
    });
}
/** Slot A1/A2 belongs to Program teamA (left), B1/B2 to teamB (right). */
export function defaultSlotPlayer(match,slot) {
  const team=slot[0]==='A'?match.teamA:match.teamB;
  return team?.teamId?`${team.teamId}-P${slot[1]}`:null;
}
export function slotPlayerAllowed(match,slot,playerId) {
  if (playerId===null) return true;
  if (!validPlayerId(playerId)) return false;
  const team=slot[0]==='A'?match.teamA:match.teamB;
  return !!team?.teamId && playerId.startsWith(`${team.teamId}-`);
}
/** Every slot of a registry team is bound to one of that team's players. */
export function normalizeCameras(cameras,match) {
  const out={layout:'bottom4',slots:{}};
  for (const slot of CAMERA_SLOTS) {
    const value=cameras?.slots?.[slot]??{};
    const candidate='playerId' in value?value.playerId:(validPlayerId(value.participantId)?value.participantId:null);
    out.slots[slot]={playerId:slotPlayerAllowed(match,slot,candidate)&&candidate?candidate:defaultSlotPlayer(match,slot),visible:!!value.visible};
  }
  return out;
}
function upgradeProgram(program) {
  // v0.3D migration: add hidden history layer. v0.3F: slots bind to playerId.
  if (program?.layers && program.layers.history === undefined) program.layers.history={visible:false};
  // v0.4H: Cam Focus layer (off, left team).
  if (program?.layers && !focusValid(program.layers.focus)) program.layers.focus={visible:false,team:'A'};
  else if (program?.layers?.focus) program.layers.focus={visible:program.layers.focus.visible,team:program.layers.focus.team??'A'};
  // v0.4B: scoreboard placement defaults (x 0, y 0, scale 100%).
  if (program?.layers?.scoreboard) Object.assign(program.layers.scoreboard,placement(program.layers.scoreboard));
  program.cameras=normalizeCameras(validateCameras(program.cameras)?program.cameras:defaultProgram.cameras,program.match);
  return program;
}
function loadState(file) {
  try {
    const stored = JSON.parse(fs.readFileSync(file,'utf8'));
    if (validateMatch(stored.match) && validateLayers(stored.layers) && integer(stored.revision,0,Number.MAX_SAFE_INTEGER)) {
      return upgradeProgram(stored);
    }
  } catch { /* first run */ }
  return upgradeProgram(deepClone(defaultProgram));
}
const sameState=(a,b)=>JSON.stringify({match:a.match,layers:a.layers,cameras:a.cameras})===JSON.stringify({match:b.match,layers:b.layers,cameras:b.cameras});

export function createStore(file = STATE_FILE, {database=null} = {}) {
  const persisted = database?.loadProgram() ?? null;
  if (database && !persisted && fs.existsSync(file)) {
    // Do not silently replace a malformed user's v0.2 state with sample data.
    let legacy;
    try { legacy = JSON.parse(fs.readFileSync(file,'utf8')); }
    catch { throw new Error(`Legacy Program JSON cannot be parsed: ${file}. Back up and repair it before migration.`); }
    if (!validateMatch(legacy.match) || !validateLayers(legacy.layers) || !integer(legacy.revision,0,Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Legacy Program JSON has invalid structure: ${file}. Refusing migration to avoid data loss.`);
    }
  }
  if (persisted && (!validateMatch(persisted.match) || !validateLayers(persisted.layers) || !validateCameras(persisted.cameras))) {
    throw new Error('Database Program State is invalid. Refusing to overwrite live data.');
  }
  const before=persisted?JSON.stringify(persisted):null;
  let current = upgradeProgram(persisted ? deepClone(persisted) : loadState(file));
  // v0.3B: complete canonical club metadata for snapshots that selected a
  // registry team before logos were supported in the renderer.
  if (database) {
    const registry=database.registry();
    for (const team of [current.match.teamA,current.match.teamB]) {
      const entry=registry.teams.find(t=>t.id===team.teamId);
      if (entry && (team.name!==entry.club.name || team.shortName!==entry.id || team.clubLogo!==entry.club.logo)) {
        team.name=entry.club.name;team.shortName=entry.id;team.clubLogo=entry.club.logo;
      }
    }
    // One-time migrations (v0.2 JSON import, history layer, playerId slots).
    if (!persisted || JSON.stringify(current)!==before) database.saveProgram(current);
  }
  let pending = Promise.resolve();
  const seen = new Map();
  const remember=id=>{seen.set(id,Date.now());while(seen.size>300)seen.delete(seen.keys().next().value);};
  function writeFile(next) {
    // Legacy file mode retained for unit tests and explicit migration checks.
    // A failed write must never block later writes (v0.3F A1 fix).
    const run=pending.then(async()=>{
      await fs.promises.mkdir(path.dirname(file),{recursive:true});
      const temp = `${file}.tmp`;
      await fs.promises.writeFile(temp,JSON.stringify(next,null,2));
      await fs.promises.rename(temp,file);
    });
    pending=run.catch(()=>{});
    return run;
  }
  const fail=(reason)=>({ok:false,reason});
  return {
    get() { return deepClone(current); },
    async command(command) {
      if (!command || typeof command!=='object' || typeof command.id!=='string' || command.id.length>90 || command.id.length<5) return fail('Command ID required');
      if (seen.has(command.id)) return {ok:true,program:deepClone(current),duplicate:true};
      const next = deepClone(current);
      let boEffect=null; // database side effect committed atomically with the Program
      if (command.type==='program.take') {
        if (!integer(command.expectedRevision,0,Number.MAX_SAFE_INTEGER) || command.expectedRevision!==current.revision) return fail('STALE_REVISION — Refresh draft from live before TAKE');
        if (!validateMatch(command.match) || !validateLayers(command.layers) || (command.cameras!==undefined && !validateCameras(command.cameras))) return fail('Invalid match/layer data');
        const match=normalizeMatch(command.match);
        if (database) {
          const a=match.teamA, b=match.teamB;
          const session=match.matchId?database.getMatch(match.matchId):null;
          if ((match.matchId && (!session || ![a.teamId,b.teamId].every(id=>[session.leftTeamId,session.rightTeamId].includes(id)) || (session.status==='finished' && session.id!==current.match.matchId))) || (a.teamId && a.teamId===b.teamId) || !database.validSelection(a.teamId,a.playerId) || !database.validSelection(b.teamId,b.playerId)) {
            return fail('Invalid tournament team/player pairing');
          }
          const registry=database.registry();
          for (const team of [a,b]) {
            const canonical=team.teamId?registry.teams.find(t=>t.id===team.teamId):null;
            if (canonical) {team.name=canonical.club.name;team.shortName=canonical.id;team.clubLogo=canonical.club.logo;team.color=canonical.club.colors.primary;
              const rosterPlayer=canonical.players.find(p=>p.id===team.playerId);if(rosterPlayer)team.player=rosterPlayer.displayName;}
          }
          // v0.5C: a new session never inherits the previous BO's manual score
          // or game number. Reject the payload before any database writes;
          // never silently reset a score the operator might be expecting.
          if (!match.matchId && (match.gameNumber!==1 || a.seriesWins!==0 || b.seriesWins!==0 || a.gameGoals!==0 || b.gameGoals!==0))
            return fail('NEW_BO_NOT_RESET — A new BO must start at GAME 1, BO 0-0 and goals 0-0. Prepare a new BO in Studio.');
          // Match/Fixture UI is gone. A TAKE without a session ID opens one BO
          // session; the previous BO is finished in the same transaction.
          // Scoreboard wins are NEVER inferred from games.
          if (!match.matchId && a.teamId && b.teamId) {
            match.matchId=`match-custom-${crypto.randomUUID()}`;
            boEffect={type:'start',id:match.matchId,leftTeamId:a.teamId,rightTeamId:b.teamId,bestOf:match.bestOf,previous:current.match.matchId};
          } else if (session && session.bestOf!==match.bestOf) {
            boEffect={type:'format',id:session.id,bestOf:match.bestOf};
          }
        }
        next.match = match;
        next.layers = normalizeLayers(command.layers,current.layers);
        next.cameras = normalizeCameras(command.cameras??current.cameras,match);
      } else if (command.type==='layer.setVisible') {
        if (!['scoreboard','intro','history','focus'].includes(command.layer) || typeof command.visible!=='boolean') return fail('Invalid layer visibility');
        next.layers[command.layer].visible = command.visible;
      } else if (command.type==='focus.setTeam') {
        // v0.4H: pick the focused team; while Focus is on air the rows swap at once.
        if (!['A','B'].includes(command.team)) return fail('Invalid focus team');
        next.layers.focus.team=command.team;
      } else if (command.type==='camera.assign') {
        const playerId=command.playerId!==undefined?command.playerId:command.participantId;
        if (!CAMERA_SLOTS.includes(command.slot) || (playerId!==null && !validPlayerId(playerId))) return fail('Invalid camera assignment');
        if (!slotPlayerAllowed(next.match,command.slot,playerId)) return fail('Camera slot can only use a player of the team on that side');
        next.cameras.slots[command.slot].playerId=playerId??defaultSlotPlayer(next.match,command.slot);
      } else if (command.type==='camera.setVisible') {
        if (!CAMERA_SLOTS.includes(command.slot) || typeof command.visible!=='boolean') return fail('Invalid camera visibility');
        next.cameras.slots[command.slot].visible=command.visible;
      } else if (command.type==='camera.setAllVisible') {
        // A single atomic revision: all four tiles appear (or exit) together,
        // even if a feed is offline. Placeholder/fallback is a media concern.
        if (typeof command.visible!=='boolean') return fail('Invalid camera group visibility');
        for (const slot of CAMERA_SLOTS) next.cameras.slots[slot].visible=command.visible;
      } else if (command.type==='score.adjust') {
        if (!['A','B'].includes(command.team) || !['seriesWins','gameGoals'].includes(command.kind) || ![-1,1].includes(command.delta)) return fail('Invalid score adjustment');
        const team = next.match[command.team==='A'?'teamA':'teamB'];
        // Optional optimistic guard: a double-click sends the same "from" twice;
        // the second one is rejected instead of adding +2 on air.
        if (command.from!==undefined && command.from!==team[command.kind]) {remember(command.id);return fail('SCORE_CHANGED — score already updated, check Program before pressing again');}
        const max = command.kind==='seriesWins' ? Math.ceil(next.match.bestOf/2) : 25;
        team[command.kind] = Math.max(0, Math.min(max, team[command.kind]+command.delta));
      } else if (command.type==='program.clear') {
        next.layers.scoreboard.visible = false;
        next.layers.intro.visible = false;
        next.layers.history.visible = false;
        next.layers.focus.visible = false;
        for (const slot of CAMERA_SLOTS) next.cameras.slots[slot].visible=false;
      } else return fail('Unknown command');
      // v0.4H: Cam Focus needs a camera on; with every slot off it switches itself off.
      if (!CAMERA_SLOTS.some(slot=>next.cameras.slots[slot].visible)) next.layers.focus.visible=false;
      if (sameState(next,current) && !boEffect) {
        remember(command.id);
        return {ok:true,program:deepClone(current),unchanged:true};
      }
      next.revision++;
      next.updatedAt = new Date().toISOString();
      try {
        if (database) {
          // BO start/finish/format and the Program snapshot commit together:
          // a crash can never leave broadcast_matches and program_state apart.
          database.transaction(()=>{
            if (boEffect?.type==='start') {
              database.startBo({id:boEffect.id,leftTeamId:boEffect.leftTeamId,rightTeamId:boEffect.rightTeamId,bestOf:boEffect.bestOf});
              if (boEffect.previous && boEffect.previous!==boEffect.id) database.finishBo(boEffect.previous);
            } else if (boEffect?.type==='format') database.updateBoFormat(boEffect.id,boEffect.bestOf);
            database.saveProgram(next);
          });
        } else await writeFile(next);
      } catch (error) {
        return fail(`Save failed: ${error?.message||'database error'}. Live state unchanged; try again.`);
      }
      const previousBo=current.match.matchId;
      current = next;
      remember(command.id);
      return {ok:true,program:deepClone(current),boChanged:previousBo!==current.match.matchId,previousBoId:previousBo};
    }
  };
}
