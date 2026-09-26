/**
 * Pure logic for the Freestyle quali advisory break (ADR 0019, narrowed by
 * 0036). One mechanism: a break clock that counts DOWN while the athlete rests,
 * holding their active budget paused; at zero the lane just holds for a manual
 * Start (long beep — the judge decides when to resume). Battle has NO break
 * clock (ADR 0036): the changeover is a control-local pause count-up owned by
 * the battle machine, so nothing here routes or auto-resumes anything.
 *
 * React-free and side-effect-free so the allowance and the break-clock
 * derivation are unit tested off the realtime page components — mirroring
 * `timerSnapshot.ts` / `raceTime.ts` / `scoreInput.ts`.
 */

import { remainingFrom } from 'app/util/time';

/** The two freestyle lanes. Local to keep this pure util off the hook layer. */
export type PlayerId = 1 | 2;

/** Reference quali allowance: up to 2 advisory breaks. Break length is
 * per-competition config, not a constant. */
export const MAX_BREAKS = 2;

/** A break is allowed only while the lane is running and an allowance remains. */
export const canTakeBreak = (isRunning: boolean, breaksLeft: number): boolean =>
  isRunning && breaksLeft > 0;

/**
 * The `start_break` payload: freeze the run at its current remaining, start the
 * break clock from `breakMs`, and return the post-decrement allowance (clamped
 * at zero). `breakMs` is the selected competition's `config.freestyle.breakMs`
 * — no hardcoded constant (ADR 0019 §6).
 */
export const takeBreak = (
  runRemainingMs: number,
  breakMs: number,
  breaksLeft: number,
): {
  runRemainingMs: number;
  breakMs: number;
  breaksLeft: number;
} => ({
  runRemainingMs,
  breakMs,
  breaksLeft: Math.max(0, breaksLeft - 1),
});

/** The break clock counting down from `breakMs` by wall-clock elapsed since it
 * started (clamped at zero) — used to recover `breakRemainingMs` in a snapshot.
 * A thin domain alias over the shared `remainingFrom` anchor arithmetic. */
export const breakRemainingFrom = (breakMs: number, breakStartedAt: number, now: number): number =>
  remainingFrom(breakMs, breakStartedAt, now);
