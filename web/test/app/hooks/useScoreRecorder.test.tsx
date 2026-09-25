import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { useScoreRecorder, type ScoreRecorder } from 'app/hooks/useScoreRecorder';
import { computeOverall, type Match, type Score } from 'app/types';
import { entryDraft, type ScoreFields } from 'app/util/scoreInput';

const COMP = 'c1';

const freestyleMatch = (matchId: string, athlete1Id: string, athlete2Id: string): Match => ({
  matchId,
  compId: COMP,
  discipline: 'freestyle',
  round: 'final',
  gender: 'male',
  position: 0,
  athlete1Id,
  athlete2Id,
});

// m1/m2 are final-round; m3 is a quarter — so the round filter has something to
// exclude and the confirm-on-round-change path has a different round to move to.
const MATCHES = [
  freestyleMatch('m1', 'a1', 'a2'),
  freestyleMatch('m2', 'a3', 'a4'),
  { ...freestyleMatch('m3', 'a5', 'a6'), round: 'quarter' as const },
];

interface FetchOpts {
  method?: string;
  body?: Record<string, unknown>;
}

let nextScoreId: number;
// Scores the server "already has" — returned by the GET /scores seed fetch.
// Default empty (no interference with the live-recording tests); the seeding
// tests set it before rendering.
let seededScores: Score[];

/** Answer like the server: echo write bodies back, computing overall when omitted. */
const routeApi = (path: string, opts: FetchOpts = {}): unknown => {
  const method = opts.method ?? 'GET';
  if (method === 'GET' && path.includes('/matches?')) return MATCHES;
  if (method === 'GET' && path.includes('/scores')) return seededScores;
  if (method === 'POST' && path.endsWith('/scores')) {
    const body = opts.body ?? {};
    return {
      ...body,
      compId: COMP,
      scoreId: `s${nextScoreId++}`,
      overall: body.overall ?? computeOverall(body as unknown as ScoreFields),
    };
  }
  if (method === 'PUT' && path.includes('/matches/'))
    return { ...opts.body, compId: COMP, matchId: path.split('/').pop() };
  if (method === 'PUT' && path.includes('/scores/')) {
    const body = opts.body ?? {};
    return {
      ...body,
      compId: COMP,
      scoreId: path.split('/').pop(),
      overall: body.overall ?? computeOverall(body as unknown as ScoreFields),
    };
  }
  throw new Error(`unrouted ${method} ${path}`);
};

/** The request bodies apiFetch received for a method + path fragment, in order. */
const bodies = (method: string, pathPart: string): Record<string, unknown>[] =>
  (apiFetchMock.mock.calls as [string, FetchOpts?][])
    .filter(([path, opts]) => (opts?.method ?? 'GET') === method && path.includes(pathPart))
    .map(([, opts]) => opts?.body ?? {});

const wrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

const renderRecorder = () => renderHook(() => useScoreRecorder(COMP), { wrapper: wrapper() });

/** A recorder with the matches list loaded and match m1 (a1 vs a2) selected. */
const matchRecorder = async () => {
  const rendered = renderRecorder();
  await waitFor(() => expect(rendered.result.current.matches.isSuccess).toBe(true));
  act(() => rendered.result.current.selectMatch('m1'));
  return rendered;
};

/** Judge a slot at the given difficulty (other components zero) and await the save. */
const saveScore = async (result: { current: ScoreRecorder }, slot: 1 | 2, difficulty: number) => {
  act(() => result.current.setField(slot, 'difficulty', difficulty));
  act(() => result.current.recordScore(slot));
  await waitFor(() => expect(result.current.entries[slot].status).toBe('saved'));
};

/** The panel's judged components, whichever arm it is in. */
const fieldsOf = (result: { current: ScoreRecorder }, slot: 1 | 2): ScoreFields =>
  entryDraft(result.current.entries[slot]).fields;

const isLocked = (result: { current: ScoreRecorder }, slot: 1 | 2): boolean =>
  result.current.entries[slot].status === 'saved';

describe('useScoreRecorder', () => {
  beforeEach(() => {
    nextScoreId = 1;
    seededScores = [];
    apiFetchMock
      .mockReset()
      .mockImplementation((path: string, opts?: FetchOpts) =>
        Promise.resolve(routeApi(path, opts)),
      );
  });

  /**
   * Where a save stands is the entry union plus the toast (§4.9 / C08), so the
   * POST's own mutation stays inside the hook: a panel handed the raw handle
   * could read a shared observer that reports only the LATEST of two saves.
   */
  it('hands out no raw score mutation', () => {
    const { result } = renderRecorder();

    expect(Object.keys(result.current)).not.toContain('createScore');
  });

  describe('score recording + lock-on-save', () => {
    it('POSTs the judged components and locks the panel on save', async () => {
      const { result } = renderRecorder();
      // A battle round so best trick / control penalty flow (they're zeroed in
      // qualification — rule F8; see the dedicated quali test below).
      act(() => result.current.setRound('final'));
      act(() => result.current.setAthlete(1, 'a1'));
      act(() => result.current.setField(1, 'difficulty', 8));
      act(() => result.current.setField(1, 'combo', 7));
      act(() => result.current.setField(1, 'style', 6));
      act(() => result.current.setField(1, 'bestTrick', 5));
      act(() => result.current.setField(1, 'controlPenalty', 2));
      act(() => result.current.recordScore(1));

      await waitFor(() =>
        expect(result.current.entries[1]).toMatchObject({
          status: 'saved',
          result: { overall: 24, dnf: false },
        }),
      );
      // No override → no overall on the wire; the server computes it.
      expect(bodies('POST', '/scores')).toEqual([
        {
          athleteId: 'a1',
          round: 'final',
          difficulty: 8,
          combo: 7,
          style: 6,
          bestTrick: 5,
          controlPenalty: 2,
        },
      ]);
      expect(isLocked(result, 1)).toBe(true);
      expect(result.current.toast).toMatchObject({ severity: 'success' });
    });

    it('zeroes best trick + control penalty when saving a qualification score (rule F8)', async () => {
      const { result } = renderRecorder();
      // Default round is qualification: even if stale field values linger, the
      // battle-only components must not reach the server (which 400s a nonzero).
      act(() => result.current.setAthlete(1, 'a1'));
      act(() => result.current.setField(1, 'difficulty', 8));
      act(() => result.current.setField(1, 'combo', 7));
      act(() => result.current.setField(1, 'style', 6));
      act(() => result.current.setField(1, 'bestTrick', 5));
      act(() => result.current.setField(1, 'controlPenalty', 2));
      act(() => result.current.recordScore(1));

      await waitFor(() => expect(result.current.entries[1].status).toBe('saved'));
      expect(bodies('POST', '/scores')).toEqual([
        {
          athleteId: 'a1',
          round: 'qualification',
          difficulty: 8,
          combo: 7,
          style: 6,
          bestTrick: 0,
          controlPenalty: 0,
        },
      ]);
    });

    it('refuses a re-save and a DNF while the panel is locked', async () => {
      const { result } = renderRecorder();
      act(() => result.current.setAthlete(1, 'a1'));
      await saveScore(result, 1, 8);

      act(() => result.current.recordScore(1));
      act(() => result.current.recordDnf(1));

      expect(bodies('POST', '/scores')).toHaveLength(1);
    });

    it('leaves an errored save unlocked so the operator can retry', async () => {
      apiFetchMock.mockImplementation((path: string, opts?: FetchOpts) =>
        (opts?.method ?? 'GET') === 'POST'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(routeApi(path, opts)),
      );
      const { result } = renderRecorder();
      act(() => result.current.setAthlete(1, 'a1'));
      act(() => result.current.setField(1, 'difficulty', 8));
      act(() => result.current.recordScore(1));

      await waitFor(() => expect(result.current.entries[1].status).toBe('error'));
      // The reason is kept for the panel to render, and the typed values stay
      // put so the operator can retry rather than re-judging the run.
      expect(result.current.entries[1]).toMatchObject({
        status: 'error',
        reason: 'boom',
        result: { overall: 8, dnf: false },
      });
      expect(fieldsOf(result, 1).difficulty).toBe(8);
      expect(isLocked(result, 1)).toBe(false);
      expect(result.current.toast).toMatchObject({ severity: 'error' });
    });

    it('changing the athlete unlocks the panel and starts a fresh entry', async () => {
      const { result } = renderRecorder();
      act(() => result.current.setAthlete(1, 'a1'));
      await saveScore(result, 1, 8);

      act(() => result.current.setAthlete(1, 'a9'));

      expect(result.current.entries[1]).toEqual({ status: 'empty' });

      act(() => result.current.recordScore(1));
      await waitFor(() => expect(bodies('POST', '/scores')).toHaveLength(2));
      expect(bodies('POST', '/scores')[1]).toMatchObject({ athleteId: 'a9' });
    });

    it('carries an explicit overall override onto the wire', async () => {
      const { result } = renderRecorder();
      act(() => result.current.setAthlete(1, 'a1'));
      act(() => result.current.setField(1, 'difficulty', 8));
      act(() => result.current.setOverride(1, '55'));
      act(() => result.current.recordScore(1));

      await waitFor(() =>
        expect(result.current.entries[1]).toMatchObject({
          status: 'saved',
          result: { overall: 55, dnf: false },
        }),
      );
      expect(bodies('POST', '/scores')[0]).toMatchObject({ overall: 55 });
    });

    // The draft is text, so what the field holds mid-typing is not a number
    // yet; what reaches the wire is the number it became.
    it('posts a negative override, which a battle allows', async () => {
      const { result } = renderRecorder();
      act(() => result.current.setRound('final'));
      act(() => result.current.setAthlete(1, 'a1'));
      act(() => result.current.setOverride(1, '-'));
      act(() => result.current.setOverride(1, '-6'));
      act(() => result.current.recordScore(1));

      await waitFor(() => expect(bodies('POST', '/scores')).toHaveLength(1));
      expect(bodies('POST', '/scores')[0]).toMatchObject({ overall: -6 });
    });
  });

  // The freestyle twin of the speed plane's "Move time to …": a Score saved
  // under the wrong athlete is re-filed from the board in one press, instead of
  // a detour to /admin/scores mid-battle.
  describe('moving a score to the athlete now on the slot', () => {
    /** Save a1 at 8, then put a9 on the slot — the mis-filed shape. */
    const misfiled = async () => {
      const rendered = renderRecorder();
      act(() => rendered.result.current.setAthlete(1, 'a1'));
      await saveScore(rendered.result, 1, 8);
      act(() => rendered.result.current.setAthlete(1, 'a9'));
      return rendered;
    };

    it('keeps the persisted row on the slot when the panel reopens', async () => {
      const { result } = await misfiled();

      // The panel is free for the next athlete, but the row it wrote is still
      // addressable — and still filed under a1.
      expect(result.current.entries[1]).toEqual({ status: 'empty' });
      expect(result.current.records[1]).toMatchObject({
        scoreId: 's1',
        input: { athleteId: 'a1', difficulty: 8 },
        result: { overall: 8, dnf: false },
      });
    });

    it('PUTs the same body under the new athlete and re-locks the panel there', async () => {
      const { result } = await misfiled();

      act(() => result.current.moveScore(1));

      await waitFor(() => expect(bodies('PUT', '/scores/')).toHaveLength(1));
      // The same body, re-filed: the server rewrites the sort key, so one row
      // moves and none is created (a second POST would leave two).
      expect(bodies('PUT', '/scores/')[0]).toEqual({
        athleteId: 'a9',
        round: 'qualification',
        difficulty: 8,
        combo: 0,
        style: 0,
        bestTrick: 0,
        controlPenalty: 0,
      });
      expect(bodies('POST', '/scores')).toHaveLength(1);
      await waitFor(() => expect(isLocked(result, 1)).toBe(true));
      expect(result.current.entries[1]).toMatchObject({
        status: 'saved',
        origin: 'live',
        result: { overall: 8, dnf: false },
      });
      expect(fieldsOf(result, 1).difficulty).toBe(8);
      expect(result.current.records[1]).toMatchObject({ input: { athleteId: 'a9' } });
      expect(result.current.toast).toMatchObject({ severity: 'success' });
    });

    it('refuses to move a row already filed under the slot’s athlete', async () => {
      const { result } = renderRecorder();
      act(() => result.current.setAthlete(1, 'a1'));
      await saveScore(result, 1, 8);

      act(() => result.current.moveScore(1));

      expect(bodies('PUT', '/scores/')).toHaveLength(0);
    });

    it('keeps the row bound elsewhere when the move fails, so it can be retried', async () => {
      const { result } = await misfiled();
      apiFetchMock.mockImplementation((path: string, opts?: FetchOpts) =>
        (opts?.method ?? 'GET') === 'PUT'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(routeApi(path, opts)),
      );

      act(() => result.current.moveScore(1));

      await waitFor(() => expect(result.current.toast).toMatchObject({ severity: 'error' }));
      expect(result.current.records[1]).toMatchObject({ input: { athleteId: 'a1' } });
      expect(isLocked(result, 1)).toBe(false);
    });

    it('re-derives the match winner from the moved row', async () => {
      const { result } = await matchRecorder();
      // Slot 2 was judged with the wrong athlete picked.
      act(() => result.current.setAthlete(2, 'a3'));
      await saveScore(result, 1, 8);
      await saveScore(result, 2, 9);
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(1));
      expect(bodies('PUT', '/matches/')[0]).toMatchObject({ winnerId: 'a3' });

      act(() => result.current.setAthlete(2, 'a2'));
      act(() => result.current.moveScore(2));

      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(2));
      expect(bodies('PUT', '/matches/')[1]).toMatchObject({ winnerId: 'a2' });
      expect(result.current.derivedWinner).toEqual({ winnerId: 'a2', source: 'derived' });
    });

    it('never moves a row off a peer-mirrored selection (ADR 0038)', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));
      act(() => result.current.setRound('final'));
      act(() => result.current.setAthlete(1, 'a1'));
      await saveScore(result, 1, 8);

      // The peer moved the board to a different pair: the panel follows, the
      // mis-filed row does not — a write binds to the local press only.
      act(() =>
        result.current.applySelection({
          discipline: 'freestyle',
          round: 'final',
          gender: 'male',
          matchId: 'm2',
          athlete1Id: 'a3',
          athlete2Id: 'a4',
          freestyleMode: 'battle',
        }),
      );

      expect(bodies('PUT', '/scores/')).toHaveLength(0);
    });
  });

  describe('match-driven winner derivation', () => {
    it('selectMatch autofills the players and round; saves link via matchId', async () => {
      const { result } = await matchRecorder();

      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
      expect(result.current.round).toBe('final');

      await saveScore(result, 1, 8);
      expect(bodies('POST', '/scores')[0]).toMatchObject({ matchId: 'm1', round: 'final' });
    });

    it('PUTs Match.winnerId once both athlete slots are saved; a re-save can flip it', async () => {
      const { result } = await matchRecorder();

      await saveScore(result, 1, 8);
      // One slot judged: not yet resolvable — the match must stay untouched.
      expect(result.current.derivedWinner).toBeNull();
      expect(bodies('PUT', '/matches/')).toHaveLength(0);

      await saveScore(result, 2, 5);
      expect(result.current.derivedWinner).toEqual({ winnerId: 'a1', source: 'derived' });
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(1));
      expect(bodies('PUT', '/matches/')[0]).toMatchObject({
        discipline: 'freestyle',
        winnerId: 'a1',
      });

      // Corrected re-save: re-picking the athlete unlocks the panel (the only
      // unlock there is), and outscoring slot 1 flips the winner.
      act(() => result.current.setAthlete(2, 'a2'));
      await saveScore(result, 2, 9);
      expect(result.current.derivedWinner).toEqual({ winnerId: 'a2', source: 'derived' });
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(2));
      expect(bodies('PUT', '/matches/')[1]).toMatchObject({ winnerId: 'a2' });
    });

    it('clears the winner when both athlete slots DNF', async () => {
      const { result } = await matchRecorder();

      act(() => result.current.recordDnf(1));
      act(() => result.current.recordDnf(2));

      await waitFor(() => expect(bodies('POST', '/scores')).toHaveLength(2));
      expect(bodies('POST', '/scores')[0]).toMatchObject({ dnf: true, matchId: 'm1' });
      // Athlete 2 DNF'd while slot 1's POST was still in flight — BOTH saves
      // must land (and lock) in their own panels; see the mutateAsync note in save().
      await waitFor(() =>
        expect(result.current.entries[1]).toMatchObject({
          status: 'saved',
          result: { dnf: true },
        }),
      );
      await waitFor(() =>
        expect(result.current.entries[2]).toMatchObject({
          status: 'saved',
          result: { dnf: true },
        }),
      );
      // '' = an explicit no-winner; the PUT body must drop winnerId entirely so
      // the transactional put unsets it (not write an empty value).
      expect(result.current.derivedWinner).toEqual({ winnerId: '', source: 'derived' });
      await waitFor(() => expect(bodies('PUT', '/matches/')).toHaveLength(1));
      expect(bodies('PUT', '/matches/')[0]).not.toHaveProperty('winnerId');
    });

    it('writes no winner while the second score is only in flight, then fails', async () => {
      // The Match follows what the server holds, not what the board typed: a
      // winner PUT off a POST that then fails would decide a battle on a score
      // that does not exist.
      let failSecond: (error: Error) => void = () => {};
      apiFetchMock.mockImplementation((path: string, opts?: FetchOpts) => {
        const body = opts?.body as { athleteId?: string } | undefined;
        if ((opts?.method ?? 'GET') === 'POST' && body?.athleteId === 'a2') {
          return new Promise((_resolve, reject) => {
            failSecond = reject;
          });
        }
        return Promise.resolve(routeApi(path, opts));
      });
      const { result } = await matchRecorder();
      await saveScore(result, 1, 8);

      act(() => result.current.setField(2, 'difficulty', 5));
      act(() => result.current.recordScore(2));
      expect(result.current.entries[2].status).toBe('pending');
      expect(result.current.derivedWinner).toBeNull();
      expect(bodies('PUT', '/matches/')).toHaveLength(0);

      // The mutation runs its fn a tick later, so wait for the POST to be on
      // the wire before failing it.
      await waitFor(() => expect(bodies('POST', '/scores')).toHaveLength(2));
      act(() => failSecond(new Error('boom')));
      await waitFor(() => expect(result.current.entries[2].status).toBe('error'));
      expect(result.current.derivedWinner).toBeNull();
      expect(bodies('PUT', '/matches/')).toHaveLength(0);
    });

    it('selecting a different match resets the per-match results and panels', async () => {
      const { result } = await matchRecorder();
      await saveScore(result, 1, 8);

      act(() => result.current.selectMatch('m2'));

      // Fresh entry: the saved lock and slot 1's m1 result must not leak.
      expect(isLocked(result, 1)).toBe(false);
      expect(result.current.athletes).toEqual({ 1: 'a3', 2: 'a4' });

      await saveScore(result, 2, 5);
      // Only slot 2 has an m2 result — pairing it with slot 1's m1 result
      // would wrongly decide the new match, so no winner PUT may happen.
      expect(result.current.derivedWinner).toBeNull();
      expect(bodies('PUT', '/matches/')).toHaveLength(0);
    });
  });

  describe('seeding a re-selected match from persisted scores', () => {
    const score = (athleteId: string, difficulty: number, extra: Partial<Score> = {}): Score => ({
      scoreId: `s-${athleteId}`,
      compId: COMP,
      athleteId,
      round: 'final',
      difficulty,
      combo: 0,
      style: 0,
      bestTrick: 0,
      controlPenalty: 0,
      overall: computeOverall({
        difficulty,
        combo: 0,
        style: 0,
        bestTrick: 0,
        controlPenalty: 0,
      }),
      matchId: 'm1',
      ...extra,
    });

    it('restores both athlete slots’ saved scores (locked) and the winner', async () => {
      seededScores = [score('a1', 8), score('a2', 5)];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() => result.current.selectMatch('m1'));

      // Both panels come back locked with their persisted overall shown.
      await waitFor(() => expect(isLocked(result, 1)).toBe(true));
      expect(isLocked(result, 2)).toBe(true);
      expect(result.current.entries[1]).toMatchObject({
        status: 'saved',
        origin: 'restored',
        result: { overall: 8 },
      });
      expect(result.current.entries[2]).toMatchObject({ status: 'saved', result: { overall: 5 } });
      expect(fieldsOf(result, 1).difficulty).toBe(8);
      // Both scored, no persisted winnerId → the winner resolves locally from
      // the seeded results (a1 outscored a2), for display only (no Match PUT).
      expect(result.current.derivedWinner).toEqual({ winnerId: 'a1', source: 'derived' });
      expect(bodies('PUT', '/matches/')).toHaveLength(0);
    });

    it('leaves an unscored slot editable and does not write the match', async () => {
      // Only slot 1 has a saved score.
      seededScores = [score('a1', 8)];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() => result.current.selectMatch('m1'));

      await waitFor(() => expect(isLocked(result, 1)).toBe(true));
      expect(isLocked(result, 2)).toBe(false);
      // Only one slot scored → winner unresolved, and seeding never PUTs.
      expect(result.current.derivedWinner).toBeNull();
      expect(bodies('PUT', '/matches/')).toHaveLength(0);
    });
  });

  // Qualification has no match to select — the athlete pickers are the whole
  // selection — and it is where nearly every save happens, so the seed has to
  // run off the (round, athlete) pair the Score is keyed on.
  describe('seeding a slot from persisted scores without a match', () => {
    const qualiScore = (
      athleteId: string,
      difficulty: number,
      extra: Partial<Score> = {},
    ): Score => {
      const fields: ScoreFields = {
        difficulty,
        combo: 0,
        style: 0,
        bestTrick: 0,
        controlPenalty: 0,
      };
      return {
        scoreId: `s-${athleteId}`,
        compId: COMP,
        athleteId,
        round: 'qualification',
        ...fields,
        overall: computeOverall(fields),
        ...extra,
      };
    };

    it('fills and locks a quali panel from that athlete’s saved score', async () => {
      seededScores = [qualiScore('a1', 7)];
      const { result } = renderRecorder();
      // Picked while the scores fetch is still in flight — the reload path: the
      // board comes back locked on its own, with no peer and no match.
      act(() => result.current.setAthlete(1, 'a1'));

      await waitFor(() => expect(isLocked(result, 1)).toBe(true));
      expect(result.current.entries[1]).toMatchObject({
        status: 'saved',
        origin: 'restored',
        result: { overall: 7, dnf: false },
      });
      expect(fieldsOf(result, 1).difficulty).toBe(7);
      expect(result.current.selectedMatchId).toBe('');
      // A restore only re-displays: it never writes.
      expect(bodies('POST', '/scores')).toHaveLength(0);
      expect(bodies('PUT', '/matches/')).toHaveLength(0);
    });

    it('leaves an athlete with no saved score empty and editable', async () => {
      seededScores = [qualiScore('a1', 7)];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.scores.isSuccess).toBe(true));

      act(() => result.current.setAthlete(2, 'a2'));

      expect(result.current.entries[2].status).toBe('empty');
      act(() => result.current.setField(2, 'difficulty', 4));
      expect(fieldsOf(result, 2).difficulty).toBe(4);
    });

    it('re-seeds when the athlete changes away and back', async () => {
      seededScores = [qualiScore('a1', 7)];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.scores.isSuccess).toBe(true));

      act(() => result.current.setAthlete(1, 'a1'));
      await waitFor(() => expect(isLocked(result, 1)).toBe(true));

      // Away: a1's restored entry must not survive under a2.
      act(() => result.current.setAthlete(1, 'a2'));
      expect(isLocked(result, 1)).toBe(false);
      expect(fieldsOf(result, 1).difficulty).toBe(0);

      act(() => result.current.setAthlete(1, 'a1'));
      await waitFor(() => expect(isLocked(result, 1)).toBe(true));
      expect(fieldsOf(result, 1).difficulty).toBe(7);
    });

    it('keys the seed on the round as well as the athlete', async () => {
      seededScores = [qualiScore('a1', 7, { round: 'final' })];
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.scores.isSuccess).toBe(true));

      // The athlete's only Score is a final; at qualification there is nothing
      // to restore.
      act(() => result.current.setAthlete(1, 'a1'));
      expect(result.current.entries[1].status).toBe('empty');

      act(() => result.current.setRound('final'));
      await waitFor(() => expect(isLocked(result, 1)).toBe(true));
      expect(fieldsOf(result, 1).difficulty).toBe(7);
    });

    it('never re-seeds over the board’s own save, swap included', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.scores.isSuccess).toBe(true));
      act(() => result.current.setAthlete(1, 'a1'));
      act(() => result.current.setAthlete(2, 'a2'));

      // The server now holds what this board is about to save, so the refetch
      // the POST invalidates into returns it.
      seededScores = [qualiScore('a1', 8)];
      await saveScore(result, 1, 8);
      await waitFor(() => expect(result.current.scores.data).toHaveLength(1));

      // Re-seeding would downgrade a live save to a restore, which is what
      // decides whether the board's own result outranks a stored winner.
      expect(result.current.entries[1]).toMatchObject({ status: 'saved', origin: 'live' });

      act(() => result.current.swapAthletes());
      expect(result.current.entries[2]).toMatchObject({ status: 'saved', origin: 'live' });
      expect(isLocked(result, 1)).toBe(false);
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
      const { result } = await matchRecorder(); // m1 (final), players a1/a2
      await saveScore(result, 1, 8); // slot 1 locked

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
      expect(result.current.athletes).toEqual({ 1: '', 2: '' });
      expect(isLocked(result, 1)).toBe(false);
      expect(result.current.derivedWinner).toBeNull();
    });

    it('cancelling a round change leaves the round and match untouched', async () => {
      const { result } = await matchRecorder(); // m1 (final), players a1/a2

      act(() => result.current.requestRound('quarter'));
      act(() => result.current.cancelPendingChange());

      expect(result.current.pendingChange).toBeNull();
      expect(result.current.round).toBe('final');
      expect(result.current.selectedMatchId).toBe('m1');
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
    });
  });

  describe('gender cascade + confirm-on-gender-change (cascading filters)', () => {
    it('switches immediately with no match selected and clears the slot picks', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));
      act(() => result.current.setAthlete(1, 'a1'));
      act(() => result.current.setField(1, 'difficulty', 7));

      act(() => result.current.requestGender('female'));

      // The picks came from the male-filtered list — off-filter now, cleared
      // (with the panel reset that any athlete change performs).
      expect(result.current.selectedGender).toBe('female');
      expect(result.current.pendingChange).toBeNull();
      expect(result.current.athletes).toEqual({ 1: '', 2: '' });
      expect(result.current.entries[1]).toEqual({ status: 'empty' });
    });

    it('a same-value gender request is a no-op (never pends)', async () => {
      const { result } = await matchRecorder(); // match selected
      act(() => result.current.requestGender('male'));

      expect(result.current.pendingChange).toBeNull();
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
    });

    it('defers a gender change while a match is selected, then confirms it', async () => {
      // Unguarded, this silently strands the selected match (the match list is
      // gender-scoped) — the exact orphan the round confirm exists for.
      const { result } = await matchRecorder(); // m1 (final), players a1/a2

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
      expect(result.current.athletes).toEqual({ 1: '', 2: '' });
      expect(result.current.derivedWinner).toBeNull();
    });

    it('cancelling a gender change leaves the gender and match untouched', async () => {
      const { result } = await matchRecorder(); // m1 (final), players a1/a2

      act(() => result.current.requestGender('female'));
      act(() => result.current.cancelPendingChange());

      expect(result.current.pendingChange).toBeNull();
      expect(result.current.selectedGender).toBe('male');
      expect(result.current.selectedMatchId).toBe('m1');
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
    });
  });

  describe('applySelection — peer board mirroring (ADR 0038, write-free)', () => {
    /** apiFetch calls that would write to the data plane (Score POST / Match PUT). */
    const writeCalls = () =>
      (apiFetchMock.mock.calls as [string, FetchOpts?][]).filter(
        ([, opts]) => (opts?.method ?? 'GET') !== 'GET',
      );

    it('mirrors round/gender/match/athletes without any data-plane write', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() =>
        result.current.applySelection({
          discipline: 'freestyle',
          round: 'final',
          gender: 'male',
          matchId: 'm1',
          athlete1Id: 'a1',
          athlete2Id: 'a2',
          freestyleMode: 'battle',
        }),
      );

      expect(result.current.round).toBe('final');
      expect(result.current.selectedGender).toBe('male');
      expect(result.current.selectedMatchId).toBe('m1');
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
      expect(writeCalls()).toHaveLength(0);
    });

    it('drops a foreign-discipline selection and a round outside the freestyle vocabulary', async () => {
      const { result } = renderRecorder();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() =>
        result.current.applySelection({
          discipline: 'speed',
          round: 'final',
          gender: 'female',
          matchId: 'm1',
          athlete1Id: 'a1',
          athlete2Id: 'a2',
        }),
      );
      act(() =>
        result.current.applySelection({
          discipline: 'freestyle',
          round: 'training', // a TimeRound, not a MatchRound
          gender: 'female',
          matchId: 'm1',
          athlete1Id: 'a1',
          athlete2Id: 'a2',
        }),
      );

      expect(result.current.selectedMatchId).toBe('');
      expect(result.current.selectedGender).toBe('male');
      expect(result.current.athletes).toEqual({ 1: '', 2: '' });
    });

    it('re-applying an equal selection never wipes an in-progress local entry', async () => {
      const { result } = await matchRecorder(); // m1 (final), players a1/a2
      act(() => result.current.setField(1, 'difficulty', 7.5));

      // The peer re-pushes its (identical) selection on every best-trick try.
      act(() =>
        result.current.applySelection({
          discipline: 'freestyle',
          round: 'final',
          gender: 'male',
          matchId: 'm1',
          athlete1Id: 'a1',
          athlete2Id: 'a2',
        }),
      );

      expect(fieldsOf(result, 1).difficulty).toBe(7.5);
      expect(result.current.selectedMatchId).toBe('m1');
    });

    it('a peer match change cascades like a local selectMatch (fresh panels, restored scores)', async () => {
      // m2's slot 1 (a3) already has a persisted final Score: the mirrored
      // selection must re-seed it (locked panel), exactly like a local select.
      seededScores = [
        {
          scoreId: 's-a3',
          compId: COMP,
          athleteId: 'a3',
          round: 'final',
          difficulty: 9,
          combo: 0,
          style: 0,
          bestTrick: 0,
          controlPenalty: 0,
          overall: 9,
        },
      ];
      const { result } = await matchRecorder(); // m1 selected
      act(() => result.current.setField(1, 'difficulty', 5));

      act(() =>
        result.current.applySelection({
          discipline: 'freestyle',
          round: 'final',
          gender: 'male',
          matchId: 'm2',
          athlete1Id: 'a3',
          athlete2Id: 'a4',
        }),
      );

      expect(result.current.selectedMatchId).toBe('m2');
      expect(result.current.athletes).toEqual({ 1: 'a3', 2: 'a4' });
      // The previous match's in-progress entry is gone…
      await waitFor(() => expect(fieldsOf(result, 1).difficulty).toBe(9));
      // …and the persisted score seeded + locked, with no write fired.
      expect(isLocked(result, 1)).toBe(true);
      expect(writeCalls()).toHaveLength(0);
    });
  });

  describe('swapAthletes', () => {
    it('does nothing until both athlete slots have an athlete', () => {
      const { result } = renderRecorder();
      act(() => result.current.setAthlete(1, 'a1'));

      act(() => result.current.swapAthletes());
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: '' });

      act(() => result.current.setAthlete(2, 'a2'));
      act(() => result.current.swapAthletes());
      expect(result.current.athletes).toEqual({ 1: 'a2', 2: 'a1' });
    });

    it('exchanges the two players’ athletes', () => {
      const { result } = renderRecorder();
      act(() => result.current.setAthlete(1, 'a1'));
      act(() => result.current.setAthlete(2, 'a2'));

      act(() => result.current.swapAthletes());
      expect(result.current.athletes).toEqual({ 1: 'a2', 2: 'a1' });

      // A double swap is identity.
      act(() => result.current.swapAthletes());
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
    });

    it('carries an in-progress judged entry with its athlete', () => {
      const { result } = renderRecorder();
      act(() => result.current.setAthlete(1, 'a1'));
      act(() => result.current.setAthlete(2, 'a2'));
      act(() => result.current.setField(1, 'difficulty', 7));

      act(() => result.current.swapAthletes());
      // Athlete 1's entry follows a1 to slot 2, not misattributed to a2.
      expect(result.current.athletes).toEqual({ 1: 'a2', 2: 'a1' });
      expect(fieldsOf(result, 2).difficulty).toBe(7);
      expect(fieldsOf(result, 1).difficulty).toBe(0);
    });

    it('carries a saved player’s lock + recorded result with its athlete', async () => {
      const { result } = await matchRecorder(); // m1 (final), players a1/a2
      await saveScore(result, 1, 8);
      expect(isLocked(result, 1)).toBe(true);

      act(() => result.current.swapAthletes());
      expect(result.current.athletes).toEqual({ 1: 'a2', 2: 'a1' });
      // The saved lock and the result it recorded follow a1 to slot 2 (a Score
      // is keyed by athlete, not slot); slot 1 (now a2) is free to enter.
      expect(result.current.entries[2]).toMatchObject({
        status: 'saved',
        result: { overall: 8 },
      });
      expect(isLocked(result, 1)).toBe(false);
    });
  });
});
