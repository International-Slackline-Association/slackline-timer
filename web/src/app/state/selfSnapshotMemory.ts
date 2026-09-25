/**
 * The control panel's browser-local copy of its OWN last state (ADR 0047).
 *
 * Peer-to-peer recovery (ADR 0011) only works when a second panel is in the room
 * to answer `request_state`; a SOLO panel that reloads or crashes mid-run has
 * nobody to ask. This is the fallback: the same snapshot the panel already
 * answers with, kept on the device, keyed by `sessionId` + discipline (both
 * boards share one relay room). The relay stays stateless — nothing here ever
 * leaves the browser, and a peer answer always wins over it.
 *
 * Device-local operator state, alongside `freestyleModeMemory` /
 * `panelSoundMemory` — never a data-plane write.
 */

import type { CountdownSnapshot, LiveSelection, SpeedlineSnapshot } from 'app/hooks/useWebSocket';
import type { Discipline } from 'app/types';

export interface SelfSnapshotRecord {
  /** Wall clock at save — this device's own clock on both ends of the comparison,
   * so the age bound never crosses machines. */
  at: number;
  snapshot: SpeedlineSnapshot | CountdownSnapshot;
  /** Stored beside the snapshot because a snapshot carries no athletes/round/
   * match: without it a recovered run comes back nameless and records nothing. */
  selection: LiveSelection;
}

/**
 * How old a stored run may be and still be offered back. Long enough to cover a
 * reload, a crash-and-relaunch or a laptop swap mid-heat; short enough that
 * yesterday's board cannot walk back onto the screen.
 */
export const SELF_SNAPSHOT_MAX_AGE_MS = 15 * 60_000;

const storageKey = (sessionId: string, discipline: Discipline) =>
  `speedline.selfSnapshot.${sessionId}.${discipline}`;

/** The stored record, or null when there is none, it is unreadable, or it is
 * outside the age bound (a future stamp reads as a corrected device clock). */
export const readSelfSnapshot = (
  sessionId: string,
  discipline: Discipline,
  now: number,
): SelfSnapshotRecord | null => {
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId, discipline));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Partial<SelfSnapshotRecord>;
    if (typeof record.at !== 'number' || !record.snapshot || !record.selection) return null;
    const age = now - record.at;
    if (age < 0 || age > SELF_SNAPSHOT_MAX_AGE_MS) return null;
    return record as SelfSnapshotRecord;
  } catch {
    return null;
  }
};

export const storeSelfSnapshot = (
  sessionId: string,
  discipline: Discipline,
  record: SelfSnapshotRecord,
): void => {
  try {
    window.localStorage.setItem(storageKey(sessionId, discipline), JSON.stringify(record));
  } catch {
    // Private-mode / disabled / full storage: the panel simply has no fallback,
    // which is exactly where it stood before this feature.
  }
};

export const clearSelfSnapshot = (sessionId: string, discipline: Discipline): void => {
  try {
    window.localStorage.removeItem(storageKey(sessionId, discipline));
  } catch {
    // See storeSelfSnapshot.
  }
};
