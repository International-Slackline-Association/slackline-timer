import { describe, expect, it } from 'vitest';

import { reduce as reduceBattle, initialBattleState } from 'app/util/battleMachine';
import { reduce as reduceTry, initialTrySeries } from 'app/util/bestTrickSeries';
import { reduce as reduceWarmup, initialWarmupState } from 'app/util/warmupChannel';
import type { TimerEffect } from 'app/util/timerChannel';
import type { RaceSound } from 'app/util/raceSound';

/**
 * The four-tone map (FREESTYLE_BOARD_UX §4.2, audit S14). The per-machine table
 * tests pin each tone in its own effect table; this one pins the property that
 * finding actually asked for — that the four expiries an operator hears with
 * their eyes on the athlete are four DIFFERENT tones. Adding a fifth expiry
 * that reuses one of them fails here, in the one place that reads across the
 * three machines.
 */

const BUDGET = 120_000;
const BREAK = 30_000;

const tone = (effects: TimerEffect[]): RaceSound | undefined =>
  effects.find((e) => e.kind === 'audio')?.sound;

/** A run budget crossing zero mid-performance. */
const runZero = (): RaceSound | undefined => {
  const armed = initialBattleState(BUDGET, 2);
  const running = reduceBattle(armed, { type: 'START', lane: 1, at: 0 }).state;
  return tone(reduceBattle(running, { type: 'TIMEOUT', lane: 1, at: BUDGET }).effects);
};

/** A quali advisory break running out. */
const breakOver = (): RaceSound | undefined => {
  const armed = initialBattleState(BUDGET, 2);
  const running = reduceBattle(armed, { type: 'START', lane: 1, at: 0 }).state;
  const onBreak = reduceBattle(running, {
    type: 'TAKE_BREAK',
    lane: 1,
    at: 30_000,
    breakMs: BREAK,
  }).state;
  return tone(reduceBattle(onBreak, { type: 'BREAK_ZERO', lane: 1, at: 60_000 }).effects);
};

/** The warm-up window running out. */
const warmupOver = (): RaceSound | undefined => {
  const armed = initialWarmupState(300);
  const running = reduceWarmup(armed, { type: 'START', at: 0 }).state;
  return tone(reduceWarmup(running, { type: 'EXPIRE' }).effects);
};

/** A best-trick try window closing. */
const tryEnd = (): RaceSound | undefined => {
  const armed = initialTrySeries(3);
  const open = reduceTry(armed, { type: 'START_TRY', side: 1, at: 0 }).state;
  return tone(reduceTry(open, { type: 'TRY_TIMEOUT', at: 30_000 }).effects);
};

describe('the four-tone map — four expiry channels, four tones', () => {
  it('assigns each expiry its own tone', () => {
    expect(runZero()).toBe('long');
    expect(breakOver()).toBe('alert2');
    expect(warmupOver()).toBe('alert');
    expect(tryEnd()).toBe('short');
  });

  it('never lets two expiries share a tone', () => {
    const tones = [runZero(), breakOver(), warmupOver(), tryEnd()];
    expect(tones.every((t) => t !== undefined)).toBe(true);
    expect(new Set(tones).size).toBe(tones.length);
  });

  it('leaves the two relayed expiries silent on a mirroring panel', () => {
    // The horn has an owner, not a dedupe (ADR 0046 §5): the four tones above
    // sound where the clock crossed zero, and the mirrored application of the
    // same crossing says nothing — two panels at one judges' desk are one horn.
    const armed = initialBattleState(BUDGET, 2);
    const running = reduceBattle(armed, {
      type: 'PEER_START',
      lane: 1,
      startedAt: 0,
      remainingMs: BUDGET,
    }).state;
    expect(
      tone(
        reduceBattle(running, { type: 'PEER_STOP', lane: 1, at: BUDGET, remainingMs: 0 }).effects,
      ),
    ).toBeUndefined();

    const onBreak = reduceBattle(running, {
      type: 'PEER_BREAK_START',
      lane: 1,
      startedAt: 30_000,
      runRemainingMs: 90_000,
      breakMs: BREAK,
      breaksLeft: 1,
    }).state;
    // The break OPENING still cues every surface — only the horns collided.
    expect(
      tone(
        reduceBattle(running, {
          type: 'PEER_BREAK_START',
          lane: 1,
          startedAt: 30_000,
          runRemainingMs: 90_000,
          breakMs: BREAK,
          breaksLeft: 1,
        }).effects,
      ),
    ).toBe('short');
    expect(
      tone(
        reduceBattle(onBreak, { type: 'PEER_BREAK_END', lane: 1, runRemainingMs: 90_000 }).effects,
      ),
    ).toBeUndefined();
  });
});
