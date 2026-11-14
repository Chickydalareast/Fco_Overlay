export const CAMERA_SLOTS = ["A1", "A2", "B1", "B2"];
/** "2 - 2 (PEN 4-3)", "1 - 0 (HP)" style suffix for a saved game; '' for regular time. */
export function decidedSuffix(game, flipped = false) {
    if (game.decidedBy === "penalties" && game.leftPens != null && game.rightPens != null)
        return flipped ? `PEN ${game.rightPens}-${game.leftPens}` : `PEN ${game.leftPens}-${game.rightPens}`;
    return game.decidedBy === "extra_time" ? "HIỆP PHỤ" : "";
}
export const SAMPLE_PROGRAM = {
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
    cameras: { layout: "bottom4", slots: { A1: { playerId: null, visible: false }, A2: { playerId: null, visible: false }, B1: { playerId: null, visible: false }, B2: { playerId: null, visible: false } } }
};
export function cloneProgram(program) {
    // JSON clone instead of structuredClone: also runs on old OBS/CEF (Chromium < 98).
    return JSON.parse(JSON.stringify(program));
}
/** Display name used by Intro and Scoreboard: "C1 - AC Milan" (custom teams: plain name). */
export function teamLabel(team) {
    return team.teamId ? `${team.teamId} - ${team.name}` : team.name;
}
/** JSON with sorted keys, so property order never makes a draft look "modified". */
export function stableStringify(value) {
    return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}
export function identicalDraft(a, b) {
    return stableStringify({ match: a.match, layers: a.layers, cameras: a.cameras }) === stableStringify({ match: b.match, layers: b.layers, cameras: b.cameras });
}
export function freshId() {
    return (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
/** Default player of a slot: A1 -> team A player 1, B2 -> team B player 2. */
export function defaultSlotPlayer(match, slot) {
    const team = slot[0] === "A" ? match.teamA : match.teamB;
    return team.teamId ? `${team.teamId}-P${slot[1]}` : null;
}
export function teammateOf(playerId) {
    return playerId.replace(/-P([12])$/, (_m, n) => n === "1" ? "-P2" : "-P1");
}
export const identityForPlayer = (playerId) => `player-${playerId}`;
export function playerIdFromIdentity(identity) {
    const m = /^player-(C(?:[1-9]|1[0-6])-P[12])$/.exec(identity);
    return m ? m[1] : null;
}
/** v0.5C: session boundary is explicit; old BO scores and feeds never carry over. */
export function resetNewBoDraft(program) {
    const next = cloneProgram(program);
    delete next.match.matchId;
    next.match.gameNumber = 1;
    for (const team of [next.match.teamA, next.match.teamB]) {
        team.seriesWins = 0;
        team.gameGoals = 0;
    }
    for (const slot of CAMERA_SLOTS)
        next.cameras.slots[slot] = { playerId: defaultSlotPlayer(next.match, slot), visible: false };
    return next;
}
/** Undo accidental team switching without zeroing the still-running BO. */
export function restoreCurrentBoDraft(draft, live) {
    if (!draft.match.matchId || draft.match.matchId !== live.match.matchId)
        return cloneProgram(draft);
    const next = cloneProgram(draft);
    next.match.gameNumber = live.match.gameNumber;
    const liveCameras = cloneProgram(live).cameras;
    for (const target of ['A', 'B']) {
        const staged = next.match[target === 'A' ? 'teamA' : 'teamB'];
        if (staged.teamId !== live.match.teamA.teamId && staged.teamId !== live.match.teamB.teamId)
            continue;
        const source = live.match.teamA.teamId === staged.teamId ? 'A' : 'B';
        const current = live.match[source === 'A' ? 'teamA' : 'teamB'];
        staged.seriesWins = current.seriesWins;
        staged.gameGoals = current.gameGoals;
        for (const n of ['1', '2'])
            next.cameras.slots[`${target}${n}`] = liveCameras.slots[`${source}${n}`];
    }
    return next;
}
// Fields where Program must win if both Preview and Live changed them.
const PREFER_LIVE = new Set(["match.teamA.seriesWins", "match.teamB.seriesWins"]);
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => stableStringify(a) === stableStringify(b);
function mergeValue(base, draft, live, path, conflicts) {
    if (isObject(draft) && isObject(live)) {
        const out = {};
        const b = isObject(base) ? base : {};
        for (const key of new Set([...Object.keys(draft), ...Object.keys(live)])) {
            const value = mergeValue(b[key], draft[key], live[key], path ? `${path}.${key}` : key, conflicts);
            if (value !== undefined)
                out[key] = value;
        }
        return out;
    }
    const copy = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    if (same(draft, base))
        return copy(live); // Preview untouched -> follow Program
    if (same(live, base) || same(draft, live))
        return copy(draft); // only Preview changed
    conflicts.push(path);
    return copy(PREFER_LIVE.has(path) ? live : draft);
}
/**
 * 3-way rebase of an edited Preview onto a newer Program (v0.3F). Fields the
 * operator did not touch follow Live (e.g. a +1 BO score); edited fields stay.
 */
export function rebaseDraft(base, draft, live) {
    const conflicts = [];
    // v0.5C: a staged NEW BO has its own match/score/game/camera state.
    // In particular, never import a score or camera toggle from the previous BO
    // just because the operator has not edited that one field yet.
    const newBoDraft = !draft.match.matchId && !!draft.match.teamA.teamId && !!draft.match.teamB.teamId;
    const merged = mergeValue({ match: base.match, layers: base.layers, cameras: base.cameras }, { match: draft.match, layers: draft.layers, cameras: draft.cameras }, { match: live.match, layers: live.layers, cameras: live.cameras }, "", conflicts);
    if (newBoDraft) {
        merged.match = cloneProgram(draft).match;
        merged.cameras = cloneProgram(draft).cameras;
        // The two BOs are independent: old-BO score changes are not conflicts.
        for (let i = conflicts.length - 1; i >= 0; i--)
            if (conflicts[i].startsWith('match.') || conflicts[i].startsWith('cameras.'))
                conflicts.splice(i, 1);
    }
    return { program: { ...cloneProgram(live), ...merged, revision: live.revision, updatedAt: live.updatedAt }, conflicts };
}
