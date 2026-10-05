// Head-to-head result payloads for a resolved bracket final or small final.
// `/stream/vs/*` sources its stats tables from the match round's Times (speed:
// RUN 1/2/3) and Scores (freestyle: the judged breakdown + TOTAL), and overall
// ranks 1–4 read their result off the same rounds, so a seed that stops at the
// bracket leaves those boxes empty and ranks 3–4 borrowing quali times.
//
// Split out of seedLocal.mjs to be testable: the caller owns the randomness
// (`runsFor` / `scoreFor`); this owns the rules that silently break the overlay
// — run order, the loser's DNF, and a decided pair whose laps and scores crown
// the stored `winnerId`.
// Plain ESM + a hand-written .d.mts, like seedPreflight.mjs.

import { DNF_SENTINEL } from './seedClient.mjs';

/** Best-of-3 (the VS speed table has exactly three RUN rows). */
export const FINAL_RUNS = 3;

/** Wall-clock spacing between a finalist's runs. `runsForAthlete` (the VS
 *  overlay) sorts by `startTime` and takes the first three, so the runs must be
 *  strictly ordered — three POSTs in the same millisecond scramble RUN 1/2/3. */
const RUN_GAP_MS = 60_000;

/** Added to the loser's lap when both draws are equal, so the winner is strictly faster. */
const TIE_BREAK_MS = 50;

/** `computeOverall` in src/core/types.ts — the server's freestyle overall. */
const overallOf = (s) =>
  Math.round((s.difficulty + s.combo + s.style + s.bestTrick - s.controlPenalty) * 1e6) / 1e6;

/** Runs 1–2: the faster of the two draws goes to the winner. Run 3: the loser DNFs. */
const decidedLaps = (winnerLaps, loserLaps) => {
  const winner = [...winnerLaps];
  const loser = [...loserLaps];
  for (let i = 0; i < FINAL_RUNS - 1; i++) {
    const [fast, slow] = [Math.min(winner[i], loser[i]), Math.max(winner[i], loser[i])];
    winner[i] = fast;
    loser[i] = slow === fast ? slow + TIE_BREAK_MS : slow;
  }
  loser[FINAL_RUNS - 1] = DNF_SENTINEL;
  return { winner, loser };
};

/** The higher-overall component set goes to the winner; a tie costs the loser a
 *  control-penalty point (uncapped, so it always stays valid). */
const decidedScores = (winnerScore, loserScore) => {
  const [winner, loser] =
    overallOf(loserScore) > overallOf(winnerScore)
      ? [loserScore, winnerScore]
      : [winnerScore, loserScore];
  return overallOf(winner) === overallOf(loser)
    ? { winner, loser: { ...loser, controlPenalty: loser.controlPenalty + 1 } }
    : { winner, loser };
};

/**
 * The rows for ONE resolved final or small final, in data-plane POST shape,
 * tagged with the match's own `round`.
 * Speed gets Times, freestyle a Score — the two planes the VS card splits on.
 *
 * A final with a `winnerId` is written as a decided pair (see `decidedLaps` /
 * `decidedScores`); one without stays undecided — clean runs, scores as drawn.
 * Freestyle components otherwise ride through as given: a battle is the only
 * round where `bestTrick` / `controlPenalty` may be nonzero (rule F8), and the
 * VS table renders both.
 *
 * Writes nothing for a final that is not a resolved pair (a bye, or a bracket
 * that never advanced) — there is no head-to-head to populate.
 */
export const buildFinalResults = ({ discipline, match, runsFor, scoreFor, startEpoch }) => {
  const empty = { times: [], scores: [] };
  const { matchId, round, athlete1Id, athlete2Id, winnerId } = match ?? {};
  if (!matchId || !athlete1Id || !athlete2Id) return empty;

  const finalists = [athlete1Id, athlete2Id];
  const loserId = finalists.includes(winnerId)
    ? finalists.find((id) => id !== winnerId)
    : undefined;
  const decide = (draw, rule) => {
    const drawn = new Map(finalists.map((id) => [id, draw(id)]));
    if (!loserId) return drawn;
    const { winner, loser } = rule(drawn.get(winnerId), drawn.get(loserId));
    return new Map([
      [winnerId, winner],
      [loserId, loser],
    ]);
  };

  if (discipline === 'freestyle') {
    const components = decide(scoreFor, decidedScores);
    return {
      times: [],
      scores: finalists.map((athleteId) => ({
        athleteId,
        round,
        matchId,
        ...components.get(athleteId),
      })),
    };
  }

  const laps = decide(runsFor, decidedLaps);
  const times = finalists.flatMap((athleteId) =>
    Array.from({ length: FINAL_RUNS }, (_, i) => ({
      athleteId,
      round,
      matchId,
      timeMs: laps.get(athleteId)[i],
      startTime: startEpoch + i * RUN_GAP_MS,
    })),
  );
  return { times, scores: [] };
};
