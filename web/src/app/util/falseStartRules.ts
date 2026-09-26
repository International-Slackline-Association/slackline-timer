/**
 * Pure false-start rules for the Speedline timer console (rules S2–S4), used by
 * `useRaceRecorder`. React-free and table-testable, the `raceTime.ts` pattern.
 *
 * A false start is attributed to one lane and counted per lane, per **attempt**
 * (one start→finish cycle — what `runWins` tallies). The counter is capped at 2
 * because the second flag is already the terminal event: in qualification a 2nd
 * FS fails the attempt (S2, no time recorded); in the finals a 2nd FS by the
 * same athlete forfeits the round to the opponent (S3). A false start never
 * stops the live run (S4) — the run finishes and video review decides — so
 * these helpers only decide what to *record* and what to *advise*, never timing.
 */

/** A lane's false-start count this attempt, capped at 2 (the terminal flag). */
export type FsCount = 0 | 1 | 2;

/** Per-lane false-start counters for the current attempt. */
export type FsCounts = Record<1 | 2, FsCount>;

/** A pristine pair of counters — both lanes clean. */
export const NO_FALSE_STARTS: FsCounts = { 1: 0, 2: 0 };

/** Increment a lane's counter, capped at 2 (a third flag is meaningless). */
export const flagFalseStart = (count: FsCount): FsCount =>
  count >= 2 ? 2 : ((count + 1) as FsCount);

/** Clear a lane's counter (an operator mis-tap, or a fresh attempt). */
export const clearFalseStart = (): FsCount => 0;

/** Normalize a wire-carried count (`updateSelection.falseStarts` is plain
 * numbers) back into the capped domain — peer panels mirror each other's
 * counters (ADR 0038), so the wire value re-enters typed state here. */
export const toFsCount = (count: number): FsCount => (count >= 2 ? 2 : count >= 1 ? 1 : 0);

/**
 * Rule S2: a lane records a time only while it is under its second false start.
 * At 2 the attempt has failed (quali) or forfeited (finals), so no Time is POSTed
 * — the absence of a record *is* the record (ADR 0035: no durable FS marker).
 */
export const shouldRecordTime = (count: FsCount): boolean => count < 2;

/**
 * The counters to carry into the next start. A lane whose previous attempt
 * closed with an accepted result (`attemptClosed`) begins the next attempt clean
 * — including the same athlete's next qualification attempt (S2 no carry-over).
 * A lane still mid-attempt (a rerun after a void, no accepted result yet) keeps
 * its count so a repeated jump is caught as the same attempt's second FS.
 */
export const fsCountsAfterStart = (
  counts: FsCounts,
  attemptClosed: Record<1 | 2, boolean>,
): FsCounts => ({
  1: attemptClosed[1] ? 0 : counts[1],
  2: attemptClosed[2] ? 0 : counts[2],
});

/**
 * The consequence the software advises for the current attempt (the head judge
 * decides — the `deriveFreestyleMatchWinner` house pattern). `runWinner` is the
 * lane the completed run awarded (null while undecided / a tie).
 *
 * Precedence, most-decisive first:
 *  - `none` — neither lane flagged.
 *  - `rerun-round` — BOTH lanes flagged (S3 both-FS reruns), regardless of counts.
 *  - `round-to-opponent` — one lane reached its 2nd FS (S3 forfeit); the clean
 *    lane (`opponent`) is awarded the round.
 *  - a single first FS on one lane, the run then:
 *     - `awaiting-finish` — still undecided (S4: the run runs to a finish);
 *     - `rerun-start` — the offender won (its jump may have tainted the win);
 *     - `result-stands` — the clean lane won anyway.
 */
export type FsOutcome =
  | { kind: 'none' }
  | { kind: 'rerun-round' }
  | { kind: 'round-to-opponent'; offender: 1 | 2; opponent: 1 | 2 }
  | { kind: 'awaiting-finish'; offender: 1 | 2 }
  | { kind: 'rerun-start'; offender: 1 | 2 }
  | { kind: 'result-stands'; offender: 1 | 2 };

export const deriveFsOutcome = (counts: FsCounts, runWinner: 1 | 2 | null): FsOutcome => {
  const c1 = counts[1];
  const c2 = counts[2];
  if (c1 === 0 && c2 === 0) return { kind: 'none' };
  // Both athletes jumped: the round reruns, whatever the individual counts (a
  // 2-vs-1 is still a mutual false start — the forfeit needs one clean lane).
  if (c1 >= 1 && c2 >= 1) return { kind: 'rerun-round' };

  const offender: 1 | 2 = c1 >= 1 ? 1 : 2;
  const opponent: 1 | 2 = offender === 1 ? 2 : 1;
  if (counts[offender] === 2) return { kind: 'round-to-opponent', offender, opponent };
  // A single first false start: S4 — the run is never stopped, so wait for it.
  if (runWinner === null) return { kind: 'awaiting-finish', offender };
  if (runWinner === offender) return { kind: 'rerun-start', offender };
  return { kind: 'result-stands', offender };
};
