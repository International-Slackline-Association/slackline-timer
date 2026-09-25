import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from 'aws-lambda';
import { competitionDb } from 'core/competitionDb';
import { resolveUserByEmail } from 'core/cognitoUsers';
import {
  AuthContext,
  HttpError,
  errorResponse,
  getAuth,
  json,
  loadCompetitionOrThrow,
  parseJsonBody,
  requireAdmin,
} from 'core/http';

/**
 * Per-competition manager grants (competition ACL). Superadmin-only: only a
 * `timeradmin` may add or remove managers, so every route calls requireAdmin.
 * Managers themselves get scoped operator access to the granted competition via
 * the grant records this Lambda writes (checked by core/http requireCompAccess
 * and the WS $connect authorizer).
 *
 *   GET    /competitions/{compId}/managers            → list grants
 *   POST   /competitions/{compId}/managers   {email}  → grant (email→sub resolve)
 *   DELETE /competitions/{compId}/managers/{sub}      → revoke
 */
export const main: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext> = async (event) => {
  try {
    const auth = getAuth(event);
    requireAdmin(auth);

    const compId = event.pathParameters!.compId!;
    await loadCompetitionOrThrow(compId);

    const routeKey = event.routeKey;

    if (routeKey === 'GET /competitions/{compId}/managers') {
      return json(200, await competitionDb.listManagers(compId));
    }

    if (routeKey === 'POST /competitions/{compId}/managers') {
      const body = parseJsonBody(event) as { email?: unknown };
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new HttpError(400, 'a valid email is required');
      }

      const poolId = process.env.COGNITO_USER_POOL_ID;
      if (!poolId) throw new HttpError(503, 'Cognito pool is not configured');
      const user = await resolveUserByEmail(poolId, email);
      if (!user) {
        throw new HttpError(404, `no ISA user found with email ${email}`);
      }

      const grant = {
        sub: user.sub,
        email: user.email,
        grantedByEmail: auth.email ?? '',
        grantedBySub: auth.sub ?? 'system',
        grantedAt: Date.now(),
      };
      await competitionDb.grantManager(compId, grant);
      return json(201, grant);
    }

    const sub = event.pathParameters?.sub;
    if (!sub) throw new HttpError(404, `unsupported route ${routeKey}`);

    if (routeKey === 'DELETE /competitions/{compId}/managers/{sub}') {
      await competitionDb.revokeManager(compId, sub);
      return json(204, '');
    }

    throw new HttpError(404, `unsupported route ${routeKey}`);
  } catch (e) {
    return errorResponse(e);
  }
};
