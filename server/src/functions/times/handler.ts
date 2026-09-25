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
import { isTimeRound } from 'core/types';
import { validateTimeInput } from 'core/validators';

/**
 * Time CRUD. POST is the timer console's save-on-stop (athlete must exist;
 * startTime defaults to now - timeMs like timertimer). Editing round/athleteId
 * rewrites the sort key, so those updates run as a transactional delete+put.
 */
export const main: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext> = async (event) => {
  try {
    const auth = getAuth(event);
    const compId = event.pathParameters!.compId!;
    await requireCompAccess(auth, compId);
    await loadCompetitionOrThrow(compId);

    const routeKey = event.routeKey;

    if (routeKey === 'GET /competitions/{compId}/times') {
      const round = event.queryStringParameters?.round;
      if (round !== undefined && !isTimeRound(round)) {
        throw new HttpError(400, `unknown round: ${round}`);
      }
      return json(200, await competitionDb.listTimes(compId, round));
    }

    if (routeKey === 'POST /competitions/{compId}/times') {
      requireWrite(auth);
      const input = parseBody(event, (b) => validateTimeInput(b, Date.now()), 'invalid time');

      const athlete = await competitionDb.getAthlete(compId, input.athleteId);
      if (!athlete) throw new HttpError(400, `athlete ${input.athleteId} does not exist`);

      const time = { ...input, timeId: randomUUID(), compId };
      await competitionDb.createTime(time);
      // Run-timeline trace (pairs with the messageHandler relay trace): the
      // persisted result of a lane stop, with the athlete identity attached.
      console.log(
        JSON.stringify({
          timeCreated: 1,
          compId,
          timeId: time.timeId,
          athleteId: time.athleteId,
          athleteName: athlete.name,
          round: time.round,
          timeMs: time.timeMs,
        }),
      );
      await publishDbUpdate({ compId, entity: 'time', action: 'created', id: time.timeId });
      return json(201, time);
    }

    const timeId = event.pathParameters?.timeId;
    if (!timeId) throw new HttpError(404, `unsupported route ${routeKey}`);

    const existing = await competitionDb.findTimeById(compId, timeId);
    if (!existing) throw new HttpError(404, `time ${timeId} not found`);

    if (routeKey === 'PUT /competitions/{compId}/times/{timeId}') {
      requireWrite(auth);
      const input = parseBody(event, (b) => validateTimeInput(b, Date.now()), 'invalid time');

      if (existing.athleteId !== input.athleteId) {
        const athlete = await competitionDb.getAthlete(compId, input.athleteId);
        if (!athlete) throw new HttpError(400, `athlete ${input.athleteId} does not exist`);
      }

      const updated = { ...input, timeId, compId };
      await competitionDb.upsertTime(existing, updated);
      await publishDbUpdate({ compId, entity: 'time', action: 'updated', id: timeId });
      return json(200, updated);
    }

    if (routeKey === 'DELETE /competitions/{compId}/times/{timeId}') {
      requireWrite(auth);
      await competitionDb.deleteTime(existing);
      await publishDbUpdate({ compId, entity: 'time', action: 'deleted', id: timeId });
      return json(204, '');
    }

    throw new HttpError(404, `unsupported route ${routeKey}`);
  } catch (e) {
    return errorResponse(e);
  }
};
