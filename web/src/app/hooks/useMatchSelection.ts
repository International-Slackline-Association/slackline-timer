import { useRef, useState } from 'react';

import { useMatches } from 'app/api/matches';
import type { Discipline, Gender, Match, TimeRound } from 'app/types';

/** The two operator slots (speed lanes / freestyle players). */
export type SlotId = 1 | 2;

/**
 * Mode wiring for `useMatchSelection`. The cascade callbacks are how each
 * recorder hangs its per-mode state (series tally, entry panels, FS counters)
 * off the shared selection transitions — the selection hook never knows what
 * they reset. All are invoked from event handlers, so they may close over
 * state declared after the hook call.
 */
export interface MatchSelectionConfig<R extends TimeRound> {
  /** Which bracket's matches feed the dropdown (both modes share one relay room). */
  discipline: Discipline;
  initialRound: R;
  /**
   * Reset the mode's per-match state (series tally / result accumulator) —
   * fired on every selection-context change (selectMatch and clearMatch).
   */
  onSelectionReset?: () => void;
  /** Fired after a selected match filled the slots (e.g. fresh entry panels). */
  onMatchFilled?: () => void;
  /** Fired after clearMatch emptied the slots (e.g. drop the per-run results). */
  onMatchCleared?: () => void;
  /** Fired after a gender switch emptied the slots (e.g. clear the FS counters). */
  onGenderApplied?: () => void;
}

/**
 * The round/gender/match/athlete selection machinery shared by the two judge
 * consoles (`useRaceRecorder` / `useScoreRecorder`), parameterized on the round
 * vocabulary — speed records into `TimeRound`, freestyle into `MatchRound`.
 * Owns the cascading filters (round scopes the match list, gender the athlete
 * pool), the confirm-guarded round/gender changes (ADR 0033), the two athlete
 * slots, and the per-selection seed guard; all recording/POST logic stays in
 * each recorder, wired in through the config callbacks.
 */
export const useMatchSelection = <R extends TimeRound>(
  compId: string,
  {
    discipline,
    initialRound,
    onSelectionReset,
    onMatchFilled,
    onMatchCleared,
    onGenderApplied,
  }: MatchSelectionConfig<R>,
) => {
  const [round, setRound] = useState<R>(initialRound);
  const [athletes, setAthletes] = useState<Record<SlotId, string>>({ 1: '', 2: '' });
  const [selectedGender, setSelectedGender] = useState<Gender>('male');
  const [selectedMatchId, setSelectedMatchId] = useState<string>('');
  const matches = useMatches(compId, selectedGender, { discipline });

  // Only the current round's matches feed the dropdown (ADR 0033): round is the
  // single source of the match list, so a match selection can never disagree
  // with the round (the useMatches fetch is gender+discipline only).
  const roundMatches = (matches.data ?? []).filter((m) => m.round === round);

  // A round/gender change requested while a match is selected — held pending a
  // confirm (either would orphan the selection: the match list is scoped by
  // both). One discriminated pending change, not two — a round-pending and a
  // gender-pending state can never coexist. null = no pending change.
  const [pendingChange, setPendingChange] = useState<
    { kind: 'round'; round: R } | { kind: 'gender'; gender: Gender } | null
  >(null);

  // The match whose persisted records have already seeded the mode's state.
  // Owned here so the selection transitions reset it; the speed recorder's seed
  // effect consumes it to fill once per selection and never re-seed over live
  // increments (a live write invalidates the query and would otherwise re-run).
  // Freestyle seeds per (round, athlete) instead — a Score is keyed on that, and
  // qualification has no match to hang a per-selection guard on.
  const seededMatchId = useRef<string | null>(null);

  const findMatch = (matchId: string): Match | undefined =>
    matches.data?.find((m) => m.matchId === matchId);

  /**
   * Select a match and auto-fill the slots from it: slot 1 ← athlete1, slot 2 ←
   * athlete2, round ← match.round (athlete1 = slot 1, the orientation both
   * winner derivations assume). The selects stay editable afterwards (an
   * off-bracket run/entry is still possible). Selecting "— no match —" clears
   * the link but leaves the slots as-is so a manual run isn't disrupted.
   */
  const selectMatch = (matchId: string): void => {
    setSelectedMatchId(matchId);
    // A different match (or clearing the link) is a NEW per-match context; drop
    // the seed guard so the recorder's effect re-reads the persisted records.
    seededMatchId.current = null;
    onSelectionReset?.();
    if (!matchId) return;
    const match = findMatch(matchId);
    if (!match) return;
    setAthletes({ 1: match.athlete1Id ?? '', 2: match.athlete2Id ?? '' });
    // Safe: every Match.round is in both instantiations of R (MatchRound ⊆ TimeRound).
    setRound(match.round as R);
    onMatchFilled?.();
  };

  /**
   * Clear the match link and everything `selectMatch` cascaded from it — the
   * slot athletes plus the mode's per-match state (via the callbacks). The
   * confirmed round/gender-change path reuses this to drop a selection the new
   * scope would orphan.
   */
  const clearMatch = (): void => {
    setSelectedMatchId('');
    seededMatchId.current = null;
    onSelectionReset?.();
    setAthletes({ 1: '', 2: '' });
    onMatchCleared?.();
  };

  /**
   * Change the recording round behind a confirm (ADR 0033). The dropdown only
   * lists the current round's matches, so changing the round while a match is
   * selected would orphan it: defer to `pendingChange` and let the control page
   * confirm. With no match selected the round changes immediately.
   */
  const requestRound = (next: R): void => {
    if (selectedMatchId && next !== round) setPendingChange({ kind: 'round', round: next });
    else setRound(next);
  };

  // Apply a gender switch: the athlete pickers narrow to the new gender, so the
  // slot picks (made from the other gender's now-hidden list) clear with it.
  const applyGender = (next: Gender): void => {
    setSelectedGender(next);
    setAthletes({ 1: '', 2: '' });
    onGenderApplied?.();
  };

  /**
   * Change the selection gender behind the same confirm as the round (the match
   * list is gender-scoped, so an unguarded switch would silently strand the
   * selected match). With no match selected it applies immediately.
   */
  const requestGender = (next: Gender): void => {
    if (next === selectedGender) return;
    if (selectedMatchId) setPendingChange({ kind: 'gender', gender: next });
    else applyGender(next);
  };

  /** Confirm YES: apply the pending change and clear the orphaned match. */
  const confirmPendingChange = (): void => {
    if (pendingChange === null) return;
    if (pendingChange.kind === 'round') setRound(pendingChange.round);
    else applyGender(pendingChange.gender);
    clearMatch();
    setPendingChange(null);
  };

  /** Confirm NO: drop the pending change — the select reverts to current state. */
  const cancelPendingChange = (): void => setPendingChange(null);

  return {
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
    seededMatchId,
    selectMatch,
    clearMatch,
    requestRound,
    requestGender,
    pendingChange,
    confirmPendingChange,
    cancelPendingChange,
  };
};
