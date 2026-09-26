import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { useUpdateMatch } from 'app/api/matches';
import { useCreateScore, useScores, useUpdateScore } from 'app/api/scores';
import { useMatchSelection } from 'app/hooks/useMatchSelection';
import type { LiveSelection } from 'app/hooks/useWebSocket';
import { computeOverall, isMatchRound, type MatchRound, type ScoreInput } from 'app/types';
import { apiErrorMessage } from 'app/util/apiError';
import {
  deriveFreestyleMatchWinner,
  dnfScoreInput,
  entryDraft,
  initialScoreEntries,
  isEntryOpen,
  isScoreBoundElsewhere,
  matchResultsOf,
  moveScoreInput,
  overrideValue,
  resolveMatchWinner,
  restoreSlotFromScores,
  scoreEntryReducer,
  scoreInput,
  zeroBattleOnlyForRound,
  type OverrideDraft,
  type ScoreFields,
  type ScoreResult,
} from 'app/util/scoreInput';

export type AthleteSlot = 1 | 2;

/** A transient confirmation shown in a snackbar; cleared by the consumer on dismiss. */
export interface Toast {
  text: string;
  severity: 'success' | 'error';
}

/**
 * Scoring-console recorder for the Freestyle control page. Holds the operator's
 * round + per-athlete-slot selection and the five judged component fields, and
 * turns a Save into a POSTed Score. The two countdown athlete slots map to two
 * athletes. Scoring is a purely additive layer over the timer — `scoreInput`
 * returns null (records nothing) for an unassigned slot, so the panel can be
 * ignored entirely and timing is unaffected. `compId` is the relay sessionId.
 *
 * Each athlete slot's panel is ONE discriminated union (`SlotEntry`, the entry
 * machine in `util/scoreInput`) rather than parallel field/override/feedback
 * slices: the inputs, where the POST stands and what it recorded are the same
 * state, so a locked panel always carries the value it locked on and an edit can
 * never land in a save already on the wire. A saved panel unlocks only when the
 * slot's athlete changes — the POST upserts on the Score's sort key, so a
 * second save from the board would overwrite the recorded row; corrections are
 * made on the Scores page. The row itself outlives the panel (`records`), which
 * is what lets `moveScore` re-file a score entered against the wrong athlete
 * without leaving the board.
 *
 * Optionally an operator picks a freestyle Match (gender + match select); it
 * auto-fills the two athlete slots and the round, links each saved Score to the match
 * via `matchId`, and — once BOTH slots' scores are PERSISTED — derives
 * `winnerId` from the recorded overalls (`deriveFreestyleMatchWinner`) and PUTs
 * it onto the Match. That write is the entry machine's one effect, drained here
 * (HSM rule 4): the winner follows the saves rather than racing them, and a
 * corrected re-save re-resolves (and can flip) it. Picking "— no match —" keeps
 * the Scores-only behavior and never touches a Match.
 *
 * `initialRound` lets the board seed the round to its restored mode's default
 * (per-comp mode memory, ADR 0036) — a mount-time seed only, later mode
 * switches go through `requestRound`.
 */
export const useScoreRecorder = (compId: string, initialRound: MatchRound = 'qualification') => {
  const createScore = useCreateScore(compId);
  const updateScore = useUpdateScore(compId);
  const updateMatch = useUpdateMatch(compId);
  const [store, dispatch] = useReducer(scoreEntryReducer, undefined, initialScoreEntries);
  const entries = store.entries;
  const records = store.records;
  const [toast, setToast] = useState<Toast | null>(null);
  // Which slot's re-attribution PUT is on the wire, so its button can go inert
  // without the panel changing state — the row stays saved throughout a move,
  // and only its `athleteId` is in question.
  const [movingSlot, setMovingSlot] = useState<AthleteSlot | null>(null);

  // All persisted Scores for the comp — the source for restoring a re-selected
  // match's already-recorded slot scores (looked up by round + athleteId).
  const scores = useScores(compId);

  // The (round, athleteId) pair each athlete slot's panel has already been seeded
  // from — the Score's own identity, so it works with or without a Match.
  // `null` = a fresh panel that owes a seed; every path that clears a panel
  // clears its key with it, so "cleared ⇒ re-seeded" holds. A ref, not state:
  // nothing renders from it, it only gates the effect below.
  const seededKey = useRef<Record<AthleteSlot, string | null>>({ 1: null, 2: null });

  const clearAthleteAssignments = (): void => {
    seededKey.current = { 1: null, 2: null };
    dispatch({ type: 'CLEAR_BOTH' });
  };

  // Round/gender/match/athlete selection — the machinery shared with the speed
  // console (useMatchSelection owns ADR 0033's confirm-guarded cascading
  // filters); every freestyle cascade is the same "fresh entry panels" reset,
  // which also drops the per-match results (they live in the panels).
  const {
    round,
    setRound,
    athletes,
    setAthletes,
    selectedGender,
    setSelectedGender,
    selectedMatchId,
    setSelectedMatchId,
    matches,
    roundMatches,
    findMatch,
    selectMatch,
    requestRound,
    requestGender,
    pendingChange,
    confirmPendingChange,
    cancelPendingChange,
  } = useMatchSelection<MatchRound>(compId, {
    discipline: 'freestyle',
    initialRound,
    onMatchFilled: clearAthleteAssignments,
    onMatchCleared: clearAthleteAssignments,
    onGenderApplied: clearAthleteAssignments,
  });

  const match = selectedMatchId ? findMatch(selectedMatchId) : undefined;

  /**
   * Restore each athlete slot's already-recorded Score into its panel: the five
   * components refill and the panel comes back locked on the persisted
   * overall/DNF. A slot with no saved Score is left empty and editable. No
   * Match is written — a restore only re-displays, so it queues no effect.
   *
   * Driven by the (round, athlete) pair rather than a Match selection, so it
   * runs in both modes: qualification has no match to select and is where
   * nearly every save happens, and an unlocked panel there would upsert
   * straight over the persisted `SCORE#<round>#<athleteId>` row. `seededKey`
   * makes it once per pair — a Save invalidates the scores query, and
   * re-seeding would downgrade the board's own save to a `restored` one (which
   * is what decides whether it outranks a stored `Match.winnerId`).
   */
  useEffect(() => {
    const scoresData = scores.data;
    if (!scoresData) return;
    ([1, 2] as const).forEach((slot) => {
      const athleteId = athletes[slot];
      if (!athleteId) {
        seededKey.current[slot] = null;
        return;
      }
      const key = `${round}#${athleteId}`;
      if (seededKey.current[slot] === key) return;
      seededKey.current[slot] = key;
      const restored = restoreSlotFromScores(athleteId, round, scoresData);
      if (!restored) return;
      dispatch({ type: 'RESTORE', player: slot, ...restored });
    });
  }, [round, athletes, scores.data]);

  const clearToast = (): void => setToast(null);

  /**
   * Put an athlete on a slot. The panel unlocks and starts a fresh entry — a
   * saved slot is locked, and the operator moving to the next athlete is the
   * signal they're done with the previous one — but the Score that slot
   * persisted deliberately stays on it (`SavedScore`), bound to the athlete it
   * was POSTed under: a re-pick may be exploratory, and dropping the row would
   * throw away the only pointer to a mis-filed record. The console names that
   * athlete on the status slot and offers `moveScore` as the one-tap
   * re-attribution (the speed plane's `setLaneAthlete`/`moveTime` pair).
   */
  const setAthlete = (slot: AthleteSlot, athleteId: string): void => {
    setAthletes((prev) => ({ ...prev, [slot]: athleteId }));
    seededKey.current[slot] = null;
    dispatch({ type: 'CLEAR', player: slot });
  };

  const canSwapAthletes = Boolean(athletes[1] && athletes[2]);

  /**
   * Swap the two athletes' assignments together with their entry panels
   * (judged fields, override, save state and recorded result) — a true exchange
   * (a double swap is identity), so an in-progress or already-saved entry
   * follows its athlete to the other side rather than being misattributed (a
   * Score is keyed by athlete, not slot). A setup convenience: flip who is
   * Athlete 1 vs 2 without re-picking both dropdowns. The winner is an athlete
   * id, so it stays correct as-is; the mirrored `updateSelection` re-broadcasts
   * off the changed athletes.
   */
  const swapAthletes = (): void => {
    if (!canSwapAthletes) return;
    setAthletes((prev) => ({ 1: prev[2], 2: prev[1] }));
    // The seed keys exchange with them: an entry that already matches its
    // athlete's persisted Score must not be re-seeded on the other side.
    seededKey.current = { 1: seededKey.current[2], 2: seededKey.current[1] };
    dispatch({ type: 'SWAP' });
  };

  /**
   * Peer-apply a mirrored board selection (ADR 0038) — write-free: nothing here
   * ever POSTs a Score or PUTs a Match. Sets the round directly (bypassing the
   * `requestRound` confirm — the confirm belongs to the acting panel) and drops
   * a foreign-discipline selection / a round outside the freestyle vocabulary
   * (both modes share one relay room). Value-guarded — equal values set nothing
   * — which is what terminates the cross-panel selection echo (`updateSelection`
   * re-pushes on every best-trick try, so this runs often with equal values).
   * A changed match cascades like a local `selectMatch` (fresh panels, whose
   * seed guards clear with them) so this panel restores the mirrored match's
   * persisted scores too — unlike speed there is no wire tally the seed could
   * double-count against, so re-seeding is exactly the local behavior.
   */
  const applySelection = (sel: LiveSelection): void => {
    if (sel.discipline !== 'freestyle' || !isMatchRound(sel.round)) return;
    setRound(sel.round);
    setSelectedGender(sel.gender);
    const matchId = sel.matchId ?? '';
    if (matchId !== selectedMatchId) {
      setSelectedMatchId(matchId);
      clearAthleteAssignments();
    }
    const next: Record<AthleteSlot, string> = { 1: sel.athlete1Id ?? '', 2: sel.athlete2Id ?? '' };
    ([1, 2] as const).forEach((slot) => {
      // setAthlete resets the slot's panel, so guard it — stale judged fields
      // must not survive under a peer-switched athlete, but an equal mirror
      // must not wipe an in-progress local entry.
      if (athletes[slot] !== next[slot]) setAthlete(slot, next[slot]);
    });
  };

  // The Match winner, derived: from both persisted scores once this board saved
  // one of them, else off the stored Match (`resolveMatchWinner`).
  const derivedWinner = useMemo(
    () => resolveMatchWinner(match, athletes, entries),
    [match, athletes, entries],
  );

  // PUT the winner the persisted scores now resolve to, if any.
  // `deriveFreestyleMatchWinner` returns null until BOTH athlete slots' scores are
  // persisted, so no Match is ever written off a POST in flight — and a
  // restore, which queues nothing, never writes at all.
  const writeMatchWinner = (): void => {
    if (!match) return;
    const input = deriveFreestyleMatchWinner(match, athletes, matchResultsOf(entries));
    if (input) updateMatch.mutate({ id: match.matchId, input });
  };

  // Drain the entry machine's `resolve_match`: a save has landed, so re-derive
  // the winner and write it.
  useEffect(() => {
    if (store.effects.length === 0) return;
    writeMatchWinner();
    dispatch({ type: 'DRAIN' });
  }, [store.effects]);

  /**
   * Re-run the winner PUT after it failed. Re-derived rather than replayed: the
   * scores are what decide the match, so a retry writes what they say now (a
   * correction saved in between wins) instead of resending a stale body.
   */
  const retryMatchUpdate = (): void => writeMatchWinner();

  const setField = (slot: AthleteSlot, field: keyof ScoreFields, value: number): void =>
    dispatch({ type: 'EDIT_FIELD', player: slot, field, value });

  /** Override the computed overall with what the operator typed (null clears it). */
  const setOverride = (slot: AthleteSlot, value: OverrideDraft): void =>
    dispatch({ type: 'EDIT_OVERRIDE', player: slot, value });

  /**
   * POST a Score and reflect its lifecycle into the athlete slot's entry + a toast.
   * `mutateAsync`, not `mutate` with callbacks: both athlete slots share one mutation
   * observer, and React Query fires mutate-level callbacks only for the LATEST
   * of consecutive mutations — back-to-back saves (e.g. DNF'ing both athletes)
   * would strand the first on "pending" and never lock its panel. The per-call
   * promise keeps each slot's entry independent (mirrors useRaceRecorder).
   */
  const save = (slot: AthleteSlot, input: ScoreInput | null, result: ScoreResult): void => {
    if (!input) return;
    dispatch({ type: 'SUBMIT', player: slot, result });
    createScore.mutateAsync(input).then(
      (score) => {
        dispatch({
          type: 'SAVED',
          player: slot,
          record: {
            scoreId: score.scoreId,
            input,
            result: { overall: score.overall, dnf: score.dnf ?? false },
          },
        });
        setToast({ text: `Athlete ${slot} score saved`, severity: 'success' });
      },
      (error: unknown) => {
        dispatch({ type: 'FAILED', player: slot, reason: apiErrorMessage(error) });
        setToast({ text: `Athlete ${slot} score not saved`, severity: 'error' });
      },
    );
  };

  /** Save an athlete slot's score; no-op for an unassigned, locked or in-flight slot. */
  const recordScore = (slot: AthleteSlot): void => {
    const entry = entries[slot];
    if (!isEntryOpen(entry)) return;
    const { fields, override } = entryDraft(entry);
    const overall = overrideValue(override);
    const input = scoreInput(athletes[slot], round, fields, overall, selectedMatchId || undefined);
    // What the POST will record — the override when set, else the computed
    // value over the fields `scoreInput` actually sends (quali zeroes the
    // battle-only two, rule F8).
    save(slot, input, {
      overall: overall ?? computeOverall(zeroBattleOnlyForRound(round, fields)),
      dnf: false,
    });
  };

  /** Record an athlete slot as DNF (attempted-and-failed); same no-ops as Save. */
  const recordDnf = (slot: AthleteSlot): void => {
    if (!isEntryOpen(entries[slot])) return;
    const input = dnfScoreInput(athletes[slot], round, selectedMatchId || undefined);
    save(slot, input, { overall: 0, dnf: true });
  };

  /**
   * Re-file this slot's persisted Score under the athlete now on it — the
   * recovery for a score entered against the wrong person, and the freestyle
   * twin of `useRaceRecorder.moveTime`. PUTs the body it was saved with under
   * the new `athleteId` (a sort-key field, so the server rewrites the SK
   * transactionally: one row moves, none is created), then re-locks the panel
   * on the moved value and re-derives the Match winner — which now follows the
   * athlete the row is filed under. No-op unless the slot holds a row bound to
   * someone else, and never reached from the peer path: `applySelection` only
   * changes assignments, so a write still binds to a local press (ADR 0038).
   */
  const moveScore = (slot: AthleteSlot): void => {
    const record = records[slot];
    const athleteId = athletes[slot];
    if (!record || !isScoreBoundElsewhere(record, athleteId) || movingSlot === slot) return;
    const input = moveScoreInput(record.input, athleteId);
    setMovingSlot(slot);
    // mutateAsync for the same reason `save` uses it: one observer serves both
    // slots, so a mutate-level callback would report only the later move.
    updateScore.mutateAsync({ id: record.scoreId, input }).then(
      (score) => {
        setMovingSlot(null);
        dispatch({
          type: 'MOVED',
          player: slot,
          record: {
            scoreId: score.scoreId,
            input,
            result: { overall: score.overall ?? record.result.overall, dnf: score.dnf ?? false },
          },
        });
        setToast({ text: `Athlete ${slot} score moved`, severity: 'success' });
      },
      () => {
        setMovingSlot(null);
        // The row is untouched and still bound elsewhere, so the offer — and
        // the retry — stand.
        setToast({ text: `Athlete ${slot} score not moved`, severity: 'error' });
      },
    );
  };

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
    athletes,
    setAthlete,
    canSwapAthletes,
    swapAthletes,
    // The two entry panels — inputs, save state and recorded result in one union.
    entries,
    // …and the Score each slot has on the server, which outlives its panel.
    records,
    setField,
    setOverride,
    recordScore,
    recordDnf,
    moveScore,
    movingSlot,
    toast,
    clearToast,
    // Match-driven recording surface (mirrors useRaceRecorder). Gender changes
    // go through `requestGender`; only the peer path sets it directly.
    applySelection,
    selectedGender,
    selectedMatchId,
    selectMatch,
    matches,
    scores,
    updateMatch,
    retryMatchUpdate,
    derivedWinner,
  };
};

export type ScoreRecorder = ReturnType<typeof useScoreRecorder>;

/**
 * The two halves of the recorder its panels actually use. The board's step 3
 * (`FreestyleSelectionPanel`) picks WHO/WHAT is being judged; step 5/6
 * (`FreestyleScoreControls`) enters the judged numbers — so neither takes the
 * recorder whole, and what each panel can reach is what it declares. The
 * recorder itself stays the single owner (a `ScoreRecorder` satisfies both).
 */
export type ScoreSelection = Pick<
  ScoreRecorder,
  | 'round'
  | 'requestRound'
  | 'requestGender'
  | 'pendingChange'
  | 'confirmPendingChange'
  | 'cancelPendingChange'
  | 'roundMatches'
  | 'athletes'
  | 'setAthlete'
  | 'canSwapAthletes'
  | 'swapAthletes'
  | 'selectedGender'
  | 'selectedMatchId'
  | 'selectMatch'
  | 'matches'
>;

export type ScoreEntry = Pick<
  ScoreRecorder,
  | 'round'
  | 'athletes'
  | 'entries'
  | 'records'
  | 'setField'
  | 'setOverride'
  | 'recordScore'
  | 'recordDnf'
  | 'moveScore'
  | 'movingSlot'
  | 'selectedMatchId'
  | 'updateMatch'
  | 'retryMatchUpdate'
  | 'derivedWinner'
>;
