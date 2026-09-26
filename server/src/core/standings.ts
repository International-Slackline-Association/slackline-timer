import type { Match, MatchRound } from './types';

/**
 * Final overall standings (LAAX rule G3): bracket outcomes merged with the
 * qualification ranking into one placement list — 1–2 from the final, 3–4 from
 * the small final, 5–8 quarter losers by quali rank, 9+ the quali tail.
 *
 * Pure module in the `bracketProgression.ts` style — no DB imports. The caller
 * (the rankings Lambda) passes the gender/discipline-scoped bracket matches and
 * the qualification order (best first, from `core/rankings.ts`).
 *
 * Band model: every athlete is always placed, and `provisional` marks any rank
 * that can still change, so the view is honestly airable at every stage. Bands
 * are emitted top-down and an athlete's first (highest) band wins:
 *
 *   1. final participants        — decided: winner over loser (firm);
 *                                  undecided: both by quali order, provisional.
 *   2. small-final participants  — same rule, at 3–4.
 *   3. top-4 in flight           — semi-finalists and not-yet-advanced quarter
 *                                  winners, by quali order, provisional.
 *   4. quarter rest              — losers + undecided participants, by quali
 *                                  order; firm only once every quarter is decided
 *                                  (then it is exactly the losers at 5–8).
 *   5. quali tail                — the remaining quali ranking, starting after
 *                                  the observed bracket size (quarters place
 *                                  1–8 so the tail is rank 9+; a halves-only
 *                                  top-4 bracket places 1–4 so the tail is
 *                                  rank 5+; no bracket → the whole quali list,
 *                                  all provisional).
 *
 * With a bracket seeded but nothing decided this degrades to exactly the
 * qualification ranking (all provisional).
 */

/** Where a placement's rank comes from. The rankings API re-reports `source` as
 *  the round the row's displayed RESULT came from, which differs whenever the
 *  placement round holds none (see `resultWithProvenance`). */
export type StandingsSource = 'final' | 'small_final' | 'half' | 'quarter' | 'qualification';

export interface StandingsPlacement {
  athleteId: string;
  rank: number;
  source: StandingsSource;
  /** Present while the rank can still change (an undecided match upstream). */
  provisional?: true;
}

type BracketMatch = Pick<Match, 'round' | 'position' | 'athlete1Id' | 'athlete2Id' | 'winnerId'>;

const BRACKET_ROUNDS: readonly MatchRound[] = ['quarter', 'half', 'small_final', 'final'];

const participants = (m: BracketMatch): string[] =>
  [m.athlete1Id, m.athlete2Id].filter((id): id is string => id !== undefined);

/** The winner, only when it names one of the match's participants (else: undecided). */
const decidedWinner = (m: BracketMatch): string | undefined =>
  m.winnerId !== undefined && participants(m).includes(m.winnerId) ? m.winnerId : undefined;

export const computeOverallStandings = (
  matches: BracketMatch[],
  qualiOrder: string[],
  names: ReadonlyMap<string, string> = new Map(),
): StandingsPlacement[] => {
  const bracket = matches.filter((m) => BRACKET_ROUNDS.includes(m.round));
  const ofRound = (round: MatchRound) =>
    bracket.filter((m) => m.round === round).sort((a, b) => a.position - b.position);

  // In-band order: quali rank, a no-quali seeded athlete last, then name —
  // placed by the bracket, never dropped.
  const qualiIndex = new Map(qualiOrder.map((id, i) => [id, i]));
  const byQuali = (a: string, b: string): number => {
    const ai = qualiIndex.get(a);
    const bi = qualiIndex.get(b);
    if (ai !== bi)
      return (ai ?? Number.POSITIVE_INFINITY) < (bi ?? Number.POSITIVE_INFINITY) ? -1 : 1;
    return (names.get(a) ?? a).localeCompare(names.get(b) ?? b);
  };

  const placed = new Set<string>();
  const rows: StandingsPlacement[] = [];
  const place = (
    athleteId: string,
    source: StandingsSource,
    provisional: boolean,
    rank = rows.length + 1,
  ): void => {
    if (placed.has(athleteId)) return;
    placed.add(athleteId);
    rows.push({ athleteId, rank, source, ...(provisional ? { provisional: true as const } : {}) });
  };

  const placeMatchBand = (round: 'final' | 'small_final'): void => {
    for (const m of ofRound(round)) {
      const winner = decidedWinner(m);
      if (winner !== undefined) {
        place(winner, round, false);
        const loser = participants(m).find((id) => id !== winner);
        if (loser !== undefined) place(loser, round, false);
      } else {
        for (const id of participants(m).sort(byQuali)) place(id, round, true);
      }
    }
  };

  placeMatchBand('final');
  placeMatchBand('small_final');

  const halves = ofRound('half');
  const quarters = ofRound('quarter');

  const halfIds = new Set(halves.flatMap(participants));
  const top4 = new Set([
    ...halfIds,
    ...quarters.map(decidedWinner).filter((id): id is string => id !== undefined),
  ]);
  for (const id of [...top4].filter((id) => !placed.has(id)).sort(byQuali)) {
    place(id, halfIds.has(id) ? 'half' : 'quarter', true);
  }

  const quartersDecided =
    quarters.length > 0 && quarters.every((m) => decidedWinner(m) !== undefined);
  const quarterRest = [...new Set(quarters.flatMap(participants))]
    .filter((id) => !placed.has(id))
    .sort(byQuali);
  for (const id of quarterRest) place(id, 'quarter', !quartersDecided);

  // Tail floor comes from the observed bracket, not the placed count, so a TBD
  // bracket slot reserves its rank instead of pulling the tail up.
  const bracketSize = quarters.length > 0 ? 8 : halves.length > 0 ? 4 : 0;
  let rank = Math.max(rows.length, bracketSize) + 1;
  const noBracket = bracket.length === 0;
  for (const id of qualiOrder) {
    if (placed.has(id)) continue;
    place(id, 'qualification', noBracket, rank);
    rank += 1;
  }

  return rows;
};

/**
 * Combined-title row (LAAX rule G2): the average of an athlete's two
 * per-discipline overall placements. `rank` is 1224-style — equal averages
 * share the rank, the next distinct average resumes at the skip rank.
 */
export interface CombinedPlacement {
  athleteId: string;
  rank: number;
  /** The ranked quantity: (speedRank + freestyleRank) / 2, ascending. */
  combined: number;
  speedRank: number;
  freestyleRank: number;
  /** Present while either input placement can still change. */
  provisional?: true;
}

/**
 * The combined title (rule G2) over two `computeOverallStandings` outputs:
 * intersection only (the rule averages two ranks that must both exist — a
 * one-discipline athlete is excluded, never given a synthetic worst rank).
 * Before both disciplines have any standings the intersection is naturally
 * empty, so a mid-event board needs no gating; `provisional` propagates from
 * either side so a live combined leaderboard stays honest. Emission order on
 * equal averages: better single best rank, then name.
 */
export const computeCombinedRanking = (
  speed: StandingsPlacement[],
  freestyle: StandingsPlacement[],
  names: ReadonlyMap<string, string> = new Map(),
): CombinedPlacement[] => {
  const bySpeed = new Map(speed.map((p) => [p.athleteId, p]));
  const rows = freestyle.flatMap((f) => {
    const s = bySpeed.get(f.athleteId);
    if (!s) return [];
    return [
      {
        athleteId: f.athleteId,
        combined: (s.rank + f.rank) / 2,
        speedRank: s.rank,
        freestyleRank: f.rank,
        provisional: s.provisional === true || f.provisional === true,
      },
    ];
  });
  rows.sort(
    (a, b) =>
      a.combined - b.combined ||
      Math.min(a.speedRank, a.freestyleRank) - Math.min(b.speedRank, b.freestyleRank) ||
      (names.get(a.athleteId) ?? a.athleteId).localeCompare(names.get(b.athleteId) ?? b.athleteId),
  );
  const out: CombinedPlacement[] = [];
  for (const [i, row] of rows.entries()) {
    // The shared rank is assigned here, not client-side: the client only renders
    // the `=` marker on repeats.
    const rank = i > 0 && rows[i - 1].combined === row.combined ? out[i - 1].rank : i + 1;
    out.push({
      athleteId: row.athleteId,
      rank,
      combined: row.combined,
      speedRank: row.speedRank,
      freestyleRank: row.freestyleRank,
      ...(row.provisional ? { provisional: true as const } : {}),
    });
  }
  return out;
};
