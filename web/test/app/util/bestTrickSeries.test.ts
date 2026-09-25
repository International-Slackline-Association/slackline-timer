import { describe, expect, it } from 'vitest';

import {
  BEST_TRICK_TIMER_ID,
  DEFAULT_TRY_MS,
  bestTrickWire,
  currentTurn,
  initialTrySeries,
  initialTrySeriesStore,
  peerTryAction,
  reduce,
  seriesDone,
  suggestedNext,
  tryClockDisplay,
  trySeriesReducer,
  tryRemainingMs,
  type TrySeriesAction,
  type TrySeriesState,
  type TrySeriesStore,
} from 'app/util/bestTrickSeries';

const fresh = (cap = 3, tryMs = DEFAULT_TRY_MS): TrySeriesState => initialTrySeries(cap, tryMs);

/** Drive one event and return the next state. */
const step = (state: TrySeriesState, event: Parameters<typeof reduce>[1]) =>
  reduce(state, event).state;

describe('bestTrickSeries — START_TRY', () => {
  it('consumes the try on start, anchors the clock, and broadcasts start_countdown + short beep', () => {
    const r = reduce(fresh(), { type: 'START_TRY', side: 1, at: 1000 });
    expect(r.state.used).toEqual({ 1: 1, 2: 0 });
    expect(r.state.clock).toEqual({
      running: true,
      side: 1,
      startedAt: 1000,
      tryMs: DEFAULT_TRY_MS,
    });
    expect(r.state.lastSide).toBe(1);
    expect(r.effects).toEqual([
      {
        kind: 'ws',
        message: {
          type: 'start_countdown',
          timerId: BEST_TRICK_TIMER_ID,
          // The shared wire anchor (the try's wall-clock start) rides along.
          data: { remainingMs: DEFAULT_TRY_MS, startedAt: 1000 },
        },
      },
      { kind: 'audio', sound: 'short' },
    ]);
  });

  it('ignores a start over a running clock (no double-start)', () => {
    const running = step(fresh(), { type: 'START_TRY', side: 1, at: 1000 });
    const r = reduce(running, { type: 'START_TRY', side: 2, at: 2000 });
    expect(r.state).toBe(running);
    expect(r.effects).toHaveLength(0);
  });

  it('ignores a start for an exhausted side (used at cap)', () => {
    let s = fresh(1);
    s = step(s, { type: 'START_TRY', side: 1, at: 0 });
    s = step(s, { type: 'END_TRY', at: 5000 });
    const r = reduce(s, { type: 'START_TRY', side: 1, at: 6000 });
    expect(r.effects).toHaveLength(0);
    expect(r.state.used[1]).toBe(1);
  });
});

describe('bestTrickSeries — END_TRY / TRY_TIMEOUT', () => {
  it('END_TRY resets the clock to the full window for the next athlete (landed == missed)', () => {
    const running = step(fresh(), { type: 'START_TRY', side: 1, at: 1000 });
    const r = reduce(running, { type: 'END_TRY', at: 1000 + 12_000 });
    // Ending a try switches to the other athlete, so the clock rests at the full
    // armed window (endedMs=null → tryMs), not the leftover time, and the wire
    // clock is reset (not stopped at the leftover) so every surface shows it.
    expect(r.state.clock).toEqual({ running: false, endedMs: null });
    expect(r.effects).toEqual([
      {
        kind: 'ws',
        message: {
          type: 'reset_countdown',
          timerId: BEST_TRICK_TIMER_ID,
          data: { remainingMs: DEFAULT_TRY_MS },
        },
      },
    ]);
  });

  it('END_TRY on an idle clock is a no-op', () => {
    const r = reduce(fresh(), { type: 'END_TRY', at: 5000 });
    expect(r.effects).toHaveLength(0);
  });

  it('TRY_TIMEOUT stops the clock with only the try-end short beep (no stop broadcast)', () => {
    const running = step(fresh(), { type: 'START_TRY', side: 1, at: 0 });
    const r = reduce(running, { type: 'TRY_TIMEOUT', at: DEFAULT_TRY_MS });
    // endedMs 0 = the window expired — the controlled display renders "TIME".
    expect(r.state.clock).toEqual({ running: false, endedMs: 0 });
    // `short`, never the run-zero `long`: four expiries, four tones (audit S14).
    expect(r.effects).toEqual([{ kind: 'audio', sound: 'short' }]);
  });

  it('a stale TRY_TIMEOUT after END_TRY is a no-op', () => {
    let s = step(fresh(), { type: 'START_TRY', side: 1, at: 0 });
    s = step(s, { type: 'END_TRY', at: 10_000 });
    const r = reduce(s, { type: 'TRY_TIMEOUT', at: DEFAULT_TRY_MS });
    expect(r.effects).toHaveLength(0);
  });
});

describe('bestTrickSeries — SKIP_TRY', () => {
  it('consumes a try without a clock or effects', () => {
    const r = reduce(fresh(), { type: 'SKIP_TRY', side: 1 });
    expect(r.state.used).toEqual({ 1: 1, 2: 0 });
    expect(r.state.lastSide).toBe(1);
    expect(r.state.clock).toEqual({ running: false, endedMs: null });
    expect(r.effects).toHaveLength(0);
  });

  it('is ignored over a running clock or for an exhausted side', () => {
    const running = step(fresh(), { type: 'START_TRY', side: 1, at: 0 });
    expect(reduce(running, { type: 'SKIP_TRY', side: 2 }).state).toBe(running);
    let s = fresh(1);
    s = step(s, { type: 'SKIP_TRY', side: 1 });
    expect(reduce(s, { type: 'SKIP_TRY', side: 1 }).effects).toHaveLength(0);
  });
});

describe('bestTrickSeries — suggestedNext / seriesDone alternation', () => {
  it('participant A (player 1) goes first', () => {
    expect(suggestedNext(fresh())).toBe(1);
  });

  it('alternates 1 → 2 → 1 … from lastSide', () => {
    let s = fresh(3);
    s = step(s, { type: 'START_TRY', side: 1, at: 0 });
    s = step(s, { type: 'END_TRY', at: 1 });
    expect(suggestedNext(s)).toBe(2);
    s = step(s, { type: 'START_TRY', side: 2, at: 2 });
    s = step(s, { type: 'END_TRY', at: 3 });
    expect(suggestedNext(s)).toBe(1);
  });

  it('falls back to the same side when the other is exhausted', () => {
    // cap 1: after 2 skips both once, then let side 1 run out first.
    let s = fresh(2);
    // Side 2 exhausts first, side 1 still has a try left.
    s = step(s, { type: 'SKIP_TRY', side: 2 });
    s = step(s, { type: 'SKIP_TRY', side: 1 });
    s = step(s, { type: 'SKIP_TRY', side: 2 });
    // used: {1:1, 2:2}; lastSide 2 → other is 1 (still has a try) → suggests 1.
    expect(suggestedNext(s)).toBe(1);
    s = step(s, { type: 'SKIP_TRY', side: 1 });
    expect(suggestedNext(s)).toBeNull();
    expect(seriesDone(s)).toBe(true);
  });

  it('currentTurn is the running side while a clock is live, else the suggestion', () => {
    const running = step(fresh(), { type: 'START_TRY', side: 1, at: 0 });
    expect(currentTurn(running)).toBe(1);
    const idle = step(running, { type: 'END_TRY', at: 1 });
    expect(currentTurn(idle)).toBe(2);
  });
});

describe('bestTrickSeries — SET_CAP / SET_TRY_MS clamp', () => {
  it('SET_CAP mid-series exhausts a side already at the new cap', () => {
    let s = fresh(3);
    s = step(s, { type: 'SKIP_TRY', side: 1 });
    s = step(s, { type: 'SKIP_TRY', side: 2 });
    s = step(s, { type: 'SET_CAP', cap: 1 });
    // Both used 1, cap now 1 → done.
    expect(seriesDone(s)).toBe(true);
    expect(suggestedNext(s)).toBeNull();
  });

  it('SET_CAP / SET_TRY_MS are ignored over a running clock', () => {
    const running = step(fresh(3, DEFAULT_TRY_MS), { type: 'START_TRY', side: 1, at: 0 });
    expect(step(running, { type: 'SET_CAP', cap: 5 }).cap).toBe(3);
    expect(step(running, { type: 'SET_TRY_MS', tryMs: 20_000 }).tryMs).toBe(DEFAULT_TRY_MS);
  });

  it('SET_TRY_MS applies to the next try', () => {
    let s = step(fresh(), { type: 'SET_TRY_MS', tryMs: 20_000 });
    s = step(s, { type: 'START_TRY', side: 1, at: 100 });
    expect(tryRemainingMs(s, 100)).toBe(20_000);
  });

  it('SET_TRY_MS broadcasts the new window so a peer panel converges at once', () => {
    // The window is per-panel config; broadcasting a reset_countdown of it lets a
    // second control panel adopt it immediately (via PEER_TRY_RESET) instead of
    // waiting for the next ARM/RESET.
    const r = reduce(fresh(), { type: 'SET_TRY_MS', tryMs: 20_000 });
    expect(r.state.tryMs).toBe(20_000);
    expect(r.effects).toEqual([
      {
        kind: 'ws',
        message: {
          type: 'reset_countdown',
          timerId: BEST_TRICK_TIMER_ID,
          data: { remainingMs: 20_000 },
        },
      },
    ]);
  });
});

describe('bestTrickSeries — RESET', () => {
  it('zeroes the tally, keeps config, and broadcasts reset_countdown of the window', () => {
    let s = fresh(5, 20_000);
    s = step(s, { type: 'SKIP_TRY', side: 1 });
    const r = reduce(s, { type: 'RESET' });
    expect(r.state).toEqual({
      cap: 5,
      tryMs: 20_000,
      used: { 1: 0, 2: 0 },
      clock: { running: false, endedMs: null },
      lastSide: null,
    });
    expect(r.effects).toEqual([
      {
        kind: 'ws',
        message: {
          type: 'reset_countdown',
          timerId: BEST_TRICK_TIMER_ID,
          data: { remainingMs: 20_000 },
        },
      },
    ]);
  });
});

describe('bestTrickSeries — trySeriesReducer arm/disarm', () => {
  it('ARM installs a fresh series and resets the wire clock; DISARM clears it', () => {
    const armed = trySeriesReducer(initialTrySeriesStore, {
      type: 'ARM',
      cap: 5,
      tryMs: DEFAULT_TRY_MS,
    });
    expect(armed.series?.cap).toBe(5);
    expect(armed.effects).toEqual([
      {
        kind: 'ws',
        message: {
          type: 'reset_countdown',
          timerId: BEST_TRICK_TIMER_ID,
          data: { remainingMs: DEFAULT_TRY_MS },
        },
      },
    ]);
    const disarmed = trySeriesReducer(armed, { type: 'DISARM' });
    expect(disarmed.series).toBeNull();
  });

  it('ignores series events while disarmed', () => {
    const r = trySeriesReducer(initialTrySeriesStore, { type: 'START_TRY', side: 1, at: 0 });
    expect(r.series).toBeNull();
    expect(r.effects).toHaveLength(0);
  });

  it('DISARM while already disarmed is a no-op', () => {
    const store = initialTrySeriesStore;
    expect(trySeriesReducer(store, { type: 'DISARM' })).toBe(store);
  });

  it('ARM appends to an undrained queue instead of dropping it', () => {
    // Several actions can land between two drains (the edge drains once per
    // render), so ARM must queue behind whatever is still pending rather than
    // replace it — a dropped disarm reset would leave the preview hero on the
    // previous match's clock.
    const armed = trySeriesReducer(initialTrySeriesStore, { type: 'ARM', cap: 3 });
    const disarmed = trySeriesReducer(armed, { type: 'DISARM' });
    expect(disarmed.effects).toHaveLength(2);

    const rearmed = trySeriesReducer(disarmed, { type: 'ARM', cap: 5, tryMs: 20_000 });
    expect(rearmed.series?.cap).toBe(5);
    expect(rearmed.effects).toEqual([
      ...disarmed.effects,
      {
        kind: 'ws',
        message: {
          type: 'reset_countdown',
          timerId: BEST_TRICK_TIMER_ID,
          data: { remainingMs: 20_000 },
        },
      },
    ]);
  });
});

describe('bestTrickSeries — peer mirroring (ADR 0038)', () => {
  const disarmed: TrySeriesStore = initialTrySeriesStore;
  const armedStore = (series: TrySeriesState): TrySeriesStore => ({
    series,
    context: null,
    effects: [],
  });

  it('never queues a ws effect from any peer action (the re-broadcast loop guard)', () => {
    const running = step(fresh(), { type: 'START_TRY', side: 1, at: 0 });
    const stores = [disarmed, armedStore(running)];
    const actions: TrySeriesAction[] = [
      {
        type: 'PEER_SELECTION',
        bestTrick: { cap: 3, tries: { 1: 1, 2: 0 }, turn: 2, clockRunning: false },
      },
      { type: 'PEER_SELECTION', bestTrick: undefined },
      { type: 'PEER_TRY_START', at: 100, startedAt: 100, remainingMs: DEFAULT_TRY_MS },
      { type: 'PEER_TRY_STOP', remainingMs: 12_000 },
      { type: 'PEER_TRY_RESET', remainingMs: DEFAULT_TRY_MS },
    ];
    for (const store of stores) {
      for (const action of actions) {
        const next = trySeriesReducer(store, action);
        expect(next.effects.filter((e) => e.kind === 'ws')).toHaveLength(0);
      }
    }
  });

  it('PEER_SELECTION arms a disarmed store to match the peer board and mirrors the tally', () => {
    const r = trySeriesReducer(disarmed, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 5, tries: { 1: 2, 2: 1 }, turn: 2, clockRunning: false },
    });
    expect(r.series).not.toBeNull();
    expect(r.series?.cap).toBe(5);
    expect(r.series?.used).toEqual({ 1: 2, 2: 1 });
    // The reconstructed lastSide reproduces the wire turn.
    expect(currentTurn(r.series as TrySeriesState)).toBe(2);
  });

  it('PEER_SELECTION reproduces the wire turn in the same-side-fallback case too', () => {
    // Side 2 exhausted, side 1 last ran and goes again: turn stays 1.
    const r = trySeriesReducer(disarmed, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 2, tries: { 1: 1, 2: 2 }, turn: 1, clockRunning: false },
    });
    expect(currentTurn(r.series as TrySeriesState)).toBe(1);
  });

  it('PEER_SELECTION without a bestTrick disarms silently', () => {
    const armed = armedStore(fresh());
    const r = trySeriesReducer(armed, { type: 'PEER_SELECTION', bestTrick: undefined });
    expect(r.series).toBeNull();
    expect(r.effects).toHaveLength(0);
    // Already-disarmed application returns the same store (echo terminator).
    expect(trySeriesReducer(disarmed, { type: 'PEER_SELECTION', bestTrick: undefined })).toBe(
      disarmed,
    );
  });

  it('PEER_SELECTION with equal values returns the same store (echo terminator)', () => {
    const first = trySeriesReducer(disarmed, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 3, tries: { 1: 1, 2: 0 }, turn: 2, clockRunning: false },
    });
    const second = trySeriesReducer(first, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 3, tries: { 1: 1, 2: 0 }, turn: 2, clockRunning: false },
    });
    expect(second).toBe(first);
  });

  it('PEER_SELECTION corrects a running mirrored clock’s side off the wire turn', () => {
    // A clock started with a guessed side (start arrived before any selection).
    let store = trySeriesReducer(disarmed, {
      type: 'PEER_TRY_START',
      at: 0,
      startedAt: 0,
      remainingMs: DEFAULT_TRY_MS,
    });
    expect(store.series?.clock).toMatchObject({ running: true, side: 1 });
    store = trySeriesReducer(store, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 3, tries: { 1: 0, 2: 1 }, turn: 2, clockRunning: true },
    });
    expect(store.series?.clock).toMatchObject({ running: true, side: 2, startedAt: 0 });
  });

  it('the live path (selection first, then the clock start) mirrors the acting side', () => {
    // The acting panel broadcast: updateSelection (clockRunning, turn = 2) then
    // start_countdown. The mirrored clock must start on side 2.
    let store = trySeriesReducer(disarmed, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 3, tries: { 1: 0, 2: 1 }, turn: 2, clockRunning: true },
    });
    store = trySeriesReducer(store, {
      type: 'PEER_TRY_START',
      at: 500,
      startedAt: 500,
      remainingMs: DEFAULT_TRY_MS,
    });
    expect(store.series?.clock).toEqual({
      running: true,
      side: 2,
      startedAt: 500,
      tryMs: DEFAULT_TRY_MS,
    });
    // The mirrored start does NOT consume a try — `used` mirrors via the
    // selection only (the acting panel already counted it).
    expect(store.series?.used).toEqual({ 1: 0, 2: 1 });
    expect(store.effects).toEqual([{ kind: 'audio', sound: 'short' }]);
  });

  it('PEER_TRY_START arms implicitly at snapshot catch-up (clock before selection)', () => {
    const r = trySeriesReducer(disarmed, {
      type: 'PEER_TRY_START',
      at: 1000,
      startedAt: 1000,
      remainingMs: 18_000, // mid-window at join
    });
    expect(r.series?.clock).toEqual({ running: true, side: 1, startedAt: 1000, tryMs: 18_000 });
  });

  it('PEER_TRY_STOP freezes the mirrored clock at the wire remaining, without a broadcast', () => {
    let store = trySeriesReducer(disarmed, {
      type: 'PEER_TRY_START',
      at: 0,
      startedAt: 0,
      remainingMs: DEFAULT_TRY_MS,
    });
    store = trySeriesReducer(store, { type: 'PEER_TRY_STOP', remainingMs: 12_000 });
    // The wire value is authoritative — the display rests at the acting
    // panel's frozen remaining.
    expect(store.series?.clock).toEqual({ running: false, endedMs: 12_000 });
    // Idle clock / disarmed store: no-ops.
    expect(trySeriesReducer(store, { type: 'PEER_TRY_STOP', remainingMs: 12_000 })).toBe(store);
    expect(trySeriesReducer(disarmed, { type: 'PEER_TRY_STOP', remainingMs: 12_000 })).toBe(
      disarmed,
    );
  });

  it('PEER_TRY_RESET freezes the clock and adopts a real window, never arms', () => {
    const armed = armedStore(step(fresh(), { type: 'START_TRY', side: 1, at: 0 }));
    const r = trySeriesReducer(armed, { type: 'PEER_TRY_RESET', remainingMs: 20_000 });
    expect(r.series?.clock).toEqual({ running: false, endedMs: null });
    expect(r.series?.tryMs).toBe(20_000); // a peer ARM/RESET carries its window
    // The disarm broadcast (remainingMs 0) keeps the local window config.
    const zero = trySeriesReducer(armed, { type: 'PEER_TRY_RESET', remainingMs: 0 });
    expect(zero.series?.tryMs).toBe(DEFAULT_TRY_MS);
    expect(trySeriesReducer(disarmed, { type: 'PEER_TRY_RESET', remainingMs: 20_000 })).toBe(
      disarmed,
    );
  });

  it('PEER_SELECTION never stops a running try clock (the clock channel owns it)', () => {
    // The peer has not applied our start_countdown yet, so its echo still says
    // "no try is open". Stopping on that killed the acting panel's own try.
    const acting = armedStore(step(fresh(), { type: 'START_TRY', side: 1, at: 1000 }));
    const r = trySeriesReducer(acting, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 3, tries: { 1: 1, 2: 0 }, turn: 1, clockRunning: false },
    });
    expect(r.series?.clock).toEqual(acting.series?.clock);
    // A preserved clock keeps its side as the last one to run, so the turn the
    // board reads stays the athlete whose window is open.
    expect(r.series?.lastSide).toBe(1);
    expect(currentTurn(r.series as TrySeriesState)).toBe(1);
  });

  it('PEER_SELECTION never lowers the tally of the side whose try is running', () => {
    // A mirrored panel anchors its clock off start_countdown WITHOUT consuming
    // the try (`used` rides the selection), so its echo lags by one — applying
    // it verbatim wiped the acting panel's tally back to 0.
    const acting = armedStore(step(fresh(), { type: 'START_TRY', side: 1, at: 1000 }));
    const r = trySeriesReducer(acting, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 3, tries: { 1: 0, 2: 0 }, turn: 1, clockRunning: true },
    });
    expect(r.series?.used).toEqual({ 1: 1, 2: 0 });
    expect(r).toBe(acting); // and the lagging echo dies here, unchanged
  });

  it('still takes a peer RESET that clears the tally under a running clock', () => {
    // The one legitimate decrement: a RESET zeroes BOTH sides and stops the
    // wire clock, so it is not a lagging echo and must pass through — the
    // acting panel's `Reset series` has to clear the mirror mid-try.
    const mirror = armedStore(step(fresh(), { type: 'START_TRY', side: 1, at: 1000 }));
    const r = trySeriesReducer(mirror, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 3, tries: { 1: 0, 2: 0 }, turn: 1, clockRunning: false },
    });
    expect(r.series?.used).toEqual({ 1: 0, 2: 0 });
  });

  it('reconstructs no lastSide from a tally nothing has been spent on', () => {
    // A freshly armed mirror. `turn` is a suggestion, not a history, and the
    // last side read out of it decided PEER_TRY_START's guess (see the reducer).
    const armed = trySeriesReducer(initialTrySeriesStore, {
      type: 'PEER_SELECTION',
      bestTrick: bestTrickWire(fresh()),
    });
    expect(armed.series?.lastSide).toBeNull();
    expect(suggestedNext(armed.series as TrySeriesState)).toBe(1);
  });

  it("mirrors the peer's consumed tries across a whole series, in BOTH wire orders", () => {
    // The tally rides the SELECTION and the window rides the CLOCK, and the
    // acting panel's two frames are unordered — so a mirror that leans on one
    // of them reads a try behind (`fs best-trick: B's tally consumes the try`,
    // `fs series-reset: B's tally follows the 2nd try`). Driven as the panel
    // really is: each acting transition's selection + clock frame, both orders,
    // over two consecutive tries on the same side.
    for (const clockFirst of [true, false]) {
      let acting = fresh();
      let mirror = trySeriesReducer(initialTrySeriesStore, {
        type: 'PEER_SELECTION',
        bestTrick: bestTrickWire(acting),
      });
      const relay = (clock: TrySeriesAction) => {
        const frames: TrySeriesAction[] = [
          { type: 'PEER_SELECTION', bestTrick: bestTrickWire(acting) },
          clock,
        ];
        for (const frame of clockFirst ? frames.reverse() : frames) {
          mirror = trySeriesReducer(mirror, frame);
        }
      };

      acting = step(acting, { type: 'START_TRY', side: 1, at: 1_000 });
      relay({ type: 'PEER_TRY_START', at: 1_000, startedAt: 1_000, remainingMs: DEFAULT_TRY_MS });
      expect(mirror.series?.used).toEqual({ 1: 1, 2: 0 });

      acting = step(acting, { type: 'END_TRY', at: 5_000 });
      relay({ type: 'PEER_TRY_RESET', remainingMs: DEFAULT_TRY_MS });

      acting = step(acting, { type: 'START_TRY', side: 1, at: 6_000 });
      relay({ type: 'PEER_TRY_START', at: 6_000, startedAt: 6_000, remainingMs: DEFAULT_TRY_MS });
      expect(mirror.series?.used).toEqual({ 1: 2, 2: 0 });
      // …and the whole mirrored payload agrees, turn and open window included.
      expect(bestTrickWire(mirror.series)).toEqual(bestTrickWire(acting));
    }
  });

  it('a mirrored try start converges in BOTH wire orders (the two-panel round trip)', () => {
    // Panel A opens a try; panel B mirrors it and — because a value-changing
    // peer application re-pushes — echoes its own derived selection back. The
    // relay does not order the acting panel's two frames, so both arrival
    // orders must land B on A's state and leave A's own untouched.
    for (const clockFirst of [true, false]) {
      const acting = step(fresh(), { type: 'START_TRY', side: 1, at: 1000 });
      const clockFrame: TrySeriesAction = {
        type: 'PEER_TRY_START',
        at: 1000,
        startedAt: 1000,
        remainingMs: DEFAULT_TRY_MS,
      };
      const selectionFrame: TrySeriesAction = {
        type: 'PEER_SELECTION',
        bestTrick: bestTrickWire(acting),
      };
      // Armed the way a real peer is — off the acting panel's ARM selection —
      // so anything that reconstruction invents rides into the guess below.
      let mirror = trySeriesReducer(initialTrySeriesStore, {
        type: 'PEER_SELECTION',
        bestTrick: bestTrickWire(fresh()),
      });
      for (const frame of clockFirst
        ? [clockFrame, selectionFrame]
        : [selectionFrame, clockFrame]) {
        mirror = trySeriesReducer(mirror, frame);
      }
      expect(bestTrickWire(mirror.series as TrySeriesState)).toEqual(bestTrickWire(acting));

      // …and the echo the mirror sends back leaves the acting panel alone.
      const echoed = trySeriesReducer(armedStore(acting), {
        type: 'PEER_SELECTION',
        bestTrick: bestTrickWire(mirror.series as TrySeriesState),
      });
      expect(echoed.series).toEqual(acting);
    }
  });
});

describe('bestTrickSeries — bestTrickWire (the mirrored selection payload)', () => {
  it('is absent while disarmed and carries the live tally/turn while armed', () => {
    expect(bestTrickWire(null)).toBeUndefined();
    const running = step(fresh(5), { type: 'START_TRY', side: 2, at: 0 });
    expect(bestTrickWire(running)).toEqual({
      cap: 5,
      tries: { 1: 0, 2: 1 },
      turn: 2,
      clockRunning: true,
    });
  });
});

describe('bestTrickSeries — tryClockDisplay (the controlled display derivation)', () => {
  it('rests at the armed window before any try (endedMs null)', () => {
    expect(tryClockDisplay(fresh(3, 20_000))).toEqual({ kind: 'idle', remainingMs: 20_000 });
  });

  it('derives a running clock from its anchor + window', () => {
    const running = step(fresh(), { type: 'START_TRY', side: 2, at: 1000 });
    expect(tryClockDisplay(running)).toEqual({
      kind: 'running',
      remainingMs: DEFAULT_TRY_MS,
      startedAt: 1000,
    });
  });

  it('rests at the full armed window after END_TRY (fresh window for the next athlete)', () => {
    let s = step(fresh(), { type: 'START_TRY', side: 1, at: 0 });
    s = step(s, { type: 'END_TRY', at: 12_000 });
    expect(tryClockDisplay(s)).toEqual({ kind: 'idle', remainingMs: DEFAULT_TRY_MS });
  });

  it('is expired after a window timeout (endedMs 0 → "TIME")', () => {
    let s = step(fresh(), { type: 'START_TRY', side: 1, at: 0 });
    s = step(s, { type: 'TRY_TIMEOUT', at: DEFAULT_TRY_MS });
    expect(tryClockDisplay(s)).toEqual({ kind: 'expired' });
  });

  it('a series RESET returns the display to the armed window', () => {
    let s = step(fresh(3, 20_000), { type: 'START_TRY', side: 1, at: 0 });
    s = step(s, { type: 'TRY_TIMEOUT', at: 20_000 });
    s = step(s, { type: 'RESET' });
    expect(tryClockDisplay(s)).toEqual({ kind: 'idle', remainingMs: 20_000 });
  });
});

describe('bestTrickSeries — peerTryAction (the wire → PEER_TRY_* table)', () => {
  it('maps the timerId-3 clock messages, stamped with receipt time', () => {
    // No wire `startedAt` ⇒ the anchor falls back to receipt (`at`).
    expect(
      peerTryAction(
        { type: 'start_countdown', timerId: 3, data: { remainingMs: 5 }, sessionId: 's' },
        777,
      ),
    ).toEqual({ type: 'PEER_TRY_START', at: 777, startedAt: 777, remainingMs: 5 });
    // A wire `startedAt` is preferred over receipt, so every receiver converges.
    expect(
      peerTryAction(
        {
          type: 'start_countdown',
          timerId: 3,
          data: { remainingMs: 5, startedAt: 700 },
          sessionId: 's',
        },
        777,
      ),
    ).toEqual({ type: 'PEER_TRY_START', at: 777, startedAt: 700, remainingMs: 5 });
    expect(
      peerTryAction(
        { type: 'stop_countdown', timerId: 3, data: { remainingMs: 6 }, sessionId: 's' },
        777,
      ),
    ).toEqual({ type: 'PEER_TRY_STOP', remainingMs: 6 });
    expect(
      peerTryAction(
        { type: 'reset_countdown', timerId: 3, data: { remainingMs: 7 }, sessionId: 's' },
        777,
      ),
    ).toEqual({ type: 'PEER_TRY_RESET', remainingMs: 7 });
  });

  it('returns null for other channels and session messages', () => {
    expect(
      peerTryAction(
        { type: 'start_countdown', timerId: 1, data: { remainingMs: 5 }, sessionId: 's' },
        777,
      ),
    ).toBeNull();
    expect(peerTryAction({ type: 'request_state', data: {}, sessionId: 's' }, 777)).toBeNull();
  });
});

// The ADR 0017 §3 reset rule as a transition: the phase belongs to the match
// (and, per ADR 0036, the mode) that was live when it was armed. It used to be
// a page effect plus a `skipPeerDisarmRef` — a peer-mirrored change must NOT
// disarm, because the peer's own `bestTrick` field decides and a local DISARM
// would broadcast a reset over the peer's live try clock.
describe('bestTrickSeries — board context (the disarm-on-change rule)', () => {
  const quarterM1 = { matchId: 'm1', mode: 'battle' } as const;
  const quarterM2 = { matchId: 'm2', mode: 'battle' } as const;

  const armedIn = (context: { matchId: string; mode: 'quali' | 'battle' }) => {
    const armed = trySeriesReducer(
      { ...initialTrySeriesStore, context },
      { type: 'ARM', cap: 3, tryMs: DEFAULT_TRY_MS },
    );
    return trySeriesReducer(armed, { type: 'DRAIN' });
  };

  it('adopts the first context it is told about without disarming', () => {
    const armed = trySeriesReducer(initialTrySeriesStore, { type: 'ARM', cap: 3 });
    const r = trySeriesReducer(armed, { type: 'CONTEXT', context: quarterM1 });
    expect(r.series).not.toBeNull();
    expect(r.context).toEqual(quarterM1);
  });

  it('disarms on a match change and freezes the wire clock', () => {
    const r = trySeriesReducer(armedIn(quarterM1), { type: 'CONTEXT', context: quarterM2 });
    expect(r.series).toBeNull();
    expect(r.context).toEqual(quarterM2);
    expect(r.effects).toEqual([
      {
        kind: 'ws',
        message: {
          type: 'reset_countdown',
          timerId: BEST_TRICK_TIMER_ID,
          data: { remainingMs: 0 },
        },
      },
    ]);
  });

  it('disarms on a mode flip — best trick is a battle-only surface', () => {
    const r = trySeriesReducer(armedIn(quarterM1), {
      type: 'CONTEXT',
      context: { matchId: 'm1', mode: 'quali' },
    });
    expect(r.series).toBeNull();
  });

  it('is identity when the context is unchanged', () => {
    const store = armedIn(quarterM1);
    expect(trySeriesReducer(store, { type: 'CONTEXT', context: { ...quarterM1 } })).toBe(store);
  });

  it('PEER_CONTEXT drops the series the room has left — silently', () => {
    const r = trySeriesReducer(armedIn(quarterM1), { type: 'PEER_CONTEXT', context: quarterM2 });
    expect(r.series).toBeNull();
    expect(r.context).toEqual(quarterM2);
    // The mirrored path broadcasts nothing: the acting panel has already sent
    // its own reset, and a second one from here would freeze ITS clock.
    expect(r.effects).toHaveLength(0);
  });

  it('adopts the first peer-reported context without dropping anything', () => {
    const armed = trySeriesReducer(initialTrySeriesStore, { type: 'ARM', cap: 3 });
    const r = trySeriesReducer(armed, { type: 'PEER_CONTEXT', context: quarterM1 });
    expect(r.series).not.toBeNull();
    expect(r.context).toEqual(quarterM1);
  });

  it('PEER_CONTEXT is identity when the context is unchanged', () => {
    const store = armedIn(quarterM1);
    expect(trySeriesReducer(store, { type: 'PEER_CONTEXT', context: { ...quarterM1 } })).toBe(
      store,
    );
  });

  it('a peer-recorded context makes the local observation a no-op', () => {
    const mirrored = trySeriesReducer(armedIn(quarterM1), {
      type: 'PEER_CONTEXT',
      context: quarterM2,
    });
    const r = trySeriesReducer(mirrored, { type: 'CONTEXT', context: quarterM2 });
    // No second disarm, and — crucially — no `reset_countdown(0)` back at the
    // panel that made the change (`fs peer-match`: the mirrored disarm
    // broadcasts nothing back).
    expect(r).toBe(mirrored);
    expect(r.effects).toHaveLength(0);
  });

  it('re-arms under the new context when the peer carried a series into it', () => {
    // The peer changed match AND is armed there: the context drop and the
    // `bestTrick` that rides the same frame compose into one clean re-arm.
    let store = trySeriesReducer(armedIn(quarterM1), {
      type: 'PEER_CONTEXT',
      context: quarterM2,
    });
    store = trySeriesReducer(store, {
      type: 'PEER_SELECTION',
      bestTrick: { cap: 5, tries: { 1: 1, 2: 0 }, turn: 2, clockRunning: false },
    });
    expect(store.series?.cap).toBe(5);
    expect(store.series?.used).toEqual({ 1: 1, 2: 0 });
    expect(store.context).toEqual(quarterM2);
  });

  it('follows a peer match change in BOTH frame orders (the disarm reorder race)', () => {
    // The acting panel sends its bestTrick-less selection and its drained
    // `timerId 3` reset as two UNORDERED frames, and the relay fans them out
    // concurrently by design. Either arrival order must leave this panel
    // disarmed — a series that survived one of them re-pushed an armed
    // `bestTrick` under the peer's NEW match and re-armed the panel that had
    // just left it (`peer-match-disarm-reorder-race`).
    const peerFrames: TrySeriesAction[] = [
      { type: 'PEER_CONTEXT', context: quarterM2 },
      { type: 'PEER_SELECTION', bestTrick: undefined },
    ];
    const clockFrame: TrySeriesAction = { type: 'PEER_TRY_RESET', remainingMs: 0 };
    for (const frames of [
      [clockFrame, ...peerFrames],
      [...peerFrames, clockFrame],
    ]) {
      // Armed with an OPEN try, the way the acting panel's own board is.
      let store: TrySeriesStore = {
        ...armedIn(quarterM1),
        series: step(fresh(), { type: 'START_TRY', side: 1, at: 1000 }),
      };
      for (const frame of frames) store = trySeriesReducer(store, frame);
      expect(store.series).toBeNull();
      // …so the next selection this panel pushes retracts the phase too.
      expect(bestTrickWire(store.series)).toBeUndefined();
      expect(store.effects.filter((e) => e.kind === 'ws')).toHaveLength(0);
    }
  });

  it('a peer clock frame cannot resurrect a series the context change dropped', () => {
    // STOP and RESET are inert on a disarmed store by construction; pinned
    // because the reorder fix leans on it — the drop lands with the context,
    // so a late clock frame for the old match has nothing left to keep.
    const dropped = trySeriesReducer(armedIn(quarterM1), {
      type: 'PEER_CONTEXT',
      context: quarterM2,
    });
    expect(trySeriesReducer(dropped, { type: 'PEER_TRY_STOP', remainingMs: 9_000 })).toBe(dropped);
    expect(trySeriesReducer(dropped, { type: 'PEER_TRY_RESET', remainingMs: 30_000 })).toBe(
      dropped,
    );
  });
});
