import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from 'aws-lambda';
import { computeEventExpiry } from 'core/eventWindow';
import {
  AuthContext,
  HttpError,
  errorResponse,
  getAuth,
  json,
  loadCompetitionOrThrow,
  requireCompAccess,
  requireWrite,
} from 'core/http';
import { mintReadToken } from 'core/readToken';
import { getReadTokenSecret } from 'core/secrets';

/**
 * POST /competitions/{compId}/read-tokens (operators) → the event read token
 * OBS/H2R overlays carry in their URL. Read-only, competition-scoped, expires
 * with the event (≤ 10 days; see core/eventWindow.ts), revocable by bumping
 * the competition's tokenVersion (POST /competitions/{compId}/revoke-read-tokens).
 */
export const main: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext> = async (event) => {
  try {
    const auth = getAuth(event);
    const compId = event.pathParameters!.compId!;
    await requireCompAccess(auth, compId);
    requireWrite(auth);
    const competition = await loadCompetitionOrThrow(compId);

    const secret = await getReadTokenSecret();
    if (!secret) throw new HttpError(503, 'read tokens are not configured');

    const now = Date.now();
    const expiresAt = computeEventExpiry(competition.endDate, now);
    if (expiresAt <= now) {
      throw new HttpError(409, `competition ${compId} has ended — read tokens would be expired`);
    }

    const token = mintReadToken({
      compId,
      tokenVersion: competition.tokenVersion,
      expiresAt,
      secret,
      now,
    });

    return json(201, token);
  } catch (e) {
    return errorResponse(e);
  }
};
