/**
 * The one-button ADVANCE router (FREESTYLE_BOARD_UX §4.1) — one pure decision
 * shared by every trigger and by the board that announces it.
 *
 * `advanceRoute` answers "what does the next press do?" as data: the machine to
 * dispatch into plus the event, or an explicit no-op with its reason.
 * `advanceLabel` renders that same decision for the operator. Because the press
 * and the plate read ONE function, the board cannot promise something the press
 * does not do — the failure the old split invited, where the page cued a beep
 * and then discovered there was nothing to advance.
 *
 * Design notes (HSM rules):
 *  - Pure and clock-free. Wall clock is not a routing input, so it stays off the
 *    decision: the caller stamps it with `battleAdvanceEvent` / `tryAdvanceEvent`
 *    on dispatch, and a render can ask for the label without inventing a `now`.
 *    The one answer that genuinely needs a clock — what follows a battle turn
 *    end whose partner lane is spent — is withheld, not guessed, and a caller
 *    that ticks settles it with `settleThen`.
 *  - The route's variants correlate verb and event (a `TAKE BREAK` route can
 *    only carry a `TAKE_BREAK`), so a mislabelled press is unrepresentable.
 *  - It routes, it never transitions: every returned event is one the battle /
 *    try-series reducers already own and guard.
 *
 * Router order (§4.1): a running lane wins over an armed series, then the series,
 * then the ADR 0037 mode cycles. The lane interlocks make "a lane runs while the
 * series is armed" unreachable; the order is pinned anyway.
 */

import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import {
  currentTurn,
  suggestedNext,
  type TrySeriesEvent,
  type TrySeriesState,
} from 'app/util/bestTrickSeries';
import {
  advanceTarget,
  laneRemainingMs,
  otherLane,
  runningLane,
  type BattleEvent,
  type BattleState,
} from 'app/util/battleMachine';
import { canTakeBreak, type PlayerId } from 'app/util/breakState';
import { athleteLabel } from 'app/util/raceNames';

/** The battle transitions a press can fire, minus the wall clock (and the
 * per-competition break window) the caller stamps on dispatch. */
export type AdvanceBattleEvent =
  | { type: 'START'; lane: PlayerId }
  | { type: 'STOP'; lane: PlayerId }
  | { type: 'TAKE_BREAK'; lane: PlayerId };

/** The best-trick transitions a press can fire, same clock-free shape. */
export type AdvanceTryEvent = { type: 'START_TRY'; side: PlayerId } | { type: 'END_TRY' };

/** Why a press does nothing. The four dead ends of the §3 state table — each an
 * answer the operator can act on, never a silent swallow. */
export type AdvanceNoopReason = 'battleOver' | 'seriesDone' | 'noBreaksLeft' | 'qualiFinished';

/**
 * What the press AFTER this one will do — the plate's unbounded `then:`
 * sub-line. Domain literals rather than sentences: only the router sees the
 * state that answers this, only `advanceLabel` renders. A dead end is a
 * follow-up like any other (`noop` carries the reason the operator will read a
 * second later), so every press announces the next one.
 *
 * `unsettled` is the single exception — a follow-up the clock-free router
 * cannot decide. It renders as nothing; a caller holding a wall clock resolves
 * it with `settleThen`.
 */
export type AdvanceThen =
  | { kind: 'endsTurn' }
  | { kind: 'startLane'; lane: PlayerId }
  | { kind: 'laneAgain'; lane: PlayerId }
  | { kind: 'takeBreak'; breaksLeft: number }
  | { kind: 'resumeRun' }
  | { kind: 'endTry' }
  | { kind: 'nextTry'; side: PlayerId; nth: number; cap: number }
  | { kind: 'enterScores' }
  | { kind: 'noop'; reason: AdvanceNoopReason }
  | { kind: 'unsettled' };

/** The decision one ADVANCE press makes. */
export type AdvanceRoute =
  | {
      kind: 'battle';
      verb: 'START' | 'RESUME';
      event: { type: 'START'; lane: PlayerId };
      then: AdvanceThen;
    }
  | { kind: 'battle'; verb: 'STOP'; event: { type: 'STOP'; lane: PlayerId }; then: AdvanceThen }
  | {
      kind: 'battle';
      verb: 'TAKE BREAK';
      event: { type: 'TAKE_BREAK'; lane: PlayerId };
      then: AdvanceThen;
    }
  | {
      kind: 'try';
      verb: 'START TRY';
      event: { type: 'START_TRY'; side: PlayerId };
      then: AdvanceThen;
    }
  | {
      kind: 'try';
      verb: 'END TRY';
      event: { type: 'END_TRY' };
      /** The athlete whose window is open — END_TRY itself carries no side. */
      side: PlayerId;
      then: AdvanceThen;
    }
  | { kind: 'noop'; reason: AdvanceNoopReason };

/** The athlete display names the label renders, per athlete slot (`''` = unassigned). */
export type AdvanceNames = Record<PlayerId, string>;

/**
 * The rendered press label (§4.1's acceptance shape): `verb` is at most two
 * words, `target` names who it acts on, `detail` is the unbounded sub-line —
 * the `then:` hint on a real route, the bare reason on a no-op (the plate joins
 * them with its own em dash).
 *
 * **No live reading rides the label.** A clock, a break allowance, a held run,
 * the attempt a try opens — the §3 rows write those beside the verb, but they
 * belong to the plate's LEFT half, the half that ticks; a copy parked beside
 * the verb is a second-old duplicate of a number the other half already counts.
 * Pinned over the whole table in `test/app/util/advanceRoute.test.ts`.
 */
export interface AdvanceLabel {
  verb: string;
  target: string;
  detail: string;
}

/** The quali advisory-break cycle's follow-up: another break while the
 * allowance holds, else the dead end the operator meets next (Stop stays a
 * deliberate manual act). */
const afterQualiStart = (breaksLeft: number): AdvanceThen =>
  breaksLeft > 0 ? { kind: 'takeBreak', breaksLeft } : { kind: 'noop', reason: 'noBreaksLeft' };

/**
 * The battle turn end's follow-up: the other athlete's turn while they still
 * hold budget, else — the partner spent — whatever this lane's own budget
 * leaves, which only the wall clock knows. A caller without one gets
 * `unsettled` rather than a guess; `settleThen` is how the plate asks with a
 * `now`.
 */
const afterStop = (state: BattleState, lane: PlayerId, now: number | null): AdvanceThen => {
  const other = otherLane(lane);
  if (state[other].phase !== 'finished') {
    return { kind: 'startLane', lane: other };
  }
  if (now === null) {
    return { kind: 'unsettled' };
  }
  return laneRemainingMs(state[lane], now) > 0
    ? { kind: 'laneAgain', lane }
    : { kind: 'noop', reason: 'battleOver' };
};

/** The try end's follow-up: whoever the series suggests next, and which attempt
 * that is. END_TRY consumes nothing (a try is consumed on start), so the
 * suggestion off the current state IS the post-press one. */
const afterEndTry = (series: TrySeriesState): AdvanceThen => {
  const next = suggestedNext(series);
  return next === null
    ? { kind: 'enterScores' }
    : { kind: 'nextTry', side: next, nth: series.used[next] + 1, cap: series.cap };
};

/** The best-trick leg: end an open window, else open the suggested side's. */
const seriesRoute = (series: TrySeriesState): AdvanceRoute => {
  if (series.clock.running) {
    return {
      kind: 'try',
      verb: 'END TRY',
      event: { type: 'END_TRY' },
      side: series.clock.side,
      then: afterEndTry(series),
    };
  }
  const side = currentTurn(series);
  if (side === null) {
    return { kind: 'noop', reason: 'seriesDone' };
  }
  return {
    kind: 'try',
    verb: 'START TRY',
    event: { type: 'START_TRY', side },
    then: { kind: 'endTry' },
  };
};

/**
 * The quali leg (ADR 0037 §3): the single lane's run ↔ advisory-break toggle. A
 * press never kills a run — with the allowance spent it is an explicit no-op and
 * Stop / Reset stay deliberate manual acts. A lane that has already run resumes
 * rather than starts (`lastRan` survives the turn end, and RESET clears it).
 */
const qualiRoute = (state: BattleState): AdvanceRoute => {
  const live = runningLane(state);
  if (live !== null) {
    return canTakeBreak(true, state[live].breaksLeft)
      ? {
          kind: 'battle',
          verb: 'TAKE BREAK',
          event: { type: 'TAKE_BREAK', lane: live },
          then: { kind: 'resumeRun' },
        }
      : { kind: 'noop', reason: 'noBreaksLeft' };
  }
  const lane = state[1];
  if (lane.phase === 'finished') {
    return { kind: 'noop', reason: 'qualiFinished' };
  }
  // idle (armed, or held after a break) and onBreak (the early-start break
  // cancel, ADR 0019 §2) both start lane 1.
  return {
    kind: 'battle',
    verb: lane.phase === 'onBreak' || state.lastRan !== null ? 'RESUME' : 'START',
    event: { type: 'START', lane: 1 },
    then: afterQualiStart(lane.breaksLeft),
  };
};

/**
 * The battle leg (ADR 0037 §2): end the live turn, else start whoever is next
 * (`advanceTarget` alternates and skips a spent lane), else the battle is over.
 */
const battleRoute = (state: BattleState): AdvanceRoute => {
  const target = advanceTarget(state);
  return target === null
    ? { kind: 'noop', reason: 'battleOver' }
    : {
        kind: 'battle',
        verb: 'START',
        event: { type: 'START', lane: target },
        then: { kind: 'endsTurn' },
      };
};

/** What the next ADVANCE press does — the single decision the press dispatches
 * and the board announces. */
export const advanceRoute = (
  mode: FreestyleMode,
  state: BattleState,
  series: TrySeriesState | null,
): AdvanceRoute => {
  if (mode === 'quali') {
    return qualiRoute(state);
  }
  const live = runningLane(state);
  if (live !== null) {
    return {
      kind: 'battle',
      verb: 'STOP',
      event: { type: 'STOP', lane: live },
      then: afterStop(state, live, null),
    };
  }
  return series !== null ? seriesRoute(series) : battleRoute(state);
};

/**
 * The follow-up `advanceRoute` withheld, answered with a `now`. Only the battle
 * turn end needs it: with the partner lane spent, whether the stopping lane
 * survives its own stop is a wall-clock reading, and the press that decides the
 * match is the last one the plate should go quiet on. The plate already ticks,
 * so it settles the promise a second at a time — the same accuracy its live
 * facts are read at.
 *
 * Only `then` can change. Verb, target and the dispatched event are never a
 * clock decision (that is `advanceRoute`'s whole contract), so every other
 * route comes back as it went in.
 */
export const settleThen = (route: AdvanceRoute, state: BattleState, now: number): AdvanceRoute =>
  route.kind === 'battle' && route.then.kind === 'unsettled'
    ? { ...route, then: afterStop(state, route.event.lane, now) }
    : route;

/** Stamp a routed battle event for dispatch: the wall clock, plus the
 * per-competition break window `TAKE_BREAK` rides on. */
export const battleAdvanceEvent = (
  event: AdvanceBattleEvent,
  at: number,
  breakMs: number,
): BattleEvent => (event.type === 'TAKE_BREAK' ? { ...event, at, breakMs } : { ...event, at });

/** Stamp a routed try event for dispatch. */
export const tryAdvanceEvent = (event: AdvanceTryEvent, at: number): TrySeriesEvent => ({
  ...event,
  at,
});

/** `Athlete 1 · C. Bianchi`, or just the slot number before an athlete is picked. */
const athleteTarget = (lane: PlayerId, names: AdvanceNames): string =>
  names[lane] ? `Athlete ${lane} · ${names[lane]}` : `Athlete ${lane}`;

/** An athlete by name, falling back to their athlete slot. */
const athlete = (side: PlayerId, names: AdvanceNames): string => athleteLabel(side, names[side]);

/** The operator sentence behind a dead end — what to do instead. */
const reasonText = (reason: AdvanceNoopReason): string => {
  switch (reason) {
    case 'battleOver':
      return 'Begin best trick or Reset a lane';
    case 'seriesDone':
      return 'enter scores';
    case 'noBreaksLeft':
      return 'Stop is manual';
    case 'qualiFinished':
      return 'Reset is manual';
  }
};

const thenText = (then: AdvanceThen, names: AdvanceNames): string => {
  switch (then.kind) {
    case 'endsTurn':
      return 'then: a press ends the turn';
    case 'startLane':
      return `then: start ${athleteTarget(then.lane, names)}`;
    case 'laneAgain':
      // The partner is spent, so the athlete being stopped is the one the next
      // press starts — `again` is what keeps that from reading as a misprint.
      return `then: start ${athleteTarget(then.lane, names)} again`;
    case 'takeBreak':
      return `then: take a break (${then.breaksLeft} left)`;
    case 'resumeRun':
      return 'then: a press resumes the run';
    case 'endTry':
      return 'then: end the try';
    case 'nextTry':
      return `then: ${athlete(then.side, names)}'s try ${then.nth} of ${then.cap}`;
    case 'enterScores':
      return 'then: enter the scores';
    case 'noop':
      // The words the plate itself will show a press later, so the promise and
      // the dead end it predicts read identically.
      return `then: nothing to advance — ${reasonText(then.reason)}`;
    case 'unsettled':
      return '';
  }
};

/** Render a route for the operator — the same decision the press dispatches. */
export const advanceLabel = (route: AdvanceRoute, names: AdvanceNames): AdvanceLabel => {
  switch (route.kind) {
    case 'noop':
      return { verb: 'NOTHING TO ADVANCE', target: '', detail: reasonText(route.reason) };
    case 'battle':
      return {
        verb: route.verb,
        target: athleteTarget(route.event.lane, names),
        detail: thenText(route.then, names),
      };
    case 'try':
      return {
        verb: route.verb,
        target: athlete(route.verb === 'START TRY' ? route.event.side : route.side, names),
        detail: thenText(route.then, names),
      };
  }
};
