import { describe, expect, it } from 'vitest';

import {
  advanceLabel,
  advanceRoute,
  battleAdvanceEvent,
  settleThen,
  tryAdvanceEvent,
  type AdvanceLabel,
  type AdvanceRoute,
} from 'app/util/advanceRoute';
import { initialBattleState, reduce, runningLane, type BattleState } from 'app/util/battleMachine';
import {
  DEFAULT_CAP,
  initialTrySeries,
  reduce as reduceTry,
  type TrySeriesState,
} from 'app/util/bestTrickSeries';
import type { FreestyleMode } from 'app/state/freestyleModeMemory';

// The SAME fixtures the reducer tables are pinned to (battleMachine.test.ts /
// bestTrickSeries.test.ts), so the router and the machines can never disagree
// about a state.
const BUDGET = 120_000;
const BREAK = 30_000;

const fresh = (): BattleState => initialBattleState(BUDGET, 2);
const step = (state: BattleState, event: Parameters<typeof reduce>[1]) =>
  reduce(state, event).state;
const stepTry = (state: TrySeriesState, event: Parameters<typeof reduceTry>[1]) =>
  reduceTry(state, event).state;

const NAMES = { 1: 'C. Bianchi', 2: 'R. Lafleur' } as const;

/**
 * One ADVANCE press, end to end: route → stamp → dispatch. The page does
 * exactly this, so driving it here pins the route AND the transition it lands.
 */
const advance = (
  mode: FreestyleMode,
  state: BattleState,
  at: number,
  series: TrySeriesState | null = null,
) => {
  const route = advanceRoute(mode, state, series);
  if (route.kind === 'noop') {
    return { route, state, series, effects: [] };
  }
  if (route.kind === 'try') {
    const result = reduceTry(series as TrySeriesState, tryAdvanceEvent(route.event, at));
    return { route, state, series: result.state, effects: result.effects };
  }
  const result = reduce(state, battleAdvanceEvent(route.event, at, BREAK));
  return { route, state: result.state, series, effects: result.effects };
};

/** The board states the design's §3 table enumerates, as reducer fixtures. */
const ready = (): BattleState => fresh();
const battleRunning = (): BattleState => step(fresh(), { type: 'START', lane: 1, at: 0 });
const changeover = (): BattleState => step(battleRunning(), { type: 'STOP', lane: 1, at: 20_000 });
const bothSpent = (): BattleState => ({
  ...fresh(),
  1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
  2: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
  lastRan: 2,
});
/** The last turn of a battle: the partner's budget is spent, so what a press
 * after this lane's STOP does depends on this lane's own clock. */
const lastTurnRunning = (): BattleState =>
  step(
    { ...fresh(), 2: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 } },
    { type: 'START', lane: 1, at: 0 },
  );
const qualiRunning = (): BattleState => step(fresh(), { type: 'START', lane: 1, at: 0 });
const qualiNoBreaks = (): BattleState => {
  let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
  s = step(s, { type: 'TAKE_BREAK', lane: 1, at: 10_000, breakMs: BREAK });
  s = step(s, { type: 'START', lane: 1, at: 20_000 });
  s = step(s, { type: 'TAKE_BREAK', lane: 1, at: 30_000, breakMs: BREAK });
  return step(s, { type: 'START', lane: 1, at: 40_000 });
};
const qualiOnBreak = (): BattleState =>
  step(qualiRunning(), { type: 'TAKE_BREAK', lane: 1, at: 10_000, breakMs: BREAK });
const qualiHoldingNoBreaks = (): BattleState =>
  step(qualiNoBreaks(), { type: 'STOP', lane: 1, at: 50_000 });
const qualiFinished = (): BattleState => ({
  ...fresh(),
  1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
});

const armedSeries = (): TrySeriesState => initialTrySeries(DEFAULT_CAP);
const tryOpen = (): TrySeriesState => stepTry(armedSeries(), { type: 'START_TRY', side: 1, at: 0 });
const seriesComplete = (): TrySeriesState => {
  let s = armedSeries();
  for (let i = 0; i < DEFAULT_CAP; i += 1) {
    s = stepTry(s, { type: 'SKIP_TRY', side: 1 });
    s = stepTry(s, { type: 'SKIP_TRY', side: 2 });
  }
  return s;
};

/**
 * The pinned decision table: every row of the design brief's §3 state table has
 * one explicit event AND one explicit label — the plate renders this, the press
 * dispatches this, so the plate cannot lie.
 */
const TABLE: {
  state: string;
  mode: FreestyleMode;
  battle: BattleState;
  series: TrySeriesState | null;
  route: AdvanceRoute;
  label: AdvanceLabel;
}[] = [
  {
    state: 'Ready (battle, budgets full)',
    mode: 'battle',
    battle: ready(),
    series: null,
    route: {
      kind: 'battle',
      verb: 'START',
      event: { type: 'START', lane: 1 },
      then: { kind: 'endsTurn' },
    },
    label: {
      verb: 'START',
      target: 'Athlete 1 · C. Bianchi',
      detail: 'then: a press ends the turn',
    },
  },
  {
    state: 'Battle lane running',
    mode: 'battle',
    battle: battleRunning(),
    series: null,
    route: {
      kind: 'battle',
      verb: 'STOP',
      event: { type: 'STOP', lane: 1 },
      then: { kind: 'startLane', lane: 2 },
    },
    label: {
      verb: 'STOP',
      target: 'Athlete 1 · C. Bianchi',
      detail: 'then: start Athlete 2 · R. Lafleur',
    },
  },
  {
    state: 'Battle changeover',
    mode: 'battle',
    battle: changeover(),
    series: null,
    route: {
      kind: 'battle',
      verb: 'START',
      event: { type: 'START', lane: 2 },
      then: { kind: 'endsTurn' },
    },
    label: {
      verb: 'START',
      target: 'Athlete 2 · R. Lafleur',
      detail: 'then: a press ends the turn',
    },
  },
  {
    state: 'Battle both spent',
    mode: 'battle',
    battle: bothSpent(),
    series: null,
    route: { kind: 'noop', reason: 'battleOver' },
    label: {
      verb: 'NOTHING TO ADVANCE',
      target: '',
      detail: 'Begin best trick or Reset a lane',
    },
  },
  {
    state: 'Best trick armed, no try',
    mode: 'battle',
    battle: bothSpent(),
    series: armedSeries(),
    route: {
      kind: 'try',
      verb: 'START TRY',
      event: { type: 'START_TRY', side: 1 },
      then: { kind: 'endTry' },
    },
    label: {
      verb: 'START TRY',
      target: 'C. Bianchi',
      detail: 'then: end the try',
    },
  },
  {
    state: 'Try open',
    mode: 'battle',
    battle: bothSpent(),
    series: tryOpen(),
    route: {
      kind: 'try',
      verb: 'END TRY',
      event: { type: 'END_TRY' },
      side: 1,
      then: { kind: 'nextTry', side: 2, nth: 1, cap: DEFAULT_CAP },
    },
    label: {
      verb: 'END TRY',
      target: 'C. Bianchi',
      detail: "then: R. Lafleur's try 1 of 3",
    },
  },
  {
    state: 'Series complete',
    mode: 'battle',
    battle: bothSpent(),
    series: seriesComplete(),
    route: { kind: 'noop', reason: 'seriesDone' },
    label: { verb: 'NOTHING TO ADVANCE', target: '', detail: 'enter scores' },
  },
  {
    state: 'Quali ready',
    mode: 'quali',
    battle: fresh(),
    series: null,
    route: {
      kind: 'battle',
      verb: 'START',
      event: { type: 'START', lane: 1 },
      then: { kind: 'takeBreak', breaksLeft: 2 },
    },
    label: {
      verb: 'START',
      target: 'Athlete 1 · C. Bianchi',
      detail: 'then: take a break (2 left)',
    },
  },
  {
    state: 'Quali running, breaks left',
    mode: 'quali',
    battle: qualiRunning(),
    series: null,
    route: {
      kind: 'battle',
      verb: 'TAKE BREAK',
      event: { type: 'TAKE_BREAK', lane: 1 },
      then: { kind: 'resumeRun' },
    },
    label: {
      verb: 'TAKE BREAK',
      target: 'Athlete 1 · C. Bianchi',
      detail: 'then: a press resumes the run',
    },
  },
  {
    state: 'Quali running, no breaks',
    mode: 'quali',
    battle: qualiNoBreaks(),
    series: null,
    route: { kind: 'noop', reason: 'noBreaksLeft' },
    label: { verb: 'NOTHING TO ADVANCE', target: '', detail: 'Stop is manual' },
  },
  {
    state: 'Quali break / hold at zero',
    mode: 'quali',
    battle: qualiOnBreak(),
    series: null,
    route: {
      kind: 'battle',
      verb: 'RESUME',
      event: { type: 'START', lane: 1 },
      then: { kind: 'takeBreak', breaksLeft: 1 },
    },
    label: {
      verb: 'RESUME',
      target: 'Athlete 1 · C. Bianchi',
      detail: 'then: take a break (1 left)',
    },
  },
  {
    state: 'Quali holding, no breaks left',
    mode: 'quali',
    battle: qualiHoldingNoBreaks(),
    series: null,
    route: {
      kind: 'battle',
      verb: 'RESUME',
      event: { type: 'START', lane: 1 },
      then: { kind: 'noop', reason: 'noBreaksLeft' },
    },
    label: {
      verb: 'RESUME',
      target: 'Athlete 1 · C. Bianchi',
      detail: 'then: nothing to advance — Stop is manual',
    },
  },
  {
    state: 'Quali finished',
    mode: 'quali',
    battle: qualiFinished(),
    series: null,
    route: { kind: 'noop', reason: 'qualiFinished' },
    label: { verb: 'NOTHING TO ADVANCE', target: '', detail: 'Reset is manual' },
  },
];

describe('advanceRoute — the pinned press table (brief §3/§4.1)', () => {
  it.each(TABLE)('$state', ({ mode, battle, series, route, label }) => {
    const decided = advanceRoute(mode, battle, series);
    expect(decided).toEqual(route);
    expect(advanceLabel(decided, NAMES)).toEqual(label);
  });

  it('gives every row an explicit verb and a non-empty sub-line', () => {
    for (const row of TABLE) {
      const label = advanceLabel(advanceRoute(row.mode, row.battle, row.series), NAMES);
      expect(label.verb).not.toBe('');
      expect(label.detail).not.toBe('');
    }
  });

  // §4.1's label shape, as an invariant: the right half is a verb and WHO it
  // acts on. Every live reading — a clock, a break allowance, a held run, the
  // attempt a try opens — belongs to the plate's left half, the half that
  // ticks, so the label can never carry a second-old copy of a number the
  // other half is already counting.
  it('never reads a live number into the verb or the target', () => {
    const LIVE = /\d{1,2}:\d{2}|\d+\s+(?:breaks?|left)\b|\btry \d+ of \d+/i;
    for (const row of TABLE) {
      const { verb, target } = advanceLabel(advanceRoute(row.mode, row.battle, row.series), NAMES);

      expect(`${verb} ${target}`, row.state).not.toMatch(LIVE);
    }
  });

  it('falls back to the player number when a lane has no athlete yet', () => {
    const label = advanceLabel(advanceRoute('battle', ready(), null), { 1: '', 2: '' });
    expect(label.target).toBe('Athlete 1');
  });
});

// The one follow-up the clock-free router cannot answer (brief §4.1's sub-line):
// with the partner lane spent, whether the stopping lane survives its own stop
// is a wall-clock reading, so the router withholds it and a caller holding a
// `now` — the ticking plate — settles it.
describe('settleThen — the follow-up that needs a clock', () => {
  it('withholds the follow-up of a last turn until a clock settles it', () => {
    const route = advanceRoute('battle', lastTurnRunning(), null);

    expect(route).toMatchObject({ verb: 'STOP', then: { kind: 'unsettled' } });
    expect(advanceLabel(route, NAMES).detail).toBe('');
  });

  it('promises the same athlete another turn while their budget survives the stop', () => {
    const route = settleThen(
      advanceRoute('battle', lastTurnRunning(), null),
      lastTurnRunning(),
      20_000,
    );

    expect(route).toMatchObject({ then: { kind: 'laneAgain', lane: 1 } });
    expect(advanceLabel(route, NAMES).detail).toBe('then: start Athlete 1 · C. Bianchi again');
  });

  it('promises the end of the battle once the stop spends the last budget', () => {
    const route = settleThen(
      advanceRoute('battle', lastTurnRunning(), null),
      lastTurnRunning(),
      BUDGET,
    );

    expect(route).toMatchObject({ then: { kind: 'noop', reason: 'battleOver' } });
    expect(advanceLabel(route, NAMES).detail).toBe(
      'then: nothing to advance — Begin best trick or Reset a lane',
    );
  });

  // The clock answers ONE question. A stop the partner can follow, and every
  // route that is not a battle turn end, come back untouched.
  it('leaves a stop the partner still answers, and every other route, alone', () => {
    for (const [mode, state, series] of [
      ['battle', battleRunning(), null],
      ['battle', bothSpent(), armedSeries()],
      ['quali', qualiOnBreak(), null],
    ] as const) {
      const route = advanceRoute(mode, state, series);

      expect(settleThen(route, state, 20_000)).toBe(route);
    }
  });

  it('settles the promise the plate renders on the very press it dispatches', () => {
    const state = lastTurnRunning();
    const route = settleThen(advanceRoute('battle', state, null), state, 20_000);
    const after = advance('battle', state, 20_000).state;

    expect(route).toMatchObject({ event: { type: 'STOP', lane: 1 } });
    expect(advanceRoute('battle', after, null)).toMatchObject({
      verb: 'START',
      event: { type: 'START', lane: 1 },
    });
  });
});

// The interlocks make "a lane runs while the series is armed" unreachable; the
// order is pinned anyway (brief §4.1) so a later slice cannot quietly invert it.
describe('advanceRoute — router order', () => {
  it('stops a running lane before it touches an armed series', () => {
    const route = advanceRoute('battle', battleRunning(), armedSeries());
    expect(route).toMatchObject({ kind: 'battle', event: { type: 'STOP', lane: 1 } });
  });

  it('routes to the series once no lane runs', () => {
    const route = advanceRoute('battle', bothSpent(), armedSeries());
    expect(route).toMatchObject({ kind: 'try' });
  });
});

// The end-to-end pins ported from battleMachine.test.ts's ADVANCE describes:
// the route + the stamped dispatch reproduce the cycle the reducer used to own.
describe('advanceRoute — battle cycle (stop-current / start-next, ADR 0037 §2)', () => {
  it('stops the running lane: stop broadcast + pause anchor', () => {
    const r = advance('battle', battleRunning(), 20_000);
    expect(r.state[1]).toEqual({
      phase: 'idle',
      budgetMs: 100_000,
      armedMs: BUDGET,
      breaksLeft: 2,
    });
    expect(r.state.pauseStartedAt).toBe(20_000);
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: { type: 'stop_countdown', timerId: 1, data: { remainingMs: 100_000 } },
    });
  });

  it('alternates across a full press cycle: 1 → stop → 2 → stop → 1', () => {
    let s = fresh();
    s = advance('battle', s, 0).state;
    expect(runningLane(s)).toBe(1);
    s = advance('battle', s, 10_000).state;
    expect(runningLane(s)).toBeNull();
    s = advance('battle', s, 20_000).state;
    expect(runningLane(s)).toBe(2);
    s = advance('battle', s, 30_000).state;
    s = advance('battle', s, 40_000).state;
    expect(runningLane(s)).toBe(1);
    expect(s[1]).toMatchObject({ phase: 'running', budgetMs: 110_000 });
  });

  it('starts the survivor when the other lane is spent (exhausted-lane skip)', () => {
    let s = step(fresh(), { type: 'START', lane: 2, at: 0 });
    s = step(s, { type: 'TIMEOUT', lane: 2, at: BUDGET });
    s = advance('battle', s, BUDGET + 1000).state;
    expect(runningLane(s)).toBe(1);
    s = advance('battle', s, BUDGET + 5000).state;
    const r = advance('battle', s, BUDGET + 10_000);
    expect(runningLane(r.state)).toBe(1);
  });

  it('is a no-op once both lanes are finished (battle over)', () => {
    const s = bothSpent();
    const r = advance('battle', s, 1000);
    expect(r.route).toEqual({ kind: 'noop', reason: 'battleOver' });
    expect(r.state).toBe(s);
    expect(r.effects).toHaveLength(0);
  });
});

describe('advanceRoute — quali cycle (run ↔ advisory break, ADR 0037 §3)', () => {
  it('starts an idle lane 1', () => {
    const r = advance('quali', fresh(), 1000);
    expect(runningLane(r.state)).toBe(1);
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: {
        type: 'start_countdown',
        timerId: 1,
        data: { remainingMs: BUDGET, startedAt: 1000 },
      },
    });
  });

  it('takes the advisory break on a running lane, riding the page breakMs', () => {
    const s = advance('quali', fresh(), 0).state;
    const r = advance('quali', s, 30_000);
    expect(r.state[1]).toMatchObject({ phase: 'onBreak', budgetMs: 90_000, breaksLeft: 1 });
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: {
        type: 'start_break',
        timerId: 1,
        data: { runRemainingMs: 90_000, breakMs: BREAK, breaksLeft: 1, startedAt: 30_000 },
      },
    });
  });

  it('resumes early from the break (the existing early-start cancel)', () => {
    let s = advance('quali', fresh(), 0).state;
    s = advance('quali', s, 30_000).state;
    const r = advance('quali', s, 40_000);
    expect(r.route).toMatchObject({ verb: 'RESUME' });
    expect(r.state[1]).toMatchObject({ phase: 'running', budgetMs: 90_000, startedAt: 40_000 });
  });

  it('never kills a run: a press with the allowance exhausted is a no-op', () => {
    const s = qualiNoBreaks();
    expect(s[1]).toMatchObject({ phase: 'running', breaksLeft: 0 });
    const r = advance('quali', s, 50_000);
    expect(r.route).toEqual({ kind: 'noop', reason: 'noBreaksLeft' });
    expect(r.state).toBe(s);
    expect(r.effects).toHaveLength(0);
  });

  it('is a no-op on a finished lane (Reset stays a deliberate manual act)', () => {
    const s = qualiFinished();
    const r = advance('quali', s, 1000);
    expect(r.route).toEqual({ kind: 'noop', reason: 'qualiFinished' });
    expect(r.state).toBe(s);
  });
});

describe('advanceRoute — best-trick series (ADR 0032 part 2)', () => {
  it('opens the suggested side’s window, then ends it', () => {
    const opened = advance('battle', bothSpent(), 0, armedSeries());
    expect(opened.series).toMatchObject({ used: { 1: 1, 2: 0 } });
    expect(opened.series?.clock).toMatchObject({ running: true, side: 1 });

    const ended = advance('battle', bothSpent(), 10_000, opened.series);
    expect(ended.route).toMatchObject({ kind: 'try', verb: 'END TRY', side: 1 });
    expect(ended.series?.clock.running).toBe(false);
  });

  it('is a no-op once both athletes have used every try', () => {
    const done = seriesComplete();
    const r = advance('battle', bothSpent(), 1000, done);
    expect(r.route).toEqual({ kind: 'noop', reason: 'seriesDone' });
    expect(r.series).toBe(done);
  });

  it('names the other side’s next try as the follow-up once one side is spent', () => {
    // Player 1 has used all three; ending player 2's open try leads back to
    // player 2 (the only side with tries left).
    let s = armedSeries();
    for (let i = 0; i < DEFAULT_CAP; i += 1) s = stepTry(s, { type: 'SKIP_TRY', side: 1 });
    s = stepTry(s, { type: 'START_TRY', side: 2, at: 0 });
    const route = advanceRoute('battle', bothSpent(), s);
    expect(route).toMatchObject({
      verb: 'END TRY',
      then: { kind: 'nextTry', side: 2, nth: 2, cap: DEFAULT_CAP },
    });
    expect(advanceLabel(route, NAMES).detail).toBe("then: R. Lafleur's try 2 of 3");
  });
});
