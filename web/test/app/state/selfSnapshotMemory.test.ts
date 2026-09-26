import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SELF_SNAPSHOT_MAX_AGE_MS,
  clearSelfSnapshot,
  readSelfSnapshot,
  storeSelfSnapshot,
  type SelfSnapshotRecord,
} from 'app/state/selfSnapshotMemory';
import type { LiveSelection, SpeedlineSnapshot } from 'app/hooks/useWebSocket';

const selection: LiveSelection = {
  discipline: 'speed',
  round: 'final',
  gender: 'male',
  matchId: 'm1',
  athlete1Id: 'a1',
  athlete2Id: 'a2',
};

const snapshot: SpeedlineSnapshot = {
  isPreviewEnabled: true,
  at: 9_000,
  signalPhase: 0,
  text: '',
  timers: [{ timerId: 1, startTime: 1_000, stopTime: null }],
};

const record = (at: number): SelfSnapshotRecord => ({ at, snapshot, selection });

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('selfSnapshotMemory', () => {
  it('returns null for a panel with nothing stored', () => {
    expect(readSelfSnapshot('comp-1', 'speed', 10_000)).toBeNull();
  });

  it('round-trips the panel’s own snapshot + selection', () => {
    storeSelfSnapshot('comp-1', 'speed', record(10_000));
    expect(readSelfSnapshot('comp-1', 'speed', 10_000)).toEqual(record(10_000));
  });

  it('keys the record off the session AND the discipline (both boards share a room)', () => {
    storeSelfSnapshot('comp-1', 'speed', record(10_000));
    expect(readSelfSnapshot('comp-1', 'freestyle', 10_000)).toBeNull();
    expect(readSelfSnapshot('comp-2', 'speed', 10_000)).toBeNull();
  });

  it('drops a record older than the recovery bound', () => {
    storeSelfSnapshot('comp-1', 'speed', record(10_000));
    expect(readSelfSnapshot('comp-1', 'speed', 10_000 + SELF_SNAPSHOT_MAX_AGE_MS)).not.toBeNull();
    expect(readSelfSnapshot('comp-1', 'speed', 10_000 + SELF_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
  });

  it('drops a record stamped in the future (a clock the device has since corrected)', () => {
    storeSelfSnapshot('comp-1', 'speed', record(10_000));
    expect(readSelfSnapshot('comp-1', 'speed', 9_000)).toBeNull();
  });

  it('rejects a corrupted record instead of returning it', () => {
    window.localStorage.setItem('speedline.selfSnapshot.comp-1.speed', '{ not json');
    expect(readSelfSnapshot('comp-1', 'speed', 10_000)).toBeNull();

    window.localStorage.setItem('speedline.selfSnapshot.comp-1.speed', '{"at":10000}');
    expect(readSelfSnapshot('comp-1', 'speed', 10_000)).toBeNull();
  });

  it('clears a stored record', () => {
    storeSelfSnapshot('comp-1', 'speed', record(10_000));
    clearSelfSnapshot('comp-1', 'speed');
    expect(readSelfSnapshot('comp-1', 'speed', 10_000)).toBeNull();
  });
});
