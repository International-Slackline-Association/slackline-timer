/**
 * Pure helpers for peer-to-peer timer state recovery.
 *
 * The relay persists nothing (it is a dumb broadcast), so a late-joining or
 * reconnecting preview/overlay would render a blank timer until the next
 * operator action. Recovery is request-reply: the preview emits `request_state`
 * on (re)open, the control page replies with a snapshot built here, and the
 * preview applies it via the normalized lane states below.
 *
 * This module is React-free and side-effect-free so all the branching (idle vs
 * running vs finished, clock-skew clamping, countdown epoch adjustment) is unit
 * tested off the untestable realtime page components — mirroring how
 * `raceTime.ts` / `scoreInput.ts` pull pure logic off the hooks.
 */

import type { CountdownSnapshot, SpeedlineSnapshot } from 'app/hooks/useWebSocket';
import { breakRemainingFrom } from 'app/util/breakState';
import { remainingFrom } from 'app/util/time';

// ---------------------------------------------------------------------------
// Cross-mode snapshot tolerance
// ---------------------------------------------------------------------------

/**
 * `compId` doubles as both modes' relay session, so a Speedline and a Freestyle
 * control page can share one room. A preview's `request_state` is then answered
 * by BOTH controls, so a preview can receive the OTHER mode's `state_snapshot`.
 * These structural guards let each timer display drop a foreign snapshot rather
 * than mis-render it: a SpeedlineSnapshot has no per-lane `remainingMs`, so
 * `countdownLaneState` would drive a Freestyle lane to `NaN`; a CountdownSnapshot
 * has no `signalPhase`/`text`, so it would blank the Speedline start light.
 * The discriminator is `signalPhase` — SpeedlineSnapshot always carries it as a
 * number, CountdownSnapshot never has it.
 */
export const isSpeedlineSnapshot = (
  snapshot: SpeedlineSnapshot | CountdownSnapshot,
): snapshot is SpeedlineSnapshot => typeof (snapshot as SpeedlineSnapshot).signalPhase === 'number';

export const isCountdownSnapshot = (
  snapshot: SpeedlineSnapshot | CountdownSnapshot,
): snapshot is CountdownSnapshot => !isSpeedlineSnapshot(snapshot);

// The wire-boundary half of the same two guards (ADR 0051): `unknown` in, every
// field a consumer reads checked. The relay frame guard runs these once per
// frame, so the typed discriminators above can stay one-field cheap.

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumberOrNull = (v: unknown): boolean => v === null || typeof v === 'number';
const isOptional = (v: unknown, check: (v: unknown) => boolean): boolean =>
  v === undefined || check(v);
const isNumber = (v: unknown): boolean => typeof v === 'number';
const isBoolean = (v: unknown): boolean => typeof v === 'boolean';

/** `{ 1: number; 2: number }` — the per-lane tallies (false starts, run wins). */
export const isLanePair = (v: unknown): boolean =>
  isObject(v) && typeof v[1] === 'number' && typeof v[2] === 'number';

const isSpeedlineTimerRow = (v: unknown): boolean =>
  isObject(v) &&
  typeof v.timerId === 'number' &&
  isNumberOrNull(v.startTime) &&
  isNumberOrNull(v.stopTime);

export const isSpeedlineSnapshotShape = (v: unknown): v is SpeedlineSnapshot =>
  isObject(v) &&
  typeof v.isPreviewEnabled === 'boolean' &&
  typeof v.signalPhase === 'number' &&
  typeof v.text === 'string' &&
  Array.isArray(v.timers) &&
  v.timers.every(isSpeedlineTimerRow) &&
  isOptional(v.at, isNumber) &&
  isOptional(v.falseStarts, isLanePair);

const isCountdownTimerRow = (v: unknown): boolean =>
  isObject(v) &&
  typeof v.timerId === 'number' &&
  typeof v.remainingMs === 'number' &&
  typeof v.isRunning === 'boolean' &&
  isOptional(v.startedAt, isNumber) &&
  isOptional(v.breakStartedAt, isNumber) &&
  isOptional(v.onBreak, isBoolean) &&
  isOptional(v.breakRemainingMs, isNumber) &&
  isOptional(v.breaksLeft, isNumber) &&
  isOptional(v.armedMs, isNumber);

export const isCountdownSnapshotShape = (v: unknown): v is CountdownSnapshot =>
  isObject(v) &&
  typeof v.isPreviewEnabled === 'boolean' &&
  Array.isArray(v.timers) &&
  v.timers.every(isCountdownTimerRow);

// ---------------------------------------------------------------------------
// Speedline
// ---------------------------------------------------------------------------

/** Current control-page Speedline state, as the page already tracks it. */
export interface SpeedlineControlState {
  isPreviewEnabled: boolean;
  /** Wall clock at build, stamped onto the snapshot as `at` (see the field). */
  now: number;
  signalPhase: number;
  text: string;
  timers: Array<{
    timerId: number;
    startTime: number | null;
    stopTime: number | null;
  }>;
  /** Per-lane false-start counts to carry into a recovery snapshot (S2–S4). */
  falseStarts?: { 1: number; 2: number };
}

export const buildSpeedlineSnapshot = (state: SpeedlineControlState): SpeedlineSnapshot => ({
  isPreviewEnabled: state.isPreviewEnabled,
  at: state.now,
  signalPhase: state.signalPhase,
  text: state.text,
  timers: state.timers.map((t) => ({
    timerId: t.timerId,
    startTime: t.startTime,
    stopTime: t.stopTime,
  })),
  ...(state.falseStarts ? { falseStarts: state.falseStarts } : {}),
});

/** A recovered Speedline lane, normalized for the preview to apply directly. */
export type SpeedlineLaneState = (
  | { kind: 'idle' }
  | { kind: 'running'; startTime: number }
  | { kind: 'finished'; startTime: number; stopTime: number; elapsedMs: number }
) & {
  /** The carrying snapshot's `at` — when the control ASSERTED this lane state,
   * as opposed to the epochs the state itself is made of. Only the snapshot
   * path sets it (the control page drives its own lanes from live state, where
   * the question doesn't arise), and only `mergeRecovery` reads it. */
  assertedAt?: number;
};

/**
 * Classify one snapshot lane. Both-null ⇒ idle, start-only ⇒ running, start +
 * stop ⇒ finished (with the frozen elapsed, clamped against clock skew). A stop
 * without a start is meaningless live state, so it is treated as idle.
 */
export const speedlineLaneState = (
  timer: SpeedlineSnapshot['timers'][number],
  assertedAt?: number,
): SpeedlineLaneState => {
  const stamp = assertedAt != null ? { assertedAt } : {};
  if (timer.startTime == null) {
    return { kind: 'idle', ...stamp };
  }
  if (timer.stopTime == null) {
    return { kind: 'running', startTime: timer.startTime, ...stamp };
  }
  return {
    kind: 'finished',
    startTime: timer.startTime,
    stopTime: timer.stopTime,
    elapsedMs: Math.max(0, timer.stopTime - timer.startTime),
    ...stamp,
  };
};

// ---------------------------------------------------------------------------
// Freestyle countdown
// ---------------------------------------------------------------------------

/**
 * The canonical pre-send control-row: one Freestyle countdown lane as the
 * control page holds it, before `buildCountdownSnapshot` turns it into the wire
 * row. This is the builder INPUT shape — `lastRemainingMs` is the frozen active
 * budget (a running lane's live value is derived off `startedAt` here, not
 * accumulated) and the break clock is carried as `breakMs`/`breakStartedAt`.
 * Distinct from the already-unified WIRE row (`CountdownTimerRow` in
 * useWebSocket, which carries the epoch-adjusted `remainingMs`): the battle
 * reducer's `laneSnapshot` produces these rows and `buildCountdownSnapshot`
 * consumes them, so both ends share one definition.
 *
 * Lives here (not in battleMachine) to keep the module graph acyclic:
 * battleMachine already depends on this module (`countdownLaneState`), so the
 * shared type flows the same single direction (battleMachine -> timerSnapshot).
 */
export interface CountdownControlRow {
  timerId: number;
  lastRemainingMs: number;
  isRunning: boolean;
  startedAt: number | null;
  // Set while the lane is on a quali advisory break (ADR 0019/0036):
  // the active budget is frozen at `lastRemainingMs` (paused, not adjusted)
  // and the break clock counts down from `breakMs` since `breakStartedAt`.
  onBreak?: boolean;
  breakMs?: number;
  breakStartedAt?: number | null;
  // The lane's remaining quali break allowance — carried in EVERY phase (not
  // only on break), so a panel joining mid-run adopts the true count instead
  // of assuming the full allowance until the next start_break. Absent on the
  // allowance-free channels (warm-up, best trick).
  breaksLeft?: number;
  // The budget the lane was last armed to (ADR 0046 §2) — carried in EVERY
  // phase like the allowance, and for the same reason: it is the room's value,
  // not the joining panel's format default. The warm-up channel carries it too
  // (its armed default is what tells the audience surface a stopped window from
  // a fresh one); the best-trick try clock, which has no armed budget, does not.
  armedMs?: number;
}

/**
 * Current control-page Freestyle state. The page does not keep the live
 * remaining (it lives in each Countdown child), so it lifts the last value it
 * passed plus the wall-clock epoch a running lane started at, and this builder
 * adjusts for elapsed time at send.
 */
export interface CountdownControlState {
  isPreviewEnabled: boolean;
  now: number;
  timers: CountdownControlRow[];
}

export const buildCountdownSnapshot = (state: CountdownControlState): CountdownSnapshot => ({
  isPreviewEnabled: state.isPreviewEnabled,
  timers: state.timers.map((t) => {
    // An on-break lane is paused: hold the run remaining verbatim and surface the
    // live break clock so a reconnecting preview resumes the break tick.
    // `breakStartedAt: state.now` is the shared anchor the derived break
    // remaining applies to (the receiver ticks off it, not its own receipt).
    if (t.onBreak && t.breakMs != null && t.breakStartedAt != null) {
      return {
        timerId: t.timerId,
        remainingMs: Math.max(0, t.lastRemainingMs),
        isRunning: false,
        onBreak: true,
        breakRemainingMs: breakRemainingFrom(t.breakMs, t.breakStartedAt, state.now),
        breakStartedAt: state.now,
        breaksLeft: t.breaksLeft ?? 0,
        ...(t.armedMs != null ? { armedMs: t.armedMs } : {}),
      };
    }
    // A running lane's remaining is derived off its anchor at send; the send
    // epoch (`state.now`) rides on `startedAt` so a recovered lane re-derives
    // off the same shared epoch (`remainingFrom(remainingMs, startedAt, now)`)
    // and every late joiner converges instead of re-anchoring to its receipt.
    const remainingMs =
      t.isRunning && t.startedAt != null
        ? remainingFrom(t.lastRemainingMs, t.startedAt, state.now)
        : Math.max(0, t.lastRemainingMs);
    // The break allowance and the armed budget ride in every phase (`!= null`,
    // 0 is a real count), so a mid-run joiner doesn't assume the full allowance
    // and doesn't re-arm the room to its own preset; the channels that have
    // neither (warm-up, best trick) omit them.
    return {
      timerId: t.timerId,
      remainingMs,
      isRunning: t.isRunning,
      ...(t.isRunning ? { startedAt: state.now } : {}),
      ...(t.breaksLeft != null ? { breaksLeft: t.breaksLeft } : {}),
      ...(t.armedMs != null ? { armedMs: t.armedMs } : {}),
    };
  }),
});

/** Normalize a recovered countdown lane for the preview (clamp negatives). On an
 * on-break lane the break fields ride through so the preview resumes the break. */
export const countdownLaneState = (
  timer: CountdownSnapshot['timers'][number],
): CountdownSnapshot['timers'][number] => {
  const base = {
    timerId: timer.timerId,
    remainingMs: Math.max(0, timer.remainingMs),
    isRunning: timer.isRunning,
    // The shared run anchor rides through so a recovered running lane ticks off
    // the wire epoch, not its receipt (absent ⇒ receiver falls back to now).
    ...(timer.startedAt != null ? { startedAt: timer.startedAt } : {}),
    ...(timer.breaksLeft != null ? { breaksLeft: timer.breaksLeft } : {}),
    // The room's armed budget (ADR 0046 §2); absent from a pre-feature sender,
    // whose receiver falls back per phase (`laneFromSnapshot`).
    ...(timer.armedMs != null ? { armedMs: timer.armedMs } : {}),
  };
  if (!timer.onBreak) {
    return base;
  }
  return {
    ...base,
    onBreak: true,
    breakRemainingMs: Math.max(0, timer.breakRemainingMs ?? 0),
    // The shared break anchor, same role as `startedAt` for the break clock.
    ...(timer.breakStartedAt != null ? { breakStartedAt: timer.breakStartedAt } : {}),
    breaksLeft: timer.breaksLeft ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Recoverability
// ---------------------------------------------------------------------------

/**
 * Is there a run in this snapshot worth recovering? The gate the browser-local
 * self-snapshot both stores and restores through (ADR 0047).
 *
 * Speedline: any lane that has STARTED (running, or stopped with a time on it).
 * Countdown: any lane running, on a break, or part-spent against the budget it
 * was armed to (`armedMs`; a pre-feature row without one can only be judged by
 * `isRunning`).
 */
export const snapshotHasRun = (snapshot: SpeedlineSnapshot | CountdownSnapshot): boolean =>
  isSpeedlineSnapshot(snapshot)
    ? snapshot.timers.some((t) => t.startTime != null)
    : snapshot.timers.some(
        (t) =>
          t.isRunning || t.onBreak === true || (t.armedMs != null && t.remainingMs < t.armedMs),
      );
