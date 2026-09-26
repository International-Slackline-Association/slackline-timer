import { randomUUID } from 'node:crypto';

import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from 'aws-lambda';
import {
  BracketError,
  advanceTargets,
  seedBracketMatches,
  type BracketRow,
  type SeedStage,
} from 'core/bracketProgression';
import { publishDbUpdate } from 'core/broadcast';
import { competitionDb } from 'core/competitionDb';
import {
  AuthContext,
  HttpError,
  errorResponse,
  getAuth,
  json,
  loadCompetitionOrThrow,
  parseBody,
  parseJsonBody,
  requireCompAccess,
  requireWrite,
} from 'core/http';
import { rankAthletesByBestTime, rankAthletesByOverall } from 'core/rankings';
import {
  isDiscipline,
  isGender,
  isMatchRound,
  type Discipline,
  type Gender,
  type Match,
} from 'core/types';
import { validateMatchInput } from 'core/validators';

/**
 * Match CRUD (mirrors timertimer's MatchLive). Editing gender/round rewrites
 * the sort key → transactional delete+put. Athlete slots are validated to
 * exist when set.
 */
export const main: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext> = async (event) => {
  try {
    const auth = getAuth(event);
    const compId = event.pathParameters!.compId!;
    await requireCompAccess(auth, compId);
    await loadCompetitionOrThrow(compId);

    const routeKey = event.routeKey;

    if (routeKey === 'GET /competitions/{compId}/matches') {
      const { discipline, gender, round } = event.queryStringParameters ?? {};
      if (discipline !== undefined && !isDiscipline(discipline)) {
        throw new HttpError(400, `unknown discipline: ${discipline}`);
      }
      if (gender !== undefined && !isGender(gender)) {
        throw new HttpError(400, `unknown gender: ${gender}`);
      }
      if (round !== undefined && !isMatchRound(round)) {
        throw new HttpError(400, `unknown round: ${round}`);
      }
      // The SK is discipline-first: each narrower filter requires the broader one.
      if (gender !== undefined && discipline === undefined) {
        throw new HttpError(
          400,
          'gender filter requires discipline (matches are keyed discipline-first)',
        );
      }
      if (round !== undefined && gender === undefined) {
        throw new HttpError(400, 'round filter requires gender (matches are keyed gender-first)');
      }
      return json(200, await competitionDb.listMatches(compId, discipline, gender, round));
    }

    if (routeKey === 'POST /competitions/{compId}/matches') {
      requireWrite(auth);
      const input = parseBody(event, validateMatchInput, 'invalid match');
      await assertAthleteSlotsExist(compId, input);

      const match = { ...input, matchId: randomUUID(), compId };
      await competitionDb.createMatch(match);
      await publishDbUpdate({ compId, entity: 'match', action: 'created', id: match.matchId });
      return json(201, match);
    }

    if (routeKey === 'POST /competitions/{compId}/matches/seed') {
      requireWrite(auth);
      // Thin alias for advance with fromRound=qualification, kept for the dev
      // seed script + existing tooling. Delegates to the same seedBracket.
      const { discipline, gender, force, stage } = parseBracketBody(event);
      return json(201, await seedBracket(compId, discipline, gender, force, stage));
    }

    if (routeKey === 'POST /competitions/{compId}/matches/advance') {
      requireWrite(auth);
      const { discipline, gender, fromRound, force, stage } = parseBracketBody(event);
      // One progression entry point that dispatches on the source stage:
      // qualification seeds the bracket from the ranking (201, created); every
      // other round advances winners into the next round (200).
      if (fromRound === 'qualification') {
        return json(201, await seedBracket(compId, discipline, gender, force, stage));
      }
      if (!isMatchRound(fromRound)) {
        throw new HttpError(400, `unknown round: ${String(fromRound)}`);
      }
      return json(200, await advanceBracket(compId, discipline, gender, fromRound, force));
    }

    const matchId = event.pathParameters?.matchId;
    if (!matchId) throw new HttpError(404, `unsupported route ${routeKey}`);

    const existing = await competitionDb.findMatchById(compId, matchId);
    if (!existing) throw new HttpError(404, `match ${matchId} not found`);

    if (routeKey === 'PUT /competitions/{compId}/matches/{matchId}') {
      requireWrite(auth);
      const input = parseBody(event, validateMatchInput, 'invalid match');
      await assertAthleteSlotsExist(compId, input, existing);

      const updated = { ...input, matchId, compId };
      await competitionDb.upsertMatch(existing, updated);
      await publishDbUpdate({ compId, entity: 'match', action: 'updated', id: matchId });
      return json(200, updated);
    }

    if (routeKey === 'DELETE /competitions/{compId}/matches/{matchId}') {
      requireWrite(auth);
      await competitionDb.deleteMatch(existing);
      await publishDbUpdate({ compId, entity: 'match', action: 'deleted', id: matchId });
      return json(204, '');
    }

    throw new HttpError(404, `unsupported route ${routeKey}`);
  } catch (e) {
    return errorResponse(e);
  }
};

interface BracketBody {
  discipline: Discipline;
  gender: Gender;
  fromRound?: unknown;
  force: boolean;
  /** Optional operator override of the auto-picked entry stage (seed only). */
  stage?: SeedStage;
}

/** Validate the shared `{ discipline, gender, force?, stage? }` body of seed/advance. */
const parseBracketBody = (event: { body?: string; isBase64Encoded?: boolean }): BracketBody => {
  const b = (parseJsonBody(event) ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (!isDiscipline(b.discipline)) errors.push('discipline must be speed or freestyle');
  if (!isGender(b.gender)) errors.push('gender must be male or female');
  if (b.force !== undefined && typeof b.force !== 'boolean') errors.push('force must be a boolean');
  if (b.stage !== undefined && b.stage !== 'quarter' && b.stage !== 'half') {
    errors.push('stage must be quarter or half');
  }
  if (errors.length > 0) throw new HttpError(400, 'invalid request', errors);
  return {
    discipline: b.discipline as Discipline,
    gender: b.gender as Gender,
    fromRound: b.fromRound,
    force: b.force === true,
    stage: b.stage as SeedStage | undefined,
  };
};

/**
 * Seed the bracket entry round from the qualification ranking (speed = best
 * Time asc, freestyle = Score overall desc). The stage is chosen by field size
 * (rules S7/F11): ≥9 ranked athletes → the four quarter-finals (top 8); <9 → a
 * top-4 semi-final bracket; an operator `stageOverride` forces either. Refuses
 * (409) if any slot in the seeded round for this discipline+gender already
 * holds an athlete, unless `force`. Writes all rows in one transaction.
 */
const seedBracket = async (
  compId: string,
  discipline: Discipline,
  gender: Gender,
  force: boolean,
  stageOverride?: SeedStage,
): Promise<Match[]> => {
  const athletes = await competitionDb.listAthletes(compId);
  const rankedIds =
    discipline === 'freestyle'
      ? rankAthletesByOverall(
          athletes,
          await competitionDb.listScores(compId, 'qualification'),
          gender,
        ).map((r) => r.athlete.athleteId)
      : rankAthletesByBestTime(
          athletes,
          await competitionDb.listTimes(compId, 'qualification'),
          gender,
        ).map((r) => r.athlete.athleteId);

  let stage: SeedStage;
  let seeded: Omit<Match, 'matchId' | 'compId'>[];
  try {
    ({ stage, matches: seeded } = seedBracketMatches(rankedIds, discipline, gender, stageOverride));
  } catch (e) {
    if (e instanceof BracketError) throw new HttpError(400, e.message, e.details);
    throw e;
  }

  const existing = await competitionDb.listMatches(compId, discipline, gender, stage);
  if (!force) {
    const filled = existing.some((m) => m.athlete1Id || m.athlete2Id || m.winnerId);
    if (filled) {
      throw new HttpError(409, `${stage} bracket already seeded; re-run with force to overwrite`);
    }
  }

  // Reuse an existing row's matchId at the same position so we overwrite in
  // place (the SK is matchId-keyed) rather than leaving orphan rows.
  const byPosition = new Map(existing.map((m) => [m.position, m]));
  const matches: Match[] = seeded.map((row) => ({
    ...row,
    compId,
    matchId: byPosition.get(row.position)?.matchId ?? randomUUID(),
  }));

  await competitionDb.writeBracketMatches(matches);
  await publishDbUpdate({ compId, entity: 'match', action: 'updated', id: 'bracket-seed' });
  return matches;
};

/**
 * Advance `fromRound` into the next round. Every source match must have a
 * winnerId (else 400 listing the missing ones). Fills/creates the downstream
 * rows (half / final + small_final) in one transaction. Refuses (409) if a
 * target slot already holds a DIFFERENT athlete, unless `force`. A downstream
 * winner survives a re-advance with an unchanged pair and clears only when the
 * contenders change (so a no-op re-run never un-decides a played round).
 */
const advanceBracket = async (
  compId: string,
  discipline: Discipline,
  gender: Gender,
  fromRound: Match['round'],
  force: boolean,
): Promise<Match[]> => {
  const source = await competitionDb.listMatches(compId, discipline, gender, fromRound);
  if (source.length === 0) {
    throw new HttpError(400, `no ${fromRound} matches to advance for ${discipline} ${gender}`);
  }
  const missing = source
    .filter((m) => !m.winnerId)
    .map((m) => m.roundName || `position ${m.position}`);
  if (missing.length > 0) {
    throw new HttpError(400, 'every source match needs a winner before advancing', missing);
  }

  let targets: BracketRow[];
  try {
    targets = advanceTargets(fromRound, source);
  } catch (e) {
    if (e instanceof BracketError) throw new HttpError(400, e.message, e.details);
    throw e;
  }
  if (targets.length === 0) {
    throw new HttpError(400, `${fromRound} has no downstream round to advance into`);
  }

  // Index existing downstream rows by (round, position) so we overwrite the
  // same SK rather than creating duplicates, and can detect collisions.
  const downstreamRounds = [...new Set(targets.map((t) => t.round))];
  const existing: Match[] = [];
  for (const round of downstreamRounds) {
    existing.push(...(await competitionDb.listMatches(compId, discipline, gender, round)));
  }
  const slotKey = (round: string, position: number) => `${round}#${position}`;
  const bySlot = new Map(existing.map((m) => [slotKey(m.round, m.position), m]));

  const matches: Match[] = [];
  for (const t of targets) {
    const current = bySlot.get(slotKey(t.round, t.position));
    if (!force && current) {
      const collides =
        (current.athlete1Id && current.athlete1Id !== t.athlete1Id) ||
        (current.athlete2Id && current.athlete2Id !== t.athlete2Id);
      if (collides) {
        throw new HttpError(
          409,
          `${t.round} #${t.position} already holds different athletes; re-run with force to overwrite`,
        );
      }
    }
    // A no-op re-run must not un-decide a played round (see the docblock).
    const athletesChanged =
      current?.athlete1Id !== t.athlete1Id || current?.athlete2Id !== t.athlete2Id;
    const winnerId = !athletesChanged ? current?.winnerId : undefined;

    matches.push({
      discipline,
      gender,
      round: t.round,
      position: t.position,
      // Bracket rows carry no roundName; preserve an operator's manual override
      // if one already sits on the downstream slot.
      ...(current?.roundName ? { roundName: current.roundName } : {}),
      ...(t.athlete1Id !== undefined ? { athlete1Id: t.athlete1Id } : {}),
      ...(t.athlete2Id !== undefined ? { athlete2Id: t.athlete2Id } : {}),
      ...(winnerId ? { winnerId } : {}),
      compId,
      matchId: current?.matchId ?? randomUUID(),
    });
  }

  await competitionDb.writeBracketMatches(matches);
  await publishDbUpdate({ compId, entity: 'match', action: 'updated', id: 'bracket-advance' });
  return matches;
};

/** Validate referenced athletes exist; skips slots unchanged from the current item. */
const assertAthleteSlotsExist = async (
  compId: string,
  next: Pick<Match, 'athlete1Id' | 'athlete2Id' | 'winnerId'>,
  current?: Match,
): Promise<void> => {
  const ids = [next.athlete1Id, next.athlete2Id, next.winnerId].filter(
    (id): id is string =>
      id !== undefined &&
      id !== current?.athlete1Id &&
      id !== current?.athlete2Id &&
      id !== current?.winnerId,
  );
  for (const id of [...new Set(ids)]) {
    const athlete = await competitionDb.getAthlete(compId, id);
    if (!athlete) throw new HttpError(400, `athlete ${id} does not exist`);
  }
};
