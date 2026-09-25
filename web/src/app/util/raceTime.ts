import type { MatchInput } from 'app/api/matches';
import type { TimeInput } from 'app/api/times';
import type { Match, Time, TimeRound } from 'app/types';
import { DNF_SENTINEL } from 'app/util/time';

/**
 * Pure helpers for turning a live race into a persistable Time, used by the
 * Speedline timer console (`useRaceRecorder`). Kept free of React/IO so the
 * record-or-skip decision and the elapsed math are exhaustively testable — the
 * live control page can't be unit-tested (it opens real WebSocket connections).
 */

/** Elapsed milliseconds between race start and a lane stop, clamped to ≥ 0. */
export const elapsedMs = (raceStartTime: number, stopTime: number): number =>
  Math.max(0, stopTime - raceStartTime);

/**
 * Build the Time to POST when a lane's stopwatch stops. Returns `null` (record
 * nothing) when the lane has no athlete assigned or the race never started —
 * so warmups and unassigned lanes don't create junk times.
 */
export const finishTimeInput = (
  athleteId: string,
  round: TimeRound,
  raceStartTime: number | null,
  stopTime: number,
  matchId?: string,
): TimeInput | null => {
  if (!athleteId || raceStartTime === null) return null;
  return {
    athleteId,
    round,
    timeMs: elapsedMs(raceStartTime, stopTime),
    startTime: raceStartTime,
    ...(matchId ? { matchId } : {}),
  };
};

/**
 * Build a DNF Time for a lane (the operator marks a fall / no-finish). Recorded
 * whenever an athlete is assigned, with or without a started race; the start
 * time is carried through when known so attempts stay chronological.
 */
export const dnfTimeInput = (
  athleteId: string,
  round: TimeRound,
  raceStartTime: number | null,
  matchId?: string,
): TimeInput | null => {
  if (!athleteId) return null;
  return {
    athleteId,
    round,
    timeMs: DNF_SENTINEL,
    ...(raceStartTime !== null ? { startTime: raceStartTime } : {}),
    ...(matchId ? { matchId } : {}),
  };
};

/**
 * Re-build a recorded Time's PUT body with a corrected `timeMs` (hand timers
 * differ from the system clock). `timeMs` is a non-key attribute, so the edit
 * carries every other field — athlete/round/startTime/matchId — through
 * unchanged; the server PUTs the full object (see `useUpdateTime`).
 */
export const editTimeInput = (prev: TimeInput, timeMs: number): TimeInput => ({
  ...prev,
  timeMs,
});

/**
 * Re-build a recorded Time's PUT body under a different athlete — a lane's
 * result recorded against the wrong person (the operator re-picks the lane
 * after the save). The clock is untouched: `timeMs`/`startTime`/round/match all
 * carry through, only the attribution moves. `athleteId` IS part of the sort
 * key, so the server runs this as a transactional delete+put (`useUpdateTime`).
 */
export const moveTimeInput = (prev: TimeInput, athleteId: string): TimeInput => ({
  ...prev,
  athleteId,
});

/** A lane's result for the current run: elapsed ms, `DNF_SENTINEL` for a DNF, or null (no result yet). */
export type LaneResult = number | null;

/**
 * Which lanes a race start ignites. A solo run — exactly one lane with an
 * athlete assigned, the qualification pattern — starts only that lane, so the
 * empty lane's stopwatch stays dormant instead of ticking a meaningless time.
 * No athletes (warmup / untracked timing) or both assigned (a match) keep the
 * old both-lanes start.
 */
export const activeStartLanes = (laneAthletes: Record<1 | 2, string>): Array<1 | 2> => {
  if (laneAthletes[1] && !laneAthletes[2]) return [1];
  if (laneAthletes[2] && !laneAthletes[1]) return [2];
  return [1, 2];
};

/** Qualification allows at most two recorded attempts per athlete (rule S5). */
export const QUALI_ATTEMPT_CAP = 2;

/**
 * How many Times an athlete already holds in a round. DNFs count — a fall is a
 * used attempt. Counted over the persisted Times, so deleting/voiding an attempt
 * frees a slot with no override flag; an unassigned lane ('') counts as zero.
 */
export const attemptCount = (times: Time[], athleteId: string, round: TimeRound): number =>
  athleteId ? times.filter((t) => t.athleteId === athleteId && t.round === round).length : 0;

/**
 * Whether recording another Time for this athlete would exceed the qualification
 * two-attempt cap (rule S5). Only `qualification` is capped — finals attempts are
 * governed by best-of-3, and training/test stay unbounded. The Speedline recorder
 * console reads this to lock a lane whose athlete has used both attempts; the
 * admin Times CRUD stays the correction escape hatch.
 */
export const qualiAttemptCapReached = (
  times: Time[],
  athleteId: string,
  round: TimeRound,
): boolean =>
  round === 'qualification' && attemptCount(times, athleteId, round) >= QUALI_ATTEMPT_CAP;

/**
 * Strip the server-owned ids off a Match, leaving the create/update payload.
 * Mirrors `MatchForm`'s `toInput` exactly: the immutable sort-key fields
 * (discipline/round/gender/position) and athlete ids must all ride along
 * because `useUpdateMatch` PUTs the full object as a transactional delete+put —
 * sending a partial body would corrupt the record. Optional fields are spread
 * only when set so an absent winner clears `winnerId` rather than writing empty.
 */
export const matchToInput = (match: Match): MatchInput => ({
  discipline: match.discipline,
  round: match.round,
  ...(match.roundName ? { roundName: match.roundName } : {}),
  gender: match.gender,
  position: match.position,
  ...(match.athlete1Id ? { athlete1Id: match.athlete1Id } : {}),
  ...(match.athlete2Id ? { athlete2Id: match.athlete2Id } : {}),
  ...(match.winnerId ? { winnerId: match.winnerId } : {}),
});

/**
 * The Match PUT body with any winner stripped — used to void a run: the times
 * that supported the derived winner are being deleted, so the winner must be
 * unset too. Drops the `winnerId` key entirely so the transactional PUT clears
 * it (an empty value would write a blank, not unset). Carries the immutable
 * sort-key + athlete fields through unchanged, like `matchToInput`.
 */
export const clearWinnerInput = (match: Match): MatchInput => {
  const { winnerId: _prior, ...base } = matchToInput(match);
  return base;
};

/**
 * Decide which lane won a single completed run from the two lanes' results, or
 * `null` when the run awards no win. Pure lane comparison shared by the live
 * winner derivation and the best-of-3 tally (one source of truth):
 *  - both lanes must have a non-null result this run, else null (one-lane no-op);
 *  - `DNF_SENTINEL` is not a finishing time — excluded from the comparison;
 *  - both DNF → no win;
 *  - exactly one non-DNF lane → that lane;
 *  - two non-DNF lanes with equal elapsed (exact tie) → no win;
 *  - otherwise the faster non-DNF lane.
 */
export const runWinningLane = (laneResults: Record<1 | 2, LaneResult>): 1 | 2 | null => {
  const r1 = laneResults[1];
  const r2 = laneResults[2];
  if (r1 === null || r2 === null) return null;

  const dnf1 = r1 === DNF_SENTINEL;
  const dnf2 = r2 === DNF_SENTINEL;

  if (dnf1 && dnf2) return null;
  if (dnf1) return 2;
  if (dnf2) return 1;
  if (r1 === r2) return null; // exact tie — operator resolves via MatchForm
  return r1 < r2 ? 1 : 2;
};

/**
 * The lane-oriented view of a best-of-3 run-wins tally — what the console
 * renders under each lane column and what `updateSelection.runWins` carries on
 * the wire (relative to the SAME message's `athlete1Id`/`athlete2Id`, so an
 * overlay pairing name↔digit from one message is consistent by construction).
 */
export type RunWins = Record<1 | 2, number>;

/** A pristine best-of-3 lane view — both lanes on zero. */
export const NO_RUN_WINS: RunWins = { 1: 0, 2: 0 };

/**
 * The best-of-3 series tally keyed by **athlete id** — the tally's true
 * identity. A run-win belongs to the athlete who won it, not to the physical
 * lane they happened to run in: athletes routinely switch sides between the
 * runs of a match (neutralising a lane advantage), and a lane-keyed tally
 * silently re-credits every earlier win to whoever now stands on that lane
 * (ADR 0044). Lane-oriented consumers derive their view via `laneRunWins`.
 */
export type SeriesWins = Record<string, number>;

/** A pristine series — no athlete holds a run-win. */
export const NO_SERIES_WINS: SeriesWins = {};

/** An athlete's run-wins in the series (0 for an unassigned lane's ''). */
export const winsFor = (wins: SeriesWins, athleteId: string): number =>
  (athleteId && wins[athleteId]) || 0;

/** Project the athlete-keyed tally onto the current lane→athlete pairing. */
export const laneRunWins = (wins: SeriesWins, laneAthletes: Record<1 | 2, string>): RunWins => ({
  1: winsFor(wins, laneAthletes[1]),
  2: winsFor(wins, laneAthletes[2]),
});

/** Credit an athlete with a run-win. */
export const addRunWin = (wins: SeriesWins, athleteId: string): SeriesWins => ({
  ...wins,
  [athleteId]: winsFor(wins, athleteId) + 1,
});

/** Undo an athlete's run-win (floored at zero — an undo can't go negative). */
export const removeRunWin = (wins: SeriesWins, athleteId: string): SeriesWins => ({
  ...wins,
  [athleteId]: Math.max(0, winsFor(wins, athleteId) - 1),
});

/**
 * The athlete who has clinched a best-of-3 series (first to 2 run-wins), or
 * `null` while the series is still live. Best-of-3 ⇒ reaching 2 is unbeatable,
 * so the threshold is a constant 2 (generalise if a configurable length is ever
 * needed). Athlete-keyed, so the answer survives any lane swap.
 */
export const seriesWinnerId = (wins: SeriesWins): string | null =>
  Object.entries(wins).find(([, w]) => w >= 2)?.[0] ?? null;

/**
 * Reconstruct a match's best-of-3 series tally from the Times already persisted
 * for it — so re-selecting a match mid-series shows the runs it has already
 * resolved (the timer console seeds `seriesWins` from this on selection).
 *
 * Both lanes of one run start together, so their Times share a `startTime`:
 * group the match's Times by `startTime` into per-run results (slotted by the
 * match's own athlete pair — any stable orientation works, the comparison is
 * symmetric), tally each run's winner via the shared `runWinningLane`, and
 * credit the winning **athlete**. A run with only one athlete recorded awards
 * nothing (runWinningLane returns null), exactly like a live half-run.
 */
export const tallyFromTimes = (match: Match, times: Time[]): SeriesWins => {
  const runs = new Map<number, Record<1 | 2, LaneResult>>();
  for (const t of times) {
    if (t.matchId !== match.matchId) continue;
    const slot = t.athleteId === match.athlete1Id ? 1 : t.athleteId === match.athlete2Id ? 2 : null;
    if (slot === null) continue;
    const run = runs.get(t.startTime) ?? { 1: null, 2: null };
    run[slot] = t.timeMs;
    runs.set(t.startTime, run);
  }

  let wins: SeriesWins = NO_SERIES_WINS;
  for (const run of runs.values()) {
    const won = runWinningLane(run);
    const athleteId = won === 1 ? match.athlete1Id : won === 2 ? match.athlete2Id : undefined;
    if (athleteId) wins = addRunWin(wins, athleteId);
  }
  return wins;
};
