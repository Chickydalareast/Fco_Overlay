/**
 * ABUxOHMYCASH CUP knockout-round Studio selection shortlist.
 * Only affects new team choices in Studio. The full Registry remains intact
 * for previously played BOs, game history, camera state and audit records.
 * Order follows the four quarterfinal matchups, top to bottom (Nov 15 2026).
 */
export const QUALIFIED_TEAM_IDS = ['C16', 'C8', 'C15', 'C2', 'C11', 'C7', 'C14', 'C1'];
const QUALIFIED_SET = new Set(QUALIFIED_TEAM_IDS);
/** Operator-only nicknames from the earlier shortlist; never on-air. C11 has no nickname supplied. */
export const QUALIFIED_TEAM_LABELS = Object.freeze({
    C2: 'Việt Tym',
    C7: 'Vĩnh Hưng',
    C1: 'Minh Hà',
    C14: 'Nhật Cà',
    C8: 'Quang Tý',
    C15: 'Minh Quý',
    C16: 'Vũ Bình'
});
export function isQualifiedTeamId(id) {
    return typeof id === 'string' && QUALIFIED_SET.has(id);
}
export function qualifiedRegistryTeams(teams) {
    const byId = new Map(teams.map(team => [team.id, team]));
    return QUALIFIED_TEAM_IDS.flatMap(id => {
        const team = byId.get(id);
        return team ? [team] : [];
    });
}
/** Clear team options: C# + operator's bracket name + official club. */
export function qualifiedTeamOptionLabel(team) {
    const nickname = QUALIFIED_TEAM_LABELS[team.id];
    return `${team.id} · ${nickname ? nickname + ' · ' : ''}${team.club.name} (Group ${team.group})`;
}
