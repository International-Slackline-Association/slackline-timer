import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { useRaceRecorder, type RaceRecorder } from 'app/hooks/useRaceRecorder';
import type { Match, Time } from 'app/types';
import { DNF_SENTINEL } from 'app/util/time';

const COMP = 'c1';

const speedMatch = (matchId: string, athlete1Id: string, athlete2Id: string): Match => ({
  matchId,
  compId: COMP,
  discipline: 'speed',
  round: 'final',
  gender: 'male',
  position: 0,
  athlete1Id,
  athlete2Id,
});

// m1/m2 are final-round; m3 is a quarter — so the round filter has something to
// exclude and the confirm-on-round-change path has a different round to move to.
const MATCHES = [
  speedMatch('m1', 'a1', 'a2'),
  speedMatch('m2', 'a3', 'a4'),
  { ...speedMatch('m3', 'a5', 'a6'), round: 'quarter' as const },
];

interface FetchOpts {
  method?: string;
  body?: Record<string, unknown>;
}

let nextTimeId: number;
// Times the server "already has" — returned by the GET /times seed fetch.
// Default empty (no interference with the live-recording tests); the seeding
// tests set it before rendering.
let seededTimes: Time[];

// A POST held in flight, so a test can act while a save is still pending (the
// resume path has to survive its own save landing late).
let holdPost: boolean;
let releasePost: () => void;

/** Answer like the server: echo write bodies back with a generated/path id. */
const routeApi = (path: string, opts: FetchOpts = {}): unknown => {
  const method = opts.method ?? 'GET';
  if (method === 'GET' && path.includes('/matches?')) return MATCHES;
  if (method === 'GET' && path.includes('/times')) return seededTimes;
  if (method === 'POST' && path.endsWith('/times')) {
    const time = { ...opts.body, compId: COMP, timeId: `t${nextTimeId++}` };
    if (holdPost) return new Promise((resolve) => (releasePost = () => resolve(time)));
    return time;
  }
  if (method === 'PUT' && path.includes('/times/'))
    return { ...opts.body, compId: COMP, timeId: path.split('/').pop() };
  if (method === 'PUT' && path.includes('/matches/'))
    return { ...opts.body, compId: COMP, matchId: path.split('/').pop() };
  if (method === 'DELETE') return undefined;
  throw new Error(`unrouted ${method} ${path}`);
};

const matching = (method: string, pathPart: string): [string, FetchOpts?][] =>
  (apiFetchMock.mock.calls as [string, FetchOpts?][]).filter(
    ([path, opts]) => (opts?.method ?? 'GET') === method && path.includes(pathPart),
  );

/** The request bodies apiFetch received for a method + path fragment, in order. */
const bodies = (method: string, pathPart: string): Record<string, unknown>[] =>
  matching(method, pathPart).map(([, opts]) => opts?.body ?? {});

/** The request paths apiFetch received for a method + path fragment, in order. */
const paths = (method: string, pathPart: string): string[] =>
  matching(method, pathPart).map(([path]) => path);

const wrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

const renderRecorder = () => renderHook(() => useRaceRecorder(COMP), { wrapper: wrapper() });

/** A recorder with the matches list loaded and match m1 (a1 vs a2) selected. */
const matchRecorder = async () => {
  const rendered = renderRecorder();
  await waitFor(() => expect(rendered.result.current.matches.isSuccess).toBe(true));
  act(() => rendered.result.current.selectMatch('m1'));
  return rendered;
};

/** A recorder with lane 1 assigned and a race started at t=1000 (no match link). */
const startedRecorder = () => {
  const rendered = renderRecorder();
  act(() => rendered.result.current.setLaneAthlete(1, 'a1'));
  act(() => rendered.result.current.onRaceStart(1000));
  return rendered;
};

/**
 * Complete one full run of the selected match: start, both lanes stop, both
 * Times saved (so the feedback holds the run's timeIds before the next step).
 */
const completeRun = async (
  result: { current: RaceRecorder },
  startTime: number,
  stop1: number,
  stop2: number,
) => {
  act(() => result.current.onRaceStart(startTime));
  act(() => result.current.recordFinish(1, stop1));
  act(() => result.current.recordFinish(2, stop2));
  await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
  await waitFor(() => expect(result.current.laneFeedback[2]?.status).toBe('saved'));
};

describe('useRaceRecorder', () => {
  beforeEach(() => {
    nextTimeId = 1;
    seededTimes = [];
    holdPost = false;
    releasePost = () => {};
    apiFetchMock
      .mockReset()
      .mockImplementation((path: string, opts?: FetchOpts) =>
        Promise.resolve(routeApi(path, opts)),
      );
  });

  describe('time recording', () => {
    it('POSTs a Time when an assigned lane finishes and reports the save', async () => {
      const { result } = startedRecorder();
      act(() => result.current.recordFinish(1, 5000));

      expect(result.current.laneFeedback[1]).toMatchObject({ status: 'pending', valueMs: 4000 });
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(bodies('POST', '/times')).toEqual([
        { athleteId: 'a1', round: 'qualification', timeMs: 4000, startTime: 1000 },
      ]);
      // The saved id + body are stashed so the operator can post-correct timeMs.
      expect(result.current.laneFeedback[1]?.saved?.timeId).toBe('t1');
      expect(result.current.toast).toMatchObject({ severity: 'success' });
    });

    it('reports a failed save on the lane and via an error toast', async () => {
      apiFetchMock.mockImplementation((path: string, opts?: FetchOpts) =>
        (opts?.method ?? 'GET') === 'POST'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(routeApi(path, opts)),
      );
      const { result } = startedRecorder();
      act(() => result.current.recordFinish(1, 5000));

      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('error'));
      expect(result.current.laneFeedback[1]?.saved).toBeUndefined();
      expect(result.current.toast).toMatchObject({ severity: 'error' });
    });

    it('no-ops a repeat finish for a lane that already recorded this run', async () => {
      const { result } = startedRecorder();
      act(() => result.current.recordFinish(1, 5000));
      act(() => result.current.recordFinish(1, 9000));

      // Only the first stop counts; the repeat must not POST a second, longer Time.
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(bodies('POST', '/times')).toHaveLength(1);
      expect(bodies('POST', '/times')[0]).toMatchObject({ timeMs: 4000 });
    });

    it('keeps the other lane recordable after one lane locks', async () => {
      const { result } = startedRecorder();
      act(() => result.current.setLaneAthlete(2, 'a2'));
      act(() => result.current.recordFinish(1, 5000));
      act(() => result.current.recordFinish(2, 6000));

      await waitFor(() => expect(bodies('POST', '/times')).toHaveLength(2));
      expect(bodies('POST', '/times')[1]).toMatchObject({ athleteId: 'a2', timeMs: 5000 });
      // Lane 2 stopped while lane 1's POST was still in flight — BOTH saves must
      // land in the feedback (consecutive mutations share one observer, so
      // mutate-level callbacks would report only the latest; see saveTime).
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      await waitFor(() => expect(result.current.laneFeedback[2]?.status).toBe('saved'));
      expect(result.current.laneFeedback[1]?.saved?.timeId).toBe('t1');
      expect(result.current.laneFeedback[2]?.saved?.timeId).toBe('t2');
    });

    it('refuses a finish for a lane already recorded as DNF this run', async () => {
      const { result } = startedRecorder();
      act(() => result.current.recordDnf(1));
      act(() => result.current.recordFinish(1, 5000));

      // Only the DNF Time; the late stop must not add a second record.
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(bodies('POST', '/times')).toHaveLength(1);
      expect(bodies('POST', '/times')[0]).toMatchObject({ timeMs: DNF_SENTINEL });
    });

    it('dedupes a repeat DNF for a lane already recorded as DNF this run', async () => {
      const { result } = startedRecorder();
      act(() => result.current.recordDnf(1));
      act(() => result.current.recordDnf(1));

      // A double DNF press (gamepad/button) must POST the DNF Time exactly once.
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(bodies('POST', '/times')).toHaveLength(1);
      expect(bodies('POST', '/times')[0]).toMatchObject({ timeMs: DNF_SENTINEL });
    });

    it('CORRECTS the row a finished lane already saved instead of adding one', async () => {
      const { result } = startedRecorder();
      act(() => result.current.recordFinish(1, 5000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      // The athlete finished but is then disqualified/falls — DNF as a correction
      // stays allowed (ADR 0028), but it edits the attempt's ONE row: a second
      // Time would leave the real time ranking the athlete and burn a quali slot.
      act(() => result.current.recordDnf(1));

      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(result.current.laneFeedback[1]?.valueMs).toBe(DNF_SENTINEL);
      expect(bodies('POST', '/times')).toHaveLength(1);
      expect(paths('PUT', '/times/')).toEqual([`/competitions/${COMP}/times/t1`]);
      expect(bodies('PUT', '/times/')[0]).toMatchObject({
        athleteId: 'a1',
        round: 'qualification',
        timeMs: DNF_SENTINEL,
        startTime: 1000,
      });
    });

    it('dedupes a repeat DNF on a corrected lane too (one PUT, ADR 0028)', async () => {
      const { result } = startedRecorder();
      act(() => result.current.recordFinish(1, 5000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      act(() => result.current.recordDnf(1));
      act(() => result.current.recordDnf(1));

      await waitFor(() => expect(result.current.laneFeedback[1]?.valueMs).toBe(DNF_SENTINEL));
      expect(bodies('PUT', '/times/')).toHaveLength(1);
    });

    it('refuses a finish once the lane athlete has used both quali attempts', async () => {
      // a1 already holds two qualification Times (rule S5 cap of 2).
      seededTimes = [
        {
          timeId: 'q1',
          compId: COMP,
          athleteId: 'a1',
          round: 'qualification',
          timeMs: 5000,
          startTime: 1,
        },
        {
          timeId: 'q2',
          compId: COMP,
          athleteId: 'a1',
          round: 'qualification',
          timeMs: 5200,
          startTime: 2,
        },
      ];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.times.isSuccess).toBe(true));
      act(() => result.current.setLaneAthlete(1, 'a1'));
      act(() => result.current.onRaceStart(1000));
      act(() => result.current.recordFinish(1, 5000));

      // The cap blocks a third quali Time; the lane badges 2/2 and toasts why.
      expect(result.current.laneAttempts[1]).toMatchObject({ used: 2, capped: true });
      expect(bodies('POST', '/times')).toHaveLength(0);
      expect(result.current.toast).toMatchObject({ severity: 'error' });
      expect(result.current.laneFeedback[1]).toBeNull();
    });

    it('refuses a DNF once the lane athlete has used both quali attempts', async () => {
      seededTimes = [
        {
          timeId: 'q1',
          compId: COMP,
          athleteId: 'a1',
          round: 'qualification',
          timeMs: 5000,
          startTime: 1,
        },
        {
          timeId: 'q2',
          compId: COMP,
          athleteId: 'a1',
          round: 'qualification',
          timeMs: 5200,
          startTime: 2,
        },
      ];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.times.isSuccess).toBe(true));
      act(() => result.current.setLaneAthlete(1, 'a1'));
      act(() => result.current.recordDnf(1));

      expect(bodies('POST', '/times')).toHaveLength(0);
      expect(result.current.laneAttempts[1].capped).toBe(true);
    });

    it('still records a second quali attempt (only the third is capped)', async () => {
      seededTimes = [
        {
          timeId: 'q1',
          compId: COMP,
          athleteId: 'a1',
          round: 'qualification',
          timeMs: 5000,
          startTime: 1,
        },
      ];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.times.isSuccess).toBe(true));
      act(() => result.current.setLaneAthlete(1, 'a1'));
      act(() => result.current.onRaceStart(1000));
      act(() => result.current.recordFinish(1, 5000));

      expect(result.current.laneAttempts[1]).toMatchObject({ used: 1, capped: false });
      await waitFor(() => expect(bodies('POST', '/times')).toHaveLength(1));
    });

    it('does not cap finals attempts (best-of-3 governs, not the S5 cap)', async () => {
      seededTimes = [
        { timeId: 'f1', compId: COMP, athleteId: 'a1', round: 'final', timeMs: 5000, startTime: 1 },
        { timeId: 'f2', compId: COMP, athleteId: 'a1', round: 'final', timeMs: 5200, startTime: 2 },
      ];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.times.isSuccess).toBe(true));
      act(() => result.current.setRound('final'));
      act(() => result.current.setLaneAthlete(1, 'a1'));
      act(() => result.current.onRaceStart(1000));
      act(() => result.current.recordFinish(1, 5000));

      expect(result.current.laneAttempts[1].capped).toBe(false);
      await waitFor(() => expect(bodies('POST', '/times')).toHaveLength(1));
    });

    it('re-arms a locked lane on the next race start', async () => {
      const { result } = startedRecorder();
      act(() => result.current.recordFinish(1, 5000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      act(() => result.current.onRaceStart(10000));
      act(() => result.current.recordFinish(1, 14500));

      await waitFor(() => expect(bodies('POST', '/times')).toHaveLength(2));
      expect(bodies('POST', '/times')[1]).toMatchObject({ timeMs: 4500 });
    });
  });

  describe('match-driven best-of-3 series', () => {
    it('selectMatch autofills the lanes and round from the match', async () => {
      const { result } = await matchRecorder();

      expect(result.current.laneAthletes).toEqual({ 1: 'a1', 2: 'a2' });
      expect(result.current.round).toBe('final');
      expect(result.current.selectedMatchId).toBe('m1');
    });

    it('tallies each run and PUTs Match.winnerId only on the series clinch', async () => {
      const { result } = await matchRecorder();

      await completeRun(result, 1000, 5000, 6000);
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });
      expect(result.current.derivedWinner).toBeNull();
      // 1–0 doesn't decide a best-of-3: the match must stay winner-less.
      expect(bodies('PUT', '/matches/')).toHaveLength(0);

      await completeRun(result, 10000, 14000, 15000);
      expect(result.current.runWins).toEqual({ 1: 2, 2: 0 });
      expect(result.current.derivedWinner).toBe('a1');
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(1));
      expect(bodies('PUT', '/matches/')[0]).toMatchObject({
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      });
    });

    it('tallies a run exactly once despite a post-save hand-timer correction', async () => {
      const { result } = await matchRecorder();
      await completeRun(result, 1000, 5000, 6000);
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });

      // Correct lane 1 slower than lane 2: the run is already tallied, so the
      // re-fired derivation must not re-increment (1–1 would clinch nothing,
      // but a double count would put lane 1 on 2 and wrongly decide the series).
      act(() => result.current.editLaneTime(1, 7000));
      await waitFor(() =>
        expect(result.current.laneFeedback[1]).toMatchObject({ status: 'saved', valueMs: 7000 }),
      );
      expect(bodies('PUT', '/times/')).toEqual([
        { athleteId: 'a1', round: 'final', timeMs: 7000, startTime: 1000, matchId: 'm1' },
      ]);
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });
      expect(bodies('PUT', '/matches/')).toHaveLength(0);
    });

    it('voidRun deletes the run Times and decrements the tally, Match untouched', async () => {
      const { result } = await matchRecorder();
      await completeRun(result, 1000, 5000, 6000);

      act(() => result.current.voidRun());

      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
      expect(result.current.laneFeedback).toEqual({ 1: null, 2: null });
      await waitFor(() => expect(paths('DELETE', '/times/')).toHaveLength(2));
      expect(paths('DELETE', '/times/')).toEqual([
        `/competitions/${COMP}/times/t1`,
        `/competitions/${COMP}/times/t2`,
      ]);
      // The series was never decided, so there is no winner to clear.
      expect(bodies('PUT', '/matches/')).toHaveLength(0);
    });

    it('voidRun clears Match.winnerId when the undo leaves the series undecided', async () => {
      const { result } = await matchRecorder();
      await completeRun(result, 1000, 5000, 6000);
      await completeRun(result, 10000, 14000, 15000); // clinch: winnerId PUT
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(1));

      act(() => result.current.voidRun());

      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });
      expect(result.current.derivedWinner).toBeNull();
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(2));
      // 1–0 no longer decides the series — the PUT body must drop winnerId
      // entirely so the transactional put unsets it (not write an empty value).
      expect(bodies('PUT', '/matches/')[1]).not.toHaveProperty('winnerId');
      expect(bodies('PUT', '/matches/')[1]).toMatchObject({ athlete1Id: 'a1', athlete2Id: 'a2' });
    });

    it('selecting a different match starts a fresh series', async () => {
      const { result } = await matchRecorder();
      await completeRun(result, 1000, 5000, 6000);
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });

      act(() => result.current.selectMatch('m2'));

      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
      expect(result.current.laneAthletes).toEqual({ 1: 'a3', 2: 'a4' });
    });

    it('clearing the match selection resets the series but keeps the lanes', async () => {
      const { result } = await matchRecorder();
      await completeRun(result, 1000, 5000, 6000);

      act(() => result.current.selectMatch(''));

      expect(result.current.selectedMatchId).toBe('');
      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
      // A manual (off-bracket) run must not be disrupted by clearing the link.
      expect(result.current.laneAthletes).toEqual({ 1: 'a1', 2: 'a2' });
    });
  });

  describe('seeding a re-selected match from persisted times', () => {
    const time = (athleteId: string, startTime: number, timeMs: number): Time => ({
      timeId: `${athleteId}-${startTime}`,
      compId: COMP,
      athleteId,
      round: 'final',
      timeMs,
      startTime,
      matchId: 'm1',
    });

    it('seeds the best-of-3 tally from the match’s already-recorded runs', async () => {
      // Two completed runs of m1 (a1 vs a2): a1 wins run 1, a2 wins run 2 → 1–1.
      seededTimes = [
        time('a1', 1000, 5000),
        time('a2', 1000, 6000),
        time('a1', 2000, 7000),
        time('a2', 2000, 6500),
      ];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() => result.current.selectMatch('m1'));

      await waitFor(() => expect(result.current.runWins).toEqual({ 1: 1, 2: 1 }));
    });

    it('continues the seeded tally on the next live run (and clinches)', async () => {
      // One persisted run of m1, a1 winning → seeds 1–0.
      seededTimes = [time('a1', 1000, 5000), time('a2', 1000, 6000)];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));
      act(() => result.current.selectMatch('m1'));
      await waitFor(() => expect(result.current.runWins).toEqual({ 1: 1, 2: 0 }));

      // A fresh live run a1 wins again → 2–0 clinches; the winner is PUT.
      await completeRun(result, 3000, 5000, 6000);
      expect(result.current.runWins).toEqual({ 1: 2, 2: 0 });
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(1));
      expect(bodies('PUT', '/matches/')[0]).toMatchObject({ winnerId: 'a1' });
    });

    it('ignores persisted times of other matches', async () => {
      // Times tagged to a different match must not seed m1’s tally.
      seededTimes = [
        { ...time('a1', 1000, 5000), matchId: 'm2' },
        { ...time('a2', 1000, 6000), matchId: 'm2' },
      ];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() => result.current.selectMatch('m1'));
      // Let the seed effect run against the loaded times, then assert it stayed 0–0.
      await waitFor(() => expect(result.current.times.isSuccess).toBe(true));
      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
    });
  });

  describe('false-start attribution (rules S2–S4)', () => {
    it('flagFs increments per lane and caps at 2', () => {
      const { result } = startedRecorder();
      act(() => result.current.flagFs(1));
      expect(result.current.fsCounts).toEqual({ 1: 1, 2: 0 });
      act(() => result.current.flagFs(1));
      act(() => result.current.flagFs(1)); // a third flag is a no-op (capped)
      expect(result.current.fsCounts).toEqual({ 1: 2, 2: 0 });
    });

    it('still records a lane under its first false start (S2 tolerates one)', async () => {
      const { result } = startedRecorder();
      act(() => result.current.flagFs(1));
      act(() => result.current.recordFinish(1, 5000));

      await waitFor(() => expect(bodies('POST', '/times')).toHaveLength(1));
      expect(bodies('POST', '/times')[0]).toMatchObject({ timeMs: 4000 });
    });

    it('records nothing and never tallies on a lane’s 2nd false start (S2/S3)', async () => {
      const { result } = await matchRecorder(); // m1 (final), lanes a1/a2
      act(() => result.current.onRaceStart(1000));
      act(() => result.current.flagFs(1));
      act(() => result.current.flagFs(1)); // lane 1 at its 2nd FS
      act(() => result.current.recordFinish(1, 5000));
      act(() => result.current.recordFinish(2, 6000)); // clean lane finishes

      // Lane 1 POSTs nothing; only the clean lane records. The run cannot
      // auto-tally to the offender — the series stays 0–0 (the award is a tap).
      await waitFor(() => expect(result.current.laneFeedback[2]?.status).toBe('saved'));
      expect(bodies('POST', '/times').map((b) => b.athleteId)).toEqual(['a2']);
      expect(result.current.laneFeedback[1]).toBeNull();
      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
    });

    it('leaves recordDnf unguarded by the FS counter (an explicit correction)', async () => {
      const { result } = startedRecorder();
      act(() => result.current.flagFs(1));
      act(() => result.current.flagFs(1)); // 2nd FS: a finish records nothing…
      act(() => result.current.recordDnf(1)); // …but an explicit DNF still does

      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(bodies('POST', '/times')[0]).toMatchObject({ timeMs: DNF_SENTINEL });
    });

    it('keeps the counters across reset and void (same attempt)', async () => {
      const { result } = await matchRecorder();
      act(() => result.current.flagFs(1));

      act(() => result.current.onReset());
      expect(result.current.fsCounts).toEqual({ 1: 1, 2: 0 });

      await completeRun(result, 1000, 5000, 6000);
      act(() => result.current.voidRun());
      // A void reruns the SAME attempt, so the flag survives.
      expect(result.current.fsCounts).toEqual({ 1: 1, 2: 0 });
    });

    it('zeroes a lane on the start after its attempt closed; carries across a void', async () => {
      const { result } = startedRecorder(); // lane 1 = a1
      act(() => result.current.flagFs(1));
      act(() => result.current.recordFinish(1, 5000)); // records → attempt closes
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));

      act(() => result.current.onRaceStart(10000)); // a fresh attempt starts clean
      expect(result.current.fsCounts).toEqual({ 1: 0, 2: 0 });
    });

    it('clears a lane counter when its athlete changes, and both on resetSeries', async () => {
      const { result } = await matchRecorder();
      act(() => result.current.flagFs(1));
      act(() => result.current.flagFs(2));

      act(() => result.current.setLaneAthlete(1, 'a3'));
      expect(result.current.fsCounts).toEqual({ 1: 0, 2: 1 });

      act(() => result.current.resetSeries());
      expect(result.current.fsCounts).toEqual({ 1: 0, 2: 0 });
    });

    it('derives the advised outcome from counts + the run winner', async () => {
      const { result } = await matchRecorder();
      expect(result.current.fsOutcome).toEqual({ kind: 'none' });

      await completeRun(result, 1000, 5000, 6000); // lane 1 wins the run
      act(() => result.current.flagFs(1));
      // Offender (lane 1) flagged once and won → advise a start rerun.
      expect(result.current.fsOutcome).toEqual({ kind: 'rerun-start', offender: 1 });

      act(() => result.current.flagFs(1)); // 2nd FS vs a clean lane → forfeit
      expect(result.current.fsOutcome).toEqual({
        kind: 'round-to-opponent',
        offender: 1,
        opponent: 2,
      });
    });

    it('awardRunTo credits the lane, clinches, and deletes the run’s saved Times', async () => {
      const { result } = await matchRecorder(); // m1 (final), a1 vs a2
      await completeRun(result, 1000, 5000, 6000); // run 1: lane 1 wins → 1–0

      // Forfeit run: the clean lane (1) finishes, the offender (2) hits its 2nd FS.
      act(() => result.current.onRaceStart(10000));
      act(() => result.current.flagFs(2));
      act(() => result.current.flagFs(2));
      act(() => result.current.recordFinish(1, 14000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      act(() => result.current.recordFinish(2, 15000)); // FS#2 — records nothing

      act(() => result.current.awardRunTo(1));

      // 2–0 clinches; the offender's earlier win is NOT undone (stale-guard), the
      // forfeit run's own saved Time is deleted, and the winner is PUT.
      expect(result.current.runWins).toEqual({ 1: 2, 2: 0 });
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(1));
      expect(bodies('PUT', '/matches/')[0]).toMatchObject({ winnerId: 'a1' });
      expect(paths('DELETE', '/times/')).toEqual([`/competitions/${COMP}/times/t3`]);
      expect(result.current.fsCounts).toEqual({ 1: 0, 2: 0 });
    });

    it('awardRunTo works with no saved Times (a forfeit before any finish)', async () => {
      const { result } = await matchRecorder();
      act(() => result.current.onRaceStart(1000));
      act(() => result.current.flagFs(2));
      act(() => result.current.flagFs(2)); // lane 2 forfeits before anyone finishes

      act(() => result.current.awardRunTo(1));

      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });
      expect(paths('DELETE', '/times/')).toHaveLength(0);
      expect(bodies('PUT', '/matches/')).toHaveLength(0); // 1–0 doesn't clinch
    });
  });

  describe('peer mirroring (ADR 0038): applySelection / notePeerFinish', () => {
    const peerSelection = {
      discipline: 'speed' as const,
      round: 'final',
      gender: 'female' as const,
      matchId: 'm1',
      athlete1Id: 'a1',
      athlete2Id: 'a2',
      runWins: { 1: 1, 2: 0 },
      falseStarts: { 1: 1, 2: 0 },
    };

    it('applySelection mirrors the whole board selection without any write', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));
      const readsBefore = apiFetchMock.mock.calls.length;

      act(() => result.current.applySelection(peerSelection));

      expect(result.current.round).toBe('final');
      expect(result.current.selectedGender).toBe('female');
      expect(result.current.selectedMatchId).toBe('m1');
      expect(result.current.laneAthletes).toEqual({ 1: 'a1', 2: 'a2' });
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });
      expect(result.current.fsCounts).toEqual({ 1: 1, 2: 0 });
      // Write-free: no POST/PUT/DELETE may ride a peer-applied selection. (The
      // gender change refetches the matches list — a read is fine.)
      expect(bodies('POST', '/times')).toHaveLength(0);
      expect(bodies('PUT', '/matches/')).toHaveLength(0);
      expect(apiFetchMock.mock.calls.length).toBeGreaterThanOrEqual(readsBefore);
    });

    it('applySelection keeps the wire tally over the persisted-Times seed', async () => {
      // m1 has a persisted run a2 won (seed would say 0–1); the live wire tally
      // says 1–0. The peer application must mark the match seeded so the seed
      // effect cannot double-count/overwrite the mirrored live value.
      seededTimes = [
        {
          timeId: 'x1',
          compId: COMP,
          athleteId: 'a1',
          round: 'final',
          timeMs: 6000,
          startTime: 1,
          matchId: 'm1',
        },
        {
          timeId: 'x2',
          compId: COMP,
          athleteId: 'a2',
          round: 'final',
          timeMs: 5000,
          startTime: 1,
          matchId: 'm1',
        },
      ];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() => result.current.applySelection({ ...peerSelection, gender: 'male' }));

      await waitFor(() => expect(result.current.times.isSuccess).toBe(true));
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });
    });

    it('applySelection bypasses the round-change confirm (it belongs to the acting panel)', async () => {
      const { result } = await matchRecorder(); // m1 selected, round final
      act(() =>
        result.current.applySelection({
          ...peerSelection,
          round: 'quarter',
          matchId: null,
          gender: 'male',
        }),
      );

      expect(result.current.round).toBe('quarter');
      expect(result.current.pendingChange).toBeNull();
      expect(result.current.selectedMatchId).toBe('');
    });

    it('applySelection drops a foreign-discipline selection (shared relay room)', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() =>
        result.current.applySelection({
          ...peerSelection,
          discipline: 'freestyle' as never,
        }),
      );

      expect(result.current.round).toBe('qualification');
      expect(result.current.selectedMatchId).toBe('');
      expect(result.current.laneAthletes).toEqual({ 1: '', 2: '' });
    });

    it('notePeerFinish records the lane result without POSTing a Time', async () => {
      const { result } = await matchRecorder(); // m1: a1 vs a2, round final
      act(() => result.current.onRaceStart(1000));

      act(() => result.current.notePeerFinish(1, 4000));

      expect(bodies('POST', '/times')).toHaveLength(0);
      expect(bodies('PUT', '/matches/')).toHaveLength(0);
    });

    it('a local stop completing a peer-started result still tallies (single tally site)', async () => {
      const { result } = await matchRecorder();
      act(() => result.current.onRaceStart(1000));
      // Lane 1 stopped on the PEER panel (its Time POSTs there, not here)…
      act(() => result.current.notePeerFinish(1, 4000));
      // …lane 2 stops LOCALLY here: this panel completed the run, so it tallies.
      act(() => result.current.recordFinish(2, 7000));

      await waitFor(() => expect(result.current.laneFeedback[2]?.status).toBe('saved'));
      // Only the locally-stopped lane POSTs; lane 1's Time belongs to the peer.
      expect(bodies('POST', '/times').map((b) => b.athleteId)).toEqual(['a2']);
      // Lane 1 (4000ms) beat lane 2 (6000ms): the tally credits lane 1.
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });
    });

    it('never increments the tally when a peer stop completes the run', async () => {
      const { result } = await matchRecorder();
      act(() => result.current.onRaceStart(1000));
      act(() => result.current.notePeerFinish(1, 4000));
      act(() => result.current.notePeerFinish(2, 6000));

      // The run completed via a peer stop — the tally's single site is the peer
      // panel; this one converges via the mirrored updateSelection.runWins.
      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
      expect(bodies('POST', '/times')).toHaveLength(0);
      expect(bodies('PUT', '/matches/')).toHaveLength(0);

      // The run is marked tallied: a later local correction path re-firing the
      // derivation must not increment either (DNF-after-finish is such a path).
      act(() => result.current.recordDnf(2));
      await waitFor(() => expect(result.current.laneFeedback[2]?.status).toBe('saved'));
      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
    });
  });

  /**
   * `speedline-resume-stopped-lane`: a mis-pressed Stop is undone at the clock
   * (the page keeps the GO epoch and drops the stop) — the recorder's half is
   * withdrawing everything that stop RECORDED, so the lane's real finish is the
   * one that counts.
   */
  describe('resuming a mis-stopped lane (resumeLane)', () => {
    it('deletes the Time the mis-press saved and re-opens the lane', async () => {
      const { result } = startedRecorder();
      act(() => result.current.recordFinish(1, 5000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));

      act(() => result.current.resumeLane(1));

      expect(result.current.laneFeedback[1]).toBeNull();
      await waitFor(() =>
        expect(paths('DELETE', '/times/')).toEqual([`/competitions/${COMP}/times/t1`]),
      );

      // The real finish now records, once, with the real elapsed off the same
      // GO epoch — the clock never moved, only the stop was withdrawn.
      act(() => result.current.recordFinish(1, 8000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(bodies('POST', '/times').map((b) => b.timeMs)).toEqual([4000, 7000]);
    });

    it('deletes a save that lands AFTER the resume, and never re-raises its chip', async () => {
      const { result } = startedRecorder();
      holdPost = true;
      act(() => result.current.recordFinish(1, 5000));
      // The mutation dispatches on a microtask, so wait until the POST is
      // genuinely in flight before holding it open.
      await waitFor(() => expect(bodies('POST', '/times')).toHaveLength(1));
      expect(result.current.laneFeedback[1]?.status).toBe('pending');

      // The operator resumes while the POST is still in flight: it cannot be
      // recalled, so the record is deleted the moment its id exists.
      act(() => result.current.resumeLane(1));
      expect(result.current.laneFeedback[1]).toBeNull();

      await act(async () => {
        releasePost();
      });

      expect(result.current.laneFeedback[1]).toBeNull();
      await waitFor(() =>
        expect(paths('DELETE', '/times/')).toEqual([`/competitions/${COMP}/times/t1`]),
      );
    });

    it('withdraws the run-win a resolved run credited, so the re-run scores once', async () => {
      const { result } = await matchRecorder();
      await completeRun(result, 1000, 5000, 6000); // lane 1 (4000) beats lane 2 (5000)
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });

      act(() => result.current.resumeLane(1));
      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });

      // Lane 1's real crossing is slower than lane 2's — the re-resolved run
      // goes the other way, and it is counted exactly once.
      act(() => result.current.recordFinish(1, 9000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(result.current.runWins).toEqual({ 1: 0, 2: 1 });
    });

    it('leaves the false-start counters alone — they belong to the attempt', async () => {
      const { result } = startedRecorder();
      act(() => result.current.flagFs(1));
      act(() => result.current.recordFinish(1, 5000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));

      act(() => result.current.resumeLane(1));

      expect(result.current.fsCounts).toEqual({ 1: 1, 2: 0 });
    });

    it('notePeerResume writes nothing for a lane it never recorded (ADR 0038)', async () => {
      const { result } = await matchRecorder();
      act(() => result.current.onRaceStart(1000));
      act(() => result.current.notePeerFinish(1, 4000));

      act(() => result.current.notePeerResume(1));

      expect(paths('DELETE', '/times/')).toHaveLength(0);
      // The lane is open again here too, so a later LOCAL stop of it records.
      act(() => result.current.recordFinish(1, 6000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(bodies('POST', '/times').map((b) => b.athleteId)).toEqual(['a1']);
    });

    /**
     * The cross-panel orphan (`ftt-followup-speedline-lane-resume-…-1`): this
     * panel stopped and SAVED the lane, the other one withdrew it. Only the
     * holder knows the timeId, so only the holder can retract it.
     */
    it('deletes its OWN row when a peer withdraws the lane it recorded', async () => {
      const { result } = startedRecorder();
      act(() => result.current.recordFinish(1, 5000));
      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));

      act(() => result.current.notePeerResume(1));

      expect(result.current.laneFeedback[1]).toBeNull();
      await waitFor(() =>
        expect(paths('DELETE', '/times/')).toEqual([`/competitions/${COMP}/times/t1`]),
      );
    });

    it('deletes a save that lands after a PEER resume, like a local one', async () => {
      const { result } = startedRecorder();
      holdPost = true;
      act(() => result.current.recordFinish(1, 5000));
      await waitFor(() => expect(bodies('POST', '/times')).toHaveLength(1));

      act(() => result.current.notePeerResume(1));
      await act(async () => {
        releasePost();
      });

      expect(result.current.laneFeedback[1]).toBeNull();
      await waitFor(() =>
        expect(paths('DELETE', '/times/')).toEqual([`/competitions/${COMP}/times/t1`]),
      );
    });
  });

  describe('round filter + confirm-on-round-change (ADR 0033)', () => {
    it('roundMatches lists only the current round’s matches', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      // Default round is qualification — no match is in it.
      expect(result.current.roundMatches).toEqual([]);

      act(() => result.current.selectMatch('m1')); // → round final
      expect(result.current.roundMatches.map((m) => m.matchId)).toEqual(['m1', 'm2']);
    });

    it('changes the round immediately when no match is selected', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() => result.current.requestRound('quarter'));

      expect(result.current.round).toBe('quarter');
      expect(result.current.pendingChange).toBeNull();
    });

    it('defers a round change while a match is selected, then confirms it', async () => {
      const { result } = await matchRecorder(); // m1 (final), lanes a1/a2
      await completeRun(result, 1000, 5000, 6000); // 1–0 series

      act(() => result.current.requestRound('quarter'));
      // Pending: nothing has changed yet.
      expect(result.current.pendingChange).toEqual({ kind: 'round', round: 'quarter' });
      expect(result.current.round).toBe('final');
      expect(result.current.selectedMatchId).toBe('m1');

      act(() => result.current.confirmPendingChange());
      // Round switched; the match and its cascade are cleared.
      expect(result.current.round).toBe('quarter');
      expect(result.current.pendingChange).toBeNull();
      expect(result.current.selectedMatchId).toBe('');
      expect(result.current.laneAthletes).toEqual({ 1: '', 2: '' });
      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
    });

    it('cancelling a round change leaves the round and match untouched', async () => {
      const { result } = await matchRecorder(); // m1 (final), lanes a1/a2

      act(() => result.current.requestRound('quarter'));
      act(() => result.current.cancelPendingChange());

      expect(result.current.pendingChange).toBeNull();
      expect(result.current.round).toBe('final');
      expect(result.current.selectedMatchId).toBe('m1');
      expect(result.current.laneAthletes).toEqual({ 1: 'a1', 2: 'a2' });
    });
  });

  describe('gender cascade + confirm-on-gender-change (cascading filters)', () => {
    it('switches immediately with no match selected and clears the lane picks + FS counters', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));
      act(() => result.current.setLaneAthlete(1, 'a1'));
      act(() => result.current.flagFs(1));

      act(() => result.current.requestGender('female'));

      // The picks came from the male-filtered list — off-filter now, cleared.
      expect(result.current.selectedGender).toBe('female');
      expect(result.current.pendingChange).toBeNull();
      expect(result.current.laneAthletes).toEqual({ 1: '', 2: '' });
      expect(result.current.fsCounts).toEqual({ 1: 0, 2: 0 });
    });

    it('a same-value gender request is a no-op (never pends)', async () => {
      const { result } = await matchRecorder(); // match selected
      act(() => result.current.requestGender('male'));

      expect(result.current.pendingChange).toBeNull();
      expect(result.current.laneAthletes).toEqual({ 1: 'a1', 2: 'a2' });
    });

    it('defers a gender change while a match is selected, then confirms it', async () => {
      // Unguarded, this silently strands the selected match (the match list is
      // gender-scoped) — the exact orphan the round confirm exists for.
      const { result } = await matchRecorder(); // m1 (final), lanes a1/a2

      act(() => result.current.requestGender('female'));
      // Pending: nothing has changed yet.
      expect(result.current.pendingChange).toEqual({ kind: 'gender', gender: 'female' });
      expect(result.current.selectedGender).toBe('male');
      expect(result.current.selectedMatchId).toBe('m1');

      act(() => result.current.confirmPendingChange());
      // Gender switched; the match and its cascade are cleared.
      expect(result.current.selectedGender).toBe('female');
      expect(result.current.pendingChange).toBeNull();
      expect(result.current.selectedMatchId).toBe('');
      expect(result.current.laneAthletes).toEqual({ 1: '', 2: '' });
      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
    });

    it('cancelling a gender change leaves the gender and match untouched', async () => {
      const { result } = await matchRecorder(); // m1 (final), lanes a1/a2

      act(() => result.current.requestGender('female'));
      act(() => result.current.cancelPendingChange());

      expect(result.current.pendingChange).toBeNull();
      expect(result.current.selectedGender).toBe('male');
      expect(result.current.selectedMatchId).toBe('m1');
      expect(result.current.laneAthletes).toEqual({ 1: 'a1', 2: 'a2' });
    });
  });

  describe('swapLanes', () => {
    it('exchanges the two lanes’ athletes', () => {
      const { result } = renderRecorder();
      act(() => result.current.setLaneAthlete(1, 'a1'));
      act(() => result.current.setLaneAthlete(2, 'a2'));

      act(() => result.current.swapLanes());
      expect(result.current.laneAthletes).toEqual({ 1: 'a2', 2: 'a1' });

      // A double swap is identity.
      act(() => result.current.swapLanes());
      expect(result.current.laneAthletes).toEqual({ 1: 'a1', 2: 'a2' });
    });

    it('carries the false-start attribution to the new lane', () => {
      const { result } = renderRecorder();
      act(() => result.current.setLaneAthlete(1, 'a1'));
      act(() => result.current.setLaneAthlete(2, 'a2'));
      act(() => result.current.flagFs(1));

      act(() => result.current.swapLanes());
      // The FS count follows the athlete to lane 2, not left on lane 1.
      expect(result.current.laneAthletes).toEqual({ 1: 'a2', 2: 'a1' });
      expect(result.current.fsCounts).toEqual({ 1: 0, 2: 1 });
    });

    it('swaps a selected match’s auto-filled lanes without touching the match', async () => {
      const { result } = await matchRecorder(); // m1 (final), lanes a1/a2

      act(() => result.current.swapLanes());
      expect(result.current.laneAthletes).toEqual({ 1: 'a2', 2: 'a1' });
      expect(result.current.selectedMatchId).toBe('m1');
    });

    it('keeps each athlete’s run-wins across a between-runs side switch (ADR 0044)', async () => {
      const { result } = await matchRecorder(); // m1: a1 (lane 1) vs a2 (lane 2)
      await completeRun(result, 1000, 5000, 6000); // a1 wins run 1 from lane 1
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });

      // The athletes switch sides for run 2 — a1's win follows them to lane 2.
      act(() => result.current.swapLanes());
      expect(result.current.laneAthletes).toEqual({ 1: 'a2', 2: 'a1' });
      expect(result.current.runWins).toEqual({ 1: 0, 2: 1 });

      // a1 wins run 2 from lane 2 → a1 clinches; the RIGHT athlete is PUT.
      await completeRun(result, 10000, 15000, 14000);
      expect(result.current.runWins).toEqual({ 1: 0, 2: 2 });
      expect(result.current.derivedWinner).toBe('a1');
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(1));
      expect(bodies('PUT', '/matches/')[0]).toMatchObject({ winnerId: 'a1' });
    });

    it('voidRun after a post-run swap undoes the credited athlete, not the lane', async () => {
      const { result } = await matchRecorder();
      await completeRun(result, 1000, 5000, 6000); // a1 wins run 1
      act(() => result.current.swapLanes()); // a2 now stands on lane 1

      act(() => result.current.voidRun());

      // a1's win is undone — a lane-keyed undo would have decremented a2.
      expect(result.current.runWins).toEqual({ 1: 0, 2: 0 });
      await waitFor(() => expect(paths('DELETE', '/times/')).toHaveLength(2));
    });

    it('a post-swap hand-timer correction edits the athlete’s own Time', async () => {
      const { result } = await matchRecorder();
      await completeRun(result, 1000, 5000, 6000); // lane 1 = a1 (t1), lane 2 = a2 (t2)
      act(() => result.current.swapLanes()); // feedback follows the athletes

      // Correcting "lane 1" now corrects a2's Time (a2 stands on lane 1).
      act(() => result.current.editLaneTime(1, 5500));
      await waitFor(() => expect(bodies('PUT', '/times/')).toHaveLength(1));
      expect(bodies('PUT', '/times/')[0]).toMatchObject({ athleteId: 'a2', timeMs: 5500 });
      expect(paths('PUT', '/times/')[0]).toContain('/times/t2');
    });

    it('applySelection re-keys the wire tally by the mirrored pairing (swapped peer)', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      // The peer board swapped its lanes mid-series: a2 on lane 1 with 0 wins,
      // a1 on lane 2 with 1 win (the wire view pairs with ITS athlete ids).
      act(() =>
        result.current.applySelection({
          discipline: 'speed',
          round: 'final',
          gender: 'male',
          matchId: 'm1',
          athlete1Id: 'a2',
          athlete2Id: 'a1',
          runWins: { 1: 0, 2: 1 },
        }),
      );
      expect(result.current.runWins).toEqual({ 1: 0, 2: 1 });

      // Swapping locally back projects the same athlete-keyed tally: a1 keeps
      // the win on lane 1 — proof the mirror adopted athletes, not lanes.
      act(() => result.current.swapLanes());
      expect(result.current.laneAthletes).toEqual({ 1: 'a1', 2: 'a2' });
      expect(result.current.runWins).toEqual({ 1: 1, 2: 0 });
    });
  });

  /**
   * `speedline-wrong-athlete-reattribute`: a run saved against the wrong person
   * used to be recoverable only by deleting it. The save stays bound to the
   * athlete it was POSTed under (the chip names them) and `moveTime` is the
   * explicit one-tap that re-attributes it.
   */
  describe('re-attributing a lane time (moveTime)', () => {
    /** Lane 1 saved for a1, then re-picked to a3. */
    const misattributed = async () => {
      const rendered = startedRecorder();
      act(() => rendered.result.current.recordFinish(1, 5000));
      await waitFor(() => expect(rendered.result.current.laneFeedback[1]?.status).toBe('saved'));
      act(() => rendered.result.current.setLaneAthlete(1, 'a3'));
      return rendered;
    };

    it('keeps the save bound to the athlete it was recorded under', async () => {
      const { result } = await misattributed();

      expect(result.current.laneFeedback[1]?.saved?.input.athleteId).toBe('a1');
      expect(result.current.laneAthletes[1]).toBe('a3');
    });

    it('PUTs the same time onto the new athlete and re-binds the feedback', async () => {
      const { result } = await misattributed();

      act(() => result.current.moveTime(1));

      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('saved'));
      expect(bodies('PUT', '/times/')).toEqual([
        { athleteId: 'a3', round: 'qualification', timeMs: 4000, startTime: 1000 },
      ]);
      expect(paths('PUT', '/times/')[0]).toContain('/times/t1');
      expect(result.current.laneFeedback[1]?.saved?.input.athleteId).toBe('a3');
      expect(result.current.toast).toEqual({ text: 'Lane 1 time moved', severity: 'success' });
    });

    it('corrects the NEW athlete’s Time after a move', async () => {
      const { result } = await misattributed();
      act(() => result.current.moveTime(1));
      await waitFor(() => expect(bodies('PUT', '/times/')).toHaveLength(1));

      act(() => result.current.editLaneTime(1, 4500));

      await waitFor(() => expect(bodies('PUT', '/times/')).toHaveLength(2));
      expect(bodies('PUT', '/times/')[1]).toMatchObject({ athleteId: 'a3', timeMs: 4500 });
    });

    it('says the move failed and leaves the binding alone', async () => {
      const { result } = await misattributed();
      apiFetchMock.mockImplementationOnce(() => Promise.reject(new Error('boom')));

      act(() => result.current.moveTime(1));

      await waitFor(() => expect(result.current.laneFeedback[1]?.status).toBe('error'));
      expect(result.current.toast).toEqual({ text: 'Lane 1 time not moved', severity: 'error' });
      expect(result.current.laneFeedback[1]?.saved?.input.athleteId).toBe('a1');
    });

    it('does nothing while the save and the lane already agree', async () => {
      const rendered = startedRecorder();
      act(() => rendered.result.current.recordFinish(1, 5000));
      await waitFor(() => expect(rendered.result.current.laneFeedback[1]?.status).toBe('saved'));

      act(() => rendered.result.current.moveTime(1));

      expect(bodies('PUT', '/times/')).toHaveLength(0);
    });
  });
});
