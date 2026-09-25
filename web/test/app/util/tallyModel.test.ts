import { describe, expect, it } from 'vitest';

import { advanceLabel, advanceRoute, settleThen } from 'app/util/advanceRoute';
import { initialBattleState, reduce, type BattleState } from 'app/util/battleMachine';
import {
  DEFAULT_CAP,
  initialTrySeries,
  reduce as reduceTry,
  type TrySeriesState,
} from 'app/util/bestTrickSeries';
import { laneCardState } from 'app/util/laneCard';
import type { ScoreResult, SlotEntry } from 'app/util/scoreInput';
import { tallyModel, type TallyInput, type TallyModel } from 'app/util/tallyModel';

// The fixtures of `advanceRoute.test.ts` / the reducer tables, so the plate is
// pinned against the SAME states the router and the machines are.
const BUDGET = 120_000;
const BREAK = 30_000;
const NAMES = { 1: 'C. Bianchi', 2: 'R. Lafleur' } as const;

const fresh = (): BattleState => initialBattleState(BUDGET, 2);
const step = (state: BattleState, event: Parameters<typeof reduce>[1]) =>
  reduce(state, event).state;
const stepTry = (state: TrySeriesState, event: Parameters<typeof reduceTry>[1]) =>
  reduceTry(state, event).state;

const battleRunning = (): BattleState => step(fresh(), { type: 'START', lane: 1, at: 0 });
const changeover = (): BattleState => step(battleRunning(), { type: 'STOP', lane: 1, at: 20_000 });
const bothSpent = (): BattleState => ({
  ...fresh(),
  1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
  2: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
  lastRan: 2,
});
/** The last turn of a battle: the partner is spent, so the press after this
 * lane's STOP is whatever this lane's own clock leaves it. */
const lastTurnRunning = (): BattleState =>
  step(
    { ...fresh(), 2: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 } },
    { type: 'START', lane: 1, at: 0 },
  );
/** The gap after that last turn: the partner is spent, so the same athlete is
 * the one the next press starts — the press the plate promised with `again`. */
const lastTurnOver = (): BattleState =>
  step(lastTurnRunning(), { type: 'STOP', lane: 1, at: 20_000 });
/** One turn taken, the changeover already cleared (a Reset of the pause anchor). */
const secondTurnReady = (): BattleState => ({
  ...fresh(),
  1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
  lastRan: 1,
});
const qualiRunning = (): BattleState => step(fresh(), { type: 'START', lane: 1, at: 0 });
const qualiOnBreak = (): BattleState =>
  step(qualiRunning(), { type: 'TAKE_BREAK', lane: 1, at: 10_000, breakMs: BREAK });
const qualiHolding = (): BattleState => step(qualiRunning(), { type: 'STOP', lane: 1, at: 20_000 });
const qualiNoBreaks = (): BattleState => {
  let state = step(fresh(), { type: 'START', lane: 1, at: 0 });
  state = step(state, { type: 'TAKE_BREAK', lane: 1, at: 10_000, breakMs: BREAK });
  state = step(state, { type: 'START', lane: 1, at: 20_000 });
  state = step(state, { type: 'TAKE_BREAK', lane: 1, at: 30_000, breakMs: BREAK });
  return step(state, { type: 'START', lane: 1, at: 40_000 });
};
const qualiFinished = (): BattleState => ({
  ...fresh(),
  1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
});

const armedSeries = (): TrySeriesState => initialTrySeries(DEFAULT_CAP);
const tryOpen = (): TrySeriesState => stepTry(armedSeries(), { type: 'START_TRY', side: 1, at: 0 });
const seriesComplete = (): TrySeriesState => {
  let series = armedSeries();
  for (let i = 0; i < DEFAULT_CAP; i += 1) {
    series = stepTry(series, { type: 'SKIP_TRY', side: 1 });
    series = stepTry(series, { type: 'SKIP_TRY', side: 2 });
  }
  return series;
};

/** An entry panel's draft half — the same for every save state the plate reads. */
const DRAFT = {
  fields: { difficulty: 0, combo: 0, style: 0, bestTrick: 0, controlPenalty: 0 },
  override: null,
} as const;
const r = (overall: number): ScoreResult => ({ overall, dnf: false });
const savedEntry = (overall: number): SlotEntry => ({
  ...DRAFT,
  status: 'saved',
  result: r(overall),
  origin: 'live',
});

const NO_SAVES: TallyInput['saves'] = { 1: { status: 'empty' }, 2: { status: 'empty' } };

const input = (over: Partial<TallyInput>): TallyInput => ({
  mode: 'battle',
  battle: fresh(),
  trySeries: null,
  names: NAMES,
  warmup: { kind: 'idle', remainingMs: 420_000 },
  link: 'open',
  audioBlocked: false,
  // The steady state of a single-panel event: the joiner's grace has passed.
  peerState: 'alone',
  saves: NO_SAVES,
  now: 0,
  ...over,
});

/**
 * The pinned plate table — one row per state of the design brief's §3 table
 * (`doc/dev/design-system/freestyle-board-ux.md`), both modes. Left is a state
 * word plus exactly one live fact; right is the ADVANCE verb plus its target;
 * the fill tier follows the verb, so a stop-coloured plate always means "this
 * press ends something".
 */
const TABLE: {
  state: string;
  input: TallyInput;
  expected: Omit<TallyModel, 'noop'>;
}[] = [
  {
    state: 'Ready (battle, budgets full)',
    input: input({ mode: 'battle', battle: fresh() }),
    expected: {
      tone: 'go',
      stateTier: 'ready',
      word: 'READY · TURN 1',
      fact: 'both budgets 02:00',
      verb: 'START',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: a press ends the turn',
    },
  },
  {
    state: 'Awaiting board state (a joiner with nothing of its own to report)',
    input: input({ peerState: 'awaiting' }),
    expected: {
      tone: 'idle',
      stateTier: 'idle',
      word: 'AWAITING BOARD STATE…',
      fact: 'a peer panel may still answer',
      // The press is NOT gated (brief §1 rejects the awaiting Start gate): the
      // plate hedges what it knows, never what a press would do.
      verb: 'START',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: a press ends the turn',
    },
  },
  {
    state: 'Awaiting while this board is already live (local truth outranks the hedge)',
    input: input({ battle: battleRunning(), now: 20_000, peerState: 'awaiting' }),
    expected: {
      tone: 'stop',
      stateTier: 'running',
      word: 'RUNNING · P1 C. BIANCHI',
      fact: '01:40 left',
      verb: 'STOP',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: start Athlete 2 · R. Lafleur',
    },
  },
  {
    // The hedge yields on `boardHoldsState`, not `boardLive`: no clock is
    // ticking here, and a taken turn is still this board's own truth.
    state: 'Awaiting on a board holding a taken turn (a hold, not a live clock)',
    input: input({ battle: secondTurnReady(), peerState: 'awaiting' }),
    expected: {
      tone: 'go',
      stateTier: 'ready',
      word: 'READY · TURN 2',
      fact: 'P2 holds 02:00',
      verb: 'START',
      target: 'Athlete 2 · R. Lafleur',
      subline: 'then: a press ends the turn',
    },
  },
  {
    state: 'Battle lane running',
    input: input({ battle: battleRunning(), now: 20_000 }),
    expected: {
      tone: 'stop',
      stateTier: 'running',
      word: 'RUNNING · P1 C. BIANCHI',
      fact: '01:40 left',
      verb: 'STOP',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: start Athlete 2 · R. Lafleur',
    },
  },
  {
    state: 'Battle changeover',
    input: input({ battle: changeover(), now: 32_000 }),
    expected: {
      tone: 'go',
      stateTier: 'break',
      word: 'CHANGEOVER',
      fact: '00:12',
      verb: 'START',
      target: 'Athlete 2 · R. Lafleur',
      subline: 'then: a press ends the turn',
    },
  },
  {
    state: 'Battle, second turn armed (changeover cleared)',
    input: input({ battle: secondTurnReady() }),
    expected: {
      tone: 'go',
      stateTier: 'ready',
      word: 'READY · TURN 2',
      fact: 'P2 holds 02:00',
      verb: 'START',
      target: 'Athlete 2 · R. Lafleur',
      subline: 'then: a press ends the turn',
    },
  },
  {
    // The plate ticks, so it settles the promise the clock-free router withheld
    // rather than going quiet at the press that decides the match.
    state: 'Battle last turn running (the partner is spent)',
    input: input({ battle: lastTurnRunning(), now: 20_000 }),
    expected: {
      tone: 'stop',
      stateTier: 'running',
      word: 'RUNNING · P1 C. BIANCHI',
      fact: '01:40 left',
      verb: 'STOP',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: start Athlete 1 · C. Bianchi again',
    },
  },
  {
    // The press the row above promised, delivered: nobody changes over, so the
    // word is the promise's own and the fact is the budget that decides whether
    // the match has another turn in it.
    state: 'Battle after the last turn (the same athlete goes again)',
    input: input({ battle: lastTurnOver(), now: 32_000 }),
    expected: {
      tone: 'go',
      stateTier: 'break',
      word: 'AGAIN · P1 C. BIANCHI',
      fact: '01:40 held',
      verb: 'START',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: a press ends the turn',
    },
  },
  {
    state: 'Battle last turn, budget gone (the stop ends the match)',
    input: input({ battle: lastTurnRunning(), now: BUDGET }),
    expected: {
      tone: 'stop',
      stateTier: 'running',
      word: 'RUNNING · P1 C. BIANCHI',
      fact: '00:00 left',
      verb: 'STOP',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: nothing to advance — Begin best trick or Reset a lane',
    },
  },
  {
    state: 'Battle both spent',
    input: input({ battle: bothSpent() }),
    expected: {
      tone: 'idle',
      stateTier: 'finished',
      word: 'BATTLE OVER · SCORE',
      fact: 'both budgets spent',
      verb: 'NOTHING TO ADVANCE',
      target: '— Begin best trick or Reset a lane',
      subline: '',
    },
  },
  {
    state: 'Best trick armed, no try open',
    input: input({ battle: bothSpent(), trySeries: armedSeries() }),
    expected: {
      tone: 'go',
      stateTier: 'ready',
      word: 'BEST TRICK · P1 NEXT',
      fact: 'try 1 of 3',
      verb: 'START TRY',
      target: 'C. Bianchi',
      subline: 'then: end the try',
    },
  },
  {
    state: 'Try open',
    input: input({ battle: bothSpent(), trySeries: tryOpen(), now: 9_000 }),
    expected: {
      tone: 'stop',
      stateTier: 'running',
      word: 'TRY · P1 C. BIANCHI · 1/3',
      fact: '00:21 left',
      verb: 'END TRY',
      target: 'C. Bianchi',
      subline: "then: R. Lafleur's try 1 of 3",
    },
  },
  {
    state: 'Series complete',
    input: input({ battle: bothSpent(), trySeries: seriesComplete() }),
    expected: {
      tone: 'idle',
      stateTier: 'finished',
      word: 'BEST TRICK DONE · SCORE',
      fact: '3 tries each',
      verb: 'NOTHING TO ADVANCE',
      target: '— enter scores',
      subline: '',
    },
  },
  {
    state: 'Quali ready',
    input: input({ mode: 'quali' }),
    expected: {
      tone: 'go',
      stateTier: 'ready',
      word: 'READY',
      fact: 'armed 02:00',
      verb: 'START',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: take a break (2 left)',
    },
  },
  {
    state: 'Quali running, breaks left',
    input: input({ mode: 'quali', battle: qualiRunning(), now: 20_000 }),
    expected: {
      tone: 'set',
      stateTier: 'running',
      word: 'RUNNING · P1 C. BIANCHI',
      fact: '01:40 left · 2 breaks',
      verb: 'TAKE BREAK',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: a press resumes the run',
    },
  },
  {
    state: 'Quali running, no breaks left',
    input: input({ mode: 'quali', battle: qualiNoBreaks(), now: 50_000 }),
    expected: {
      tone: 'idle',
      stateTier: 'running',
      word: 'RUNNING · P1 C. BIANCHI',
      fact: '01:30 left',
      verb: 'NOTHING TO ADVANCE',
      target: '— Stop is manual',
      subline: '',
    },
  },
  {
    state: 'Quali break open',
    input: input({ mode: 'quali', battle: qualiOnBreak(), now: 18_000 }),
    expected: {
      tone: 'go',
      stateTier: 'break',
      // The brief hangs `mm:ss held` off the RESUME label; it rides the clock
      // half instead, beside the break it is paused behind.
      word: 'BREAK',
      fact: '00:22 · 1 left · 01:50 held',
      verb: 'RESUME',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: take a break (1 left)',
    },
  },
  {
    state: 'Quali holding (a fall, or a break that ran out)',
    input: input({ mode: 'quali', battle: qualiHolding() }),
    expected: {
      tone: 'go',
      stateTier: 'held',
      word: 'HOLDING',
      fact: '01:40 held',
      verb: 'RESUME',
      target: 'Athlete 1 · C. Bianchi',
      subline: 'then: take a break (2 left)',
    },
  },
  {
    state: 'Quali finished',
    input: input({ mode: 'quali', battle: qualiFinished() }),
    expected: {
      tone: 'idle',
      stateTier: 'finished',
      word: 'TIME · SCORE',
      fact: 'budget spent',
      verb: 'NOTHING TO ADVANCE',
      target: '— Reset is manual',
      subline: '',
    },
  },
];

describe('tallyModel', () => {
  it.each(TABLE)('$state', ({ input: state, expected }) => {
    const { noop, ...model } = tallyModel(state);

    expect(model).toEqual(expected);
    expect(noop).toBe(expected.verb === 'NOTHING TO ADVANCE');
  });

  // Every state answers "where am I" AND "what does the next press do" — the
  // brief's acceptance measure, asserted over the whole table rather than row
  // by row so a new row cannot quietly ship blank.
  it('names a state word, one fact and a press effect in every state', () => {
    for (const { state, input: board } of TABLE) {
      const model = tallyModel(board);
      expect(model.word, state).not.toBe('');
      expect(model.fact, state).not.toBe('');
      expect(model.verb, state).not.toBe('');
    }
  });

  // The right half is the router's own label (§4.1), never words the plate
  // types: verb and target come back from `advanceLabel` over the very route a
  // press dispatches, and the `then:` hint heads the sub-line.
  it('renders advanceLabel of the route a press dispatches', () => {
    for (const { state, input: board } of TABLE) {
      const label = advanceLabel(
        // Settled with the plate's own clock: the route the press dispatches is
        // the same either way, only its `then:` hint needs a `now`.
        settleThen(
          advanceRoute(board.mode, board.battle, board.trySeries),
          board.battle,
          board.now,
        ),
        board.names,
      );
      const model = tallyModel(board);

      expect(model.verb, state).toBe(label.verb);
      // A no-op's reason moves to the target slot behind an em dash, freeing
      // the sub-line for the scoring state the operator now acts on.
      expect(model.target, state).toBe(model.noop ? `— ${label.detail}` : label.target);
      expect(model.subline.startsWith(label.detail), state).toBe(!model.noop);
    }
  });

  // The one promise the clock-free router withholds (`settleThen`): the plate
  // settles it, so the board owes the press it lands on the same word. `again`
  // IS that promise — the partner is out, so the gap is nobody's changeover —
  // and the delivery is where it would go missing.
  it('delivers the `again` it promised a press earlier', () => {
    const running = lastTurnRunning();
    const promise = advanceLabel(
      settleThen(advanceRoute('battle', running, null), running, 20_000),
      NAMES,
    );
    expect(promise.detail).toBe('then: start Athlete 1 · C. Bianchi again');

    const model = tallyModel(
      input({ battle: step(running, { type: 'STOP', lane: 1, at: 20_000 }), now: 32_000 }),
    );

    expect(model.word).toBe('AGAIN · P1 C. BIANCHI');
    expect(`${model.verb} ${model.target}`).toBe('START Athlete 1 · C. Bianchi');
  });

  // The division of labour the §3 rows blur (`RESUME · name · mm:ss held`,
  // `TAKE BREAK (n left)`, `START TRY · name · try k of cap`): every live
  // reading — a clock, a break allowance, a held run, the attempt a try opens —
  // is the LEFT half's, because the left half is the one that ticks. The right
  // half names the press, so it can never show a second-old copy of a number
  // the other half already owns.
  it('keeps every live reading out of the right half', () => {
    const LIVE = /\d{1,2}:\d{2}|\d+\s+(?:breaks?|left)\b|\btry \d+ of \d+/i;
    for (const { state, input: board } of TABLE) {
      const { verb, target } = tallyModel(board);

      expect(`${verb} ${target}`, state).not.toMatch(LIVE);
    }
  });

  // The two channels are independent by construction: the FILL follows the
  // VERB, the tier follows the BOARD. A run is a run in both modes — only the
  // press differs — so the tier is what a squint reads at 25 % scale while the
  // fill swings from amber to red on the same state.
  it('reports a run in either mode, whatever the press does with it', () => {
    const quali = tallyModel(input({ mode: 'quali', battle: qualiRunning(), now: 20_000 }));
    const battle = tallyModel(input({ battle: battleRunning(), now: 20_000 }));

    expect([quali.stateTier, battle.stateTier]).toEqual(['running', 'running']);
    expect([quali.tone, battle.tone]).toEqual(['set', 'stop']);
  });

  // One derivation, one language (§6): a quali board IS its single lane, so the
  // plate's tier and that lane's card can never word the same state two ways.
  it('takes the quali tier from the lane card the board draws', () => {
    for (const battle of [
      fresh(),
      qualiRunning(),
      qualiOnBreak(),
      qualiHolding(),
      qualiFinished(),
    ]) {
      expect(tallyModel(input({ mode: 'quali', battle })).stateTier).toBe(
        laneCardState(battle[1]).tier,
      );
    }
  });

  it('keeps the state word to at most three parts (§4.1 label shape)', () => {
    for (const { state, input: board } of TABLE) {
      expect(tallyModel(board).word.split(' · ').length, state).toBeLessThanOrEqual(3);
    }
  });
});

// The unbounded sub-line is where everything OUTSIDE the advance cycle lands,
// so the plate stays one object instead of growing a chip rail (§3).
describe('tallyModel sub-line', () => {
  it('appends the warm-up while it runs, and its expiry after', () => {
    expect(
      tallyModel(
        input({ warmup: { kind: 'running', remainingMs: 300_000, startedAt: 0 }, now: 48_000 }),
      ).subline,
    ).toBe('then: a press ends the turn · warm-up 04:12');

    expect(tallyModel(input({ warmup: { kind: 'expired' } })).subline).toBe(
      'then: a press ends the turn · warm-up over',
    );
  });

  it('reports the link in the header dialect, or not at all', () => {
    // Graded, not raw OPEN, and by the one grader the chips read: a keepalive
    // blip and the opening handshake never put a fault on the loudest object
    // here, and a board that never reached the relay has lost no preview to
    // report — it was never connected.
    expect(tallyModel(input({ link: 'lost' })).subline).toBe(
      'then: a press ends the turn · preview not receiving',
    );
    expect(tallyModel(input({ link: 'unreachable' })).subline).toBe(
      'then: a press ends the turn · not connected',
    );
    for (const link of ['open', 'connecting', 'reconnecting'] as const) {
      expect(tallyModel(input({ link })).subline).toBe('then: a press ends the turn');
    }
  });

  it('says the audio is locked while the browser still blocks playback', () => {
    expect(tallyModel(input({ audioBlocked: true })).subline).toBe(
      'then: a press ends the turn · audio locked',
    );
  });

  it('asks for an athlete while neither athlete slot is assigned', () => {
    expect(tallyModel(input({ names: { 1: '', 2: '' } })).subline).toBe(
      'then: a press ends the turn · select an athlete',
    );
  });

  it('renders the target by athlete slot before an athlete is picked', () => {
    const model = tallyModel(input({ names: { 1: '', 2: '' } }));

    expect(model.target).toBe('Athlete 1');
    expect(model.word).toBe('READY · TURN 1');
  });

  // Where the board has nothing left to advance, the scoring state IS the news
  // (brief §2 wireframe D) — a failed save must never live only in a toast.
  it('mirrors the per-athlete-slot save state once there is nothing to advance', () => {
    const saved = savedEntry(26);
    const failed: SlotEntry = { ...DRAFT, status: 'error', result: r(24.5), reason: 'boom' };

    expect(tallyModel(input({ battle: bothSpent(), saves: { 1: saved, 2: failed } })).subline).toBe(
      'P1 SAVED 26.00 · P2 NOT SAVED — retry',
    );
  });

  it('reports a save in flight and a saved DNF', () => {
    const pending: SlotEntry = { ...DRAFT, status: 'pending', result: r(0) };
    const dnf: SlotEntry = {
      ...DRAFT,
      status: 'saved',
      result: { overall: 0, dnf: true },
      origin: 'live',
    };

    expect(tallyModel(input({ battle: bothSpent(), saves: { 1: pending, 2: dnf } })).subline).toBe(
      'P1 SAVING… · P2 SAVED DNF',
    );
  });

  // A live board's sub-line belongs to the press it is about to take (§4.1's
  // `then:` line); the score rail carries the save state while a run is on.
  it('leaves the save state off a live plate', () => {
    expect(
      tallyModel(
        input({
          battle: battleRunning(),
          now: 20_000,
          saves: { 1: savedEntry(26), 2: { status: 'empty' } },
        }),
      ).subline,
    ).toBe('then: start Athlete 2 · R. Lafleur');
  });
});
