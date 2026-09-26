import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { main as athletesHandler } from '@functions/athletes/handler';
import { main as competitionsHandler } from '@functions/competitions/handler';
import { main as matchesHandler } from '@functions/matches/handler';
import { main as rankingsHandler } from '@functions/rankings/handler';
import { main as scoresHandler } from '@functions/scores/handler';
import { main as timesHandler } from '@functions/times/handler';
import { compPk } from 'core/keys';

import {
  callHandler,
  clearPartition,
  COMPETITION_TABLE,
  ensureTables,
  isDynamoReachable,
} from './helpers';

/**
 * End-to-end tests for the HTTP-API Lambda handlers, driven by fake API
 * Gateway v2 events against the local DynamoDB container. They cover the slice
 * the pure unit tests can't: routeKey dispatch, auth/role/scope enforcement,
 * validation → 400, referential-integrity → 409, and the ranking join with DNF
 * ordering — all through real reads/writes.
 *
 * `publishDbUpdate` is a no-op here (WS_API_ENDPOINT unset) and the photo
 * signer is null (no PHOTO_* env), so the handlers run without AWS. Self-skips
 * when the container is down — see helpers.ts.
 */

const reachable = isDynamoReachable();

const newCompId = () => `it-h-${randomUUID()}`;

const createComp = (compId: string) =>
  callHandler(competitionsHandler, {
    routeKey: 'POST /competitions',
    body: { compId, name: 'Handler Worlds', startDate: '2026-06-01', endDate: '2026-06-05' },
  });

const createAthlete = (compId: string, over: Record<string, unknown> = {}) =>
  callHandler<{ athleteId: string }>(athletesHandler, {
    routeKey: 'POST /competitions/{compId}/athletes',
    pathParameters: { compId },
    body: {
      name: 'Alex Walker',
      shortName: 'A. Walker',
      birthDate: '1995-04-12',
      country: 'DE',
      gender: 'male',
      ...over,
    },
  });

describe.skipIf(!reachable)('HTTP API handlers integration', () => {
  beforeAll(async () => {
    await ensureTables();
  });

  describe('competitions handler', () => {
    const compId = newCompId();
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    it('creates (201) then reads it back without the internal tokenVersion', async () => {
      const created = await createComp(compId);
      expect(created.statusCode).toBe(201);

      const got = await callHandler(competitionsHandler, {
        routeKey: 'GET /competitions/{compId}',
        pathParameters: { compId },
      });
      expect(got.statusCode).toBe(200);
      expect(got.body).toMatchObject({ compId, name: 'Handler Worlds' });
      expect(got.body).not.toHaveProperty('tokenVersion');
    });

    it('rejects a non-admin POST with 403', async () => {
      const res = await callHandler(competitionsHandler, {
        routeKey: 'POST /competitions',
        role: 'reader',
        authCompId: 'someComp',
        body: { compId: newCompId(), name: 'x', startDate: '2026-06-01', endDate: '2026-06-05' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('validates input → 400 with field errors', async () => {
      const res = await callHandler<{ details: string[] }>(competitionsHandler, {
        routeKey: 'POST /competitions',
        body: { compId: 'bad id!', name: '', startDate: 'nope', endDate: '2026-06-05' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it('rejects a duplicate compId with 409', async () => {
      const res = await createComp(compId);
      expect(res.statusCode).toBe(409);
    });

    it('revoke-read-tokens is admin-only and bumps the version', async () => {
      const ok = await callHandler<{ revoked: boolean }>(competitionsHandler, {
        routeKey: 'POST /competitions/{compId}/revoke-read-tokens',
        pathParameters: { compId },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.body.revoked).toBe(true);

      const denied = await callHandler(competitionsHandler, {
        routeKey: 'POST /competitions/{compId}/revoke-read-tokens',
        role: 'reader',
        authCompId: compId,
        pathParameters: { compId },
      });
      expect(denied.statusCode).toBe(403);
    });
  });

  describe('athletes handler', () => {
    const compId = newCompId();
    beforeAll(async () => {
      await createComp(compId);
    });
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    it('404s when the competition does not exist', async () => {
      const res = await callHandler(athletesHandler, {
        routeKey: 'GET /competitions/{compId}/athletes',
        pathParameters: { compId: newCompId() },
      });
      expect(res.statusCode).toBe(404);
    });

    it('creates, gets, lists, updates, and deletes an athlete', async () => {
      const created = await createAthlete(compId, { name: 'Casey Lee' });
      expect(created.statusCode).toBe(201);
      const { athleteId } = created.body;

      const got = await callHandler(athletesHandler, {
        routeKey: 'GET /competitions/{compId}/athletes/{athleteId}',
        pathParameters: { compId, athleteId },
      });
      expect(got.body).toMatchObject({ name: 'Casey Lee' });

      const updated = await callHandler(athletesHandler, {
        routeKey: 'PUT /competitions/{compId}/athletes/{athleteId}',
        pathParameters: { compId, athleteId },
        body: {
          name: 'Casey Lee-Smith',
          shortName: 'C. Lee',
          birthDate: '1995-04-12',
          country: 'DE',
          gender: 'male',
        },
      });
      expect(updated.statusCode).toBe(200);

      const del = await callHandler(athletesHandler, {
        routeKey: 'DELETE /competitions/{compId}/athletes/{athleteId}',
        pathParameters: { compId, athleteId },
      });
      expect(del.statusCode).toBe(204);

      const gone = await callHandler(athletesHandler, {
        routeKey: 'GET /competitions/{compId}/athletes/{athleteId}',
        pathParameters: { compId, athleteId },
      });
      expect(gone.statusCode).toBe(404);
    });

    it('blocks deletion while a Time references the athlete (409)', async () => {
      const { body } = await createAthlete(compId);
      const athleteId = body.athleteId;
      await callHandler(timesHandler, {
        routeKey: 'POST /competitions/{compId}/times',
        pathParameters: { compId },
        body: { athleteId, round: 'qualification', timeMs: 9999 },
      });

      const res = await callHandler<{ message: string }>(athletesHandler, {
        routeKey: 'DELETE /competitions/{compId}/athletes/{athleteId}',
        pathParameters: { compId, athleteId },
      });
      expect(res.statusCode).toBe(409);
      expect(res.body.message).toMatch(/times/);
    });

    it('lets a scoped reader list but not write', async () => {
      const list = await callHandler(athletesHandler, {
        routeKey: 'GET /competitions/{compId}/athletes',
        role: 'reader',
        authCompId: compId,
        pathParameters: { compId },
      });
      expect(list.statusCode).toBe(200);

      const write = await createAthleteAsReader(compId);
      expect(write.statusCode).toBe(403);
    });

    it('forbids a reader scoped to another competition (403)', async () => {
      const res = await callHandler(athletesHandler, {
        routeKey: 'GET /competitions/{compId}/athletes',
        role: 'reader',
        authCompId: 'a-different-comp',
        pathParameters: { compId },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('times handler', () => {
    const compId = newCompId();
    let athleteId: string;
    beforeAll(async () => {
      await createComp(compId);
      athleteId = (await createAthlete(compId)).body.athleteId;
    });
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    it('rejects a Time for an unknown athlete with 400', async () => {
      const res = await callHandler(timesHandler, {
        routeKey: 'POST /competitions/{compId}/times',
        pathParameters: { compId },
        body: { athleteId: 'ghost', round: 'final', timeMs: 1000 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('defaults startTime to now - timeMs on create', async () => {
      const before = Date.now();
      const created = await callHandler<{ timeId: string; startTime: number; timeMs: number }>(
        timesHandler,
        {
          routeKey: 'POST /competitions/{compId}/times',
          pathParameters: { compId },
          body: { athleteId, round: 'qualification', timeMs: 5000 },
        },
      );
      expect(created.statusCode).toBe(201);
      expect(created.body.startTime).toBeGreaterThanOrEqual(before - 5000 - 50);
      expect(created.body.startTime).toBeLessThanOrEqual(Date.now() - 5000 + 50);
    });

    it('moves a Time to a new round on PUT (SK rewrite) and filters by round', async () => {
      const created = await callHandler<{ timeId: string }>(timesHandler, {
        routeKey: 'POST /competitions/{compId}/times',
        pathParameters: { compId },
        body: { athleteId, round: 'half', timeMs: 4242, startTime: 1_700_000_000_000 },
      });
      const timeId = created.body.timeId;

      const moved = await callHandler(timesHandler, {
        routeKey: 'PUT /competitions/{compId}/times/{timeId}',
        pathParameters: { compId, timeId },
        body: { athleteId, round: 'final', timeMs: 4242, startTime: 1_700_000_000_000 },
      });
      expect(moved.statusCode).toBe(200);

      const finals = await callHandler<Array<{ timeId: string }>>(timesHandler, {
        routeKey: 'GET /competitions/{compId}/times',
        pathParameters: { compId },
        queryStringParameters: { round: 'final' },
      });
      expect(finals.body.some((t) => t.timeId === timeId)).toBe(true);
    });

    it('rejects an unknown round filter with 400', async () => {
      const res = await callHandler(timesHandler, {
        routeKey: 'GET /competitions/{compId}/times',
        pathParameters: { compId },
        queryStringParameters: { round: 'semis' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('matches handler', () => {
    const compId = newCompId();
    let a1: string;
    beforeAll(async () => {
      await createComp(compId);
      a1 = (await createAthlete(compId)).body.athleteId;
    });
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    it('requires discipline when filtering by gender, and gender when filtering by round', async () => {
      const byGender = await callHandler(matchesHandler, {
        routeKey: 'GET /competitions/{compId}/matches',
        pathParameters: { compId },
        queryStringParameters: { gender: 'male' },
      });
      expect(byGender.statusCode).toBe(400);

      const byRound = await callHandler(matchesHandler, {
        routeKey: 'GET /competitions/{compId}/matches',
        pathParameters: { compId },
        queryStringParameters: { discipline: 'speed', round: 'final' },
      });
      expect(byRound.statusCode).toBe(400);
    });

    it('rejects a match without a discipline (400)', async () => {
      const res = await callHandler(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches',
        pathParameters: { compId },
        body: { round: 'final', roundName: 'F', gender: 'male', position: 1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a match referencing a missing athlete slot (400)', async () => {
      const res = await callHandler(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches',
        pathParameters: { compId },
        body: {
          discipline: 'speed',
          round: 'final',
          roundName: 'F',
          gender: 'male',
          position: 1,
          athlete1Id: 'ghost',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('creates a match with a valid athlete slot and filters it by discipline (201)', async () => {
      const res = await callHandler(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches',
        pathParameters: { compId },
        body: {
          discipline: 'freestyle',
          round: 'final',
          roundName: 'F',
          gender: 'male',
          position: 1,
          athlete1Id: a1,
        },
      });
      expect(res.statusCode).toBe(201);

      const free = await callHandler<Array<{ discipline: string }>>(matchesHandler, {
        routeKey: 'GET /competitions/{compId}/matches',
        pathParameters: { compId },
        queryStringParameters: { discipline: 'freestyle' },
      });
      expect(free.statusCode).toBe(200);
      expect(free.body.every((m) => m.discipline === 'freestyle')).toBe(true);
    });
  });

  describe('matches bracket seed/advance', () => {
    const compId = newCompId();
    /**
     * ranked best -> worst: 9 men with qualification Times, fastest = idx 0. A
     * field of 9 (≥9) seeds the full top-8 quarter bracket per rules S7/F11;
     * men[8] is the cut 9th seed.
     */
    let men: string[];
    beforeAll(async () => {
      await createComp(compId);
      men = [];
      for (let i = 0; i < 9; i++) {
        const id = (await createAthlete(compId, { name: `Racer ${i}`, gender: 'male' })).body
          .athleteId;
        men.push(id);
        // faster (smaller timeMs) for lower i -> men[0] seeds #1
        await callHandler(timesHandler, {
          routeKey: 'POST /competitions/{compId}/times',
          pathParameters: { compId },
          body: { athleteId: id, round: 'qualification', timeMs: 1000 + i * 10, startTime: 1 },
        });
      }
    });
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    const seed = (force = false) =>
      callHandler<Array<Record<string, unknown>>>(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/seed',
        pathParameters: { compId },
        body: { discipline: 'speed', gender: 'male', force },
      });

    const getMatches = (round?: string) =>
      callHandler<
        Array<{
          matchId: string;
          round: string;
          position: number;
          roundName?: string;
          athlete1Id?: string;
          athlete2Id?: string;
          winnerId?: string;
        }>
      >(matchesHandler, {
        routeKey: 'GET /competitions/{compId}/matches',
        pathParameters: { compId },
        queryStringParameters: { discipline: 'speed', gender: 'male', ...(round ? { round } : {}) },
      });

    it('seeds four quarter matches with the standard 1v8/4v5/2v7/3v6 pairing', async () => {
      const res = await seed();
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveLength(4);

      const quarters = (await getMatches('quarter')).body.sort((a, b) => a.position - b.position);
      expect(quarters.map((m) => m.position)).toEqual([1, 2, 3, 4]);
      // Seeded matches carry no display override; the client shows the round label.
      expect(quarters.every((m) => m.roundName === undefined)).toBe(true);
      // seed N -> men[N-1]; 1v8, 4v5, 2v7, 3v6
      expect([quarters[0].athlete1Id, quarters[0].athlete2Id]).toEqual([men[0], men[7]]);
      expect([quarters[1].athlete1Id, quarters[1].athlete2Id]).toEqual([men[3], men[4]]);
      expect([quarters[2].athlete1Id, quarters[2].athlete2Id]).toEqual([men[1], men[6]]);
      expect([quarters[3].athlete1Id, quarters[3].athlete2Id]).toEqual([men[2], men[5]]);
    });

    it('refuses a re-seed without force (409) and overwrites in place with force', async () => {
      const blocked = await seed(false);
      expect(blocked.statusCode).toBe(409);

      const before = (await getMatches('quarter')).body;
      const forced = await seed(true);
      expect(forced.statusCode).toBe(201);
      const after = (await getMatches('quarter')).body;
      // Still four rows, matchIds reused (overwrite in place, no orphans).
      expect(after).toHaveLength(4);
      expect(new Set(after.map((m) => m.matchId))).toEqual(new Set(before.map((m) => m.matchId)));
    });

    it('refuses to advance while a source winner is missing (400)', async () => {
      const res = await callHandler(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/advance',
        pathParameters: { compId },
        body: { discipline: 'speed', gender: 'male', fromRound: 'quarter' },
      });
      expect(res.statusCode).toBe(400);
    });

    const setWinner = async (matchId: string, winnerId: string) => {
      const all = await getMatches();
      const m = all.body.find((x) => x.matchId === matchId)!;
      return callHandler(matchesHandler, {
        routeKey: 'PUT /competitions/{compId}/matches/{matchId}',
        pathParameters: { compId, matchId },
        body: {
          discipline: 'speed',
          gender: 'male',
          round: m.round,
          roundName: m.roundName,
          position: m.position,
          athlete1Id: m.athlete1Id,
          athlete2Id: m.athlete2Id,
          winnerId,
        },
      });
    };

    it('advances quarter -> half once every quarter has a winner', async () => {
      const quarters = (await getMatches('quarter')).body.sort((a, b) => a.position - b.position);
      for (const q of quarters) await setWinner(q.matchId, q.athlete1Id!);

      const res = await callHandler<Array<Record<string, unknown>>>(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/advance',
        pathParameters: { compId },
        body: { discipline: 'speed', gender: 'male', fromRound: 'quarter' },
      });
      expect(res.statusCode).toBe(200);

      const halves = (await getMatches('half')).body.sort((a, b) => a.position - b.position);
      expect(halves.map((m) => m.position)).toEqual([1, 2]);
      // half1 = w(q1) vs w(q2); half2 = w(q3) vs w(q4) — all athlete1 winners.
      expect([halves[0].athlete1Id, halves[0].athlete2Id]).toEqual([
        quarters[0].athlete1Id,
        quarters[1].athlete1Id,
      ]);
      expect([halves[1].athlete1Id, halves[1].athlete2Id]).toEqual([
        quarters[2].athlete1Id,
        quarters[3].athlete1Id,
      ]);
    });

    it('advances half -> final + small_final, routing losers to the bronze match', async () => {
      const halves = (await getMatches('half')).body.sort((a, b) => a.position - b.position);
      for (const h of halves) await setWinner(h.matchId, h.athlete1Id!);

      const res = await callHandler(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/advance',
        pathParameters: { compId },
        body: { discipline: 'speed', gender: 'male', fromRound: 'half' },
      });
      expect(res.statusCode).toBe(200);

      const finals = (await getMatches('final')).body;
      const smalls = (await getMatches('small_final')).body;
      expect(finals).toHaveLength(1);
      expect(smalls).toHaveLength(1);
      // final = winners (athlete1 of each half); small_final = losers (athlete2).
      expect([finals[0].athlete1Id, finals[0].athlete2Id]).toEqual([
        halves[0].athlete1Id,
        halves[1].athlete1Id,
      ]);
      expect([smalls[0].athlete1Id, smalls[0].athlete2Id]).toEqual([
        halves[0].athlete2Id,
        halves[1].athlete2Id,
      ]);
    });

    it('preserves a downstream winner on a non-force re-advance with unchanged athletes', async () => {
      // The final was filled by the half->final advance above; decide it.
      const final = (await getMatches('final')).body[0];
      await setWinner(final.matchId, final.athlete1Id!);

      // Re-advance half->final without force. Athletes are unchanged (same half
      // winners), so the slot must keep its recorded winner — not silently un-decide.
      const res = await callHandler(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/advance',
        pathParameters: { compId },
        body: { discipline: 'speed', gender: 'male', fromRound: 'half' },
      });
      expect(res.statusCode).toBe(200);

      const afterFinal = (await getMatches('final')).body[0];
      expect(afterFinal.winnerId).toBe(final.athlete1Id);
    });

    it('clears a downstream winner when a source winner change rewrites the slot (force)', async () => {
      const final = (await getMatches('final')).body[0];
      // Decide the final, then flip a half winner so the final's athlete1 changes.
      await setWinner(final.matchId, final.athlete1Id!);
      const halves = (await getMatches('half')).body.sort((a, b) => a.position - b.position);
      await setWinner(halves[0].matchId, halves[0].athlete2Id!);

      const res = await callHandler(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/advance',
        pathParameters: { compId },
        body: { discipline: 'speed', gender: 'male', fromRound: 'half', force: true },
      });
      expect(res.statusCode).toBe(200);

      const afterFinal = (await getMatches('final')).body[0];
      // The slot now holds a different athlete1, so the stale winner is gone.
      expect(afterFinal.athlete1Id).toBe(halves[0].athlete2Id);
      expect(afterFinal.winnerId).toBeUndefined();
    });
  });

  describe('matches bracket seed — small fields (rules S7/F11)', () => {
    const compId = newCompId();
    /** ranked best -> worst; grown incrementally per test. */
    const men: string[] = [];
    const addRankedAthlete = async (i: number) => {
      const id = (await createAthlete(compId, { name: `Small ${i}`, gender: 'male' })).body
        .athleteId;
      men.push(id);
      await callHandler(timesHandler, {
        routeKey: 'POST /competitions/{compId}/times',
        pathParameters: { compId },
        body: { athleteId: id, round: 'qualification', timeMs: 1000 + i * 10, startTime: 1 },
      });
    };
    beforeAll(async () => {
      await createComp(compId);
    });
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    const seed = (force = false) =>
      callHandler<
        Array<{ round: string; position: number; athlete1Id?: string; athlete2Id?: string }>
      >(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/seed',
        pathParameters: { compId },
        body: { discipline: 'speed', gender: 'male', force },
      });

    it('400s when fewer than 4 athletes are ranked', async () => {
      await addRankedAthlete(0);
      expect((await seed()).statusCode).toBe(400);
    });

    it('seeds a top-4 semi-final bracket for a small field (<9)', async () => {
      for (let i = 1; i < 6; i++) await addRankedAthlete(i); // 6 ranked total
      const res = await seed(true);
      expect(res.statusCode).toBe(201);
      // Two half matches, no quarters; 1v4 / 2v3 (seeds 5+ cut).
      expect(res.body).toHaveLength(2);
      const halves = res.body.slice().sort((a, b) => a.position - b.position);
      expect(halves.every((m) => m.round === 'half')).toBe(true);
      expect([halves[0].athlete1Id, halves[0].athlete2Id]).toEqual([men[0], men[3]]);
      expect([halves[1].athlete1Id, halves[1].athlete2Id]).toEqual([men[1], men[2]]);
    });

    it('honours a stage=quarter override once the field is large enough', async () => {
      for (let i = 6; i < 8; i++) await addRankedAthlete(i); // 8 ranked total
      const res = await callHandler<Array<{ round: string }>>(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/seed',
        pathParameters: { compId },
        body: { discipline: 'speed', gender: 'male', force: true, stage: 'quarter' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveLength(4);
      expect(res.body.every((m) => m.round === 'quarter')).toBe(true);
    });
  });

  describe('matches bracket advance from qualification (unified seed)', () => {
    const compId = newCompId();
    let men: string[];
    beforeAll(async () => {
      await createComp(compId);
      men = [];
      // 9 ranked (≥9) so qualification seeds the full top-8 quarter bracket.
      for (let i = 0; i < 9; i++) {
        const id = (await createAthlete(compId, { name: `Runner ${i}`, gender: 'male' })).body
          .athleteId;
        men.push(id);
        await callHandler(timesHandler, {
          routeKey: 'POST /competitions/{compId}/times',
          pathParameters: { compId },
          body: { athleteId: id, round: 'qualification', timeMs: 1000 + i * 10, startTime: 1 },
        });
      }
    });
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    const advanceFrom = (fromRound: string, force = false) =>
      callHandler<Array<Record<string, unknown>>>(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/advance',
        pathParameters: { compId },
        body: { discipline: 'speed', gender: 'male', fromRound, force },
      });

    it('seeds the quarters from qualification via advance (201, same 1v8 pairing as /seed)', async () => {
      const res = await advanceFrom('qualification');
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveLength(4);

      const quarters = (
        await callHandler<Array<{ position: number; athlete1Id?: string; athlete2Id?: string }>>(
          matchesHandler,
          {
            routeKey: 'GET /competitions/{compId}/matches',
            pathParameters: { compId },
            queryStringParameters: { discipline: 'speed', gender: 'male', round: 'quarter' },
          },
        )
      ).body.sort((a, b) => a.position - b.position);
      expect([quarters[0].athlete1Id, quarters[0].athlete2Id]).toEqual([men[0], men[7]]);
      expect([quarters[3].athlete1Id, quarters[3].athlete2Id]).toEqual([men[2], men[5]]);
    });

    it('refuses a re-seed via advance without force (409), same as /seed', async () => {
      const res = await advanceFrom('qualification');
      expect(res.statusCode).toBe(409);
    });

    it('400s via advance qualification when fewer than 8 athletes are ranked', async () => {
      const bare = newCompId();
      await createComp(bare);
      const id = (await createAthlete(bare, { gender: 'male' })).body.athleteId;
      await callHandler(timesHandler, {
        routeKey: 'POST /competitions/{compId}/times',
        pathParameters: { compId: bare },
        body: { athleteId: id, round: 'qualification', timeMs: 1000, startTime: 1 },
      });
      const res = await callHandler(matchesHandler, {
        routeKey: 'POST /competitions/{compId}/matches/advance',
        pathParameters: { compId: bare },
        body: { discipline: 'speed', gender: 'male', fromRound: 'qualification' },
      });
      expect(res.statusCode).toBe(400);
      await clearPartition(COMPETITION_TABLE, compPk(bare));
    });
  });

  describe('scores handler', () => {
    const compId = newCompId();
    let athleteId: string;
    beforeAll(async () => {
      await createComp(compId);
      athleteId = (await createAthlete(compId)).body.athleteId;
    });
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    const validScore = (over: Record<string, unknown> = {}) => ({
      athleteId,
      round: 'final',
      difficulty: 8,
      combo: 7,
      style: 6,
      bestTrick: 9,
      controlPenalty: 2,
      ...over,
    });

    it('rejects a Score for an unknown athlete with 400', async () => {
      const res = await callHandler(scoresHandler, {
        routeKey: 'POST /competitions/{compId}/scores',
        pathParameters: { compId },
        body: validScore({ athleteId: 'ghost' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('computes overall from components when omitted', async () => {
      const created = await callHandler<{ scoreId: string; overall: number }>(scoresHandler, {
        routeKey: 'POST /competitions/{compId}/scores',
        pathParameters: { compId },
        body: validScore({ round: 'quarter' }),
      });
      expect(created.statusCode).toBe(201);
      expect(created.body.overall).toBe(8 + 7 + 6 + 9 - 2);
    });

    it('moves a Score to a new round on PUT (SK rewrite) and filters by round', async () => {
      const created = await callHandler<{ scoreId: string }>(scoresHandler, {
        routeKey: 'POST /competitions/{compId}/scores',
        pathParameters: { compId },
        body: validScore({ round: 'half' }),
      });
      const scoreId = created.body.scoreId;

      const moved = await callHandler(scoresHandler, {
        routeKey: 'PUT /competitions/{compId}/scores/{scoreId}',
        pathParameters: { compId, scoreId },
        body: validScore({ round: 'small_final' }),
      });
      expect(moved.statusCode).toBe(200);

      const sf = await callHandler<Array<{ scoreId: string }>>(scoresHandler, {
        routeKey: 'GET /competitions/{compId}/scores',
        pathParameters: { compId },
        queryStringParameters: { round: 'small_final' },
      });
      expect(sf.body.some((s) => s.scoreId === scoreId)).toBe(true);
    });

    it('re-POST for the same athlete+round upserts in place (stable scoreId, new overall)', async () => {
      const first = await callHandler<{ scoreId: string; overall: number }>(scoresHandler, {
        routeKey: 'POST /competitions/{compId}/scores',
        pathParameters: { compId },
        body: validScore({ round: 'test' }),
      });
      expect(first.statusCode).toBe(201);
      expect(first.body.overall).toBe(8 + 7 + 6 + 9 - 2);

      const second = await callHandler<{ scoreId: string; overall: number }>(scoresHandler, {
        routeKey: 'POST /competitions/{compId}/scores',
        pathParameters: { compId },
        body: validScore({ round: 'test', difficulty: 10, controlPenalty: 0 }),
      });
      expect(second.statusCode).toBe(200);
      expect(second.body.scoreId).toBe(first.body.scoreId);
      expect(second.body.overall).toBe(10 + 7 + 6 + 9 - 0);

      const list = await callHandler<Array<{ scoreId: string }>>(scoresHandler, {
        routeKey: 'GET /competitions/{compId}/scores',
        pathParameters: { compId },
        queryStringParameters: { round: 'test' },
      });
      expect(list.body.filter((s) => s.scoreId === first.body.scoreId)).toHaveLength(1);
    });

    it('rejects an unknown round filter with 400', async () => {
      const res = await callHandler(scoresHandler, {
        routeKey: 'GET /competitions/{compId}/scores',
        pathParameters: { compId },
        queryStringParameters: { round: 'training' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('rankings handler', () => {
    const compId = newCompId();
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    it('ranks by best time per gender, with DNF sorting last and athletes without times excluded', async () => {
      await createComp(compId);
      const fast = (await createAthlete(compId, { name: 'Fast Man', gender: 'male' })).body
        .athleteId;
      const slow = (await createAthlete(compId, { name: 'Slow Man', gender: 'male' })).body
        .athleteId;
      const dnf = (await createAthlete(compId, { name: 'DNF Man', gender: 'male' })).body.athleteId;
      // a male athlete with no times must be excluded from the join
      await createAthlete(compId, { name: 'No Times', gender: 'male' });
      // a female athlete must not appear in the male ranking
      const woman = (await createAthlete(compId, { name: 'Fast Woman', gender: 'female' })).body
        .athleteId;

      const postTime = (athleteId: string, timeMs: number) =>
        callHandler(timesHandler, {
          routeKey: 'POST /competitions/{compId}/times',
          pathParameters: { compId },
          body: { athleteId, round: 'final', timeMs, startTime: 1_700_000_000_000 },
        });

      await postTime(fast, 10_000);
      await postTime(fast, 9_000); // best of the two counts
      await postTime(slow, 15_000);
      await postTime(dnf, 3_355_550); // DNF sentinel
      await postTime(woman, 1_000);

      const res = await callHandler<Array<{ athlete: { athleteId: string }; bestTimeMs: number }>>(
        rankingsHandler,
        {
          routeKey: 'GET /competitions/{compId}/rankings/{round}',
          pathParameters: { compId, round: 'final' },
          queryStringParameters: { gender: 'male' },
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.map((r) => r.athlete.athleteId)).toEqual([fast, slow, dnf]);
      expect(res.body[0].bestTimeMs).toBe(9_000);
    });

    it('requires a valid gender query param (400)', async () => {
      const res = await callHandler(rankingsHandler, {
        routeKey: 'GET /competitions/{compId}/rankings/{round}',
        pathParameters: { compId, round: 'final' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('ranks freestyle by overall DESC when discipline=freestyle', async () => {
      const top = (await createAthlete(compId, { name: 'Top Trickster', gender: 'female' })).body
        .athleteId;
      const mid = (await createAthlete(compId, { name: 'Mid Trickster', gender: 'female' })).body
        .athleteId;
      // a female athlete with no score must be excluded from the join
      await createAthlete(compId, { name: 'No Score', gender: 'female' });

      const postScore = (athleteId: string, overall: number) =>
        callHandler(scoresHandler, {
          routeKey: 'POST /competitions/{compId}/scores',
          pathParameters: { compId },
          body: {
            athleteId,
            round: 'final',
            difficulty: 0,
            combo: 0,
            style: 0,
            bestTrick: 0,
            controlPenalty: 0,
            overall,
          },
        });

      await postScore(mid, 50);
      await postScore(top, 90);

      const res = await callHandler<Array<{ athlete: { athleteId: string }; overall: number }>>(
        rankingsHandler,
        {
          routeKey: 'GET /competitions/{compId}/rankings/{round}',
          pathParameters: { compId, round: 'final' },
          queryStringParameters: { gender: 'female', discipline: 'freestyle' },
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.map((r) => r.athlete.athleteId)).toEqual([top, mid]);
      expect(res.body[0].overall).toBe(90);
    });
  });

  describe('rankings handler — overall standings', () => {
    const compId = newCompId();
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    it('merges bracket winners with the quali ranking end-to-end (round=overall)', async () => {
      await createComp(compId);
      const ids: string[] = [];
      for (const name of ['Ann One', 'Bee Two', 'Cee Three', 'Dee Four', 'Eve Five']) {
        ids.push((await createAthlete(compId, { name, gender: 'female' })).body.athleteId);
      }
      const [first, second, third, fourth, fifth] = ids;

      // Quali order: first (9s) … fifth (13s).
      for (const [i, athleteId] of ids.entries()) {
        await callHandler(timesHandler, {
          routeKey: 'POST /competitions/{compId}/times',
          pathParameters: { compId },
          body: {
            athleteId,
            round: 'qualification',
            timeMs: 9_000 + i * 1_000,
            startTime: 1_700_000_000_000,
          },
        });
      }

      // Decided final + small final: quali rank 2 takes gold, rank 4 bronze.
      const postMatch = (round: string, athlete1Id: string, athlete2Id: string, winnerId: string) =>
        callHandler(matchesHandler, {
          routeKey: 'POST /competitions/{compId}/matches',
          pathParameters: { compId },
          body: {
            discipline: 'speed',
            round,
            gender: 'female',
            position: 1,
            athlete1Id,
            athlete2Id,
            winnerId,
          },
        });
      await postMatch('final', first, second, second);
      await postMatch('small_final', third, fourth, fourth);

      const res = await callHandler<
        Array<{ athlete: { athleteId: string }; rank: number; source: string; bestTimeMs: number }>
      >(rankingsHandler, {
        routeKey: 'GET /competitions/{compId}/rankings/{round}',
        pathParameters: { compId, round: 'overall' },
        queryStringParameters: { gender: 'female' },
      });

      expect(res.statusCode).toBe(200);
      // Nobody ran a bracket round, so every row's VALUE is its quali best and
      // every row reports `qualification` — the tag names where the number came
      // from, not where the rank was decided.
      expect(res.body.map((r) => [r.rank, r.athlete.athleteId, r.source])).toEqual([
        [1, second, 'qualification'],
        [2, first, 'qualification'],
        [3, fourth, 'qualification'],
        [4, third, 'qualification'],
        [5, fifth, 'qualification'],
      ]);
      expect(res.body[0].bestTimeMs).toBe(10_000);
    });
  });

  describe('rankings handler — combined ranking', () => {
    const compId = newCompId();
    afterAll(() => clearPartition(COMPETITION_TABLE, compPk(compId)));

    it('averages the two decided disciplines end-to-end (round=combined)', async () => {
      await createComp(compId);
      const ids: string[] = [];
      for (const name of ['Ann One', 'Bee Two', 'Cee Three']) {
        ids.push((await createAthlete(compId, { name, gender: 'female' })).body.athleteId);
      }
      const [ann, bee, cee] = ids;

      // Speed quali: ann (9s), bee (10s), cee (11s).
      for (const [i, athleteId] of ids.entries()) {
        await callHandler(timesHandler, {
          routeKey: 'POST /competitions/{compId}/times',
          pathParameters: { compId },
          body: {
            athleteId,
            round: 'qualification',
            timeMs: 9_000 + i * 1_000,
            startTime: 1_700_000_000_000,
          },
        });
      }
      // Freestyle quali: cee (90) > bee (80) > ann (70).
      for (const [i, athleteId] of ids.entries()) {
        await callHandler(scoresHandler, {
          routeKey: 'POST /competitions/{compId}/scores',
          pathParameters: { compId },
          body: {
            athleteId,
            round: 'qualification',
            difficulty: 0,
            combo: 0,
            style: 0,
            bestTrick: 0,
            controlPenalty: 0,
            overall: 70 + i * 10,
          },
        });
      }

      // Decided finals: ann wins speed over bee; cee wins freestyle over bee.
      const postFinal = (discipline: string, winnerId: string, loserId: string) =>
        callHandler(matchesHandler, {
          routeKey: 'POST /competitions/{compId}/matches',
          pathParameters: { compId },
          body: {
            discipline,
            round: 'final',
            gender: 'female',
            position: 1,
            athlete1Id: winnerId,
            athlete2Id: loserId,
            winnerId,
          },
        });
      await postFinal('speed', ann, bee);
      await postFinal('freestyle', cee, bee);

      const res = await callHandler<
        Array<{
          athlete: { athleteId: string };
          rank: number;
          combined: number;
          speedRank: number;
          freestyleRank: number;
          provisional?: boolean;
        }>
      >(rankingsHandler, {
        routeKey: 'GET /competitions/{compId}/rankings/{round}',
        pathParameters: { compId, round: 'combined' },
        queryStringParameters: { gender: 'female' },
      });

      expect(res.statusCode).toBe(200);
      // Speed placements: ann 1, bee 2, cee 3 (quali tail); freestyle: cee 1,
      // bee 2, ann 3. Averages: bee 2 < ann/cee 2 — all equal → shared rank 1,
      // ordered by better single best rank (ann/cee hold a 1) then name.
      expect(
        res.body.map((r) => [
          r.rank,
          r.athlete.athleteId,
          r.combined,
          r.speedRank,
          r.freestyleRank,
        ]),
      ).toEqual([
        [1, ann, 2, 1, 3],
        [1, cee, 2, 3, 1],
        [1, bee, 2, 2, 2],
      ]);
      // Speed's cee rank-3 placement is a quali-tail row behind a decided final
      // pair → firm; freestyle mirrors it. Nothing left undecided.
      expect(res.body.every((r) => r.provisional === undefined)).toBe(true);
    });
  });
});

/** A reader attempting a write — asserts the HTTP data plane refuses read-token writes. */
const createAthleteAsReader = (compId: string) =>
  callHandler(athletesHandler, {
    routeKey: 'POST /competitions/{compId}/athletes',
    role: 'reader',
    authCompId: compId,
    pathParameters: { compId },
    body: {
      name: 'X',
      shortName: 'X',
      birthDate: '1990-01-01',
      country: 'DE',
      gender: 'male',
    },
  });
