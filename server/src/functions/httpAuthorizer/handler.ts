import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { APIGatewayRequestSimpleAuthorizerHandlerV2WithContext } from 'aws-lambda';
import { competitionDb } from 'core/competitionDb';
import type { AuthContext } from 'core/http';
import { verifyReadToken } from 'core/readToken';
import { getReadTokenSecret } from 'core/secrets';

/**
 * Custom Lambda authorizer for the HTTP API (simple responses, payload v2).
 *
 * Accepts either credential in the Authorization header:
 *  1. Cognito IdToken of an operator in the timer group → role `admin`.
 *  2. Cognito IdToken of any other ISA user → role `manager` (a scoped operator);
 *     per-competition access is decided per request against the grant table
 *     (core/http requireCompAccess), so this branch only asserts identity.
 *  3. Event read token (HMAC JWT minted by createReadToken) → role `reader`,
 *     scoped to its competition. The claim's tokenVersion is compared to the
 *     competition item, so bumping the version revokes outstanding tokens
 *     (subject to the authorizer result cache TTL, kept at 60s).
 *
 * Why not API Gateway's native JWT authorizer: it cannot assert
 * `cognito:groups`, and it cannot accept the second credential type.
 */

// Created once per container so the JWKS is fetched and cached across invocations.
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: 'id',
  clientId: process.env.COGNITO_CLIENT_ID,
});

const DENY = { isAuthorized: false, context: { role: 'reader', compId: '' } as AuthContext };

export const main: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthContext> = async (
  event,
) => {
  // The local HTTP harness preserves header case; real HTTP API v2 lower-cases it.
  const raw = event.headers?.authorization ?? event.headers?.Authorization;
  if (!raw) return DENY;
  const token = raw.replace(/^Bearer\s+/i, '');

  // Offline: accept the web's `local-dev` dummy as an operator (no Cognito locally).
  if (process.env.IS_OFFLINE === 'true' && token === 'local-dev') {
    return { isAuthorized: true, context: { role: 'admin', compId: '*' } };
  }

  // 1) Operator Cognito IdToken.
  try {
    const payload = await verifier.verify(token);
    const groups = (payload['cognito:groups'] as string[] | undefined) ?? [];
    const sub = String(payload.sub);
    const email = typeof payload.email === 'string' ? payload.email : '';
    if (groups.includes(process.env.COGNITO_TIMER_GROUP)) {
      return { isAuthorized: true, context: { role: 'admin', compId: '*', sub, email } };
    }
    // A valid ISA login without the timer group is a scoped `manager` — NOT a
    // deny and NOT a read-token candidate. Which competitions they may touch is
    // resolved per request from the grant table; with no grants they are
    // authenticated but see/do nothing.
    return { isAuthorized: true, context: { role: 'manager', compId: '', sub, email } };
  } catch {
    // Not a Cognito token — try the read token next.
  }

  // 2) Event read token.
  const secret = await getReadTokenSecret();
  if (!secret) {
    console.error('the read-token secret is not configured');
    return DENY;
  }
  const result = verifyReadToken({ token, secret });
  if (!result.ok) {
    console.log(`read token rejected: ${result.reason}`);
    return DENY;
  }

  const comp = await competitionDb.getCompetition(result.claims.compId);
  if (!comp) {
    console.log(`read token for unknown competition ${result.claims.compId}`);
    return DENY;
  }
  if (comp.tokenVersion !== result.claims.tokenVersion) {
    console.log(`read token revoked for ${comp.compId} (tokenVersion mismatch)`);
    return DENY;
  }

  return { isAuthorized: true, context: { role: 'reader', compId: comp.compId } };
};
