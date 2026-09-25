import { describe, expect, it } from 'vitest';

import { initialBattleState, type BattleState, type LaneState } from 'app/util/battleMachine';
import { initialTrySeries } from 'app/util/bestTrickSeries';
import { currentStep, stepCaption, type StepBoard } from 'app/util/boardStep';

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
  hasAthlete: true,
  ...over,
});

describe('currentStep', () => {
  it('opens on Selection until a player has an athlete', () => {
    expect(currentStep(board({ hasAthlete: false }))).toBe('selection');
  });

  it('moves to Run once the board is armed and someone is recording', () => {
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

  it('reads the selection as unfinished business only while the board is pristine', () => {
    // A run under way outranks a missing athlete: the operator is not picking.
    expect(currentStep(board({ hasAthlete: false, battle: battleWith({ 1: running }) }))).toBe(
      'run',
    );
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
