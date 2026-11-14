export type TeamKey = "A" | "B";
export type LayerKey = "scoreboard" | "intro" | "history" | "focus";
export type ScoreKey = "seriesWins" | "gameGoals";
export type CameraSlot = "A1" | "A2" | "B1" | "B2";
export const CAMERA_SLOTS: CameraSlot[] = ["A1","A2","B1","B2"];
/** v0.3F: a slot is bound to a stable tournament player ID (e.g. "C10-P1"). */
export interface CameraSlotState { playerId: string | null; visible: boolean }
export interface CameraComposition {layout:"bottom4";slots:Record<CameraSlot,CameraSlotState>}
export type CameraAdmission = "approved" | "pending" | "none";
/** One entry per registered player of the live BO (always 4 entries). */
export interface CameraPlayer {identity:string;playerId:string;name:string;team:"A"|"B";teamId:string;rosterSlot:number;status:CameraAdmission;connected:boolean;published:boolean;updatedAt:number}
export interface CameraJoinRequest {id:string;team:"A"|"B";teamId:string;playerId:string;playerName:string;createdAt:number;replaces?:boolean}
export interface RendererInfo {
  id:string;label:string;revision:number|null;
  /** Only valid when it equals revision; means camera decoder has delivered a frame. */
  mediaRevision?:number|null;
  cameraReady?:CameraSlot[];
  cameraWaiting?:CameraSlot[];
}

export interface Team {
  clubLogo?: string; // Derived from the club registry; used only for Scoreboard.
  teamId?: string; // Stable tournament team ID, e.g. C10. Legacy v0.2 state can omit it.
  playerId?: string; // Stable selected player from that team, e.g. C10-P1.
  name: string;
  shortName: string;
  player: string;
  seriesWins: number;
  gameGoals: number;
  color: string;
  portrait: string;
}
export interface Match {
  matchId?: string; // Stable broadcast match; game history is stored separately.
  competition: string;
  stage: string;
  matchNumber: number;
  gameNumber: number;
  bestOf: 3 | 5 | 7;
  teamA: Team;
  teamB: Team;
}
export type DecidedBy = "regular" | "extra_time" | "penalties";
/** v0.4E: decidedBy + penalty shoot-out score (null unless decided by penalties). */
export interface HistoryGame {gameNumber:number;leftGoals:number;rightGoals:number;winnerTeamId:string;note:string;version:number;decidedBy?:DecidedBy;leftPens?:number|null;rightPens?:number|null}
/** "2 - 2 (PEN 4-3)", "1 - 0 (HP)" style suffix for a saved game; '' for regular time. */
export function decidedSuffix(game: Pick<HistoryGame,"decidedBy"|"leftPens"|"rightPens">, flipped = false): string {
  if (game.decidedBy === "penalties" && game.leftPens != null && game.rightPens != null)
    return flipped ? `PEN ${game.rightPens}-${game.leftPens}` : `PEN ${game.leftPens}-${game.rightPens}`;
  return game.decidedBy === "extra_time" ? "HIỆP PHỤ" : "";
}
export interface Layers {
  /** x/y: nudge in 2K pixels, scale: percent (v0.4B; server fills 0/0/100). */
  scoreboard: { visible: boolean; x?: number; y?: number; scale?: number };
  intro: { visible: boolean };
  history: { visible: boolean }; // Full-screen BO results; graphic can be replaced independently.
  /** v0.4H: Cam Focus. The chosen team's cameras move up and get bigger. Needs camera slots on. */
  focus: { visible: boolean; team: TeamKey };
}
export interface Program {
  revision: number;
  updatedAt: string;
  match: Match;
  layers: Layers;
  cameras: CameraComposition;
}
export type ClientCommand =
  | { id: string; type: "program.take"; expectedRevision: number; match: Match; layers: Layers; cameras: CameraComposition }
  | { id: string; type: "layer.setVisible"; layer: LayerKey; visible: boolean }
  | { id: string; type: "score.adjust"; team: TeamKey; kind: ScoreKey; delta: number; from?: number }
  | { id: string; type: "camera.assign";slot:CameraSlot;playerId:string|null }
  | { id: string; type: "camera.setVisible";slot:CameraSlot;visible:boolean }
  | { id: string; type: "camera.setAllVisible";visible:boolean }
  | { id: string; type: "focus.setTeam"; team: TeamKey }
  | { id: string; type: "program.clear" };
export type ServerEvent =
  | { type: "program.state"; program: Program; commandId?: string }
  | { type: "camera.roster"; players: CameraPlayer[] }
  | { type: "camera.requests"; requests: CameraJoinRequest[] }
  | { type: "camera.prewarm";boId?:string;playerIds?:string[] }
  | { type: "match.history.changed"; matchId:string;gameNumber:number }
  | { type: "match.history.snapshot"; matchId:string|null; leftTeamId:string|null; rightTeamId:string|null; games:HistoryGame[] }
  | { type: "presence"; rendererCount: number; adminCount: number; rendererRevision?: number; renderers?: RendererInfo[] }
  | { type: "command.ack"; id: string; revision: number }
  | { type: "command.error"; id?: string; reason: string }
  | { type: "renderer.ack"; revision: number; rendererId: string; label?: string };

export const SAMPLE_PROGRAM: Program = {
  revision: 0,
  updatedAt: new Date(0).toISOString(),
  match: {
    competition: "FC ONLINE CHAMPIONSHIP",
    stage: "FINAL STAGE",
    matchNumber: 1,
    gameNumber: 2,
    bestOf: 5,
    teamA: { name: "Fury Football", shortName: "FFB", player: "FFBxJaden", seriesWins: 1, gameGoals: 0, color: "#e12a35", portrait: "" },
    teamB: { name: "Nova Knights", shortName: "NK", player: "NKxLHAT", seriesWins: 0, gameGoals: 0, color: "#d6dbe4", portrait: "" }
  },
  layers: { scoreboard: { visible: true, x: 0, y: 0, scale: 100 }, intro: { visible: false }, history: { visible: false }, focus: { visible: false, team: "A" } },
  cameras: {layout:"bottom4",slots:{A1:{playerId:null,visible:false},A2:{playerId:null,visible:false},B1:{playerId:null,visible:false},B2:{playerId:null,visible:false}}}
};

export function cloneProgram(program: Program): Program {
  // JSON clone instead of structuredClone: also runs on old OBS/CEF (Chromium < 98).
  return JSON.parse(JSON.stringify(program)) as Program;
}
/** Display name used by Intro and Scoreboard: "C1 - AC Milan" (custom teams: plain name). */
export function teamLabel(team: Pick<Team, "teamId" | "name">): string {
  return team.teamId ? `${team.teamId} - ${team.name}` : team.name;
}
/** JSON with sorted keys, so property order never makes a draft look "modified". */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, (v as Record<string, unknown>)[k]])) : v);
}
export function identicalDraft(a: Program, b: Program): boolean {
  return stableStringify({ match: a.match, layers: a.layers, cameras:a.cameras }) === stableStringify({ match: b.match, layers: b.layers, cameras:b.cameras });
}
export function freshId(): string {
  return (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
/** Default player of a slot: A1 -> team A player 1, B2 -> team B player 2. */
export function defaultSlotPlayer(match: Match, slot: CameraSlot): string | null {
  const team = slot[0] === "A" ? match.teamA : match.teamB;
  return team.teamId ? `${team.teamId}-P${slot[1]}` : null;
}
export function teammateOf(playerId: string): string {
  return playerId.replace(/-P([12])$/, (_m, n: string) => n === "1" ? "-P2" : "-P1");
}
export const identityForPlayer = (playerId: string) => `player-${playerId}`;
export function playerIdFromIdentity(identity: string): string | null {
  const m = /^player-(C(?:[1-9]|1[0-6])-P[12])$/.exec(identity);
  return m ? m[1]! : null;
}

/** v0.5C: session boundary is explicit; old BO scores and feeds never carry over. */
export function resetNewBoDraft(program: Program): Program {
  const next=cloneProgram(program);
  delete next.match.matchId;
  next.match.gameNumber=1;
  for(const team of [next.match.teamA,next.match.teamB]){team.seriesWins=0;team.gameGoals=0;}
  for(const slot of CAMERA_SLOTS)next.cameras.slots[slot]={playerId:defaultSlotPlayer(next.match,slot),visible:false};
  return next;
}
/** Undo accidental team switching without zeroing the still-running BO. */
export function restoreCurrentBoDraft(draft: Program, live: Program): Program {
  if(!draft.match.matchId || draft.match.matchId!==live.match.matchId)return cloneProgram(draft);
  const next=cloneProgram(draft);
  next.match.gameNumber=live.match.gameNumber;
  const liveCameras=cloneProgram(live).cameras;
  for(const target of ['A','B'] as const){
    const staged=next.match[target==='A'?'teamA':'teamB'];
    if(staged.teamId!==live.match.teamA.teamId && staged.teamId!==live.match.teamB.teamId)continue;
    const source=live.match.teamA.teamId===staged.teamId?'A':'B';
    const current=live.match[source==='A'?'teamA':'teamB'];
    staged.seriesWins=current.seriesWins;staged.gameGoals=current.gameGoals;
    for(const n of ['1','2'] as const)next.cameras.slots[`${target}${n}`]=liveCameras.slots[`${source}${n}`];
  }
  return next;
}

// Fields where Program must win if both Preview and Live changed them.
const PREFER_LIVE = new Set(["match.teamA.seriesWins", "match.teamB.seriesWins"]);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
function mergeValue(base: unknown, draft: unknown, live: unknown, path: string, conflicts: string[]): unknown {
  if (isObject(draft) && isObject(live)) {
    const out: Record<string, unknown> = {};
    const b = isObject(base) ? base : {};
    for (const key of new Set([...Object.keys(draft), ...Object.keys(live)])) {
      const value = mergeValue(b[key], draft[key], live[key], path ? `${path}.${key}` : key, conflicts);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  const copy = (v: unknown) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  if (same(draft, base)) return copy(live);   // Preview untouched -> follow Program
  if (same(live, base) || same(draft, live)) return copy(draft); // only Preview changed
  conflicts.push(path);
  return copy(PREFER_LIVE.has(path) ? live : draft);
}
/**
 * 3-way rebase of an edited Preview onto a newer Program (v0.3F). Fields the
 * operator did not touch follow Live (e.g. a +1 BO score); edited fields stay.
 */
export function rebaseDraft(base: Program, draft: Program, live: Program): { program: Program; conflicts: string[] } {
  const conflicts: string[] = [];
  // v0.5C: a staged NEW BO has its own match/score/game/camera state.
  // In particular, never import a score or camera toggle from the previous BO
  // just because the operator has not edited that one field yet.
  const newBoDraft = !draft.match.matchId && !!draft.match.teamA.teamId && !!draft.match.teamB.teamId;
  const merged = mergeValue(
    { match: base.match, layers: base.layers, cameras: base.cameras },
    { match: draft.match, layers: draft.layers, cameras: draft.cameras },
    { match: live.match, layers: live.layers, cameras: live.cameras }, "", conflicts) as Pick<Program, "match" | "layers" | "cameras">;
  if (newBoDraft) {
    merged.match = cloneProgram(draft).match;
    merged.cameras = cloneProgram(draft).cameras;
    // The two BOs are independent: old-BO score changes are not conflicts.
    for (let i = conflicts.length - 1; i >= 0; i--)
      if (conflicts[i]!.startsWith('match.') || conflicts[i]!.startsWith('cameras.')) conflicts.splice(i, 1);
  }
  return { program: { ...cloneProgram(live), ...merged, revision: live.revision, updatedAt: live.updatedAt }, conflicts };
}
