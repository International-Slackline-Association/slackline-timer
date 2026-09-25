import { createEvent, fireEvent } from '@testing-library/react';
import { expect, vi } from 'vitest';

import type { RaceRecorder } from 'app/hooks/useRaceRecorder';
import type { Athlete } from 'app/types';

/** Shared fixtures for the Speedline desk's two recording surfaces — the lane
 * columns of the live path and the recording rail beside it. Both render off
 * one `RaceRecorder`, so they stub it the same way. */

export const athlete = (
  athleteId: string,
  name: string,
  gender: 'male' | 'female' = 'male',
): Athlete => ({
  athleteId,
  compId: 'c1',
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  shortName: name.split(' ')[0],
  birthDate: '1990-01-01',
  country: 'USA',
  gender,
});

export const ATHLETES = [
  athlete('a1', 'Jane Doe'),
  athlete('a2', 'John Roe'),
  athlete('a3', 'Fay Frau', 'female'),
];

/** A recorder stub: just the fields the surfaces read + spies for the callbacks. */
export const makeRecorder = (over: Partial<RaceRecorder> = {}): RaceRecorder =>
  ({
    round: 'qualification',
    setRound: vi.fn(),
    requestRound: vi.fn(),
    requestGender: vi.fn(),
    pendingChange: null,
    confirmPendingChange: vi.fn(),
    cancelPendingChange: vi.fn(),
    roundMatches: [],
    laneAthletes: { 1: '', 2: '' },
    setLaneAthlete: vi.fn(),
    swapLanes: vi.fn(),
    laneAttempts: { 1: { used: 0, capped: false }, 2: { used: 0, capped: false } },
    attemptCap: 2,
    onRaceStart: vi.fn(),
    onReset: vi.fn(),
    recordFinish: vi.fn(),
    recordDnf: vi.fn(),
    editLaneTime: vi.fn(),
    moveTime: vi.fn(),
    voidRun: vi.fn(),
    fsCounts: { 1: 0, 2: 0 },
    flagFs: vi.fn(),
    clearFs: vi.fn(),
    fsOutcome: { kind: 'none' },
    awardRunTo: vi.fn(),
    createTime: { isError: false, error: null } as never,
    updateTime: { isError: false, error: null } as never,
    deleteTime: { isError: false, error: null } as never,
    laneFeedback: { 1: null, 2: null },
    toast: null,
    clearToast: vi.fn(),
    selectedGender: 'male',
    selectedMatchId: '',
    setSelectedMatchId: vi.fn(),
    selectMatch: vi.fn(),
    matches: { data: [] } as never,
    updateMatch: { isError: false, error: null } as never,
    derivedWinner: null,
    runWins: { 1: 0, 2: 0 },
    resetSeries: vi.fn(),
    ...over,
  }) as RaceRecorder;

/** A lane's saved feedback, bound to `athleteId`'s Time. */
export const savedFeedback = (timeId: string, valueMs: number, athleteId = 'a1') => ({
  status: 'saved' as const,
  valueMs,
  saved: {
    timeId,
    input: { athleteId, round: 'final' as const, timeMs: valueMs, startTime: 1000 },
  },
});

/** The two halves of the `RaceButton` contract a hand-painted press misses. */
export const expectRaceControl = (control: HTMLElement): void => {
  expect(parseFloat(window.getComputedStyle(control).minHeight)).toBeGreaterThanOrEqual(44);
  const press = createEvent.mouseDown(control);
  fireEvent(control, press);
  expect(press.defaultPrevented).toBe(true);
};
