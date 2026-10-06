import { randomUUID } from 'node:crypto';

import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from 'aws-lambda';
import { publishDbUpdate } from 'core/broadcast';
import { competitionDb } from 'core/competitionDb';
import { computePhotoUrlExpiry } from 'core/eventWindow';
import {
  AuthContext,
  HttpError,
  errorResponse,
  forAudience,
  getAuth,
  json,
  loadCompetitionOrThrow,
  parseBody,
  requireCompAccess,
  requireWrite,
} from 'core/http';
import { attachPhotoUrl, photoUrlSignerFromEnv } from 'core/photoUrl';
import { MAX_ATHLETES_PER_COMP, validateAthleteInput } from 'core/validators';

/**
 * A `photoKey` must sit under this competition's `photos/<compId>/` prefix: the
 * signer would otherwise mint fresh URLs for another event's photos with this
 * event's expiry. On PUT (`athleteId` given) a foreign key is grandfathered while
 * unchanged — `renameCompId --skip-photos` leaves keys under the old compId
 * (ADR 0052). The stored athlete is read only in that mismatch case.
 */
const assertOwnPhotoKey = async (
  compId: string,
  photoKey: string | undefined,
  athleteId?: string,
): Promise<void> => {
  if (photoKey === undefined || photoKey.startsWith(`photos/${compId}/`)) return;
  if (athleteId !== undefined) {
    const stored = await competitionDb.getAthlete(compId, athleteId);
    if (stored?.photoKey === photoKey) return;
  }
  throw new HttpError(400, 'invalid athlete', [`photoKey must be under photos/${compId}/`]);
};

/**
 * Athlete CRUD (mirrors timertimer's AthleteLive paths). Reads embed a
 * CloudFront-signed photoUrl that dies with the competition; deletes are
 * blocked while Times, Matches, or Scores still reference the athlete (DynamoDB has no
 * FKs — referential integrity is on us). Create is capped at
 * `MAX_ATHLETES_PER_COMP` (a soft cap: two concurrent creates may both pass).
 */
export const main: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext> = async (event) => {
  try {
    const auth = getAuth(event);
    const compId = event.pathParameters!.compId!;
    await requireCompAccess(auth, compId);

    const competition = await loadCompetitionOrThrow(compId);

    const routeKey = event.routeKey;
    const signer = await photoUrlSignerFromEnv();
    const withPhoto = <T extends { photoKey?: string }>(entity: T) =>
      attachPhotoUrl(entity, signer, computePhotoUrlExpiry(competition.endDate, Date.now()));

    if (routeKey === 'GET /competitions/{compId}/athletes') {
      const athletes = await competitionDb.listAthletes(compId);
      return json(
        200,
        athletes.map((a) => forAudience(withPhoto(a), auth)),
      );
    }

    if (routeKey === 'POST /competitions/{compId}/athletes') {
      requireWrite(auth);
      const input = parseBody(event, validateAthleteInput, 'invalid athlete');
      await assertOwnPhotoKey(compId, input.photoKey);
      if ((await competitionDb.countAthletes(compId)) >= MAX_ATHLETES_PER_COMP) {
        throw new HttpError(409, `competition already has ${MAX_ATHLETES_PER_COMP} athletes`);
      }

      const athlete = { ...input, athleteId: randomUUID(), compId };
      await competitionDb.createAthlete(athlete);
      await publishDbUpdate({
        compId,
        entity: 'athlete',
        action: 'created',
        id: athlete.athleteId,
      });
      return json(201, athlete);
    }

    const athleteId = event.pathParameters?.athleteId;
    if (!athleteId) throw new HttpError(404, `unsupported route ${routeKey}`);

    if (routeKey === 'GET /competitions/{compId}/athletes/{athleteId}') {
      const athlete = await competitionDb.getAthlete(compId, athleteId);
      if (!athlete) throw new HttpError(404, `athlete ${athleteId} not found`);
      return json(200, forAudience(withPhoto(athlete), auth));
    }

    if (routeKey === 'PUT /competitions/{compId}/athletes/{athleteId}') {
      requireWrite(auth);
      const input = parseBody(event, validateAthleteInput, 'invalid athlete');
      await assertOwnPhotoKey(compId, input.photoKey, athleteId);

      const athlete = { ...input, athleteId, compId };
      await competitionDb.updateAthlete(athlete);
      await publishDbUpdate({ compId, entity: 'athlete', action: 'updated', id: athleteId });
      return json(200, athlete);
    }

    if (routeKey === 'DELETE /competitions/{compId}/athletes/{athleteId}') {
      requireWrite(auth);
      const refs = await competitionDb.athleteHasReferences(compId, athleteId);
      if (refs.times || refs.matches || refs.scores) {
        const what = [
          refs.times ? 'times' : null,
          refs.matches ? 'matches' : null,
          refs.scores ? 'scores' : null,
        ]
          .filter(Boolean)
          .join(' and ');
        throw new HttpError(409, `athlete has recorded ${what} — delete or reassign those first`);
      }
      await competitionDb.deleteAthlete(compId, athleteId);
      await publishDbUpdate({ compId, entity: 'athlete', action: 'deleted', id: athleteId });
      return json(204, '');
    }

    throw new HttpError(404, `unsupported route ${routeKey}`);
  } catch (e) {
    return errorResponse(e);
  }
};
