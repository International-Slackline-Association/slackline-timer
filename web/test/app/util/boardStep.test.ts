import { describe, expect, it } from 'vitest';

import { initialBattleState, type BattleState, type LaneState } from 'app/util/battleMachine';
import { initialTrySeries } from 'app/util/bestTrickSeries';
import { currentStep, isSelectionComplete, stepCaption, type StepBoard } from 'app/util/boardStep';

const BUDGET = 150_000;
const BREAKS = 2;

const running: LaneState = {
  phase: 'running',
  startedAt: 0,
  budgetMs: BUDGET,
  armedMs: BUDGET,
  breaksLeft: BREAKS,
};
const finished: LaneState = { phase: 'finished', armedMs: BUDGET, breaksLeft: BREAKS };
/** Idle below its armed budget: a fall ended the turn with time left on it. */
const held: LaneState = {
  phase: 'idle',
  budgetMs: 80_000,
  armedMs: BUDGET,
  breaksLeft: BREAKS,
};

const battleWith = (lanes: Partial<Record<1 | 2, LaneState>>): BattleState => ({
  ...initialBattleState(BUDGET, BREAKS),
  ...lanes,
});

const board = (over: Partial<StepBoard> = {}): StepBoard => ({
  mode: 'battle',
  battle: initialBattleState(BUDGET, BREAKS),
  trySeries: null,
  warmupRunning: false,
  selectionComplete: true,
  recordedDone: false,
  ...over,
});

describe('currentStep', () => {
  it('opens on Selection until every recorded slot has an athlete', () => {
    expect(currentStep(board({ selectionComplete: false }))).toBe('selection');
  });

  it('moves to Run once the board is armed and the selection is complete', () => {
    expect(currentStep(board())).toBe('run');
  });

  // Every live lane hold belongs to step 4, whichever lane owns it.
  it.each([
    ['a running lane', battleWith({ 1: running })],
    ['a lane holding time after a fall', battleWith({ 1: held })],
    ['one lane spent, one still to go', battleWith({ 1: finished })],
  ])('stays on Run with %s', (_case, battle) => {
    expect(currentStep(board({ battle }))).toBe('run');
  });

  it('follows the warm-up while it ticks — it is step 2, not the run', () => {
    expect(currentStep(board({ warmupRunning: true }))).toBe('warmup');
  });

  it('moves to Best trick while a series exists, armed or open', () => {
    const spent = battleWith({ 1: finished, 2: finished });
    expect(currentStep(board({ battle: spent, trySeries: initialTrySeries(3) }))).toBe('bestTrick');
  });

  it('lands on Score once every lane the mode records is spent', () => {
    expect(currentStep(board({ battle: battleWith({ 1: finished, 2: finished }) }))).toBe('score');
    // Quali records one athlete at a time, so lane 1 alone ends the match.
    expect(currentStep(board({ mode: 'quali', battle: battleWith({ 1: finished }) }))).toBe(
      'score',
    );
  });

  // The loop between two athletes: Save, then the rail's Reset re-arms the
  // clocks under a board whose every recorded slot is saved. What is left to do
  // is pick the next athlete, so the board hands back to Selection.
  describe('once every recorded slot is saved', () => {
    it.each(['battle', 'quali'] as const)('returns to Selection on a re-armed %s board', (mode) => {
      expect(currentStep(board({ mode, recordedDone: true }))).toBe('selection');
    });

    it.each(['battle', 'quali'] as const)('stays on Run in %s while a save is owed', (mode) => {
      expect(currentStep(board({ mode, recordedDone: false }))).toBe('run');
    });

    it('stays on Score until the clocks are re-armed', () => {
      const spent = battleWith({ 1: finished, 2: finished });
      expect(currentStep(board({ battle: spent, recordedDone: true }))).toBe('score');
      expect(
        currentStep(
          board({ mode: 'quali', battle: battleWith({ 1: finished }), recordedDone: true }),
        ),
      ).toBe('score');
    });

    it('lets a lane still holding time outrank the save', () => {
      expect(
        currentStep(board({ mode: 'quali', battle: battleWith({ 1: held }), recordedDone: true })),
      ).toBe('run');
    });
  });

  it('reads the selection as unfinished business only while the board is pristine', () => {
    // A run under way outranks a missing athlete: the operator is not picking.
    expect(
      currentStep(board({ selectionComplete: false, battle: battleWith({ 1: running }) })),
    ).toBe('run');
  });
});

// A battle records both athletes, so one pick is half a selection: stepping to
// Run on it would leave the picker before Athlete 2 is named.
describe('isSelectionComplete', () => {
  const step = (mode: 'battle' | 'quali', athletes: Record<1 | 2, string>) =>
    currentStep(board({ mode, selectionComplete: isSelectionComplete(mode, athletes) }));

  it('holds a battle on Selection with only Athlete 1 picked', () => {
    expect(step('battle', { 1: 'a1', 2: '' })).toBe('selection');
    expect(step('battle', { 1: '', 2: 'a2' })).toBe('selection');
  });

  it('steps a battle to Run once both athletes are picked', () => {
    expect(step('battle', { 1: 'a1', 2: 'a2' })).toBe('run');
  });

  it('steps quali to Run on its one recorded athlete', () => {
    expect(step('quali', { 1: 'a1', 2: '' })).toBe('run');
    expect(step('quali', { 1: '', 2: '' })).toBe('selection');
  });
});

describe('stepCaption', () => {
  it('numbers the battle chronology 1 to 6', () => {
    expect(stepCaption('setup', 'battle')).toBe('1 · Setup');
    expect(stepCaption('warmup', 'battle')).toBe('2 · Warm-up');
    expect(stepCaption('selection', 'battle')).toBe('3 · Selection');
    expect(stepCaption('run', 'battle')).toBe('4 · Run');
    expect(stepCaption('bestTrick', 'battle')).toBe('5 · Best trick');
    expect(stepCaption('score', 'battle')).toBe('6 · Score entry');
  });

  it('renumbers Score to 5 in quali — there is no best-trick step', () => {
    expect(stepCaption('score', 'quali')).toBe('5 · Score entry');
  });
});
