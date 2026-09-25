import { describe, expect, it } from 'vitest';

import {
  boardHold,
  boardHoldsState,
  boardLive,
  holdReason,
  athleteHold,
  type Board,
  type BoardHold,
} from 'app/util/boardState';
import { initialBattleState, reduce, type BattleState } from 'app/util/battleMachine';
import {
  initialTrySeries,
  reduce as reduceTry,
  type TrySeriesState,
} from 'app/util/bestTrickSeries';

// The fixtures the reducer tables are pinned to (battleMachine.test.ts /
// bestTrickSeries.test.ts), so the predicates and the machines can never
// disagree about a board state.
const BUDGET = 120_000;
const BREAK = 30_000;

const fresh = (): BattleState => initialBattleState(BUDGET, 2);
const step = (state: BattleState, event: Parameters<typeof reduce>[1]) =>
  reduce(state, event).state;
const stepTry = (state: TrySeriesState, event: Parameters<typeof reduceTry>[1]) =>
  reduceTry(state, event).state;

const board = (over: Partial<Board> = {}): Board => ({
  mode: 'battle',
  battle: fresh(),
  trySeries: null,
  warmupRunning: false,
  ...over,
});

const running = (lane: 1 | 2 = 1): BattleState => step(fresh(), { type: 'START', lane, at: 0 });
/** A fall mid-turn: idle again, but below the budget it was armed to. */
const held = (lane: 1 | 2 = 1): BattleState =>
  step(running(lane), { type: 'STOP', lane, at: 20_000 });
const onBreak = (): BattleState =>
  step(running(1), { type: 'TAKE_BREAK', lane: 1, at: 10_000, breakMs: BREAK });
const spent = (): BattleState => step(running(1), { type: 'TIMEOUT', lane: 1, at: BUDGET });
const armedSeries = (): TrySeriesState => initialTrySeries(3);
const openTry = (): TrySeriesState => stepTry(armedSeries(), { type: 'START_TRY', side: 1, at: 0 });

const HOLD_CASES: [name: string, board: Board, hold: BoardHold | null][] = [
  ['an untouched board', board(), null],
  ['a running lane', board({ battle: running(1) }), { kind: 'running', lane: 1 }],
  [
    'an open quali break',
    board({ mode: 'quali', battle: onBreak() }),
    { kind: 'onBreak', lane: 1 },
  ],
  ['an open try', board({ trySeries: openTry() }), { kind: 'tryOpen' }],
  ['an armed series with no try', board({ trySeries: armedSeries() }), { kind: 'bestTrick' }],
  ['a running warm-up', board({ warmupRunning: true }), { kind: 'warmup' }],
  [
    'a lane held after a fall',
    board({ mode: 'quali', battle: held(1) }),
    { kind: 'held', lane: 1 },
  ],
  ['a spent lane', board({ mode: 'quali', battle: spent() }), { kind: 'spent', lane: 1 }],
];

describe('boardState — what the board is holding', () => {
  it.each(HOLD_CASES)('%s', (_name, input, expected) => {
    expect(boardHold(input)).toEqual(expected);
  });

  // The changeover pause is battle information only (ADR 0036): the reducer's
  // anchor is mode-free, so the predicate is what keeps a quali board from
  // reporting a changeover it never renders.
  it('reports the battle changeover, and only in battle', () => {
    const changeover = held(1);
    expect(changeover.pauseStartedAt).not.toBeNull();

    expect(boardHold(board({ battle: changeover }))).toEqual({ kind: 'changeover' });
    expect(boardHold(board({ mode: 'quali', battle: changeover }))).toEqual({
      kind: 'held',
      lane: 1,
    });
  });

  // Precedence is what makes `boardLive` a lookup: every live hold outranks
  // every merely-destroyable one, so the two predicates cannot invert.
  it('names the live hold first when a lane also holds time', () => {
    const oneHeldOneRunning = step(held(1), { type: 'START', lane: 2, at: 30_000 });

    expect(boardHold(board({ battle: oneHeldOneRunning }))).toEqual({ kind: 'running', lane: 2 });
  });

  it('is clear again after a finished run is Reset', () => {
    const cleared = step(spent(), { type: 'RESET', lane: 1, budgetMs: BUDGET });

    expect(boardHold(board({ battle: cleared }))).toBeNull();
  });

  // The Run (s) field is a draft (brief §4.5): a new budget reaches the lanes
  // only through SET_BUDGETS, so a re-armed board is pristine again — typing a
  // value must never lock the very button that applies it.
  it('is clear on a board re-armed to a new budget', () => {
    const reArmed = step(fresh(), { type: 'SET_BUDGETS', budgetMs: 150_000 });

    expect(boardHold(board({ battle: reArmed }))).toBeNull();
  });
});

const PREDICATE_CASES: [name: string, board: Board, live: boolean, holds: boolean][] = [
  ['idle', board(), false, false],
  ['a running lane', board({ battle: running(1) }), true, true],
  ['an open quali break', board({ mode: 'quali', battle: onBreak() }), true, true],
  ['a battle changeover', board({ battle: held(1) }), true, true],
  ['an open try', board({ trySeries: openTry() }), true, true],
  ['a running warm-up', board({ warmupRunning: true }), true, true],
  ['an armed series with no try', board({ trySeries: armedSeries() }), false, true],
  ['a lane held after a fall', board({ mode: 'quali', battle: held(1) }), false, true],
  ['a spent lane', board({ mode: 'quali', battle: spent() }), false, true],
];

describe('boardState — the two predicates', () => {
  it.each(PREDICATE_CASES)('%s → live %s, holds state %s', (_name, input, live, holds) => {
    expect(boardLive(input)).toBe(live);
    expect(boardHoldsState(input)).toBe(holds);
  });
});

// `Swap athletes` exchanges the two athletes and their score panels, never the
// two lane clocks or the try tally — both keyed by slot — so every hold but the
// warm-up misattributes one.
const PLAYER_HOLD_CASES: [name: string, board: Board, hold: BoardHold | null][] = [
  ['idle', board(), null],
  ['a running lane', board({ battle: running(1) }), { kind: 'running', lane: 1 }],
  [
    'an open quali break',
    board({ mode: 'quali', battle: onBreak() }),
    { kind: 'onBreak', lane: 1 },
  ],
  ['an open try', board({ trySeries: openTry() }), { kind: 'tryOpen' }],
  ['a battle changeover', board({ battle: held(1) }), { kind: 'changeover' }],
  ['an armed series with no try', board({ trySeries: armedSeries() }), { kind: 'bestTrick' }],
  [
    'a lane held after a fall',
    board({ mode: 'quali', battle: held(1) }),
    { kind: 'held', lane: 1 },
  ],
  ['a spent lane', board({ mode: 'quali', battle: spent() }), { kind: 'spent', lane: 1 }],
];

describe('boardState — what the board is holding on an athlete slot', () => {
  it.each(PLAYER_HOLD_CASES)('%s', (_name, input, expected) => {
    expect(athleteHold(input)).toEqual(expected);
  });

  // The warm-up is the one hold a swap survives: a board-wide channel bound to
  // neither athlete, running over exactly the minutes the next pair is set up in.
  it('lets a swap through the warm-up on an untouched board', () => {
    expect(boardHold(board({ warmupRunning: true }))).toEqual({ kind: 'warmup' });
    expect(athleteHold(board({ warmupRunning: true }))).toBeNull();
  });

  // …and it does not hide the hold beneath it: `boardHold` answers `warmup`
  // first, so asking that question would have unlocked a swap over a spent lane.
  it('names the athlete hold the warm-up outranks', () => {
    const overSpent = board({ mode: 'quali', battle: spent(), warmupRunning: true });

    expect(boardHold(overSpent)).toEqual({ kind: 'warmup' });
    expect(athleteHold(overSpent)).toEqual({ kind: 'spent', lane: 1 });
  });
});

const REASON_CASES: [hold: BoardHold, reason: string][] = [
  [{ kind: 'running', lane: 1 }, 'locked while Athlete 1 runs'],
  [{ kind: 'onBreak', lane: 1 }, 'locked while Athlete 1 is on break'],
  [{ kind: 'tryOpen' }, 'locked while a try is open'],
  [{ kind: 'bestTrick' }, 'locked during best trick — Leave best trick first'],
  [{ kind: 'changeover' }, 'locked during the changeover'],
  [{ kind: 'warmup' }, 'locked during the warm-up'],
  [{ kind: 'held', lane: 2 }, 'locked while Athlete 2 holds time — Reset Athlete 2 first'],
  [{ kind: 'spent', lane: 2 }, 'locked once Athlete 2 ran — Reset Athlete 2 first'],
];

describe('boardState — the blocker words', () => {
  it.each(REASON_CASES)('%o reads "%s"', (hold, reason) => {
    expect(holdReason(hold)).toBe(reason);
  });
});
