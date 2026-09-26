import type { Athlete, Gender, Score, Time, TimeRound } from './types';

/**
 * Ranking math ported from timertimer's Competition context.
 *
 * DynamoDB cannot aggregate, so the Lambdas query a round's Times plus the
 * athlete list and compute rankings here (small N — a single competition).
 *
 * DNF semantics are inherited from timertimer: the DNF sentinel is just a very
 * large elapsed time, so `min()` naturally prefers any real run, and an
 * athlete whose only results are DNFs sorts last with bestTime = DNF (the UI
 * renders it as "DNF"). Athletes with no Time in the round are excluded —
 * exactly like the SQL inner join.
 */

export interface RankedAthlete {
  athlete: Athlete;
  bestTimeMs: number;
}

export interface RankedAthleteWithTimes extends RankedAthlete {
  /** Every elapsed time of the round, ordered chronologically (start_time asc). */
  allTimesMs: number[];
}

export const bestTimeByAthlete = (times: Time[]): Map<string, number> => {
  const best = new Map<string, number>();
  for (const t of times) {
    const current = best.get(t.athleteId);
    if (current === undefined || t.timeMs < current) {
      best.set(t.athleteId, t.timeMs);
    }
  }
  return best;
};

/**
 * Second-best (next-smallest) elapsed time per athlete — the speed tiebreak when
 * two athletes share an identical best. An athlete with only one run has no
 * backup, encoded as +Infinity so any real second run outranks the absent one.
 */
const secondBestByAthlete = (times: Time[]): Map<string, number> => {
  const byAthlete = new Map<string, number[]>();
  for (const t of times) {
    const list = byAthlete.get(t.athleteId);
    if (list) list.push(t.timeMs);
    else byAthlete.set(t.athleteId, [t.timeMs]);
  }
  const second = new Map<string, number>();
  for (const [athleteId, list] of byAthlete) {
    const sorted = [...list].sort((a, b) => a - b);
    second.set(athleteId, sorted[1] ?? Number.POSITIVE_INFINITY);
  }
  return second;
};

/**
 * Ranks athletes by best time ascending, breaking an exact best-time tie on the
 * second-best run (faster backup wins, absent backup last), then athlete name.
 */
const byBestTimeAsc =
  (second: Map<string, number>) =>
  (a: RankedAthlete, b: RankedAthlete): number =>
    a.bestTimeMs - b.bestTimeMs ||
    second.get(a.athlete.athleteId)! - second.get(b.athlete.athleteId)! ||
    a.athlete.name.localeCompare(b.athlete.name);

/**
 * Port of `get_athletes_by_best_time_in_round(round, gender)`: athletes of the
 * gender that have at least one Time in the round, ranked by best time asc.
 * Pass the round's times (already filtered by the SK prefix query).
 */
export const rankAthletesByBestTime = (
  athletes: Athlete[],
  timesOfRound: Time[],
  gender: Gender,
): RankedAthlete[] => {
  const best = bestTimeByAthlete(timesOfRound);
  const second = secondBestByAthlete(timesOfRound);
  return athletes
    .filter((a) => a.gender === gender && best.has(a.athleteId))
    .map((athlete) => ({ athlete, bestTimeMs: best.get(athlete.athleteId)! }))
    .sort(byBestTimeAsc(second));
};

/**
 * Port of `get_athletes_by_best_time_with_all_times(round, gender)`: the same
 * ranking, with every attempt of the round attached in chronological order.
 */
export const rankAthletesWithAllTimes = (
  athletes: Athlete[],
  timesOfRound: Time[],
  gender: Gender,
): RankedAthleteWithTimes[] => {
  const chronological = [...timesOfRound].sort((a, b) => a.startTime - b.startTime);
  return rankAthletesByBestTime(athletes, timesOfRound, gender).map((ranked) => ({
    ...ranked,
    allTimesMs: chronological
      .filter((t) => t.athleteId === ranked.athlete.athleteId)
      .map((t) => t.timeMs),
  }));
};

export interface RankedByScore {
  athlete: Athlete;
  overall: number;
  score: Score;
  /** Present (and true) for an attempted-and-failed score; renders "DNF". */
  dnf?: boolean;
}

/**
 * A DNF mirrors the speed sentinel's intent on the judged plane: it stays in the
 * ranked field but sorts strictly below every finite overall (including 0.0).
 * The sort key is forced to -Infinity for the comparator only; the stored Score
 * keeps its real components.
 */
const sortOverall = (score: Score): number =>
  score.dnf === true ? Number.NEGATIVE_INFINITY : score.overall;

/**
 * Freestyle tiebreak on an equal overall: the higher single judged component in
 * priority order difficulty → combo → style → bestTrick (each higher =
 * better), then athlete name. A DNF vs a finite overall never reaches here — it
 * loses on overall via the -Infinity sort key; a DNF-vs-DNF pair falls through
 * to the components and ultimately the name.
 */
const JUDGED_TIEBREAK = ['difficulty', 'combo', 'style', 'bestTrick'] as const;

const byOverallDesc = (a: RankedByScore, b: RankedByScore): number => {
  const aOverall = sortOverall(a.score);
  const bOverall = sortOverall(b.score);
  // Strict comparison, not subtraction: (-Infinity) - (-Infinity) is NaN, which
  // would make the sort order of a DNF-vs-DNF pair undefined.
  if (aOverall !== bOverall) return bOverall - aOverall;
  for (const component of JUDGED_TIEBREAK) {
    const compDelta = b.score[component] - a.score[component];
    if (compDelta !== 0) return compDelta;
  }
  return a.athlete.name.localeCompare(b.athlete.name);
};

/**
 * Freestyle analogue of `rankAthletesByBestTime`: athletes of the gender with a
 * Score in the round, ranked by `overall` DESC. Athletes without a Score are
 * excluded (inner-join).
 */
export const rankAthletesByOverall = (
  athletes: Athlete[],
  scoresOfRound: Score[],
  gender: Gender,
): RankedByScore[] => {
  const byAthlete = new Map<string, Score>();
  for (const s of scoresOfRound) byAthlete.set(s.athleteId, s);
  return athletes
    .filter((a) => a.gender === gender && byAthlete.has(a.athleteId))
    .map((athlete) => {
      const score = byAthlete.get(athlete.athleteId)!;
      return {
        athlete,
        overall: score.overall,
        score,
        ...(score.dnf === true ? { dnf: true } : {}),
      };
    })
    .sort(byOverallDesc);
};

/**
 * Port of `get_top_three_times_for_athlete(athlete_id, round)`: the FIRST
 * three attempts chronologically (start_time asc), not the best three — used
 * by the head-to-head VS card.
 */
export const firstThreeTimesForAthlete = (
  timesOfRound: Time[],
  athleteId: string,
  round: TimeRound,
): Time[] =>
  timesOfRound
    .filter((t) => t.athleteId === athleteId && t.round === round)
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, 3);
