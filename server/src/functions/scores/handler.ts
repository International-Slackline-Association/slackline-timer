import { randomUUID } from 'node:crypto';

import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from 'aws-lambda';
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
  requireCompAccess,
  requireWrite,
} from 'core/http';
import { isMatchRound } from 'core/types';
import { validateScoreInput } from 'core/validators';

/**
 * Freestyle Score CRUD (one record per athlete per round). Mirrors the Time
 * slice: the athlete must exist; editing round/athleteId rewrites the sort key,
 * so those updates run as a transactional delete+put.
 */
export const main: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext> = async (event) => {
  try {
    const auth = getAuth(event);
    const compId = event.pathParameters!.compId!;
    await requireCompAccess(auth, compId);
    await loadCompetitionOrThrow(compId);

    const routeKey = event.routeKey;

    if (routeKey === 'GET /competitions/{compId}/scores') {
      const round = event.queryStringParameters?.round;
      if (round !== undefined && !isMatchRound(round)) {
        throw new HttpError(400, `unknown round: ${round}`);
      }
      return json(200, await competitionDb.listScores(compId, round));
    }

    if (routeKey === 'POST /competitions/{compId}/scores') {
      requireWrite(auth);
      const input = parseBody(event, validateScoreInput, 'invalid score');

      const athlete = await competitionDb.getAthlete(compId, input.athleteId);
      if (!athlete) throw new HttpError(400, `athlete ${input.athleteId} does not exist`);

      // A Score's identity is (round, athleteId); a re-submit is an idempotent
      // upsert that reuses the existing record's scoreId (ADR 0010/0013) rather
      // than minting a fresh UUID and 409ing on the stable SK.
      const existing = await competitionDb.getScore(compId, input.round, input.athleteId);
      if (existing) {
        const score = { ...input, scoreId: existing.scoreId, compId };
        await competitionDb.upsertScore(existing, score);
        await publishDbUpdate({ compId, entity: 'score', action: 'updated', id: score.scoreId });
        return json(200, score);
      }

      const score = { ...input, scoreId: randomUUID(), compId };
      await competitionDb.createScore(score);
      await publishDbUpdate({ compId, entity: 'score', action: 'created', id: score.scoreId });
      return json(201, score);
    }

    const scoreId = event.pathParameters?.scoreId;
    if (!scoreId) throw new HttpError(404, `unsupported route ${routeKey}`);

    const existing = await competitionDb.findScoreById(compId, scoreId);
    if (!existing) throw new HttpError(404, `score ${scoreId} not found`);

    if (routeKey === 'PUT /competitions/{compId}/scores/{scoreId}') {
      requireWrite(auth);
      const input = parseBody(event, validateScoreInput, 'invalid score');

      if (existing.athleteId !== input.athleteId) {
        const athlete = await competitionDb.getAthlete(compId, input.athleteId);
        if (!athlete) throw new HttpError(400, `athlete ${input.athleteId} does not exist`);
      }

      const updated = { ...input, scoreId, compId };
      await competitionDb.upsertScore(existing, updated);
      await publishDbUpdate({ compId, entity: 'score', action: 'updated', id: scoreId });
      return json(200, updated);
    }

    if (routeKey === 'DELETE /competitions/{compId}/scores/{scoreId}') {
      requireWrite(auth);
      await competitionDb.deleteScore(existing);
      await publishDbUpdate({ compId, entity: 'score', action: 'deleted', id: scoreId });
      return json(204, '');
    }

    throw new HttpError(404, `unsupported route ${routeKey}`);
  } catch (e) {
    return errorResponse(e);
  }
};
