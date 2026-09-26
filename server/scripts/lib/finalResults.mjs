// Final-round result payloads for a resolved bracket final. `/stream/vs/*`
// sources its stats tables from `final`-round Times (speed: RUN 1/2/3) and
// Scores (freestyle: the judged breakdown + TOTAL), so a seed that stops at the
// bracket leaves every one of those boxes empty.
//
// Split out of seedLocal.mjs to be testable: the caller owns the randomness
// (`runsFor` / `scoreFor`), this owns the rules that silently break the overlay.
// Plain ESM + a hand-written .d.mts, like seedPreflight.mjs.

import { DNF_SENTINEL } from './seedClient.mjs';

/** Best-of-3 (the VS speed table has exactly three RUN rows). */
export const FINAL_RUNS = 3;

/** Wall-clock spacing between a finalist's runs. `runsForAthlete` (the VS
 *  overlay) sorts by `startTime` and takes the first three, so the runs must be
 *  strictly ordered — three POSTs in the same millisecond scramble RUN 1/2/3. */
const RUN_GAP_MS = 60_000;

/**
 * The `final`-round rows for ONE resolved final, in data-plane POST shape.
 * Speed gets Times, freestyle a Score — the two planes the VS card splits on.
 *
 * The loser's last run carries the DNF sentinel so the table exercises its
 * `DNF` label; a final with no winner yet gets no DNF. Freestyle components
 * ride through as given: a battle is the only round where `bestTrick` /
 * `controlPenalty` may be nonzero (rule F8), and the VS table renders both.
 *
 * Writes nothing for a final that is not a resolved pair (a bye, or a bracket
 * that never advanced) — there is no head-to-head to populate.
 */
export const buildFinalResults = ({ discipline, match, runsFor, scoreFor, startEpoch }) => {
  const empty = { times: [], scores: [] };
  const { matchId, athlete1Id, athlete2Id, winnerId } = match ?? {};
  if (!matchId || !athlete1Id || !athlete2Id) return empty;

  const finalists = [athlete1Id, athlete2Id];
  if (discipline === 'freestyle') {
    return {
      times: [],
      scores: finalists.map((athleteId) => ({
        athleteId,
        round: 'final',
        matchId,
        ...scoreFor(athleteId),
      })),
    };
  }

  const loserId = winnerId ? finalists.find((id) => id !== winnerId) : undefined;
  const times = finalists.flatMap((athleteId) => {
    const laps = runsFor(athleteId);
    return Array.from({ length: FINAL_RUNS }, (_, i) => ({
      athleteId,
      round: 'final',
      matchId,
      timeMs: athleteId === loserId && i === FINAL_RUNS - 1 ? DNF_SENTINEL : laps[i],
      startTime: startEpoch + i * RUN_GAP_MS,
    }));
  });
  return { times, scores: [] };
};
