/**
 * What a handset press just did, in one line — the live half of the Freestyle
 * board's handset card (FREESTYLE_BOARD_UX §4.14). The card is the only place
 * an operator can check a binding without spending a real press on a live
 * board, so the readout has to be right about presses that did *nothing*: an
 * inert press reads `→ locked: …` and a press behind a confirm reads
 * `→ closed the … dialog`, rather than the silence that makes a dead handset
 * indistinguishable from a locked one (audit S18).
 *
 * Pure, and derived from exactly what the handlers dispatch on: the button
 * numbers come from `buzzer.ts`'s constants, the verdicts from the same
 * `laneLocks` / `bestTrickLocks` interlock table the pad effects in
 * `CountdownControl` / `BestTrickPanel` read, the ADVANCE step from the same
 * `advanceRoute` that press dispatches, and the overlay answer from the one
 * `advanceOverlay` guard. Nothing here re-decides anything.
 */

import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import type { ConfirmGuard } from 'app/hooks/useAdvanceInput';
import { advanceLabel, advanceRoute, type AdvanceNames } from 'app/util/advanceRoute';
import { runningLane, type BattleState } from 'app/util/battleMachine';
import type { TrySeriesState } from 'app/util/bestTrickSeries';
import type { PlayerId } from 'app/util/breakState';
import {
  ADVANCE_BUTTON,
  LANE_2_OFFSET,
  LANE_BUTTONS,
  buzzButton,
  buzzerRows,
} from 'app/util/buzzer';
import { bestTrickLocks, laneLocks, lockReason, type Lock } from 'app/util/lockReason';

/** Everything a verdict depends on: the board the handlers guard on, plus the
 * overlay `advanceOverlay()` reports at the instant of the press. */
export interface HandsetContext {
  mode: FreestyleMode;
  battle: BattleState;
  trySeries: TrySeriesState | null;
  /** The lane athletes, so the ADVANCE key names its step in the plate's words. */
  names: AdvanceNames;
  advanceOverlay: { confirm: ConfirmGuard | null } | null;
}

export type HandsetOutcome =
  | { kind: 'fired'; action: string }
  /** An ADVANCE the router had nothing to do: the press is real, the step is
   * not, so it can never be counted (or read) as one that fired. */
  | { kind: 'noop'; action: string }
  | { kind: 'locked'; reason: string }
  | { kind: 'closed'; confirm: ConfirmGuard }
  /** The board binds nothing to this button in this mode. */
  | { kind: 'unbound' };

const verdict = (lock: Lock | null, action: string): HandsetOutcome =>
  lock === null ? { kind: 'fired', action } : { kind: 'locked', reason: lockReason(lock) };

/** Why every key but ADVANCE is inert while an overlay is up (§4.8) — the
 * question by name, since answering it is the only way past. A bare picker has
 * no name to give and no safe answer to call: it is the browser's to close.
 * Exported for the second desk, whose keys are ALL held this way: Speedline
 * binds no answer to the pad, so its readout reaches for the same sentence. */
export const overlayLockReason = (confirm: ConfirmGuard | null): string =>
  confirm === null ? 'a picker is open' : `answer the ${confirm.dialog} question first`;

/**
 * The ADVANCE key's verdict, off the one route the press dispatches (§4.1).
 * The row label ("ADVANCE (also Space)") names the binding for the mapping
 * list, not the step — this is the one key whose effect the board decides
 * rather than the button. By the time the card is read the plate has moved on
 * to promising the NEXT press, so this line is the only record of the last
 * one, and both quote `advanceLabel` so they cannot word it two ways.
 */
const advanceStep = (ctx: HandsetContext): HandsetOutcome => {
  const route = advanceRoute(ctx.mode, ctx.battle, ctx.trySeries);
  const label = advanceLabel(route, ctx.names);
  // The `then:` hint is dropped — the promise beyond this press is the plate's.
  // A dead end keeps its reason: that IS what the press answered with.
  return route.kind === 'noop'
    ? { kind: 'noop', action: `${label.verb} — ${label.detail}` }
    : { kind: 'fired', action: `${label.verb} ${label.target}` };
};

/** What pressing `button` would do on this board, right now. */
export const handsetOutcome = (button: number, ctx: HandsetContext): HandsetOutcome => {
  const row = buzzerRows(ctx.mode).find((r) => r.button === button);
  if (row === undefined) return { kind: 'unbound' };

  const overlay = ctx.advanceOverlay;
  if (button === ADVANCE_BUTTON) {
    if (overlay !== null) {
      return overlay.confirm === null
        ? { kind: 'locked', reason: overlayLockReason(null) }
        : { kind: 'closed', confirm: overlay.confirm };
    }
    return advanceStep(ctx);
  }
  // Before the board is consulted at all: the pad handlers bail on
  // `overlayOwnsBoard()` ahead of their own interlocks, so reporting the lane's
  // own lock here would name a blocker that is not the one holding the press.
  if (overlay !== null) return { kind: 'locked', reason: overlayLockReason(overlay.confirm) };

  const athleteSlot: PlayerId = button >= LANE_2_OFFSET ? 2 : 1;
  const running = runningLane(ctx.battle);
  const locks = laneLocks({
    id: athleteSlot,
    lane: ctx.battle[athleteSlot],
    runningLane: running,
    bestTrickArmed: ctx.trySeries !== null,
  });

  switch (button - (athleteSlot === 2 ? LANE_2_OFFSET : 0)) {
    case LANE_BUTTONS.start:
      return verdict(locks.start, row.action);
    case LANE_BUTTONS.stop:
      return verdict(locks.stop, row.action);
    case LANE_BUTTONS.reset:
      return verdict(locks.reset, row.action);
    // Battle's aux key IS the Stop event under the manual's other word for it
    // ("End turn"), so it answers to Stop's lock, not to the break allowance.
    case LANE_BUTTONS.aux:
      return ctx.mode === 'battle'
        ? verdict(locks.stop, row.action)
        : verdict(locks.takeBreak, row.action);
    case LANE_BUTTONS.try: {
      const series = ctx.trySeries;
      // Either try key ends an open window, mirroring the one side-agnostic
      // End try button — so the readout names what the press actually did.
      if (series !== null && series.clock.running) return { kind: 'fired', action: 'End try' };
      return verdict(
        bestTrickLocks({ series, runningLane: running }).startTry[athleteSlot],
        row.action,
      );
    }
    default:
      return { kind: 'unbound' };
  }
};

/**
 * `→ locked: <reason>` (§4.14), without doubling the word: the board-wide holds
 * already word themselves as "locked while Athlete 1 runs" for the why-lines
 * under the buttons, and one lock reads one way everywhere.
 */
const lockedTail = (reason: string): string =>
  reason.startsWith('locked') ? `→ ${reason}` : `→ locked: ${reason}`;

/** The press, said in the card's one line: `handset 2 · blue → Stop Athlete 2`. */
export const handsetReadout = (button: number, outcome: HandsetOutcome): string => {
  const { handset, color } = buzzButton(button);
  const tail = (() => {
    switch (outcome.kind) {
      // A dead end needs no tail of its own — the label already says it did
      // nothing. The verdicts stay apart so nothing has to parse that sentence.
      case 'fired':
      case 'noop':
        return `→ ${outcome.action}`;
      case 'locked':
        return lockedTail(outcome.reason);
      case 'closed':
        return `→ closed the ${outcome.confirm.dialog} dialog (${outcome.confirm.safeAction})`;
      case 'unbound':
        return '→ nothing on this board';
    }
  })();
  return `handset ${handset} · ${color.toLowerCase()} ${tail}`;
};

/** How long ago the press was, as `0:04` — minutes unpadded, like the brief. */
export const agoLabel = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
