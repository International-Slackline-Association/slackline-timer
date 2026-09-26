import { describe, expect, it } from 'vitest';

import {
  advanceTarget,
  initialBattleState,
  isPristine,
  laneDisplay,
  laneRemainingMs,
  laneSnapshot,
  peerBattleEvent,
  reduce,
  runningLane,
  sameLaneAgain,
  type TimerEffect,
  type BattleEvent,
  type BattleState,
} from 'app/util/battleMachine';
import type { CountdownWSMessage } from 'app/hooks/useWebSocket';
import { buildCountdownSnapshot } from 'app/util/timerSnapshot';

const BUDGET = 120_000;
const BREAK = 30_000;

/** A fresh two-lane state at the default budget and full quali allowance. */
const fresh = (): BattleState => initialBattleState(BUDGET, 2);

/** Convenience: drive one event and return the next state. */
const step = (state: BattleState, event: Parameters<typeof reduce>[1]) =>
  reduce(state, event).state;

describe('battleMachine — START', () => {
  it('moves an idle lane to running, anchored at the event wall clock, and broadcasts start_countdown', () => {
    const r = reduce(fresh(), { type: 'START', lane: 1, at: 1000 });
    expect(r.state[1]).toEqual({
      phase: 'running',
      budgetMs: BUDGET,
      armedMs: BUDGET,
      startedAt: 1000,
      breaksLeft: 2,
    });
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

  it('ignores a start over the other lane running (mutual exclusion)', () => {
    const running = step(fresh(), { type: 'START', lane: 1, at: 1000 });
    const r = reduce(running, { type: 'START', lane: 2, at: 2000 });
    expect(r.state).toBe(running);
    expect(r.effects).toHaveLength(0);
  });

  it('ignores a double-start on an already-running lane (gamepad double-press)', () => {
    const running = step(fresh(), { type: 'START', lane: 1, at: 1000 });
    const r = reduce(running, { type: 'START', lane: 1, at: 2000 });
    expect(r.effects).toHaveLength(0);
  });

  it('cannot start a finished lane (budget spent)', () => {
    // Run then time out lane 1 → finished at 0 budget.
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TIMEOUT', lane: 1, at: BUDGET });
    expect(s[1].phase).toBe('finished');
    const r = reduce(s, { type: 'START', lane: 1, at: BUDGET + 1 });
    expect(r.effects).toHaveLength(0);
    expect(r.state[1].phase).toBe('finished');
  });
});

describe('battleMachine — per-athlete budget persists across turns (ADR 0019 §6)', () => {
  it('freezes the derived remaining as the lane budget on a stop, then resumes from it', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    // Stop 20s in: budget frozen to 100s.
    s = step(s, { type: 'STOP', lane: 1, at: 20_000 });
    expect(s[1]).toEqual({ phase: 'idle', budgetMs: 100_000, armedMs: BUDGET, breaksLeft: 2 });
    // Restarting resumes from the persisted budget, not the original.
    const r = reduce(s, { type: 'START', lane: 1, at: 50_000 });
    expect(r.state[1]).toMatchObject({ phase: 'running', budgetMs: 100_000 });
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: {
        type: 'start_countdown',
        timerId: 1,
        data: { remainingMs: 100_000, startedAt: 50_000 },
      },
    });
  });

  it('marks a lane finished (budget 0) when a stop lands exactly at the budget end', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'STOP', lane: 1, at: BUDGET });
    expect(s[1]).toEqual({ phase: 'finished', armedMs: BUDGET, breaksLeft: 2 });
  });
});

describe('battleMachine — pause anchor (ADR 0036: the battle changeover count-up)', () => {
  it('starts fresh with no pause anchor', () => {
    expect(fresh().pauseStartedAt).toBeNull();
  });

  it('anchors the pause at a stop (fall) while a next turn is still possible', () => {
    const s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    const r = reduce(s, { type: 'STOP', lane: 1, at: 40_000 });
    // Both lanes still hold budget → the changeover pause count-up anchors at the stop.
    expect(r.state.pauseStartedAt).toBe(40_000);
    // No break is opened and nothing auto-resumes — the turn just ends.
    expect(r.state[1]).toEqual({ phase: 'idle', budgetMs: 80_000, armedMs: BUDGET, breaksLeft: 2 });
    expect(r.state[2].phase).toBe('idle');
    expect(r.effects.some((e) => e.kind === 'ws' && e.message.type === 'start_break')).toBe(false);
    // The stop broadcast still fires for peers (relay contract unchanged).
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: { type: 'stop_countdown', timerId: 1, data: { remainingMs: 80_000 } },
    });
  });

  it('anchors the pause at a timeout while the other lane still holds budget', () => {
    const s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    const r = reduce(s, { type: 'TIMEOUT', lane: 1, at: BUDGET });
    expect(r.state[1].phase).toBe('finished');
    expect(r.state.pauseStartedAt).toBe(BUDGET);
  });

  it('anchors the pause when only the stopped lane itself retains budget (solo end-game)', () => {
    let s = fresh();
    s = { ...s, 2: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 } };
    s = step(s, { type: 'START', lane: 1, at: 0 });
    const r = reduce(s, { type: 'STOP', lane: 1, at: 30_000 });
    expect(r.state[1]).toEqual({ phase: 'idle', budgetMs: 90_000, armedMs: BUDGET, breaksLeft: 2 });
    expect(r.state.pauseStartedAt).toBe(30_000);
  });

  it('sets no pause when both budgets are spent (match over, no phantom pause)', () => {
    let s = fresh();
    s = { ...s, 2: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 } };
    s = step(s, { type: 'START', lane: 1, at: 0 });
    const r = reduce(s, { type: 'TIMEOUT', lane: 1, at: BUDGET });
    expect(r.state[1].phase).toBe('finished');
    expect(r.state[2].phase).toBe('finished');
    expect(r.state.pauseStartedAt).toBeNull();
    expect(r.effects.some((e) => e.kind === 'ws' && e.message.type === 'start_break')).toBe(false);
  });

  it('clears the pause on the next Start', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'STOP', lane: 1, at: 40_000 });
    expect(s.pauseStartedAt).toBe(40_000);
    s = step(s, { type: 'START', lane: 2, at: 55_000 });
    expect(s.pauseStartedAt).toBeNull();
  });

  it('keeps the pause on a rejected Start (a finished lane cannot clear it)', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TIMEOUT', lane: 1, at: BUDGET });
    expect(s.pauseStartedAt).toBe(BUDGET);
    s = step(s, { type: 'START', lane: 1, at: BUDGET + 1 }); // guard-rejected
    expect(s.pauseStartedAt).toBe(BUDGET);
  });

  it('clears the pause on Reset', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'STOP', lane: 1, at: 40_000 });
    s = step(s, { type: 'RESET', lane: 1, budgetMs: BUDGET });
    expect(s.pauseStartedAt).toBeNull();
  });

  it('does not anchor a pause on a quali advisory break', () => {
    const s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    const r = reduce(s, { type: 'TAKE_BREAK', lane: 1, at: 45_000, breakMs: BREAK });
    expect(r.state.pauseStartedAt).toBeNull();
  });
});

describe('battleMachine — TIMEOUT', () => {
  it('long-beeps, spends the budget, and broadcasts the stop', () => {
    const s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    const r = reduce(s, { type: 'TIMEOUT', lane: 1, at: BUDGET });
    expect(r.state[1].phase).toBe('finished');
    expect(r.state[2].phase).toBe('idle');
    expect(r.effects).toContainEqual({ kind: 'audio', sound: 'long' });
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: { type: 'stop_countdown', timerId: 1, data: { remainingMs: 0 } },
    });
    // No break is routed and nothing auto-resumes (ADR 0036).
    expect(r.effects.some((e) => e.kind === 'ws' && e.message.type === 'start_break')).toBe(false);
  });

  it('ignores a timeout on a lane that is not running', () => {
    const r = reduce(fresh(), { type: 'TIMEOUT', lane: 1, at: 1000 });
    expect(r.effects).toHaveLength(0);
  });
});

describe('battleMachine — TAKE_BREAK (quali advisory)', () => {
  it('freezes the budget, decrements the allowance, holds the lane paused', () => {
    const s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    const r = reduce(s, { type: 'TAKE_BREAK', lane: 1, at: 45_000, breakMs: BREAK });
    expect(r.state[1]).toEqual({
      phase: 'onBreak',
      budgetMs: 75_000,
      armedMs: BUDGET,
      breakMs: BREAK,
      breakStartedAt: 45_000,
      breaksLeft: 1,
    });
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: {
        type: 'start_break',
        timerId: 1,
        data: { runRemainingMs: 75_000, breakMs: BREAK, breaksLeft: 1, startedAt: 45_000 },
      },
    });
  });

  it('blocks a break when the lane is not running', () => {
    const r = reduce(fresh(), { type: 'TAKE_BREAK', lane: 1, at: 1000, breakMs: BREAK });
    expect(r.effects).toHaveLength(0);
  });

  it('blocks a third break once the allowance is exhausted', () => {
    let s = fresh();
    // Two breaks, each preceded by a start (a break pauses the lane).
    s = step(s, { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TAKE_BREAK', lane: 1, at: 1000, breakMs: BREAK });
    s = step(s, { type: 'BREAK_ZERO', lane: 1, at: 2000 }); // holds → idle
    s = step(s, { type: 'START', lane: 1, at: 3000 });
    s = step(s, { type: 'TAKE_BREAK', lane: 1, at: 4000, breakMs: BREAK });
    expect((s[1] as { breaksLeft: number }).breaksLeft).toBe(0);
    s = step(s, { type: 'BREAK_ZERO', lane: 1, at: 5000 });
    s = step(s, { type: 'START', lane: 1, at: 6000 });
    const r = reduce(s, { type: 'TAKE_BREAK', lane: 1, at: 7000, breakMs: BREAK });
    expect(r.effects).toHaveLength(0);
  });
});

describe('battleMachine — BREAK_ZERO (advisory hold, no auto-resume)', () => {
  it('holds the lane paused (end_break) for a manual Start', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TAKE_BREAK', lane: 1, at: 30_000, breakMs: BREAK });
    const r = reduce(s, { type: 'BREAK_ZERO', lane: 1, at: 60_000 });
    expect(r.state[1]).toEqual({ phase: 'idle', budgetMs: 90_000, armedMs: BUDGET, breaksLeft: 1 });
    // The break-over tone is `alert2`, never the run-zero `long` (audit S14).
    expect(r.effects).toContainEqual({ kind: 'audio', sound: 'alert2' });
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: { type: 'end_break', timerId: 1, data: { runRemainingMs: 90_000 } },
    });
    // Never a start_countdown — the operator Starts manually (ADR 0036).
    expect(r.effects.some((e) => e.kind === 'ws' && e.message.type === 'start_countdown')).toBe(
      false,
    );
  });

  it('ignores BREAK_ZERO on a lane not on break', () => {
    const r = reduce(fresh(), { type: 'BREAK_ZERO', lane: 1, at: 1000 });
    expect(r.effects).toHaveLength(0);
  });
});

describe('battleMachine — RESET / SET_BUDGETS', () => {
  it('resets a lane to idle at the given budget with a fresh allowance and broadcasts', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TAKE_BREAK', lane: 1, at: 1000, breakMs: BREAK }); // burns a break
    const r = reduce(s, { type: 'RESET', lane: 1, budgetMs: 90_000 });
    expect(r.state[1]).toEqual({ phase: 'idle', budgetMs: 90_000, armedMs: 90_000, breaksLeft: 2 });
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: { type: 'reset_countdown', timerId: 1, data: { remainingMs: 90_000 } },
    });
  });

  it('re-arms both pristine lanes and broadcasts one reset_countdown each', () => {
    const r = reduce(fresh(), { type: 'SET_BUDGETS', budgetMs: 60_000 });
    const armed = { phase: 'idle', budgetMs: 60_000, armedMs: 60_000, breaksLeft: 2 };
    expect(r.state[1]).toEqual(armed);
    expect(r.state[2]).toEqual(armed);
    // The message RESET already sends, so peers PEER_RESET and the preview
    // mirrors — the re-arm reaches every surface with no wire change.
    expect(r.effects).toEqual([
      {
        kind: 'ws',
        message: { type: 'reset_countdown', timerId: 1, data: { remainingMs: 60_000 } },
      },
      {
        kind: 'ws',
        message: { type: 'reset_countdown', timerId: 2, data: { remainingMs: 60_000 } },
      },
    ]);
  });

  it('leaves a held lane alone: one effect, the held run intact', () => {
    // Lane 1 fell 20 s in and holds 100 s — idle, but NOT pristine. The reducer
    // alone must not be able to clobber it.
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'STOP', lane: 1, at: 20_000 });
    const r = reduce(s, { type: 'SET_BUDGETS', budgetMs: 60_000 });
    expect(r.state[1]).toEqual({
      phase: 'idle',
      budgetMs: 100_000,
      armedMs: BUDGET,
      breaksLeft: 2,
    });
    expect(r.state[2]).toEqual({ phase: 'idle', budgetMs: 60_000, armedMs: 60_000, breaksLeft: 2 });
    expect(r.effects).toEqual([
      {
        kind: 'ws',
        message: { type: 'reset_countdown', timerId: 2, data: { remainingMs: 60_000 } },
      },
    ]);
  });

  it('leaves running, on-break and finished lanes alone', () => {
    const running = step(fresh(), { type: 'START', lane: 1, at: 0 });
    expect(reduce(running, { type: 'SET_BUDGETS', budgetMs: 60_000 }).state[1]).toEqual(running[1]);

    const onBreak = step(running, { type: 'TAKE_BREAK', lane: 1, at: 45_000, breakMs: BREAK });
    expect(reduce(onBreak, { type: 'SET_BUDGETS', budgetMs: 60_000 }).state[1]).toEqual(onBreak[1]);

    const spent = step(running, { type: 'TIMEOUT', lane: 1, at: BUDGET });
    expect(reduce(spent, { type: 'SET_BUDGETS', budgetMs: 60_000 }).state[1]).toEqual(spent[1]);
  });

  it('is a total no-op when neither lane is pristine (nothing to re-arm)', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'STOP', lane: 1, at: 20_000 });
    s = step(s, { type: 'START', lane: 2, at: 30_000 });
    const r = reduce(s, { type: 'SET_BUDGETS', budgetMs: 60_000 });
    expect(r.state).toBe(s);
    expect(r.effects).toHaveLength(0);
  });
});

describe('battleMachine — armedMs + isPristine (the re-arm guard, ADR 0046)', () => {
  it('seeds armedMs from the initial budget: both lanes pristine', () => {
    const s = fresh();
    expect(s[1].armedMs).toBe(BUDGET);
    expect(isPristine(s[1])).toBe(true);
    expect(isPristine(s[2])).toBe(true);
  });

  it('is untouched by START / STOP — the gap is the evidence of a run', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    expect(s[1].armedMs).toBe(BUDGET);
    expect(isPristine(s[1])).toBe(false); // running is never pristine
    s = step(s, { type: 'STOP', lane: 1, at: 20_000 });
    expect(s[1]).toMatchObject({ phase: 'idle', budgetMs: 100_000, armedMs: BUDGET });
    expect(isPristine(s[1])).toBe(false); // idle, but held below its armed budget
  });

  it('is untouched across a break and a spent budget', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TAKE_BREAK', lane: 1, at: 30_000, breakMs: BREAK });
    expect(s[1].armedMs).toBe(BUDGET);
    s = step(s, { type: 'BREAK_ZERO', lane: 1, at: 60_000 });
    expect(s[1].armedMs).toBe(BUDGET);
    s = step(s, { type: 'START', lane: 1, at: 61_000 });
    s = step(s, { type: 'TIMEOUT', lane: 1, at: 61_000 + 90_000 });
    expect(s[1]).toEqual({ phase: 'finished', armedMs: BUDGET, breaksLeft: 1 });
  });

  it('RESET re-arms it, restoring the lane to pristine', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'STOP', lane: 1, at: 20_000 });
    s = step(s, { type: 'RESET', lane: 1, budgetMs: 90_000 });
    expect(s[1]).toMatchObject({ budgetMs: 90_000, armedMs: 90_000 });
    expect(isPristine(s[1])).toBe(true);
  });

  it('PEER_RESET sets it to the wire remaining (a peer re-arm is a re-arm here)', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'STOP', lane: 1, at: 20_000 });
    s = step(s, { type: 'PEER_RESET', lane: 1, remainingMs: 90_000 });
    expect(s[1]).toMatchObject({ budgetMs: 90_000, armedMs: 90_000 });
    expect(isPristine(s[1])).toBe(true);
  });

  it('PEER_SNAPSHOT adopts the wire armedMs (the room owns the armed budget)', () => {
    // A peer's held lane arrives: the room armed it to 90s and it has 80s left,
    // so it reads held HERE too — off the room's budget, not this panel's preset.
    const r = reduce(fresh(), {
      type: 'PEER_SNAPSHOT',
      at: 10_000,
      timers: [{ timerId: 1, remainingMs: 80_000, isRunning: false, armedMs: 90_000 }],
    });
    expect(r.state[1]).toEqual({
      phase: 'idle',
      budgetMs: 80_000,
      armedMs: 90_000,
      breaksLeft: 2,
    });
    expect(isPristine(r.state[1])).toBe(false);
  });

  it('PEER_SNAPSHOT hydrates a pristine room lane as pristine, not held', () => {
    // The B2 regression: a joiner whose format default is 120s joins a room
    // armed at 90s. While armedMs stayed local the hydrated 90s budget sat
    // against a 120s armed value, so the lane read HELD — locking the joiner's
    // format controls and making its Reset broadcast 120s back to the room.
    const r = reduce(fresh(), {
      type: 'PEER_SNAPSHOT',
      at: 10_000,
      timers: [{ timerId: 1, remainingMs: 90_000, isRunning: false, armedMs: 90_000 }],
    });
    expect(isPristine(r.state[1])).toBe(true);
    // …and the joiner's Reset now re-arms the room to ITS budget, not the preset.
    const reset = reduce(r.state, { type: 'RESET', lane: 1, budgetMs: r.state[1].armedMs });
    expect(reset.effects).toEqual([
      {
        kind: 'ws',
        message: { type: 'reset_countdown', timerId: 1, data: { remainingMs: 90_000 } },
      },
    ]);
  });

  it('PEER_SNAPSHOT falls back to the lane budget on an idle pre-feature row', () => {
    // A sender that predates the field omits it. An idle lane is the one phase
    // with a safe answer — its remaining IS an armed budget — so the joiner
    // reads it pristine instead of inventing a held turn off its own preset.
    const r = reduce(fresh(), {
      type: 'PEER_SNAPSHOT',
      at: 10_000,
      timers: [{ timerId: 1, remainingMs: 90_000, isRunning: false }],
    });
    expect(r.state[1]).toEqual({
      phase: 'idle',
      budgetMs: 90_000,
      armedMs: 90_000,
      breaksLeft: 2,
    });
    expect(isPristine(r.state[1])).toBe(true);
  });

  it('PEER_SNAPSHOT keeps the local value on a non-idle pre-feature row', () => {
    // Running / on-break / finished carry a SPENT remaining (0 when finished),
    // so it is no guess at what a Reset would re-arm to: the local value stands.
    const r = reduce(fresh(), {
      type: 'PEER_SNAPSHOT',
      at: 10_000,
      timers: [
        { timerId: 1, remainingMs: 80_000, isRunning: true },
        { timerId: 2, remainingMs: 0, isRunning: false },
      ],
    });
    expect(r.state[1]).toMatchObject({ phase: 'running', armedMs: BUDGET });
    expect(r.state[2]).toMatchObject({ phase: 'finished', armedMs: BUDGET });
  });
});

describe('battleMachine — lastRan + advanceTarget (ADR 0037)', () => {
  it('starts with no lastRan and targets lane 1 on the first press', () => {
    const s = fresh();
    expect(s.lastRan).toBeNull();
    expect(advanceTarget(s)).toBe(1);
  });

  it('sets lastRan on START and keeps it across STOP (survives the turn end)', () => {
    let s = step(fresh(), { type: 'START', lane: 2, at: 0 });
    expect(s.lastRan).toBe(2);
    s = step(s, { type: 'STOP', lane: 2, at: 10_000 });
    expect(s.lastRan).toBe(2);
    expect(advanceTarget(s)).toBe(1);
  });

  it('keeps lastRan across TIMEOUT', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TIMEOUT', lane: 1, at: BUDGET });
    expect(s.lastRan).toBe(1);
    expect(advanceTarget(s)).toBe(2);
  });

  it('skips a finished other lane — the survivor keeps the button', () => {
    // Lane 2 spends its budget, lane 1 last ran: the target stays lane 1.
    let s = step(fresh(), { type: 'START', lane: 2, at: 0 });
    s = step(s, { type: 'TIMEOUT', lane: 2, at: BUDGET });
    s = step(s, { type: 'START', lane: 1, at: BUDGET + 1000 });
    s = step(s, { type: 'STOP', lane: 1, at: BUDGET + 5000 });
    expect(advanceTarget(s)).toBe(1);
    // …and the gap it left is not a changeover: nobody changes over.
    expect(sameLaneAgain(s)).toBe(true);
  });

  it('reads an ordinary turn end as a changeover, not a repeat', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'STOP', lane: 1, at: 10_000 });
    expect(sameLaneAgain(s)).toBe(false);
  });

  it('reads a battle with nothing left to start as neither', () => {
    const s: BattleState = {
      ...fresh(),
      1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
      2: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
      lastRan: 1,
    };
    expect(sameLaneAgain(s)).toBe(false);
  });

  it('targets lane 2 when lane 1 is already finished and nothing ran yet', () => {
    const s: BattleState = { ...fresh(), 1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 } };
    expect(advanceTarget(s)).toBe(2);
  });

  it('returns null once both lanes are finished (battle over)', () => {
    const s: BattleState = {
      ...fresh(),
      1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
      2: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
      lastRan: 2,
    };
    expect(advanceTarget(s)).toBeNull();
  });

  it('clears lastRan on RESET (the cycle restarts at lane 1)', () => {
    let s = step(fresh(), { type: 'START', lane: 2, at: 0 });
    s = step(s, { type: 'STOP', lane: 2, at: 5000 });
    s = step(s, { type: 'RESET', lane: 2, budgetMs: BUDGET });
    expect(s.lastRan).toBeNull();
    expect(advanceTarget(s)).toBe(1);
  });

  it('clears lastRan on SET_BUDGETS (a re-armed board restarts the cycle)', () => {
    let s = step(fresh(), { type: 'START', lane: 2, at: 0 });
    s = step(s, { type: 'STOP', lane: 2, at: 5000 });
    s = step(s, { type: 'SET_BUDGETS', budgetMs: 60_000 });
    expect(s.lastRan).toBeNull();
  });
});

describe('battleMachine — PEER_HINT (alternation survives a rejoin, brief §4.11)', () => {
  /** A held (turn taken, budget left) lane — what a rejoin mirrors mid-match. */
  const held = (remainingMs: number) => ({
    phase: 'idle' as const,
    budgetMs: remainingMs,
    armedMs: BUDGET,
    breaksLeft: 2,
  });

  it('derives lastRan from the peer nextUp — the other lane ran', () => {
    // The room says lane 2 is next, so lane 1 is the one that ran; a joiner that
    // never saw the START reproduces the alternation from the relayed hint.
    const s = step(
      { ...fresh(), 1: held(40_000) },
      { type: 'PEER_HINT', nextUp: 2, mode: 'battle' },
    );
    expect(s.lastRan).toBe(1);
    expect(advanceTarget(s)).toBe(2);
  });

  it('emits no effects (a hint is mirrored state, never a broadcast)', () => {
    const r = reduce(fresh(), { type: 'PEER_HINT', nextUp: 2, mode: 'battle' });
    expect(r.effects).toHaveLength(0);
  });

  it('reproduces the target when the peer nextUp is next because the other lane is finished', () => {
    // Lane 1 spent its budget, so the room's nextUp is 2 — and 2 is still the
    // target after the derived lastRan = 1, not a bounce back to the dead lane.
    const s = step(
      { ...fresh(), 1: { phase: 'finished' as const, armedMs: BUDGET, breaksLeft: 2 } },
      { type: 'PEER_HINT', nextUp: 2, mode: 'battle' },
    );
    expect(s.lastRan).toBe(1);
    expect(advanceTarget(s)).toBe(2);
  });

  it('keeps state identity when the hint says what this panel already holds', () => {
    // Every relayed selection re-carries `nextUp`; a re-render per push would be
    // the cost of listening.
    const before = step(
      { ...fresh(), 1: held(40_000) },
      {
        type: 'PEER_HINT',
        nextUp: 2,
        mode: 'battle',
      },
    );
    expect(reduce(before, { type: 'PEER_HINT', nextUp: 2, mode: 'battle' }).state).toBe(before);
  });

  it('is a no-op when the peer carries no nextUp (an idle or spent room says nothing)', () => {
    const before = { ...fresh(), lastRan: 2 as const };
    const r = reduce(before, { type: 'PEER_HINT', nextUp: null, mode: 'battle' });
    expect(r.state).toBe(before);
  });

  it('is a no-op in quali (one lane, no alternation to reproduce)', () => {
    const before = fresh();
    const r = reduce(before, { type: 'PEER_HINT', nextUp: 2, mode: 'quali' });
    expect(r.state).toBe(before);
  });

  it('is a no-op while a lane runs (the live turn owns lastRan)', () => {
    const before = step(fresh(), { type: 'START', lane: 2, at: 0 });
    const r = reduce(before, { type: 'PEER_HINT', nextUp: 2, mode: 'battle' });
    expect(r.state).toBe(before);
    expect(r.state.lastRan).toBe(2);
  });
});

describe('battleMachine — peer apply (ADR 0038: mirror without re-broadcast)', () => {
  it('never emits a ws effect from any peer event (the re-broadcast loop guard)', () => {
    // A state where every peer event is applicable: lane 1 running, lane 2 on
    // break — so no event short-circuits into the no-op branch.
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = {
      ...s,
      2: {
        phase: 'onBreak',
        budgetMs: 50_000,
        armedMs: BUDGET,
        breakMs: BREAK,
        breakStartedAt: 0,
        breaksLeft: 1,
      },
    };
    const peerEvents: BattleEvent[] = [
      { type: 'PEER_START', lane: 2, startedAt: 1000, remainingMs: 50_000 },
      { type: 'PEER_STOP', lane: 1, at: 1000, remainingMs: 0 },
      { type: 'PEER_RESET', lane: 1, remainingMs: BUDGET },
      {
        type: 'PEER_BREAK_START',
        lane: 1,
        startedAt: 1000,
        runRemainingMs: 60_000,
        breakMs: BREAK,
        breaksLeft: 1,
      },
      { type: 'PEER_BREAK_END', lane: 2, runRemainingMs: 50_000 },
      {
        type: 'PEER_SNAPSHOT',
        at: 1000,
        timers: [{ timerId: 1, remainingMs: 30_000, isRunning: true }],
      },
    ];
    for (const event of peerEvents) {
      const r = reduce(s, event);
      expect(r.effects.filter((e) => e.kind === 'ws')).toHaveLength(0);
    }
  });

  it('PEER_START mirrors a running lane anchored to the wire epoch with the wire budget', () => {
    // The anchor comes from `startedAt` (the shared wire epoch), never from the
    // moment of receipt — proving two panels receiving the same start at
    // different times land on the identical anchor and converge.
    const r = reduce(fresh(), {
      type: 'PEER_START',
      lane: 2,
      startedAt: 4200,
      remainingMs: 90_000,
    });
    expect(r.state[2]).toEqual({
      phase: 'running',
      budgetMs: 90_000,
      armedMs: BUDGET,
      startedAt: 4200,
      breaksLeft: 2,
    });
    expect(r.effects).toHaveLength(0);
  });

  it('PEER_START keeps this panel’s own advance cycle consistent (lastRan + pause clear)', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'STOP', lane: 1, at: 20_000 }); // pause anchored locally
    const r = reduce(s, {
      type: 'PEER_START',
      lane: 2,
      startedAt: 25_000,
      remainingMs: BUDGET,
    });
    expect(r.state.pauseStartedAt).toBeNull();
    expect(r.state.lastRan).toBe(2);
    // The next battle ADVANCE alternates off the mirrored turn.
    const stopped = reduce(r.state, {
      type: 'PEER_STOP',
      lane: 2,
      at: 40_000,
      remainingMs: 105_000,
    });
    expect(advanceTarget(stopped.state)).toBe(1);
  });

  it('PEER_STOP freezes the wire remaining and anchors the changeover pause', () => {
    const s = step(fresh(), {
      type: 'PEER_START',
      lane: 1,
      startedAt: 0,
      remainingMs: BUDGET,
    });
    const r = reduce(s, { type: 'PEER_STOP', lane: 1, at: 30_000, remainingMs: 89_500 });
    expect(r.state[1]).toEqual({ phase: 'idle', budgetMs: 89_500, armedMs: BUDGET, breaksLeft: 2 });
    expect(r.state.pauseStartedAt).toBe(30_000);
    expect(r.effects).toHaveLength(0); // a fall: no beep, no broadcast
  });

  it('PEER_STOP at zero finishes the lane silently — the horn belongs to the panel that ran it', () => {
    const s = step(fresh(), {
      type: 'PEER_START',
      lane: 1,
      startedAt: 0,
      remainingMs: BUDGET,
    });
    const r = reduce(s, { type: 'PEER_STOP', lane: 1, at: BUDGET, remainingMs: 0 });
    expect(r.state[1]).toEqual({ phase: 'finished', armedMs: BUDGET, breaksLeft: 2 });
    expect(r.effects).toHaveLength(0);
  });

  it('PEER_STOP on a lane not running here neither beeps again nor re-anchors the pause', () => {
    // The local expiry won the race: TIMEOUT already fired (beep + broadcast).
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TIMEOUT', lane: 1, at: BUDGET });
    expect(s.pauseStartedAt).toBe(BUDGET);
    // The peer's duplicate stop lands ~RTT later.
    const r = reduce(s, { type: 'PEER_STOP', lane: 1, at: BUDGET + 120, remainingMs: 0 });
    expect(r.state[1].phase).toBe('finished');
    expect(r.state.pauseStartedAt).toBe(BUDGET); // untouched — no count-up drift
    expect(r.effects).toHaveLength(0); // no double beep
  });

  it('PEER_RESET re-arms the lane silently with a fresh allowance', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TAKE_BREAK', lane: 1, at: 1000, breakMs: BREAK }); // burns a break
    const r = reduce(s, { type: 'PEER_RESET', lane: 1, remainingMs: 90_000 });
    expect(r.state[1]).toEqual({ phase: 'idle', budgetMs: 90_000, armedMs: 90_000, breaksLeft: 2 });
    expect(r.state.lastRan).toBeNull();
    expect(r.effects).toHaveLength(0);
  });

  it('PEER_BREAK_START mirrors the quali break (wire allowance, wire anchor) with one short beep', () => {
    const s = step(fresh(), {
      type: 'PEER_START',
      lane: 1,
      startedAt: 0,
      remainingMs: BUDGET,
    });
    const r = reduce(s, {
      type: 'PEER_BREAK_START',
      lane: 1,
      startedAt: 45_000,
      runRemainingMs: 75_000,
      breakMs: BREAK,
      breaksLeft: 1,
    });
    expect(r.state[1]).toEqual({
      phase: 'onBreak',
      budgetMs: 75_000,
      armedMs: BUDGET,
      breakMs: BREAK,
      breakStartedAt: 45_000,
      breaksLeft: 1,
    });
    expect(r.effects).toEqual([{ kind: 'audio', sound: 'short' }]);
    // A duplicate application does not beep twice.
    const again = reduce(r.state, {
      type: 'PEER_BREAK_START',
      lane: 1,
      startedAt: 45_100,
      runRemainingMs: 75_000,
      breakMs: BREAK,
      breaksLeft: 1,
    });
    expect(again.effects).toHaveLength(0);
  });

  it('PEER_BREAK_END holds the lane paused silently — the horn belongs to the panel on break', () => {
    let s = step(fresh(), {
      type: 'PEER_START',
      lane: 1,
      startedAt: 0,
      remainingMs: BUDGET,
    });
    s = step(s, {
      type: 'PEER_BREAK_START',
      lane: 1,
      startedAt: 30_000,
      runRemainingMs: 90_000,
      breakMs: BREAK,
      breaksLeft: 1,
    });
    const r = reduce(s, { type: 'PEER_BREAK_END', lane: 1, runRemainingMs: 90_000 });
    expect(r.state[1]).toEqual({ phase: 'idle', budgetMs: 90_000, armedMs: BUDGET, breaksLeft: 1 });
    expect(r.effects).toHaveLength(0);
    // The local BREAK_ZERO already fired: the peer's duplicate is a silent no-op.
    const again = reduce(r.state, { type: 'PEER_BREAK_END', lane: 1, runRemainingMs: 90_000 });
    expect(again.state).toBe(r.state);
    expect(again.effects).toHaveLength(0);
  });

  it('PEER_SNAPSHOT hydrates running/on-break/finished lanes and keeps the control-local anchors', () => {
    const s: BattleState = { ...fresh(), pauseStartedAt: 7000, lastRan: 1 };
    const r = reduce(s, {
      type: 'PEER_SNAPSHOT',
      at: 10_000,
      timers: [
        { timerId: 0, remainingMs: 200_000, isRunning: true }, // warm-up: not this machine's
        { timerId: 1, remainingMs: 80_000, isRunning: true },
        { timerId: 2, remainingMs: 0, isRunning: false },
      ],
    });
    expect(r.state[1]).toEqual({
      phase: 'running',
      budgetMs: 80_000,
      armedMs: BUDGET,
      startedAt: 10_000,
      breaksLeft: 2,
    });
    expect(r.state[2]).toEqual({ phase: 'finished', armedMs: BUDGET, breaksLeft: 2 });
    expect(r.state.pauseStartedAt).toBe(7000);
    expect(r.state.lastRan).toBe(1);
    expect(r.effects).toHaveLength(0);
  });

  it('PEER_SNAPSHOT adopts the running lane as lastRan (a rejoin mid-turn alternates next)', () => {
    // The snapshot carries no `lastRan` (control-local, ADR 0037), but a lane
    // running in it IS the lane that last started — so the joiner's next
    // ADVANCE after that turn ends targets the other lane, not lane 1 again.
    const r = reduce(fresh(), {
      type: 'PEER_SNAPSHOT',
      at: 10_000,
      timers: [{ timerId: 2, remainingMs: 80_000, isRunning: true }],
    });
    expect(r.state.lastRan).toBe(2);
  });

  it('PEER_SNAPSHOT adopts the wire breaksLeft on lanes not on break (mid-run join)', () => {
    const r = reduce(fresh(), {
      type: 'PEER_SNAPSHOT',
      at: 10_000,
      timers: [
        { timerId: 1, remainingMs: 80_000, isRunning: true, breaksLeft: 1 },
        // A spent allowance (0) is falsy but authoritative.
        { timerId: 2, remainingMs: BUDGET, isRunning: false, breaksLeft: 0 },
      ],
    });
    expect(r.state[1]).toEqual({
      phase: 'running',
      budgetMs: 80_000,
      armedMs: BUDGET,
      startedAt: 10_000,
      breaksLeft: 1,
    });
    expect(r.state[2]).toEqual({ phase: 'idle', budgetMs: BUDGET, armedMs: BUDGET, breaksLeft: 0 });
  });

  it('PEER_SNAPSHOT keeps the local allowance when the wire omits breaksLeft (pre-feature peer)', () => {
    const r = reduce(fresh(), {
      type: 'PEER_SNAPSHOT',
      at: 10_000,
      timers: [{ timerId: 1, remainingMs: 80_000, isRunning: true }],
    });
    expect(r.state[1]).toMatchObject({ phase: 'running', breaksLeft: 2 });
  });

  it('PEER_SNAPSHOT resumes a mid-break quali lane off the wire break clock', () => {
    const r = reduce(fresh(), {
      type: 'PEER_SNAPSHOT',
      at: 5000,
      timers: [
        {
          timerId: 1,
          remainingMs: 70_000,
          isRunning: false,
          onBreak: true,
          breakRemainingMs: 12_000,
          breaksLeft: 1,
        },
        { timerId: 2, remainingMs: BUDGET, isRunning: false },
      ],
    });
    expect(r.state[1]).toEqual({
      phase: 'onBreak',
      budgetMs: 70_000,
      armedMs: BUDGET,
      breakMs: 12_000,
      breakStartedAt: 5000,
      breaksLeft: 1,
    });
    expect(r.state[2]).toEqual({ phase: 'idle', budgetMs: BUDGET, armedMs: BUDGET, breaksLeft: 2 });
  });
});

describe('battleMachine — laneSnapshot (the request_state contribution)', () => {
  it('carries breaksLeft and armedMs in every phase, not only on break', () => {
    expect(
      laneSnapshot(1, { phase: 'idle', budgetMs: BUDGET, armedMs: 90_000, breaksLeft: 1 }),
    ).toEqual({
      timerId: 1,
      lastRemainingMs: BUDGET,
      isRunning: false,
      startedAt: null,
      armedMs: 90_000,
      breaksLeft: 1,
    });
    expect(
      laneSnapshot(1, {
        phase: 'running',
        budgetMs: BUDGET,
        armedMs: 90_000,
        startedAt: 500,
        breaksLeft: 0,
      }),
    ).toEqual({
      timerId: 1,
      lastRemainingMs: BUDGET,
      isRunning: true,
      startedAt: 500,
      armedMs: 90_000,
      breaksLeft: 0,
    });
    // A spent lane still knows what a Reset would re-arm it to — the one row
    // whose `lastRemainingMs` (0) says nothing about the room's armed budget.
    expect(laneSnapshot(2, { phase: 'finished', armedMs: 90_000, breaksLeft: 2 })).toEqual({
      timerId: 2,
      lastRemainingMs: 0,
      isRunning: false,
      startedAt: null,
      armedMs: 90_000,
      breaksLeft: 2,
    });
  });

  it('produces canonical control rows that feed buildCountdownSnapshot directly', () => {
    // Locks the type unification (canonical-countdown-control-row-type): the
    // reducer's laneSnapshot output IS the CountdownControlRow buildCountdownSnapshot
    // consumes, so a running lane feeds the pre-send builder with no re-shaping.
    const snapshot = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 500,
      timers: [
        laneSnapshot(1, {
          phase: 'running',
          budgetMs: BUDGET,
          armedMs: BUDGET,
          startedAt: 500,
          breaksLeft: 1,
        }),
      ],
    });
    expect(snapshot.timers[0]).toMatchObject({
      timerId: 1,
      remainingMs: BUDGET,
      isRunning: true,
      startedAt: 500,
      breaksLeft: 1,
    });
  });

  it('round-trips the room’s armed budget through send and hydration', () => {
    // The whole B2 fix in one pass: a room armed at 90s builds its snapshot, a
    // joiner holding a 120s preset applies it, and both panels now agree on
    // what a Reset re-arms to.
    const room: BattleState = initialBattleState(90_000, 2);
    const snapshot = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 1000,
      timers: [laneSnapshot(1, room[1]), laneSnapshot(2, room[2])],
    });
    const joiner = reduce(fresh(), {
      type: 'PEER_SNAPSHOT',
      at: 1000,
      timers: snapshot.timers,
    }).state;
    expect(joiner[1]).toEqual(room[1]);
    expect(joiner[2]).toEqual(room[2]);
  });
});

// One horn per desk. The relay carries no presence (ADR 0038), so two panels on
// one competition cannot agree between them who beeps — the tone table decides
// it instead: an expiry sounds on the panel whose OWN clock crossed zero, and
// the mirrored application of the same crossing is silent. The start/stop cue
// tones are unaffected; only the two horns collided.
describe('battleMachine — expiry tone ownership', () => {
  const tones = (r: { effects: TimerEffect[] }) =>
    r.effects.filter((e) => e.kind === 'audio').map((e) => e.sound);

  it('sounds a run reaching zero here, never a mirrored one', () => {
    const local = step(fresh(), { type: 'START', lane: 1, at: 0 });
    expect(tones(reduce(local, { type: 'TIMEOUT', lane: 1, at: BUDGET }))).toEqual(['long']);

    const mirrored = step(fresh(), {
      type: 'PEER_START',
      lane: 1,
      startedAt: 0,
      remainingMs: BUDGET,
    });
    expect(
      tones(reduce(mirrored, { type: 'PEER_STOP', lane: 1, at: BUDGET, remainingMs: 0 })),
    ).toEqual([]);
  });

  it('sounds a break reaching zero here, never a mirrored one', () => {
    let local = step(fresh(), { type: 'START', lane: 1, at: 0 });
    local = step(local, { type: 'TAKE_BREAK', lane: 1, at: 30_000, breakMs: BREAK });
    expect(tones(reduce(local, { type: 'BREAK_ZERO', lane: 1, at: 60_000 }))).toEqual(['alert2']);

    const mirrored = step(local, {
      type: 'PEER_BREAK_START',
      lane: 2,
      startedAt: 30_000,
      runRemainingMs: 90_000,
      breakMs: BREAK,
      breaksLeft: 1,
    });
    expect(
      tones(reduce(mirrored, { type: 'PEER_BREAK_END', lane: 2, runRemainingMs: 90_000 })),
    ).toEqual([]);
  });
});

describe('battleMachine — peerBattleEvent (the wire → PEER_* table)', () => {
  const lane = (message: Omit<Extract<CountdownWSMessage, { timerId: number }>, 'sessionId'>) =>
    peerBattleEvent({ ...message, sessionId: 's' } as CountdownWSMessage, 999);

  it('maps the five lane message types onto the peer events', () => {
    // No wire `startedAt` ⇒ the anchor falls back to receipt (`at`), preserving
    // the old ~RTT-anchored behaviour for a pre-feature sender.
    expect(lane({ type: 'start_countdown', timerId: 1, data: { remainingMs: 5 } })).toEqual({
      type: 'PEER_START',
      lane: 1,
      startedAt: 999,
      remainingMs: 5,
    });
    expect(lane({ type: 'stop_countdown', timerId: 2, data: { remainingMs: 6 } })).toEqual({
      type: 'PEER_STOP',
      lane: 2,
      at: 999,
      remainingMs: 6,
    });
    expect(lane({ type: 'reset_countdown', timerId: 1, data: { remainingMs: 7 } })).toEqual({
      type: 'PEER_RESET',
      lane: 1,
      remainingMs: 7,
    });
    expect(
      lane({
        type: 'start_break',
        timerId: 1,
        data: { runRemainingMs: 8, breakMs: 9, breaksLeft: 1 },
      }),
    ).toEqual({
      type: 'PEER_BREAK_START',
      lane: 1,
      startedAt: 999,
      runRemainingMs: 8,
      breakMs: 9,
      breaksLeft: 1,
    });
    expect(lane({ type: 'end_break', timerId: 2, data: { runRemainingMs: 10 } })).toEqual({
      type: 'PEER_BREAK_END',
      lane: 2,
      runRemainingMs: 10,
    });
  });

  it('prefers the shared wire startedAt over receipt for start_countdown / start_break', () => {
    // The convergence fix: when the wire carries a start epoch, every receiver
    // anchors to it regardless of its own receipt time (`at`).
    expect(
      lane({ type: 'start_countdown', timerId: 1, data: { remainingMs: 5, startedAt: 4200 } }),
    ).toEqual({ type: 'PEER_START', lane: 1, startedAt: 4200, remainingMs: 5 });
    expect(
      lane({
        type: 'start_break',
        timerId: 1,
        data: { runRemainingMs: 8, breakMs: 9, breaksLeft: 1, startedAt: 4200 },
      }),
    ).toEqual({
      type: 'PEER_BREAK_START',
      lane: 1,
      startedAt: 4200,
      runRemainingMs: 8,
      breakMs: 9,
      breaksLeft: 1,
    });
  });

  it('returns null for the warm-up/best-trick channels and session messages', () => {
    expect(lane({ type: 'start_countdown', timerId: 0, data: { remainingMs: 5 } })).toBeNull();
    expect(lane({ type: 'start_countdown', timerId: 3, data: { remainingMs: 5 } })).toBeNull();
    expect(peerBattleEvent({ type: 'request_state', data: {}, sessionId: 's' }, 999)).toBeNull();
  });
});

describe('battleMachine — laneRemainingMs (derived, never accumulated)', () => {
  it('derives a running lane off its anchor and clamps at zero', () => {
    const running = step(fresh(), { type: 'START', lane: 1, at: 1000 });
    expect(laneRemainingMs(running[1], 1000)).toBe(BUDGET);
    expect(laneRemainingMs(running[1], 1000 + 30_000)).toBe(90_000);
    expect(laneRemainingMs(running[1], 1000 + BUDGET + 5000)).toBe(0);
  });

  it('reports the paused budget for an on-break lane and zero for finished', () => {
    let s = step(fresh(), { type: 'START', lane: 1, at: 0 });
    s = step(s, { type: 'TAKE_BREAK', lane: 1, at: 20_000, breakMs: BREAK });
    expect(laneRemainingMs(s[1], 999_999)).toBe(100_000);
    const done: BattleState = { ...s, 1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 } };
    expect(laneRemainingMs(done[1], 0)).toBe(0);
  });
});

describe('battleMachine — laneDisplay (the controlled display derivation)', () => {
  it('maps idle to the armed budget', () => {
    expect(
      laneDisplay({ phase: 'idle', budgetMs: BUDGET, armedMs: BUDGET, breaksLeft: 2 }),
    ).toEqual({
      kind: 'idle',
      remainingMs: BUDGET,
    });
  });

  it('maps running to the budget + its wall-clock anchor', () => {
    expect(
      laneDisplay({
        phase: 'running',
        budgetMs: BUDGET,
        armedMs: BUDGET,
        startedAt: 1000,
        breaksLeft: 1,
      }),
    ).toEqual({ kind: 'running', remainingMs: BUDGET, startedAt: 1000 });
  });

  it('maps onBreak to the held budget + the anchored break clock + allowance', () => {
    expect(
      laneDisplay({
        phase: 'onBreak',
        budgetMs: 45_000,
        armedMs: BUDGET,
        breakMs: BREAK,
        breakStartedAt: 7000,
        breaksLeft: 1,
      }),
    ).toEqual({
      kind: 'onBreak',
      heldMs: 45_000,
      breakMs: BREAK,
      breakStartedAt: 7000,
      breaksLeft: 1,
    });
  });

  it('maps finished to expired', () => {
    expect(laneDisplay({ phase: 'finished', armedMs: BUDGET, breaksLeft: 0 })).toEqual({
      kind: 'expired',
    });
  });
});
