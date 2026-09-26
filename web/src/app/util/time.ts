/**
 * Time formatting / parsing utilities.
 *
 * Ported 1:1 from timertimer's `Timertimer.Timer` (lib/timertimer/timer.ex) so the
 * Slackline Timer migration keeps identical display semantics — including the magic
 * DNF sentinel. See doc/dev/architecture.md ("Data model").
 */

/** Elapsed-ms value that means "Did Not Finish". Preserve this exact integer. */
export const DNF_SENTINEL = 3_355_550;
export const DNF_LABEL = 'DNF';

const pad = (n: number): string => n.toString().padStart(2, '0');

/**
 * A countdown clock's live remaining: the budget less the wall-clock elapsed
 * since its anchor, clamped at zero (`max(0, durationMs − (now − anchorMs))`).
 * The ONE shared source for every anchored countdown derivation — lanes, the
 * quali break, the best-trick try clock, the snapshot builder, the display tick
 * — so the arithmetic and the anchor concept live in exactly one place. Pure /
 * React-free (wall clock arrives as `now`), like `formatClock`/`formatMs`.
 */
export const remainingFrom = (durationMs: number, anchorMs: number, now: number): number =>
  Math.max(0, durationMs - (now - anchorMs));

/**
 * `remainingFrom` seeded to the whole second IN PROGRESS (ceil): a fresh anchor
 * is already a few ms old by the time a display applies it, and `formatClock`
 * floors, so a raw seed would flash e.g. `01:59` for a `02:00` start. Layered on
 * `remainingFrom` (adds `ceil(…/1000)*1000`), never a second copy of the
 * subtraction. Subsequent ticks re-derive from the same anchor via
 * `remainingFrom` exactly.
 */
export const remainingCeilSecond = (durationMs: number, anchorMs: number, now: number): number =>
  Math.ceil(remainingFrom(durationMs, anchorMs, now) / 1000) * 1000;

/**
 * Format elapsed milliseconds as `M:SS.hh` (minutes are not zero-padded).
 * `null`/`undefined` render as the empty clock `00:00:00`; the DNF sentinel renders `DNF`.
 *
 * Negatives clamp to `0` (`0:00.00`), like `formatClock`. A running Speedline lane
 * derives its elapsed as `now − startEpoch` on the VIEWER's clock against the
 * operator-minted start epoch (Stopwatch's tick); with no clock-skew correction
 * (ADR 0021) a viewer clock a few ms behind the operator's yields a transient
 * negative for the first frames after `start`. That benign skew must render `0:00.00`,
 * not crash the broadcast overlay — the throw here was a defensive guard, not a spec.
 */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '00:00:00';
  if (!Number.isInteger(ms)) throw new Error(`formatMs expects an integer, got ${ms}`);
  if (ms === DNF_SENTINEL) return DNF_LABEL;
  if (ms < 0) return '0:00.00';

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const hundredths = Math.floor((ms % 1_000) / 10);

  return `${minutes}:${pad(seconds)}.${pad(hundredths)}`;
}

/**
 * Format elapsed/remaining milliseconds as a wall clock — `mm:ss`, widening to
 * `hh:mm:ss` past an hour — clamping negatives to `00:00`. This is the countdown
 * clock face (whole seconds, zero-padded minutes), distinct from `formatMs`'s
 * `M:SS.hh` race face; `ElapsedTime`'s `clock` format renders it.
 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

const isInt = (s: string): number | null => {
  if (!/^\d+$/.test(s)) return null;
  return Number.parseInt(s, 10);
};

/**
 * Parse a `M:SS.hh` or `M:SS:hh` string into elapsed milliseconds.
 * Empty string / null parse to `0`. Returns `null` for anything unparseable
 * or out of range (seconds 0–59, hundredths 0–99).
 */
export function parseTimeString(str: string | null | undefined): number | null {
  if (str === null || str === undefined || str === '') return 0;

  let parts: string[];
  if (str.includes(':') && str.includes('.')) {
    const [minSec, hund] = str.split('.');
    parts = [...minSec.split(':'), hund];
  } else if (str.includes(':')) {
    parts = str.split(':');
  } else {
    return null;
  }

  if (parts.length !== 3) return null;
  const [min, sec, hund] = parts.map(isInt);
  if (min === null || sec === null || hund === null) return null;
  if (sec < 0 || sec > 59) return null;
  if (hund < 0 || hund > 99) return null;

  return min * 60_000 + sec * 1_000 + hund * 10;
}

/** True when `parseTimeString` would succeed for `str`. */
export function isValidTimeFormat(str: string | null | undefined): boolean {
  return parseTimeString(str) !== null;
}
