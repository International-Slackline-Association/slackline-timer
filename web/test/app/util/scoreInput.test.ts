import { describe, expect, it } from 'vitest';

import type { Match, Score } from 'app/types';
import {
  deriveFreestyleMatchWinner,
  dnfScoreInput,
  entryDraft,
  initialScoreEntries,
  isEntryOpen,
  matchResultsOf,
  overallMax,
  overrideDraft,
  overrideValue,
  moveScoreInput,
  resolveMatchWinner,
  restoreSlotFromScores,
  scoreEntryErrors,
  scoreEntryReducer,
  scoreInput,
  winnerAwaiting,
  type EntryDraft,
  type SavedScore,
  type SlotEntry,
  type SlotResult,
  type ScoreEntryAction,
  type ScoreEntryStore,
  type ScoreFields,
  type ScoreResult,
} from 'app/util/scoreInput';

const ZERO_FIELDS: ScoreFields = {
  difficulty: 0,
  combo: 0,
  style: 0,
  bestTrick: 0,
  controlPenalty: 0,
};

const FIELDS: ScoreFields = {
  difficulty: 5,
  combo: 4,
  style: 3,
  bestTrick: 2,
  controlPenalty: 1,
};

describe('scoreInput', () => {
  it('builds a Score with the components and no overall (server computes it)', () => {
    expect(scoreInput('a1', 'final', FIELDS, null)).toEqual({
      athleteId: 'a1',
      round: 'final',
      ...FIELDS,
    });
  });

  it('carries an explicit overall override through', () => {
    expect(scoreInput('a1', 'final', FIELDS, 99)).toEqual({
      athleteId: 'a1',
      round: 'final',
      ...FIELDS,
      overall: 99,
    });
  });

  it('records nothing when no athlete is assigned', () => {
    expect(scoreInput('', 'final', FIELDS, null)).toBeNull();
  });

  it('carries a matchId when given and omits it otherwise', () => {
    expect(scoreInput('a1', 'final', FIELDS, null, 'm1')).toHaveProperty('matchId', 'm1');
    const noMatch = scoreInput('a1', 'final', FIELDS, null);
    expect(noMatch && 'matchId' in noMatch).toBe(false);
  });

  it('zeroes best trick + control penalty at qualification (rule F8: battles only)', () => {
    expect(scoreInput('a1', 'qualification', FIELDS, null)).toMatchObject({
      difficulty: 5,
      combo: 4,
      style: 3,
      bestTrick: 0,
      controlPenalty: 0,
    });
  });

  it('leaves best trick + control penalty untouched at battle rounds', () => {
    expect(scoreInput('a1', 'final', FIELDS, null)).toMatchObject({
      bestTrick: 2,
      controlPenalty: 1,
    });
  });
});

describe('scoreEntryErrors', () => {
  it('flags each component over its per-component maximum (rule F8)', () => {
    const errors = scoreEntryErrors(
      'final',
      { difficulty: 41, combo: 31, style: 31, bestTrick: 21, controlPenalty: 999 },
      null,
    );
    expect(errors).toEqual({
      difficulty: 'Max 40',
      combo: 'Max 30',
      style: 'Max 30',
      bestTrick: 'Max 20',
    });
  });

  it('returns no errors for in-range components, treating the maxima as inclusive', () => {
    expect(
      scoreEntryErrors(
        'final',
        { difficulty: 40, combo: 30, style: 30, bestTrick: 20, controlPenalty: 0 },
        null,
      ),
    ).toEqual({});
  });

  it('ignores the battle-only components at qualification, which are stored as 0', () => {
    expect(
      scoreEntryErrors(
        'qualification',
        { difficulty: 1, combo: 1, style: 1, bestTrick: 21, controlPenalty: 999 },
        null,
      ),
    ).toEqual({});
  });

  it('flags an override above the round bound', () => {
    expect(scoreEntryErrors('final', ZERO_FIELDS, '400')).toEqual({ overall: 'Max 120' });
    expect(scoreEntryErrors('qualification', ZERO_FIELDS, '120')).toEqual({ overall: 'Max 100' });
  });

  it('flags a half-typed override rather than saving it as 0', () => {
    expect(scoreEntryErrors('final', ZERO_FIELDS, '-')).toEqual({ overall: 'Enter a number' });
    expect(scoreEntryErrors('final', ZERO_FIELDS, '1e')).toEqual({ overall: 'Enter a number' });
  });

  it('leaves a negative override alone — the control penalty is uncapped', () => {
    expect(scoreEntryErrors('final', ZERO_FIELDS, '-12')).toEqual({});
    expect(scoreEntryErrors('final', ZERO_FIELDS, '120')).toEqual({});
  });
});

describe('overallMax', () => {
  it('sums the maxima of the components that apply in the round', () => {
    expect(overallMax('final')).toBe(120);
    expect(overallMax('qualification')).toBe(100);
  });
});

describe('the Overall override draft', () => {
  it('clears the override for an emptied field, back to the computed value', () => {
    expect(overrideDraft('')).toBeNull();
    expect(overrideDraft('   ')).toBeNull();
  });

  it('keeps a half-typed value verbatim, so the minus survives its keystroke', () => {
    expect(overrideDraft('-')).toBe('-');
    expect(overrideDraft(' -4. ')).toBe('-4.');
  });

  it('is worth NaN while half-typed, and the number once it is one', () => {
    expect(overrideValue(null)).toBeNull();
    expect(overrideValue('-')).toBeNaN();
    expect(overrideValue('-4.5')).toBe(-4.5);
  });
});

describe('dnfScoreInput', () => {
  it('builds an all-zero Score flagged dnf for an assigned athlete', () => {
    expect(dnfScoreInput('a1', 'final')).toEqual({
      athleteId: 'a1',
      round: 'final',
      difficulty: 0,
      combo: 0,
      style: 0,
      bestTrick: 0,
      controlPenalty: 0,
      dnf: true,
    });
  });

  it('records nothing when no athlete is assigned', () => {
    expect(dnfScoreInput('', 'final')).toBeNull();
  });

  it('carries a matchId when given', () => {
    expect(dnfScoreInput('a1', 'final', 'm1')).toHaveProperty('matchId', 'm1');
  });
});

describe('restoreSlotFromScores', () => {
  const score = (over: Partial<Score> = {}): Score => ({
    scoreId: 's1',
    compId: 'c1',
    athleteId: 'a1',
    round: 'final',
    difficulty: 5,
    combo: 4,
    style: 3,
    bestTrick: 2,
    controlPenalty: 1,
    overall: 13,
    ...over,
  });

  it('unpacks the matching score (round + athlete identity)', () => {
    expect(restoreSlotFromScores('a1', 'final', [score()])).toEqual({
      draft: {
        fields: { difficulty: 5, combo: 4, style: 3, bestTrick: 2, controlPenalty: 1 },
        override: null,
      },
      record: {
        scoreId: 's1',
        input: {
          athleteId: 'a1',
          round: 'final',
          difficulty: 5,
          combo: 4,
          style: 3,
          bestTrick: 2,
          controlPenalty: 1,
        },
        result: { overall: 13, dnf: false },
      },
    });
  });

  it('carries a hand-set overall as an override, and the match link, into the record', () => {
    // The body a re-attribution PUT re-sends must reproduce the stored row
    // exactly — a manual overall and the match provenance included.
    expect(restoreSlotFromScores('a1', 'final', [score({ overall: 40, matchId: 'm1' })])).toEqual({
      draft: {
        fields: { difficulty: 5, combo: 4, style: 3, bestTrick: 2, controlPenalty: 1 },
        override: '40',
      },
      record: {
        scoreId: 's1',
        input: {
          athleteId: 'a1',
          round: 'final',
          difficulty: 5,
          combo: 4,
          style: 3,
          bestTrick: 2,
          controlPenalty: 1,
          overall: 40,
          matchId: 'm1',
        },
        result: { overall: 40, dnf: false },
      },
    });
  });

  it('keeps a restored DNF a DNF', () => {
    const restored = restoreSlotFromScores('a1', 'final', [
      score({
        difficulty: 0,
        combo: 0,
        style: 0,
        bestTrick: 0,
        controlPenalty: 0,
        overall: 0,
        dnf: true,
      }),
    ]);

    expect(restored?.record.input).toMatchObject({ dnf: true });
    expect(restored?.record.result).toEqual({ overall: 0, dnf: true });
  });

  it('returns null for an unassigned slot or no saved score', () => {
    expect(restoreSlotFromScores(undefined, 'final', [score()])).toBeNull();
    expect(restoreSlotFromScores('a1', 'quarter', [score()])).toBeNull();
  });

  it('coerces a legacy/partial record with missing numerics to 0 (no undefined leaks)', () => {
    // A record persisted before a field existed carries `undefined` where the
    // type says `number`; left raw it crashes `formatScore(fb.overall)` on the
    // console and produces a NaN winner. The seed must be all-numeric.
    const legacy = score({
      bestTrick: undefined,
      controlPenalty: undefined,
      overall: undefined,
    } as Partial<Score>);
    expect(restoreSlotFromScores('a1', 'final', [legacy])?.draft).toEqual({
      fields: { difficulty: 5, combo: 4, style: 3, bestTrick: 0, controlPenalty: 0 },
      override: '0',
    });
  });
});

describe('moveScoreInput', () => {
  it('re-sends the same body under the new athlete', () => {
    const input = scoreInput('a1', 'final', FIELDS, null, 'm1');

    expect(moveScoreInput(input as NonNullable<typeof input>, 'a2')).toEqual({
      ...input,
      athleteId: 'a2',
    });
  });
});

describe('deriveFreestyleMatchWinner', () => {
  const baseMatch: Match = {
    matchId: 'm1',
    compId: 'c1',
    discipline: 'freestyle',
    round: 'final',
    roundName: 'Final',
    gender: 'male',
    position: 1,
    athlete1Id: 'a1',
    athlete2Id: 'a2',
  };
  const slotAthletes = { 1: 'a1', 2: 'a2' } as const;
  const r = (overall: number, dnf = false): SlotResult => ({ overall, dnf });

  it('returns the higher-overall athlete as winner (and the immutable SK fields)', () => {
    const result = deriveFreestyleMatchWinner(baseMatch, slotAthletes, { 1: r(28), 2: r(24) });
    expect(result).toHaveProperty('winnerId', 'a1');
    expect(result).toMatchObject({
      discipline: 'freestyle',
      round: 'final',
      gender: 'male',
      position: 1,
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    });
  });

  it('lets athlete 2 win when athlete 2 scores higher', () => {
    expect(
      deriveFreestyleMatchWinner(baseMatch, slotAthletes, { 1: r(20), 2: r(31) }),
    ).toHaveProperty('winnerId', 'a2');
  });

  it('takes the winner from slotAthletes, not the athlete slot', () => {
    expect(
      deriveFreestyleMatchWinner(baseMatch, { 1: 'zoe', 2: 'max' }, { 1: r(30), 2: r(10) }),
    ).toHaveProperty('winnerId', 'zoe');
  });

  it('returns null until both athlete slots have a result', () => {
    expect(deriveFreestyleMatchWinner(baseMatch, slotAthletes, { 1: r(28), 2: null })).toBeNull();
    expect(deriveFreestyleMatchWinner(baseMatch, slotAthletes, { 1: null, 2: r(28) })).toBeNull();
    expect(deriveFreestyleMatchWinner(baseMatch, slotAthletes, { 1: null, 2: null })).toBeNull();
  });

  it('lets the scoring player win when the other DNFs', () => {
    expect(
      deriveFreestyleMatchWinner(baseMatch, slotAthletes, { 1: r(0, true), 2: r(5) }),
    ).toHaveProperty('winnerId', 'a2');
    expect(
      deriveFreestyleMatchWinner(baseMatch, slotAthletes, { 1: r(5), 2: r(0, true) }),
    ).toHaveProperty('winnerId', 'a1');
  });

  it('clears the winner when both athletes DNF', () => {
    const result = deriveFreestyleMatchWinner(baseMatch, slotAthletes, {
      1: r(0, true),
      2: r(0, true),
    });
    expect(result && 'winnerId' in result).toBe(false);
  });

  it('clears the winner on an exact overall tie', () => {
    const result = deriveFreestyleMatchWinner(baseMatch, slotAthletes, {
      1: r(27.5),
      2: r(27.5),
    });
    expect(result && 'winnerId' in result).toBe(false);
  });

  it('clears the winner on a float-noise tie (equal sums, different component mixes)', () => {
    // 8.1+7.2+6.3+5.4−0.3 and a differently-mixed sum both equal 26.7 but leak
    // ~1e-14 apart from raw addition; normalized comparison (ADR 0039) sees a tie.
    const result = deriveFreestyleMatchWinner(baseMatch, slotAthletes, {
      1: r(8.1 + 7.2 + 6.3 + 5.4 - 0.3),
      2: r(9.1 + 6.2 + 6.3 + 5.4 - 0.3),
    });
    expect(result && 'winnerId' in result).toBe(false);
  });

  it('clears a previously-set winnerId when the latest result is a tie', () => {
    const result = deriveFreestyleMatchWinner({ ...baseMatch, winnerId: 'a1' }, slotAthletes, {
      1: r(27.5),
      2: r(27.5),
    });
    expect(result && 'winnerId' in result).toBe(false);
  });

  it('returns null when the winning athlete has no athlete assigned (ambiguous)', () => {
    expect(
      deriveFreestyleMatchWinner(baseMatch, { 1: '', 2: 'a2' }, { 1: r(30), 2: r(10) }),
    ).toBeNull();
  });
});

describe('the per-athlete-slot entry machine', () => {
  const EMPTY: ScoreFields = {
    difficulty: 0,
    combo: 0,
    style: 0,
    bestTrick: 0,
    controlPenalty: 0,
  };
  const RESULT: ScoreResult = { overall: 26, dnf: false };
  const P = 1 as const;

  /** What a landed POST leaves on the slot: the row's id, the body it was
   * written with, and the value it recorded. */
  const record = (athleteId: string, difficulty = 26): SavedScore => ({
    scoreId: 's1',
    input: { athleteId, round: 'final', ...EMPTY, difficulty },
    result: RESULT,
  });

  const edit = (value: number): ScoreEntryAction => ({
    type: 'EDIT_FIELD',
    player: P,
    field: 'difficulty',
    value,
  });
  const SUBMIT: ScoreEntryAction = { type: 'SUBMIT', player: P, result: RESULT };
  const SAVED: ScoreEntryAction = { type: 'SAVED', player: P, record: record('a1') };

  /** Replay a run of actions from a fresh store. */
  const run = (...actions: ScoreEntryAction[]): ScoreEntryStore =>
    actions.reduce(scoreEntryReducer, initialScoreEntries());

  it('opens the panel on the first keystroke, leaving the other one empty', () => {
    const store = run(edit(8));

    expect(store.entries[1]).toEqual({
      status: 'editing',
      fields: { ...EMPTY, difficulty: 8 },
      override: null,
    });
    expect(store.entries[2]).toEqual({ status: 'empty' });
  });

  it('locks on the save reply and queues the match resolution', () => {
    const store = run(edit(8), SUBMIT, SAVED);

    expect(store.entries[1]).toMatchObject({ status: 'saved', result: RESULT, origin: 'live' });
    expect(store.effects).toEqual([{ kind: 'resolve_match' }]);
    expect(scoreEntryReducer(store, { type: 'DRAIN' }).effects).toEqual([]);
  });

  it('refuses edits and a second save while one is in flight or landed', () => {
    // The illegal combinations the union exists to rule out: an override typed
    // into a POST already on the wire, and a re-save over a recorded row.
    const pending = run(edit(8), SUBMIT);
    expect(scoreEntryReducer(pending, edit(9))).toBe(pending);
    expect(scoreEntryReducer(pending, { type: 'EDIT_OVERRIDE', player: P, value: '40' })).toBe(
      pending,
    );
    expect(scoreEntryReducer(pending, SUBMIT)).toBe(pending);

    const saved = scoreEntryReducer(pending, SAVED);
    expect(scoreEntryReducer(saved, edit(9))).toBe(saved);
    expect(scoreEntryReducer(saved, SUBMIT)).toBe(saved);
  });

  it('keeps the draft and the reason on a failed save, editable for a retry', () => {
    const failed = run(
      edit(8),
      { type: 'EDIT_OVERRIDE', player: P, value: '30' },
      { type: 'SUBMIT', player: P, result: { overall: 30, dnf: false } },
      { type: 'FAILED', player: P, reason: 'boom' },
    );

    expect(failed.entries[1]).toEqual({
      status: 'error',
      fields: { ...EMPTY, difficulty: 8 },
      override: '30',
      result: { overall: 30, dnf: false },
      reason: 'boom',
    });
    expect(isEntryOpen(failed.entries[1])).toBe(true);
    expect(scoreEntryReducer(failed, edit(9)).entries[1].status).toBe('editing');
  });

  it('ignores a reply for a panel that moved on mid-flight', () => {
    // The athlete changed while the POST was on the wire: locking the fresh
    // entry would attribute one athlete's score to another.
    const cleared = run(edit(8), SUBMIT, { type: 'CLEAR', player: P });

    expect(scoreEntryReducer(cleared, SAVED)).toBe(cleared);
    expect(scoreEntryReducer(cleared, { type: 'FAILED', player: P, reason: 'boom' })).toBe(cleared);
  });

  it('restores a persisted score locked, and queues no write for it', () => {
    const store = run({
      type: 'RESTORE',
      player: P,
      draft: { fields: { ...EMPTY, difficulty: 8 }, override: null },
      record: record('a1', 8),
    });

    expect(store.entries[1]).toMatchObject({ status: 'saved', origin: 'restored' });
    expect(store.records[1]).toEqual(record('a1', 8));
    expect(store.effects).toEqual([]);
  });

  it('keeps the persisted row on the slot when the panel clears for the next athlete', () => {
    // The whole re-attribution feature: the panel reopens for whoever is picked
    // next, but the row it wrote stays addressable — cleared with the entry, a
    // mis-filed score would have no handle left but the Scores page.
    const store = run(edit(26), SUBMIT, SAVED, { type: 'CLEAR', player: P });

    expect(store.entries[1]).toEqual({ status: 'empty' });
    expect(store.records[1]).toEqual(record('a1'));
  });

  it('re-locks the panel on the moved body and queues the match resolution', () => {
    const moved = run(
      edit(26),
      SUBMIT,
      SAVED,
      // The save's own resolution has been drained by the edge; this is the
      // second one, queued by the move.
      { type: 'DRAIN' },
      { type: 'CLEAR', player: P },
      { type: 'MOVED', player: P, record: record('a2') },
    );

    expect(moved.entries[1]).toEqual({
      status: 'saved',
      fields: { ...EMPTY, difficulty: 26 },
      override: null,
      result: RESULT,
      origin: 'live',
    });
    expect(moved.records[1]).toEqual(record('a2'));
    // The winner follows the athlete the row is now filed under.
    expect(moved.effects).toEqual([{ kind: 'resolve_match' }]);
  });

  it('moves nothing for a slot that never persisted a row', () => {
    const store = run(edit(8));

    expect(scoreEntryReducer(store, { type: 'MOVED', player: P, record: record('a2') })).toBe(
      store,
    );
  });

  it('swaps the two panels whole and clears them together', () => {
    const store = run(
      edit(8),
      { type: 'EDIT_FIELD', player: 2, field: 'combo', value: 3 },
      SUBMIT,
      SAVED,
    );

    const swapped = scoreEntryReducer(store, { type: 'SWAP' });
    expect(entryDraft(swapped.entries[2]).fields.difficulty).toBe(8);
    expect(entryDraft(swapped.entries[1]).fields.combo).toBe(3);
    // A Score is keyed by athlete, not by slot: the persisted row rides along
    // with the panel that wrote it.
    expect(swapped.records).toEqual({ 1: null, 2: record('a1') });

    const cleared = scoreEntryReducer(swapped, { type: 'CLEAR_BOTH' });
    expect(cleared.entries).toEqual({ 1: { status: 'empty' }, 2: { status: 'empty' } });
    expect(cleared.records).toEqual({ 1: null, 2: null });
  });

  it('counts only a persisted entry as a match result', () => {
    // The acceptance rule: no winner may be derived from a POST still in flight.
    const pending = run(edit(8), SUBMIT);
    expect(matchResultsOf(pending.entries)).toEqual({ 1: null, 2: null });

    expect(matchResultsOf(scoreEntryReducer(pending, SAVED).entries)).toEqual({
      1: RESULT,
      2: null,
    });
  });
});

describe('resolveMatchWinner', () => {
  const match: Match = {
    matchId: 'm1',
    compId: 'c1',
    discipline: 'freestyle',
    round: 'final',
    gender: 'male',
    position: 1,
    athlete1Id: 'a1',
    athlete2Id: 'a2',
  };
  const athletes = { 1: 'a1', 2: 'a2' } as const;
  const draft: EntryDraft = {
    fields: { difficulty: 0, combo: 0, style: 0, bestTrick: 0, controlPenalty: 0 },
    override: null,
  };
  const saved = (overall: number, origin: 'live' | 'restored'): SlotEntry => ({
    status: 'saved',
    ...draft,
    result: { overall, dnf: false },
    origin,
  });

  it('resolves nothing without a match, or before both scores persist', () => {
    expect(
      resolveMatchWinner(undefined, athletes, { 1: saved(28, 'live'), 2: saved(24, 'live') }),
    ).toBeNull();
    expect(
      resolveMatchWinner(match, athletes, { 1: saved(28, 'live'), 2: { status: 'empty' } }),
    ).toBeNull();
  });

  it('derives the winner from both persisted scores', () => {
    expect(
      resolveMatchWinner(match, athletes, { 1: saved(28, 'live'), 2: saved(24, 'live') }),
    ).toEqual({ winnerId: 'a1', source: 'derived' });
  });

  it('shows the stored winner of a restored match, not a re-derivation', () => {
    // A tie the operator resolved by hand on the Matches page: re-deriving it
    // here would clear their decision on screen.
    expect(
      resolveMatchWinner({ ...match, winnerId: 'a2' }, athletes, {
        1: saved(26, 'restored'),
        2: saved(26, 'restored'),
      }),
    ).toEqual({ winnerId: 'a2', source: 'persisted' });
  });

  it('prefers this board’s own save over a now-stale stored winner', () => {
    expect(
      resolveMatchWinner({ ...match, winnerId: 'a1' }, athletes, {
        1: saved(24, 'restored'),
        2: saved(28, 'live'),
      }),
    ).toEqual({ winnerId: 'a2', source: 'derived' });
  });

  it('falls back to the stored winner while an athlete is unscored', () => {
    expect(
      resolveMatchWinner({ ...match, winnerId: 'a1' }, athletes, {
        1: saved(28, 'restored'),
        2: { status: 'empty' },
      }),
    ).toEqual({ winnerId: 'a1', source: 'persisted' });
  });
});

describe('winnerAwaiting', () => {
  const draft: EntryDraft = {
    fields: { difficulty: 0, combo: 0, style: 0, bestTrick: 0, controlPenalty: 0 },
    override: null,
  };
  const saved: SlotEntry = {
    status: 'saved',
    ...draft,
    result: { overall: 26, dnf: false },
    origin: 'live',
  };
  const failed: SlotEntry = {
    status: 'error',
    ...draft,
    result: { overall: 26, dnf: false },
    reason: 'network',
  };

  it('names the one outstanding save', () => {
    expect(winnerAwaiting({ 1: saved, 2: failed })).toBe('waits for Athlete 2 save');
    expect(winnerAwaiting({ 1: { status: 'empty' }, 2: saved })).toBe('waits for Athlete 1 save');
  });

  it('asks for both while neither is persisted', () => {
    expect(winnerAwaiting({ 1: { status: 'empty' }, 2: { status: 'empty' } })).toBe(
      'waits for both saves',
    );
  });

  it('waits for nothing once both athlete slots are saved', () => {
    expect(winnerAwaiting({ 1: saved, 2: saved })).toBeNull();
  });
});
