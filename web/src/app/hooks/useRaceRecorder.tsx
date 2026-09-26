import { useEffect, useRef, useState } from 'react';

import { useUpdateMatch } from 'app/api/matches';
import {
  useCreateTime,
  useDeleteTime,
  useTimes,
  useUpdateTime,
  type TimeInput,
} from 'app/api/times';
import { useMatchSelection } from 'app/hooks/useMatchSelection';
import type { LiveSelection } from 'app/hooks/useWebSocket';
import { isTimeRound, type TimeRound } from 'app/types';
import {
  clearFalseStart,
  deriveFsOutcome,
  flagFalseStart,
  fsCountsAfterStart,
  NO_FALSE_STARTS,
  shouldRecordTime,
  toFsCount,
  type FsCounts,
} from 'app/util/falseStartRules';
import {
  addRunWin,
  clearWinnerInput,
  dnfTimeInput,
  editTimeInput,
  finishTimeInput,
  laneRunWins,
  matchToInput,
  moveTimeInput,
  NO_SERIES_WINS,
  attemptCount,
  qualiAttemptCapReached,
  QUALI_ATTEMPT_CAP,
  removeRunWin,
  runWinningLane,
  seriesWinnerId,
  tallyFromTimes,
  winsFor,
  type LaneResult,
  type SeriesWins,
} from 'app/util/raceTime';
import { DNF_SENTINEL } from 'app/util/time';

export type LaneId = 1 | 2;

const NO_RESULTS: Record<LaneId, LaneResult> = { 1: null, 2: null };

/** Per-lane save feedback: the value being recorded plus where the POST stands. */
export interface LaneFeedback {
  status: 'pending' | 'saved' | 'error';
  /** The recorded elapsed ms (or DNF_SENTINEL) — shown so the operator confirms the value. */
  valueMs: number;
  /**
   * The persisted Time's id + the body it was saved with, captured on a
   * successful save so the operator can post-correct `timeMs` against the
   * existing record (hand-timer correction). Absent while pending / on error.
   */
  saved?: { timeId: string; input: TimeInput };
}

const NO_FEEDBACK: Record<LaneId, LaneFeedback | null> = { 1: null, 2: null };

/** A transient confirmation shown in a snackbar; cleared by the consumer on dismiss. */
export interface Toast {
  text: string;
  severity: 'success' | 'error';
}

/**
 * Timer-console recorder for the Speedline control page. Holds the operator's
 * round + per-lane athlete selection and the current race start, and turns lane
 * stops / DNF marks into POSTed Times (via useCreateTime). Recording is a purely
 * additive layer over the live timer — `finishTimeInput` returns null (records
 * nothing) for unassigned lanes or a race that never started, so the panel can
 * be ignored entirely and timing is unaffected. `compId` is the relay sessionId.
 *
 * Recording is no longer fire-and-forget: each lane carries a `laneFeedback`
 * entry (pending → saved/error with the recorded value) and a successful save
 * raises a `toast`, so the operator gets positive confirmation rather than only
 * seeing the silence-or-Alert of before.
 *
 * Optionally an operator picks a speed Match (gender + match select); once BOTH
 * lanes of that Match have a result this run, the recorder derives `winnerId`
 * from the recorded elapsed times and PUTs it onto the Match (`useUpdateMatch`),
 * exposing the resolved winner via `derivedWinner` for inline display.
 * Picking "— no match —" keeps the Times-only behavior and never touches a Match.
 */
export const useRaceRecorder = (compId: string) => {
  const createTime = useCreateTime(compId);
  const updateTime = useUpdateTime(compId);
  const deleteTime = useDeleteTime(compId);
  const updateMatch = useUpdateMatch(compId);
  const [raceStartTime, setRaceStartTime] = useState<number | null>(null);

  // Drives the inline "saved 1:23.45" chips.
  const [laneFeedback, setLaneFeedback] = useState<Record<LaneId, LaneFeedback | null>>({
    ...NO_FEEDBACK,
  });
  const [toast, setToast] = useState<Toast | null>(null);
  // The winner resolved for the selected Match this run: the athlete id, or ''
  // (an explicit no-winner — tie / both-DNF), or null (not yet resolved).
  const [derivedWinner, setDerivedWinner] = useState<string | null>(null);

  // All persisted Times for the comp — the source for seeding a re-selected
  // match's best-of-3 tally from its already-recorded runs (matchId filter is
  // round-independent, so no round scoping is needed here).
  const times = useTimes(compId);

  // Per-run lane results (elapsed ms, DNF_SENTINEL, or null = no result yet).
  // A ref, not state — these only feed the winner derivation and are mutated
  // imperatively as each lane stops; nothing renders off them, so no re-render
  // is needed and reads are always the latest (lanes stop on separate events).
  const laneResults = useRef<Record<LaneId, LaneResult>>({ ...NO_RESULTS });

  // Best-of-3 series tally, a sibling of laneResults but living OUTSIDE the
  // per-run reset — it spans the three runs of one match. Keyed by ATHLETE id
  // (ADR 0044): a run-win belongs to the athlete who won it, so a lane swap
  // between runs (athletes switching sides) can't re-credit earlier wins to
  // whoever now stands on the lane. Consumers read the lane-oriented view
  // (`runWins` below), projected through the live pairing each render.
  // State, not a ref: the console renders the live series score off it.
  const [seriesWins, setSeriesWins] = useState<SeriesWins>(NO_SERIES_WINS);
  // The lane the most recent completed run awarded a win to (or null) — feeds
  // the false-start outcome derivation. State (not a ref): `fsOutcome` renders
  // off it, so a change must re-render the advisory strip.
  const [lastRunLane, setLastRunLane] = useState<LaneId | null>(null);
  // The ATHLETE that run's win was credited to — what voidRun undoes. A
  // sibling of lastRunLane rather than derived from it: a swap between the
  // run and its void would re-map the lane to the other athlete.
  const [lastRunWinnerId, setLastRunWinnerId] = useState<string | null>(null);

  // Per-lane false-start counters for the current attempt (rules S2–S4). A
  // sibling of `runWins` (session-only, never persisted; ADR 0035): flagged by the
  // operator, capped at 2, carried through a rerun and zeroed when the attempt
  // closes with an accepted result (see `fsCountsAfterStart` / `attemptClosed`).
  const [fsCounts, setFsCounts] = useState<FsCounts>({ ...NO_FALSE_STARTS });
  // Whether each lane's current attempt has closed with an accepted result (a
  // saved Time / DNF / tally). Consumed by the next start to decide whether the
  // lane's FS counter zeroes (closed → new attempt) or carries (a void rerun is
  // the same attempt). A ref — nothing renders off it and it is read at start.
  const attemptClosed = useRef<Record<LaneId, boolean>>({ 1: false, 2: false });
  const closeAttempt = (lane: LaneId): void => {
    attemptClosed.current = { ...attemptClosed.current, [lane]: true };
  };
  // Whether the current run has already been counted into the tally. Guards the
  // once-per-run increment: recordLaneResult fires per lane stop AND again on a
  // hand-timer correction, but the run must score the tally exactly once.
  const runTallied = useRef(false);
  // Per-lane save generation, bumped whenever a lane's result is WITHDRAWN (a
  // resume). A POST already in flight cannot be recalled, so its reply is
  // matched against the generation it was issued under: a stale one neither
  // re-raises the chip nor leaves its record behind — the withdrawal's DELETE
  // simply waits for the id to exist.
  const saveGeneration = useRef<Record<LaneId, number>>({ 1: 0, 2: 0 });

  /**
   * Zero the best-of-3 series for a clean re-do (explicit operator control).
   * Also clears the FS counters and reopens both lanes' attempts: a new series
   * is a new attempt context, so no false start carries into it. This is the
   * single funnel `selectMatch` / `clearMatch` / `confirmPendingChange` reuse
   * (via `onSelectionReset`), so the FS-context reset rides those
   * attempt-context changes too.
   */
  const resetSeries = (): void => {
    setSeriesWins(NO_SERIES_WINS);
    setLastRunLane(null);
    setLastRunWinnerId(null);
    setDerivedWinner(null);
    setFsCounts({ ...NO_FALSE_STARTS });
    attemptClosed.current = { 1: false, 2: false };
  };

  // Round/gender/match/athlete selection — the machinery shared with the
  // freestyle console (useMatchSelection owns ADR 0033's confirm-guarded
  // cascading filters); the speed-specific cascades hang off the callbacks.
  const {
    round,
    setRound,
    athletes: laneAthletes,
    setAthletes: setLaneAthletes,
    selectedGender,
    setSelectedGender,
    selectedMatchId,
    setSelectedMatchId,
    matches,
    roundMatches,
    findMatch,
    seededMatchId,
    selectMatch,
    requestRound,
    requestGender,
    pendingChange,
    confirmPendingChange,
    cancelPendingChange,
  } = useMatchSelection<TimeRound>(compId, {
    discipline: 'speed',
    initialRound: 'qualification',
    onSelectionReset: resetSeries,
    // Clearing the match also drops the per-run state so a prior run can't leak.
    onMatchCleared: (): void => {
      laneResults.current = { ...NO_RESULTS };
      runTallied.current = false;
    },
    // A gender switch is a new athlete context — the FS counters drop with it.
    onGenderApplied: (): void => setFsCounts({ ...NO_FALSE_STARTS }),
  });

  // The lane-oriented tally view — what the console renders and what rides the
  // wire as `updateSelection.runWins`. Projected through the LIVE pairing, so a
  // swap re-broadcasts each athlete's wins under their new side and every
  // consumer (peer panels, rounds-summary overlay) follows automatically.
  const runWins = laneRunWins(seriesWins, laneAthletes);

  // Per-lane qualification attempt tally (rule S5): how many Times the lane's
  // athlete already holds this round, and whether that hits the two-attempt cap.
  // Derived over the persisted Times, so a voided/deleted attempt frees a slot.
  // `capped` is only ever true in `qualification` (see qualiAttemptCapReached).
  const allTimes = times.data ?? [];
  const laneAttempts: Record<LaneId, { used: number; capped: boolean }> = {
    1: {
      used: attemptCount(allTimes, laneAthletes[1], round),
      capped: qualiAttemptCapReached(allTimes, laneAthletes[1], round),
    },
    2: {
      used: attemptCount(allTimes, laneAthletes[2], round),
      capped: qualiAttemptCapReached(allTimes, laneAthletes[2], round),
    },
  };

  // Seed the best-of-3 tally from the match's already-persisted Times when a
  // match is (re)selected, so re-opening a mid-series match shows the runs it
  // has already resolved. Runs once per selection (see `seededMatchId`); live
  // increments after seeding are left untouched.
  useEffect(() => {
    const matchId = selectedMatchId;
    if (!matchId || seededMatchId.current === matchId) return;
    const match = findMatch(matchId);
    const timesData = times.data;
    if (!match || !timesData) return;
    setSeriesWins(tallyFromTimes(match, timesData));
    if (match.winnerId) setDerivedWinner(match.winnerId);
    seededMatchId.current = matchId;
  }, [selectedMatchId, matches.data, times.data]);

  /**
   * Put an athlete on a lane. The lane's saved feedback deliberately stays
   * bound to the athlete its Time was POSTed under: a re-pick may be
   * exploratory, and clearing the chip would throw away the only pointer to a
   * mis-attributed record. The console names that athlete on the chip and
   * offers `moveTime` as the explicit one-tap re-attribution.
   */
  const setLaneAthlete = (lane: LaneId, athleteId: string): void => {
    setLaneAthletes((prev) => ({ ...prev, [lane]: athleteId }));
    // A new athlete on the lane is a new attempt context — drop its FS count.
    clearFs(lane);
  };

  /**
   * Swap the two lanes' athlete assignments — the operator flips who is on
   * which side without re-picking both dropdowns, including the between-runs
   * side switch of a best-of-3 (athletes trade lanes to neutralise a lane
   * advantage, ADR 0044). A pure exchange (a double swap is identity), and
   * everything ATHLETE-scoped rides along: the false-start attribution, the
   * attempt-closed markers, this run's recorded results, and the save feedback
   * (so a post-swap hand-timer correction still edits the right athlete's
   * Time). The series tally needs no touch — it is athlete-keyed, so each
   * athlete's run-wins follow them to the new side via the `runWins`
   * projection. Only the physical stopwatches stay lane-fixed, which is why
   * the board's interlock table locks Swap while a run is live
   * (`speedlineLocks.swap`).
   * The mirrored `updateSelection` re-broadcasts off the changed
   * `laneAthletes`, so peer panels, preview and overlays follow with no extra
   * wiring.
   */
  const swapLanes = (): void => {
    setLaneAthletes((prev) => ({ 1: prev[2], 2: prev[1] }));
    setFsCounts((prev) => ({ 1: prev[2], 2: prev[1] }));
    setLaneFeedback((prev) => ({ 1: prev[2], 2: prev[1] }));
    laneResults.current = { 1: laneResults.current[2], 2: laneResults.current[1] };
    attemptClosed.current = { 1: attemptClosed.current[2], 2: attemptClosed.current[1] };
  };

  /** Flag a false start against a lane (operator/gamepad), capped at 2 (S2–S4). */
  const flagFs = (lane: LaneId): void =>
    setFsCounts((prev) => ({ ...prev, [lane]: flagFalseStart(prev[lane]) }));

  /** Clear a lane's false-start count (a mis-tap, or an attempt-context change). */
  const clearFs = (lane: LaneId): void =>
    setFsCounts((prev) => ({ ...prev, [lane]: clearFalseStart() }));

  const clearToast = (): void => setToast(null);

  const setLaneStatus = (lane: LaneId, fb: LaneFeedback): void =>
    setLaneFeedback((prev) => ({ ...prev, [lane]: fb }));

  /**
   * Record a lane's result for this run, then advance the best-of-3 series.
   * No-op on the Match unless a Match is selected and found in the fetched list.
   *
   * Once both lanes have a result this run, the run is scored ONCE (guarded by
   * `runTallied`): the win is credited to the ATHLETE on the winning lane at
   * the moment the run resolves (a tie / both-DNF awards no run-win — the
   * operator re-runs; an unassigned winning lane credits nobody).
   * `Match.winnerId` is PUT only when an athlete clinches the series (first to
   * 2 run-wins); until then the match stays winner-less. A fresh hand-timer
   * correction re-fires this with the run already tallied, so the increment is
   * skipped — the existing tally still decides.
   */
  const recordLaneResult = (lane: LaneId, result: LaneResult): void => {
    laneResults.current = { ...laneResults.current, [lane]: result };
    if (!selectedMatchId) return;
    const match = findMatch(selectedMatchId);
    if (!match) return;

    let nextWins = seriesWins;
    if (!runTallied.current && laneResults.current[1] !== null && laneResults.current[2] !== null) {
      runTallied.current = true;
      const wonLane = runWinningLane(laneResults.current);
      setLastRunLane(wonLane);
      // The run resolved for both lanes — the attempt is closed (its result is
      // accepted), so the next start begins a clean attempt (S2 no carry-over).
      closeAttempt(1);
      closeAttempt(2);
      const wonAthlete = wonLane !== null ? laneAthletes[wonLane] : '';
      if (wonAthlete) {
        nextWins = addRunWin(seriesWins, wonAthlete);
        setSeriesWins(nextWins);
        setLastRunWinnerId(wonAthlete);
      }
    }

    const winnerId = seriesWinnerId(nextWins);
    if (winnerId === null) return;
    updateMatch.mutate({ id: match.matchId, input: { ...matchToInput(match), winnerId } });
    setDerivedWinner(winnerId);
  };

  /**
   * Start a fresh run of the current series: clear the per-run state but KEEP
   * the best-of-3 tally (a re-light of the same match mustn't lose 1–0/1–1).
   * A new series is started only by picking a different Match (`selectMatch`).
   */
  const onRaceStart = (startTime: number): void => {
    setRaceStartTime(startTime);
    // A re-run of the same run starts clean so a prior run's result can't leak.
    laneResults.current = { ...NO_RESULTS };
    runTallied.current = false;
    setLaneFeedback({ ...NO_FEEDBACK });
    setDerivedWinner(null);
    // This run's winner is not yet known — drop the previous run's so a discard
    // (void / forfeit award) of a run that hasn't tallied can't undo an earlier
    // run's win off a stale value.
    setLastRunLane(null);
    setLastRunWinnerId(null);
    // Carry / zero the FS counters per whether each lane's attempt closed (S2:
    // a fresh attempt — incl. the same athlete's next quali run — starts clean;
    // a void rerun keeps the count so a repeat jump is the same attempt's 2nd).
    // Capture the flags before reopening: the setFsCounts updater runs lazily,
    // after the reset line below would otherwise have cleared them.
    const closed = attemptClosed.current;
    setFsCounts((prev) => fsCountsAfterStart(prev, closed));
    attemptClosed.current = { 1: false, 2: false };
  };

  /**
   * Re-arm on a reset: drop a stale start so it can't attach to the next run,
   * and reset the per-run state — but, like `onRaceStart`, KEEP the series
   * tally; resetting the lights is part of running the same match.
   */
  const onReset = (): void => {
    setRaceStartTime(null);
    laneResults.current = { ...NO_RESULTS };
    runTallied.current = false;
    setLaneFeedback({ ...NO_FEEDBACK });
    setDerivedWinner(null);
  };

  /**
   * Peer-apply a mirrored board selection (ADR 0038) — write-free: nothing here
   * ever POSTs a Time or PUTs a Match. Sets the round directly (bypassing the
   * `requestRound` confirm — the confirm belongs to the acting panel) and takes
   * the wire tally/FS counts verbatim. Value-guarded (equal values set nothing),
   * which is what terminates the cross-panel selection echo. Marks the match as
   * seeded so the persisted-Times seed effect can't double-count over the live
   * wire tally. A foreign-discipline selection (both modes share one relay room)
   * is dropped, as is a round outside the speed vocabulary.
   */
  const applySelection = (sel: LiveSelection): void => {
    if (sel.discipline !== 'speed' || !isTimeRound(sel.round)) return;
    setRound(sel.round);
    setSelectedGender(sel.gender);
    const matchId = sel.matchId ?? '';
    setSelectedMatchId(matchId);
    seededMatchId.current = matchId || null;
    const lanes: Record<LaneId, string> = { 1: sel.athlete1Id ?? '', 2: sel.athlete2Id ?? '' };
    setLaneAthletes((prev) => (prev[1] === lanes[1] && prev[2] === lanes[2] ? prev : lanes));
    const wins = sel.runWins;
    if (wins) {
      // The wire tally is the lane view relative to THIS message's athlete ids
      // (the sender projects its athlete-keyed tally the same way) — re-key it
      // by athlete before adopting. The value guard compares the lane views:
      // an equal projection keeps the previous object, terminating the echo.
      setSeriesWins((prev) => {
        if (winsFor(prev, lanes[1]) === wins[1] && winsFor(prev, lanes[2]) === wins[2]) return prev;
        const next: SeriesWins = {};
        if (lanes[1]) next[lanes[1]] = wins[1];
        if (lanes[2]) next[lanes[2]] = wins[2];
        return next;
      });
    }
    const fs = sel.falseStarts;
    if (fs) {
      const next: FsCounts = { 1: toFsCount(fs[1]), 2: toFsCount(fs[2]) };
      setFsCounts((prev) => (prev[1] === next[1] && prev[2] === next[2] ? prev : next));
    }
  };

  /**
   * Note a lane result a PEER panel's stop produced (ADR 0038) — write-free:
   * never `saveTime`, never `updateMatch`. Records the result so a later LOCAL
   * stop of the other lane still tallies/derives correctly, closes the lane's
   * attempt, and — once both lanes hold results — marks the run tallied WITHOUT
   * incrementing: the tally has a single site (the panel whose local stop
   * completed the run) and converges here via the mirrored `updateSelection`
   * runWins; a later local hand-timer correction must not re-increment either.
   */
  const notePeerFinish = (lane: LaneId, result: LaneResult): void => {
    laneResults.current = { ...laneResults.current, [lane]: result };
    closeAttempt(lane);
    if (laneResults.current[1] !== null && laneResults.current[2] !== null) {
      runTallied.current = true;
      closeAttempt(1);
      closeAttempt(2);
    }
  };

  /**
   * POST a Time and reflect its lifecycle into the lane's feedback + a toast.
   * `mutateAsync`, not `mutate` with callbacks: both lanes share one mutation
   * observer, and React Query fires mutate-level callbacks only for the LATEST
   * of consecutive mutations — two lanes routinely stop within one POST's
   * flight, which would strand the first lane on "pending" and never capture
   * its saved timeId (breaking correction and voidRun for that lane). The
   * per-call promise keeps each lane's feedback independent.
   */
  const saveTime = (lane: LaneId, input: ReturnType<typeof finishTimeInput>): void => {
    if (!input) return;
    // An accepted result closes the lane's attempt: the next start zeroes its FS
    // counter (a fresh attempt), unless a void reopens it for a rerun.
    closeAttempt(lane);
    setLaneStatus(lane, { status: 'pending', valueMs: input.timeMs });
    const generation = saveGeneration.current[lane];
    const withdrawn = (): boolean => saveGeneration.current[lane] !== generation;
    createTime.mutateAsync(input).then(
      (time) => {
        // The lane was resumed while this POST flew: the record exists now, so
        // this is where the resume's DELETE lands.
        if (withdrawn()) {
          deleteTime.mutate(time.timeId);
          return;
        }
        setLaneStatus(lane, {
          status: 'saved',
          valueMs: time.timeMs,
          saved: { timeId: time.timeId, input },
        });
        setToast({ text: `Lane ${lane} time saved`, severity: 'success' });
      },
      () => {
        if (withdrawn()) return;
        setLaneStatus(lane, { status: 'error', valueMs: input.timeMs });
        setToast({ text: `Lane ${lane} time not saved`, severity: 'error' });
      },
    );
  };

  /**
   * Post-correct a recorded lane's `timeMs` (hand-timer correction). PUTs the
   * full body via the existing update path, refreshes the lane's saved feedback
   * with the new value + body, and re-derives the selected Match's winner from
   * the corrected time. No-op for a lane with nothing saved yet.
   */
  const editLaneTime = (lane: LaneId, timeMs: number): void => {
    const saved = laneFeedback[lane]?.saved;
    if (!saved) return;
    const input = editTimeInput(saved.input, timeMs);
    setLaneStatus(lane, { status: 'pending', valueMs: timeMs, saved });
    // mutateAsync for the same reason as saveTime: both lanes can be corrected
    // while the first PUT is still in flight.
    updateTime.mutateAsync({ id: saved.timeId, input }).then(
      (time) => {
        setLaneStatus(lane, {
          status: 'saved',
          valueMs: time.timeMs,
          saved: { timeId: time.timeId, input },
        });
        setToast({ text: `Lane ${lane} time corrected`, severity: 'success' });
        recordLaneResult(lane, time.timeMs);
      },
      () => {
        setLaneStatus(lane, { status: 'error', valueMs: timeMs, saved });
        setToast({ text: `Lane ${lane} time not corrected`, severity: 'error' });
      },
    );
  };

  /**
   * Re-attribute a lane's recorded Time to the athlete now standing on it — the
   * recovery for a run saved against the wrong person. `setLaneAthlete` leaves
   * the lane's saved feedback bound to the athlete it was POSTed under (the
   * chip names them), because a pick may be exploratory; this is the explicit
   * one-tap that follows it. PUTs through the same update path as a hand-timer
   * correction (`athleteId` is a sort-key field, so the server rewrites the SK
   * transactionally), re-binds the feedback to the new body, and re-derives the
   * lane result so an unresolved run tallies to the athlete it is now recorded
   * against. No-op unless the lane holds a save bound to someone else.
   */
  const moveTime = (lane: LaneId): void => {
    const fb = laneFeedback[lane];
    const saved = fb?.saved;
    const athleteId = laneAthletes[lane];
    if (!saved || !athleteId || saved.input.athleteId === athleteId) return;
    const input = moveTimeInput(saved.input, athleteId);
    setLaneStatus(lane, { status: 'pending', valueMs: fb.valueMs, saved });
    updateTime.mutateAsync({ id: saved.timeId, input }).then(
      (time) => {
        setLaneStatus(lane, {
          status: 'saved',
          valueMs: time.timeMs,
          saved: { timeId: time.timeId, input },
        });
        setToast({ text: `Lane ${lane} time moved`, severity: 'success' });
        recordLaneResult(lane, time.timeMs);
      },
      () => {
        setLaneStatus(lane, { status: 'error', valueMs: fb.valueMs, saved });
        setToast({ text: `Lane ${lane} time not moved`, severity: 'error' });
      },
    );
  };

  /**
   * Shared internals of `voidRun` / `awardRunTo`: delete every Time this run
   * persisted (one DELETE per lane that saved one — safe when none exist, as in
   * a forfeit where the offender recorded nothing) and undo the run's best-of-3
   * tally increment. Returns the tally after the undo so the caller can clear or
   * re-credit the series winner. Does NOT touch the FS counters or per-run
   * results — each caller finishes the reset its own way.
   *
   * Deletion (not a flag) keeps the data model simple: the Time SK is the stable
   * identity, so the delete path removes the record cleanly and rankings/overlays
   * re-derive with no special-casing (see ADR 0012).
   */
  const discardRunTimes = (): SeriesWins => {
    ([1, 2] as const)
      .map((lane) => laneFeedback[lane]?.saved?.timeId)
      .filter((id): id is string => Boolean(id))
      .forEach((timeId) => deleteTime.mutate(timeId));

    // Undo against the credited ATHLETE (not the lane): a swap between the run
    // and the void must not decrement whoever now stands on the winning lane.
    const undoneId = lastRunWinnerId;
    const nextWins = undoneId !== null ? removeRunWin(seriesWins, undoneId) : seriesWins;
    if (undoneId !== null) setSeriesWins(nextWins);
    setLastRunLane(null);
    setLastRunWinnerId(null);
    return nextWins;
  };

  const clearRunState = (): void => {
    laneResults.current = { ...NO_RESULTS };
    runTallied.current = false;
    setLaneFeedback({ ...NO_FEEDBACK });
  };

  const voidRun = (): void => {
    const nextWins = discardRunTimes();
    // A void reruns the SAME attempt: reopen both lanes so a repeat jump counts
    // as this attempt's second false start, and KEEP the FS counters (ADR 0035).
    attemptClosed.current = { 1: false, 2: false };

    // Clear Match.winnerId iff the series is no longer decided after the undo.
    const match = findMatch(selectedMatchId);
    if (match && derivedWinner && seriesWinnerId(nextWins) === null)
      updateMatch.mutate({ id: match.matchId, input: clearWinnerInput(match) });

    clearRunState();
    setDerivedWinner(null);
    setToast({ text: 'Run voided', severity: 'success' });
  };

  /**
   * Withdraw everything ONE lane's stop recorded — the recorder half of a lane
   * resume (`speedline-resume-stopped-lane`); the clock half is the page's
   * (it drops the stop and keeps the GO epoch). Local state only, so the peer
   * mirror reuses it whole. Returns the tally after the undo.
   *
   * A run that had RESOLVED credited a run-win, and a resumed lane un-resolves
   * it: the credit is withdrawn against the credited ATHLETE (a swap since
   * would re-map the lane), exactly as a void does. Without that, re-crossing
   * the line would score the same run twice — and the re-run may well go the
   * other way. The FS counters and the rest of the series are untouched:
   * neither belongs to this stop.
   */
  const withdrawLaneResult = (lane: LaneId): SeriesWins => {
    saveGeneration.current = {
      ...saveGeneration.current,
      [lane]: saveGeneration.current[lane] + 1,
    };
    laneResults.current = { ...laneResults.current, [lane]: null };
    attemptClosed.current = { ...attemptClosed.current, [lane]: false };
    setLaneFeedback((prev) => ({ ...prev, [lane]: null }));
    if (!runTallied.current) return seriesWins;
    runTallied.current = false;
    const undoneId = lastRunWinnerId;
    const nextWins = undoneId !== null ? removeRunWin(seriesWins, undoneId) : seriesWins;
    if (undoneId !== null) setSeriesWins(nextWins);
    setLastRunLane(null);
    setLastRunWinnerId(null);
    return nextWins;
  };

  /**
   * Undo a mis-pressed Stop on `lane`: the athlete is still crossing, so the
   * Time the stop POSTed is deleted (a save still in flight is marked stale and
   * deleted the moment its id exists) and the lane is re-opened for its real
   * finish. The escape hatch this replaces was Void — which discards BOTH
   * lanes' Times over one lane's mis-press.
   */
  const resumeLane = (lane: LaneId): void => {
    const timeId = laneFeedback[lane]?.saved?.timeId;
    if (timeId) deleteTime.mutate(timeId);
    const nextWins = withdrawLaneResult(lane);
    // Same rule as a void: a series the withdrawn run had clinched is no longer
    // decided, so the persisted winner comes back off.
    const match = findMatch(selectedMatchId);
    if (seriesWinnerId(nextWins) === null) {
      if (match && derivedWinner)
        updateMatch.mutate({ id: match.matchId, input: clearWinnerInput(match) });
      setDerivedWinner(null);
    }
    setToast({ text: `Lane ${lane} resumed`, severity: 'success' });
  };

  /**
   * Peer-apply a mirrored lane resume (ADR 0038) — the sibling of
   * `notePeerFinish`, with one write: the panel HOLDING the lane's persisted
   * row retracts it, whichever panel's operator pressed Resume.
   *
   * The timeId lives only in the feedback of the panel that POSTed it, and the
   * peer never saw the POST's reply — so it has nothing to relay and no panel
   * but this one can issue the DELETE. That is still 0038 §2: a withdrawal of
   * this panel's own write, not a second author for it, and idempotent (a
   * resume the operator pressed here already deleted the row through
   * `resumeLane`, which withdraws the feedback before any peer frame lands).
   */
  const notePeerResume = (lane: LaneId): void => {
    const timeId = laneFeedback[lane]?.saved?.timeId;
    if (timeId) deleteTime.mutate(timeId);
    withdrawLaneResult(lane);
  };

  /**
   * Rule S3 one-tap: award the current run (round) to `lane` when the opponent's
   * second false start forfeits it. Discards this run's Times + tally win (the
   * forfeit voids any recorded result), credits `lane` with the run-win, and PUTs
   * `Match.winnerId` if that clinches the series. Closes both attempts and clears
   * the FS counters — the consequence is applied, so the next run is a fresh
   * attempt. Software advises, the head judge taps (the house pattern).
   */
  const awardRunTo = (lane: LaneId): void => {
    // The award credits an athlete; an anonymous lane can't hold a run-win.
    // Unreachable via the UI (the advisory strip only offers the award inside
    // a selected match, whose lanes are auto-filled) — a loud no-op backstop.
    const awardedAthlete = laneAthletes[lane];
    if (!awardedAthlete) {
      setToast({ text: `Lane ${lane} has no athlete to award to`, severity: 'error' });
      return;
    }
    const undoneWins = discardRunTimes();
    const nextWins = addRunWin(undoneWins, awardedAthlete);
    setSeriesWins(nextWins);
    setLastRunLane(lane);
    setLastRunWinnerId(awardedAthlete);

    const match = findMatch(selectedMatchId);
    const decided = seriesWinnerId(nextWins);
    const winnerId = match && decided !== null ? decided : '';
    if (match && winnerId) {
      updateMatch.mutate({ id: match.matchId, input: { ...matchToInput(match), winnerId } });
    }

    attemptClosed.current = { 1: true, 2: true };
    setFsCounts({ ...NO_FALSE_STARTS });
    clearRunState();
    setDerivedWinner(winnerId || null);
    setToast({ text: `Round awarded to lane ${lane}`, severity: 'success' });
  };

  /**
   * Rule S5: refuse to record a third qualification attempt for a lane whose
   * athlete already holds two Times this round. Backstops the console's disabled
   * badge for the always-firing gamepad path; toasts so a blocked stop/DNF isn't
   * silent. The admin Times CRUD stays the correction escape hatch.
   */
  const attemptCapBlocks = (lane: LaneId): boolean => {
    if (!laneAttempts[lane].capped) return false;
    setToast({ text: `Lane ${lane} at attempt cap (2/2)`, severity: 'error' });
    return true;
  };

  /**
   * Call when a lane's stopwatch stops; no-op for unassigned/not-started lanes
   * — and for a lane that already recorded a result this run (mirrors
   * `useScoreRecorder`'s saved lock): a repeat gamepad stop must not POST a second,
   * longer Time or overwrite the lane result the winner derivation read.
   * Corrections go through `editLaneTime`; the next start/reset re-arms.
   */
  const recordFinish = (lane: LaneId, stopTime: number): void => {
    if (laneResults.current[lane] !== null) return;
    // Rule S2/S3: on the lane's 2nd false start, record nothing and skip the
    // lane-result too — so the run can never auto-tally to the offender (a
    // finals award stays an operator tap). The failed/forfeited attempt is done,
    // so close it: the next start begins clean. The live run itself is untouched
    // (S4 — it already finished; timing never stops on a false start).
    if (!shouldRecordTime(fsCounts[lane])) {
      closeAttempt(lane);
      return;
    }
    if (attemptCapBlocks(lane)) return;
    const input = finishTimeInput(
      laneAthletes[lane],
      round,
      raceStartTime,
      stopTime,
      selectedMatchId || undefined,
    );
    saveTime(lane, input);
    // Drive the Match winner from the actual elapsed (independent of whether a
    // Time was POSTed — the Match write is opt-in via the Match selection).
    if (raceStartTime !== null)
      recordLaneResult(lane, input ? input.timeMs : stopTime - raceStartTime);
  };

  /**
   * Operator marks the lane's athlete DNF (a fall / no finish). Idempotent
   * dedupe rather than `recordFinish`'s hard lock: a repeat DNF press (a double
   * gamepad/button tap) is a no-op once the lane already holds a DNF this run,
   * but DNF-after-finish stays allowed — it is a used correction path (an
   * athlete finished then is disqualified/falls), see ADR 0028.
   *
   * That correction EDITS the attempt's one row rather than adding a second
   * (0028's amendment): a lane holding a save is PUT to the sentinel through
   * the same path a hand-timer correction uses, so rankings read the DNF
   * instead of the real time that outranks it and the quali attempt count stays
   * at the one attempt actually run. The lane result is set before the PUT
   * flies — it is what the double-press dedupe and `recordFinish`'s lock read,
   * and neither may wait on a round trip.
   */
  const recordDnf = (lane: LaneId): void => {
    if (laneResults.current[lane] === DNF_SENTINEL) return;
    if (laneFeedback[lane]?.saved) {
      recordLaneResult(lane, DNF_SENTINEL);
      // Deliberately ahead of the attempt cap: the cap guards a NEW record, and
      // the row this rewrites is one the lane already spent an attempt on.
      editLaneTime(lane, DNF_SENTINEL);
      return;
    }
    if (attemptCapBlocks(lane)) return;
    const input = dnfTimeInput(
      laneAthletes[lane],
      round,
      raceStartTime,
      selectedMatchId || undefined,
    );
    saveTime(lane, input);
    recordLaneResult(lane, DNF_SENTINEL);
  };

  // The advised false-start consequence for the current attempt (rules S2–S4).
  // Software advises; the head judge taps the strip — the house pattern.
  const fsOutcome = deriveFsOutcome(fsCounts, lastRunLane);

  return {
    round,
    setRound,
    // Confirm-guarded round/gender changes + the round-scoped match list
    // (ADR 0033 + the cascading-filters extension).
    requestRound,
    requestGender,
    pendingChange,
    confirmPendingChange,
    cancelPendingChange,
    roundMatches,
    laneAthletes,
    setLaneAthlete,
    swapLanes,
    // Per-lane qualification attempt tally + the two-attempt cap (rule S5).
    laneAttempts,
    attemptCap: QUALI_ATTEMPT_CAP,
    onRaceStart,
    onReset,
    recordFinish,
    recordDnf,
    // Peer mirroring (ADR 0038) — write-free application of a peer panel's state.
    applySelection,
    notePeerFinish,
    notePeerResume,
    editLaneTime,
    moveTime,
    voidRun,
    // The per-lane undo of a mis-pressed Stop (`speedline-resume-stopped-lane`).
    resumeLane,
    // Per-lane false-start attribution (rules S2–S4).
    fsCounts,
    flagFs,
    clearFs,
    fsOutcome,
    awardRunTo,
    createTime,
    updateTime,
    deleteTime,
    // Per-lane / snackbar save feedback.
    laneFeedback,
    toast,
    clearToast,
    // Match-driven recording surface. Gender changes go through `requestGender`
    // (the guarded single door); only the peer path sets it directly.
    selectedGender,
    selectedMatchId,
    setSelectedMatchId,
    selectMatch,
    matches,
    times,
    updateMatch,
    derivedWinner,
    // Best-of-3 series tally — the lane-oriented view of the athlete-keyed
    // `seriesWins` (ADR 0044), projected through the live lane pairing.
    runWins,
    resetSeries,
  };
};

export type RaceRecorder = ReturnType<typeof useRaceRecorder>;
