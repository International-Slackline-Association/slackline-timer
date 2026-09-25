import type { LiveSelection } from 'app/hooks/useWebSocket';

/**
 * Last-writer-wins acceptance for `updateSelection` (ADR 0038 §4). Control
 * panels mint a monotonic `seq` (wall-clock anchored, Lamport-bumped past
 * everything seen) on every outgoing selection; every consumer — panel or
 * passive overlay/preview — drops an incoming one at or below its last seen
 * stamp, so the losing side of a crossed concurrent edit never rolls a
 * fresher value back, regardless of arrival order.
 */
export interface SelectionStamp {
  seq: number;
  /** The envelope `senderId` of the frame the stamp came off — the last-resort
   * tiebreak, now that authority outranks it. */
  by: string;
  /** Whether that frame was a re-statement rather than a claim (see the wire
   * `echo` flag). A stored echo yields to the authoritative frame it restates. */
  echo: boolean;
}

/** Never mutated — safe as a shared ref initializer. */
export const INITIAL_SELECTION_STAMP: SelectionStamp = { seq: 0, by: '', echo: false };

/**
 * Decide whether an incoming `updateSelection` supersedes the last stamp seen.
 * Returns the stamp to store when the message must be applied, or null to
 * drop it as stale. Unstamped (pre-feature page) messages always apply and
 * leave the stamp untouched.
 *
 * The rank is `seq`, then **authority**, then `by` (ADR 0038 §4 addendum). A
 * mirror's re-push forwards the stamp it adopted, so it can only tie the panel
 * that authored the value; ranking authority above `by` is what makes that tie
 * deterministic instead of a per-mount-UUID coin flip. A consumer that took the
 * echo first is still corrected when the author's own frame lands (authoritative
 * beats a stored echo at equal `seq`), and the mirror can still inform a
 * consumer that missed the author's frame entirely — it just can no longer
 * overwrite the author.
 */
export const acceptSelectionStamp = (
  last: SelectionStamp,
  message: { seq?: number; senderId?: string; echo?: boolean },
): SelectionStamp | null => {
  const { seq } = message;
  if (seq === undefined) return last;
  const echo = message.echo === true;
  const stamp = { seq, by: message.senderId ?? '', echo };
  if (seq !== last.seq) return seq > last.seq ? stamp : null;
  if (echo !== last.echo) return echo ? null : stamp;
  return stamp.by > last.by ? stamp : null;
};

/**
 * JSON with the two distinctions the wire doesn't have removed: keys are
 * visited in sorted order and `undefined`-valued ones are skipped (absent and
 * explicitly-undefined are the same field once stringified). Shape-agnostic on
 * purpose — arrays included — so it keeps digesting a `LiveSelection` field
 * nobody has added yet.
 */
const digest = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(digest).join(',')}]`;
  const member = value as Record<string, unknown>;
  const keys = Object.keys(member).filter((key) => member[key] !== undefined);
  return `{${keys
    .sort()
    .map((key) => `${JSON.stringify(key)}:${digest(member[key])}`)
    .join(',')}}`;
};

/**
 * The re-push key of `useControlSession`'s `updateSelection` effect, replacing
 * the dep array that listed every selection field by hand — and had to be
 * extended by hand for each new one, silently not following the ones it missed.
 *
 * Two properties carry it: the walk is STRUCTURAL, so a field added to
 * `LiveSelection` (a nested tally member included) moves the key without the
 * hook knowing it exists; and equal values digest equal, which is what
 * terminates the cross-panel echo (ADR 0038) — a mirrored peer application
 * rebuilds the selection object, and only a real value change may re-push.
 */
export const selectionSignature = (selection: LiveSelection): string => digest(selection);
