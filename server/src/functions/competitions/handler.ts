import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from 'aws-lambda';
import { disconnectSessionReaders, publishDbUpdate } from 'core/broadcast';
import { competitionDb } from 'core/competitionDb';
import {
  AuthContext,
  HttpError,
  errorResponse,
  getAuth,
  json,
  loadCompetitionOrThrow,
  parseBody,
  requireAdmin,
  requireCompAccess,
  requireWrite,
} from 'core/http';
import type { Competition } from 'core/types';
import { validateCompetitionInput, validateCompetitionUpdateInput } from 'core/validators';

/** tokenVersion is internal (revocation state) — not part of the API shape. */
const toApiShape = ({ tokenVersion: _tokenVersion, ...rest }: Competition) => rest;

/**
 * Competitions are explicit: a COMP#<compId>/META item is created here, and
 * every other write Lambda rejects unknown compIds. The compId doubles as the
 * relay sessionId, which is why it must stay URL-safe.
 */
export const main: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext> = async (event) => {
  try {
    const auth = getAuth(event);
    const routeKey = event.routeKey;

    if (routeKey === 'POST /competitions') {
      requireAdmin(auth);
      const input = parseBody(event, validateCompetitionInput, 'invalid competition');

      const competition = { ...input, tokenVersion: 1 };
      await competitionDb.createCompetition(competition);
      await publishDbUpdate({
        compId: competition.compId,
        entity: 'competition',
        action: 'created',
        id: competition.compId,
      });
      return json(201, toApiShape(competition));
    }

    if (routeKey === 'GET /competitions') {
      // Admins see every competition; a manager sees only the ones granted to
      // them (the server-side scope filter behind the admin UI list).
      if (auth.role === 'admin') {
        return json(200, (await competitionDb.listCompetitions()).map(toApiShape));
      }
      if (auth.role === 'manager' && auth.sub) {
        const compIds = await competitionDb.listManagerCompIds(auth.sub);
        const comps = await Promise.all(compIds.map((id) => competitionDb.getCompetition(id)));
        return json(
          200,
          comps
            .filter((c): c is NonNullable<typeof c> => c !== null)
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map(toApiShape),
        );
      }
      return json(200, []);
    }

    if (routeKey === 'GET /competitions/{compId}') {
      const compId = event.pathParameters!.compId!;
      await requireCompAccess(auth, compId);
      const competition = await loadCompetitionOrThrow(compId);
      return json(200, toApiShape(competition));
    }

    if (routeKey === 'PUT /competitions/{compId}') {
      const compId = event.pathParameters!.compId!;
      await requireCompAccess(auth, compId);
      requireWrite(auth);
      const input = parseBody(event, validateCompetitionUpdateInput, 'invalid competition');

      await competitionDb.updateCompetition(compId, input);
      await publishDbUpdate({ compId, entity: 'competition', action: 'updated', id: compId });
      return json(200, { compId, ...input });
    }

    if (routeKey === 'POST /competitions/{compId}/revoke-read-tokens') {
      const compId = event.pathParameters!.compId!;
      await requireCompAccess(auth, compId);
      requireWrite(auth);
      const tokenVersion = await competitionDb.bumpTokenVersion(compId);
      console.log(`read tokens for ${compId} revoked (tokenVersion=${tokenVersion})`);

      // The version bump only blocks the next $connect. Cut the open overlay
      // feeds too so revocation is instant, as documented (ADR 0026). The bump
      // already persisted — a failure here must not fail the request.
      const endpoint = process.env.WS_API_ENDPOINT;
      if (endpoint) {
        try {
          const { disconnected } = await disconnectSessionReaders({ endpoint, sessionId: compId });
          console.log(`closed ${disconnected} open reader connection(s) for ${compId}`);
        } catch (e) {
          console.error('failed to close reader connections (tokenVersion bump persisted):', e);
        }
      } else {
        console.warn('WS_API_ENDPOINT not set — open reader feeds not force-closed');
      }

      return json(200, { revoked: true });
    }

    throw new HttpError(404, `unsupported route ${routeKey}`);
  } catch (e) {
    return errorResponse(e);
  }
};
