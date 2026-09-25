/**
 * Which numbered step of the Freestyle chronology the board is on
 * (FREESTYLE_BOARD_UX §2 / the desk): the desk never folds a section, so the
 * only cue that a first-time operator is looking at the right one is emphasis —
 * the current step's caption at full ink, the rest at `ink.mid`.
 *
 * Derived, like every other board surface, from what the reducers already know:
 * `boardHold` answers "what is the board holding", and the step is that answer
 * read as chronology. Nothing here is state.
 */

import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import { boardHold, type Board } from 'app/util/boardState';

export type BoardStep = 'setup' | 'warmup' | 'selection' | 'run' | 'bestTrick' | 'score';

/**
 * The steps the board can actually BE on. Setup is a real section (it captions
 * `1 · Setup` and reserves its gutter) but nothing about the board's state says
 * "the operator is configuring": the walk below has no arm that returns it, so
 * a consumer switching on the current step must not carry a `'setup'` case.
 */
export type CurrentStep = Exclude<BoardStep, 'setup'>;

/** The board, plus the one thing chronology needs that the holds do not carry:
 * whether anyone is being recorded yet (an empty selection is step 3). */
export interface StepBoard extends Board {
  hasAthlete: boolean;
}

/** The lanes a mode records — quali runs one athlete at a time (ADR 0036). */
const recordedLanes = (mode: FreestyleMode): readonly (1 | 2)[] =>
  mode === 'quali' ? [1] : [1, 2];

const matchOver = (board: StepBoard): boolean =>
  recordedLanes(board.mode).every((lane) => board.battle[lane].phase === 'finished');

export const currentStep = (board: StepBoard): CurrentStep => {
  const hold = boardHold(board);
  switch (hold?.kind) {
    case 'warmup':
      return 'warmup';
    case 'tryOpen':
    case 'bestTrick':
      return 'bestTrick';
    case 'running':
    case 'onBreak':
    case 'changeover':
    case 'held':
      return 'run';
    // The first spent lane ends the match only once every recorded lane is:
    // in a battle Athlete 2 still has a turn to take.
    case 'spent':
      return matchOver(board) ? 'score' : 'run';
    case undefined:
      return board.hasAthlete ? 'run' : 'selection';
  }
};

const STEP_NAME: Record<BoardStep, string> = {
  setup: 'Setup',
  warmup: 'Warm-up',
  selection: 'Selection',
  run: 'Run',
  bestTrick: 'Best trick',
  score: 'Score entry',
};

/** The step's name on its own — the desk section's accessible name, which stays
 * put while the number under it moves with the mode. */
export const stepName = (step: BoardStep): string => STEP_NAME[step];

/** The caption over a desk section: `4 · Run`. Quali has no best-trick step, so
 * Score renumbers to 5 there — the manual says so, and the board must agree. */
export const stepCaption = (step: BoardStep, mode: FreestyleMode): string => {
  const number: Record<BoardStep, number> = {
    setup: 1,
    warmup: 2,
    selection: 3,
    run: 4,
    bestTrick: 5,
    score: mode === 'battle' ? 6 : 5,
  };
  return `${number[step]} · ${stepName(step)}`;
};
