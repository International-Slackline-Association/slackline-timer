import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { competitionDb, ConditionFailed } from 'core/competitionDb';
import type { Athlete, Competition, Match, Score, Time } from 'core/types';

import { clearPartition, COMPETITION_TABLE, ensureTables, isDynamoReachable } from './helpers';
import { compPk } from 'core/keys';

/**
 * Integration tests for the competition data-access layer against the local
 * DynamoDB container (docker/docker-compose.yml). These cover the parts the
 * pure unit tests can't: real conditional-check failures, prefix queries,
 * pagination-safe scans, and the transactional delete+put moves.
 *
 * They self-skip when the container is down (CI without Docker), so the rest of
 * `npm test` still runs. Bring it up with `npm run db:up && npm run db:init`.
 */

const reachable = isDynamoReachable();

const newCompId = () => `it-${randomUUID()}`;

const baseComp = (compId: string): Competition => ({
  compId,
  name: 'Integration Worlds',
  startDate: '2026-06-01',
  endDate: '2026-06-05',
  tokenVersion: 1,
});

const athlete = (compId: string, over: Partial<Athlete> = {}): Athlete => ({
  athleteId: randomUUID(),
  compId,
  firstName: 'Alex',
  lastName: 'Walker',
  name: 'Alex Walker',
  shortName: 'A. Walker',
  birthDate: '1995-04-12',
  country: 'DE',
  gender: 'male',
  ...over,
});

const time = (compId: string, athleteId: string, over: Partial<Time> = {}): Time => ({
  timeId: randomUUID(),
  compId,
  athleteId,
  round: 'qualification',
  timeMs: 12_345,
  startTime: 1_700_000_000_000,
  ...over,
});

const match = (compId: string, over: Partial<Match> = {}): Match => ({
  matchId: randomUUID(),
  compId,
  discipline: 'speed',
  round: 'final',
  roundName: 'Final 1',
  gender: 'male',
  position: 1,
  ...over,
});

const score = (compId: string, athleteId: string, over: Partial<Score> = {}): Score => ({
  scoreId: randomUUID(),
  compId,
  athleteId,
  round: 'final',
  difficulty: 8,
  combo: 7,
  style: 6,
  bestTrick: 9,
  controlPenalty: 2,
  overall: 28,
  ...over,
});

describe.skipIf(!reachable)('competitionDb integration', () => {
  beforeAll(async () => {
    await ensureTables();
  });

  describe('competitions', () => {
    let compId: string;
    beforeAll(() => {
      compId = newCompId();
    });
    afterAll(async () => {
      await clearPartition(COMPETITION_TABLE, compPk(compId));
    });

    it('creates and reads a competition, stamping createdAt', async () => {
      await competitionDb.createCompetition(baseComp(compId));
      const got = await competitionDb.getCompetition(compId);
      expect(got).toMatchObject({ compId, name: 'Integration Worlds', tokenVersion: 1 });
    });

    it('rejects a duplicate compId with a conflict', async () => {
      const dup = competitionDb.createCompetition(baseComp(compId));
      await expect(dup).rejects.toMatchObject({ name: 'ConditionFailed', kind: 'conflict' });
    });

    it('returns null for an unknown competition', async () => {
      expect(await competitionDb.getCompetition(newCompId())).toBeNull();
    });

    it('lists the competition among all competitions', async () => {
      const all = await competitionDb.listCompetitions();
      expect(all.some((c) => c.compId === compId)).toBe(true);
    });

    it('updates name/dates/config in place, preserving tokenVersion, and 404s on unknown comp', async () => {
      const before = await competitionDb.getCompetition(compId);
      await competitionDb.updateCompetition(compId, {
        name: 'Renamed Worlds',
        startDate: '2026-08-01',
        endDate: '2026-08-05',
        config: { freestyle: { breakMs: 45_000 } },
      });
      const after = await competitionDb.getCompetition(compId);
      expect(after).toMatchObject({
        compId,
        name: 'Renamed Worlds',
        startDate: '2026-08-01',
        endDate: '2026-08-05',
        tokenVersion: before!.tokenVersion,
        config: { freestyle: { breakMs: 45_000 } },
      });

      // Re-update without config clears it (REMOVE branch).
      await competitionDb.updateCompetition(compId, {
        name: 'Renamed Worlds',
        startDate: '2026-08-01',
        endDate: '2026-08-05',
      });
      expect((await competitionDb.getCompetition(compId))?.config).toBeUndefined();

      await expect(
        competitionDb.updateCompetition(newCompId(), {
          name: 'X',
          startDate: '2026-08-01',
          endDate: '2026-08-05',
        }),
      ).rejects.toMatchObject({ kind: 'not_found' });
    });

    it('bumps tokenVersion to revoke read tokens, and 404s on unknown comp', async () => {
      const next = await competitionDb.bumpTokenVersion(compId);
      expect(next).toBe(2);
      const reread = await competitionDb.getCompetition(compId);
      expect(reread?.tokenVersion).toBe(2);

      await expect(competitionDb.bumpTokenVersion(newCompId())).rejects.toMatchObject({
        kind: 'not_found',
      });
    });
  });

  describe('athletes', () => {
    let compId: string;
    beforeAll(async () => {
      compId = newCompId();
      await competitionDb.createCompetition(baseComp(compId));
    });
    afterAll(async () => {
      await clearPartition(COMPETITION_TABLE, compPk(compId));
    });

    it('creates, gets, and lists athletes sorted by name', async () => {
      const zoe = athlete(compId, { name: 'Zoe Young', gender: 'female' });
      const amy = athlete(compId, { name: 'Amy Brown', gender: 'female' });
      await competitionDb.createAthlete(zoe);
      await competitionDb.createAthlete(amy);

      expect(await competitionDb.getAthlete(compId, amy.athleteId)).toMatchObject({
        name: 'Amy Brown',
      });
      const list = await competitionDb.listAthletes(compId);
      expect(list.map((a) => a.name)).toEqual(['Amy Brown', 'Zoe Young']);
    });

    it('round-trips optional fields and omits absent ones', async () => {
      const full = athlete(compId, { country2: 'AT', notes: 'wildcard', photoKey: 'p/abc.jpg' });
      await competitionDb.createAthlete(full);
      const got = await competitionDb.getAthlete(compId, full.athleteId);
      expect(got).toMatchObject({ country2: 'AT', notes: 'wildcard', photoKey: 'p/abc.jpg' });

      const bare = athlete(compId);
      await competitionDb.createAthlete(bare);
      const gotBare = await competitionDb.getAthlete(compId, bare.athleteId);
      expect(gotBare).not.toHaveProperty('country2');
      expect(gotBare).not.toHaveProperty('photoKey');
    });

    it('update requires existence; delete requires existence', async () => {
      const ghost = athlete(compId);
      await expect(competitionDb.updateAthlete(ghost)).rejects.toMatchObject({ kind: 'not_found' });
      await expect(competitionDb.deleteAthlete(compId, ghost.athleteId)).rejects.toMatchObject({
        kind: 'not_found',
      });
    });

    it('updates an existing athlete in place', async () => {
      const a = athlete(compId, { name: 'Before' });
      await competitionDb.createAthlete(a);
      await competitionDb.updateAthlete({ ...a, name: 'After' });
      expect((await competitionDb.getAthlete(compId, a.athleteId))?.name).toBe('After');
    });

    it('detects references from times and matches (referential integrity)', async () => {
      const a = athlete(compId);
      await competitionDb.createAthlete(a);
      expect(await competitionDb.athleteHasReferences(compId, a.athleteId)).toEqual({
        times: false,
        matches: false,
        scores: false,
      });

      await competitionDb.createTime(time(compId, a.athleteId));
      await competitionDb.createMatch(match(compId, { winnerId: a.athleteId }));
      await competitionDb.createScore(score(compId, a.athleteId));
      expect(await competitionDb.athleteHasReferences(compId, a.athleteId)).toEqual({
        times: true,
        matches: true,
        scores: true,
      });
    });
  });

  describe('times', () => {
    let compId: string;
    const athleteId = randomUUID();
    beforeAll(async () => {
      compId = newCompId();
      await competitionDb.createCompetition(baseComp(compId));
    });
    afterAll(async () => {
      await clearPartition(COMPETITION_TABLE, compPk(compId));
    });

    it('filters by round via the SK prefix and finds by id across rounds', async () => {
      const qual = time(compId, athleteId, { round: 'qualification' });
      const fin = time(compId, athleteId, { round: 'final' });
      await competitionDb.createTime(qual);
      await competitionDb.createTime(fin);

      const finals = await competitionDb.listTimes(compId, 'final');
      expect(finals.map((t) => t.timeId)).toEqual([fin.timeId]);
      expect((await competitionDb.listTimes(compId)).length).toBeGreaterThanOrEqual(2);
      expect((await competitionDb.findTimeById(compId, qual.timeId))?.round).toBe('qualification');
      expect(await competitionDb.findTimeById(compId, randomUUID())).toBeNull();
    });

    it('edits attributes in place without moving the SK', async () => {
      const t = time(compId, athleteId, { timeMs: 1000 });
      await competitionDb.createTime(t);
      await competitionDb.upsertTime(t, { ...t, timeMs: 2000 });
      expect((await competitionDb.findTimeById(compId, t.timeId))?.timeMs).toBe(2000);
    });

    it('upsertTime 404s when the item vanished (concurrent delete)', async () => {
      const ghost = time(compId, athleteId);
      await expect(competitionDb.upsertTime(ghost, ghost)).rejects.toMatchObject({
        name: 'ConditionFailed',
        kind: 'not_found',
      });
    });

    it('upsertTime relocates the item to a new round transactionally', async () => {
      const t = time(compId, athleteId, { round: 'half' });
      await competitionDb.createTime(t);
      const moved = { ...t, round: 'final' as const };
      await competitionDb.upsertTime(t, moved);

      expect(await competitionDb.listTimes(compId, 'half')).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ timeId: t.timeId })]),
      );
      expect(await competitionDb.listTimes(compId, 'final')).toEqual(
        expect.arrayContaining([expect.objectContaining({ timeId: t.timeId, round: 'final' })]),
      );
    });

    it('upsertTime conflicts when the moved item is gone', async () => {
      const t = time(compId, athleteId, { round: 'test' });
      const moved = { ...t, round: 'final' as const };
      // never created → the Delete's attribute_exists condition fails
      await expect(competitionDb.upsertTime(t, moved)).rejects.toBeInstanceOf(ConditionFailed);
    });

    it('deletes a time', async () => {
      const t = time(compId, athleteId, { round: 'training' });
      await competitionDb.createTime(t);
      await competitionDb.deleteTime(t);
      expect(await competitionDb.findTimeById(compId, t.timeId)).toBeNull();
    });
  });

  describe('matches', () => {
    let compId: string;
    beforeAll(async () => {
      compId = newCompId();
      await competitionDb.createCompetition(baseComp(compId));
    });
    afterAll(async () => {
      await clearPartition(COMPETITION_TABLE, compPk(compId));
    });

    it('lists by discipline, discipline+gender(+round), and sorts by position', async () => {
      const m1 = match(compId, { gender: 'male', round: 'quarter', position: 2 });
      const m2 = match(compId, { gender: 'male', round: 'quarter', position: 1 });
      const f1 = match(compId, { gender: 'female', round: 'final', position: 1 });
      const free = match(compId, { discipline: 'freestyle', gender: 'male', round: 'final' });
      await competitionDb.createMatch(m1);
      await competitionDb.createMatch(m2);
      await competitionDb.createMatch(f1);
      await competitionDb.createMatch(free);

      const maleQuarter = await competitionDb.listMatches(compId, 'speed', 'male', 'quarter');
      expect(maleQuarter.map((m) => m.matchId)).toEqual([m2.matchId, m1.matchId]); // position asc
      expect(
        (await competitionDb.listMatches(compId, 'speed', 'female')).map((m) => m.matchId),
      ).toEqual([f1.matchId]);
      expect((await competitionDb.listMatches(compId, 'freestyle')).map((m) => m.matchId)).toEqual([
        free.matchId,
      ]);
      expect((await competitionDb.listMatches(compId)).length).toBeGreaterThanOrEqual(4);
    });

    it('finds by id, edits attrs in place, and moves across gender/round', async () => {
      const m = match(compId, { gender: 'male', round: 'half', roundName: 'SF', position: 5 });
      await competitionDb.createMatch(m);
      expect((await competitionDb.findMatchById(compId, m.matchId))?.roundName).toBe('SF');

      await competitionDb.upsertMatch(m, { ...m, roundName: 'Semi' });
      expect((await competitionDb.findMatchById(compId, m.matchId))?.roundName).toBe('Semi');

      const moved = { ...m, gender: 'female' as const, round: 'final' as const };
      await competitionDb.upsertMatch(m, moved);
      const after = await competitionDb.findMatchById(compId, m.matchId);
      expect(after).toMatchObject({ gender: 'female', round: 'final' });
    });

    it('upsertMatch 404s when the item vanished (concurrent delete)', async () => {
      const ghost = match(compId);
      await expect(competitionDb.upsertMatch(ghost, ghost)).rejects.toMatchObject({
        name: 'ConditionFailed',
        kind: 'not_found',
      });
    });

    it('deletes a match', async () => {
      const m = match(compId, { round: 'small_final' });
      await competitionDb.createMatch(m);
      await competitionDb.deleteMatch(m);
      expect(await competitionDb.findMatchById(compId, m.matchId)).toBeNull();
    });
  });

  describe('scores', () => {
    let compId: string;
    const athleteId = randomUUID();
    beforeAll(async () => {
      compId = newCompId();
      await competitionDb.createCompetition(baseComp(compId));
    });
    afterAll(async () => {
      await clearPartition(COMPETITION_TABLE, compPk(compId));
    });

    it('filters by round via the SK prefix and finds by id across rounds', async () => {
      const fin = score(compId, athleteId, { round: 'final' });
      const half = score(compId, athleteId, { round: 'half' });
      await competitionDb.createScore(fin);
      await competitionDb.createScore(half);

      const finals = await competitionDb.listScores(compId, 'final');
      expect(finals.map((s) => s.scoreId)).toEqual([fin.scoreId]);
      expect((await competitionDb.listScores(compId)).length).toBeGreaterThanOrEqual(2);
      expect((await competitionDb.findScoreById(compId, half.scoreId))?.round).toBe('half');
      expect(await competitionDb.findScoreById(compId, randomUUID())).toBeNull();
    });

    it('rejects a second score for the same athlete+round (identity is round+athlete)', async () => {
      const a = randomUUID();
      await competitionDb.createScore(score(compId, a, { round: 'quarter' }));
      await expect(
        competitionDb.createScore(score(compId, a, { round: 'quarter' })),
      ).rejects.toMatchObject({ name: 'ConditionFailed', kind: 'conflict' });
    });

    it('edits components in place without moving the SK', async () => {
      const a = randomUUID();
      const s = score(compId, a, { round: 'small_final', overall: 10 });
      await competitionDb.createScore(s);
      await competitionDb.upsertScore(s, { ...s, overall: 42 });
      expect((await competitionDb.findScoreById(compId, s.scoreId))?.overall).toBe(42);
    });

    it('upsertScore 404s when the item vanished (concurrent delete)', async () => {
      const ghost = score(compId, randomUUID());
      await expect(competitionDb.upsertScore(ghost, ghost)).rejects.toMatchObject({
        name: 'ConditionFailed',
        kind: 'not_found',
      });
    });

    it('upsertScore relocates the item to a new round transactionally', async () => {
      const a = randomUUID();
      const s = score(compId, a, { round: 'test' });
      await competitionDb.createScore(s);
      const moved = { ...s, round: 'final' as const };
      await competitionDb.upsertScore(s, moved);

      expect(await competitionDb.listScores(compId, 'test')).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ scoreId: s.scoreId })]),
      );
      expect(await competitionDb.listScores(compId, 'final')).toEqual(
        expect.arrayContaining([expect.objectContaining({ scoreId: s.scoreId, round: 'final' })]),
      );
    });

    it('upsertScore conflicts when the moved item is gone', async () => {
      const s = score(compId, randomUUID(), { round: 'qualification' });
      const moved = { ...s, round: 'final' as const };
      await expect(competitionDb.upsertScore(s, moved)).rejects.toBeInstanceOf(ConditionFailed);
    });

    it('deletes a score', async () => {
      const s = score(compId, randomUUID(), { round: 'half' });
      await competitionDb.createScore(s);
      await competitionDb.deleteScore(s);
      expect(await competitionDb.findScoreById(compId, s.scoreId)).toBeNull();
    });
  });

  describe('manager grants (per-competition ACL)', () => {
    let compA: string;
    let compB: string;
    beforeAll(async () => {
      compA = newCompId();
      compB = newCompId();
      await competitionDb.createCompetition(baseComp(compA));
      await competitionDb.createCompetition(baseComp(compB));
    });
    afterAll(async () => {
      await clearPartition(COMPETITION_TABLE, compPk(compA));
      await clearPartition(COMPETITION_TABLE, compPk(compB));
      await clearPartition(COMPETITION_TABLE, 'USER#sub-int');
    });

    const grant = {
      sub: 'sub-int',
      email: 'rider@isa.org',
      grantedByEmail: 'admin@isa.org',
      grantedBySub: 'admin-int',
      grantedAt: 1_700_000_000_000,
    };

    it('grants access to one competition and isolates the other', async () => {
      await competitionDb.grantManager(compA, grant);

      expect(await competitionDb.getManagerGrant(compA, 'sub-int')).toMatchObject({
        sub: 'sub-int',
        email: 'rider@isa.org',
      });
      // The manager has NO grant on compB — the isolation guarantee.
      expect(await competitionDb.getManagerGrant(compB, 'sub-int')).toBeNull();
    });

    it('lists a manager only under their granted competition', async () => {
      expect((await competitionDb.listManagers(compA)).map((m) => m.sub)).toContain('sub-int');
      expect(await competitionDb.listManagers(compB)).toEqual([]);
    });

    it('reverse-lists exactly the granted competitions for the user', async () => {
      const compIds = await competitionDb.listManagerCompIds('sub-int');
      expect(compIds).toContain(compA);
      expect(compIds).not.toContain(compB);
    });

    it('revoking removes both the forward grant and the reverse adjacency', async () => {
      await competitionDb.revokeManager(compA, 'sub-int');
      expect(await competitionDb.getManagerGrant(compA, 'sub-int')).toBeNull();
      expect(await competitionDb.listManagerCompIds('sub-int')).not.toContain(compA);
    });
  });
});
