import { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerHandler } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { competitionDb } from 'core/competitionDb';
import { isValidOperatorSessionId } from 'core/operatorSession';
import { verifyReadToken } from 'core/readToken';
import { getReadTokenSecret } from 'core/secrets';

/**
 * WS `$connect` authorizer. Accepts either credential in the `Authorization`
 * query param (browsers cannot set WS headers):
 *
 *  1. Cognito IdToken of an operator in the timer group → full access to any
 *     real competition.
 *  2. Cognito IdToken of any other ISA user → full access ONLY to a competition
 *     they hold a manager grant on (per-competition ACL); otherwise denied.
 *  3. Event read token (overlays) → allowed only when the token's compId
 *     matches the `sessionId` being joined, and flagged read-only so the
 *     messageHandler drops anything such a connection tries to send.
 */

// Created once per container so the JWKS is fetched and cached across invocations.
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: 'id',
  clientId: process.env.COGNITO_CLIENT_ID,
});

export const main: APIGatewayRequestAuthorizerHandler = async (event) => {
  try {
    const raw = event.queryStringParameters?.['Authorization'];
    if (!raw) {
      throw new Error('No token provided');
    }

    const token = raw.replace(/^Bearer\s+/i, '');

    // Offline: accept the web's `local-dev` dummy as an operator (no Cognito locally).
    if (process.env.IS_OFFLINE === 'true' && token === 'local-dev') {
      return allowPolicy(event.methodArn, 'local-dev-operator', { readOnly: 'false' });
    }

    let payload: Awaited<ReturnType<typeof verifier.verify>> | null = null;
    try {
      payload = await verifier.verify(token);
    } catch {
      // Not a (valid) Cognito token — try the event read token below. A
      // Cognito-shaped token that failed verification also fails the HMAC
      // check, so falling through never widens access.
    }
    if (payload) {
      const groups = (payload['cognito:groups'] as string[] | undefined) ?? [];
      const sub = String(payload.sub);

      // An operator may only join a real competition, making this path symmetric
      // with the already comp-scoped read-token branch below (it closes the
      // open-room gap). Shape check in core/operatorSession.ts, existence here.
      const sessionId = event.queryStringParameters?.['sessionId'] ?? 'default';
      if (!isValidOperatorSessionId(sessionId)) {
        throw new Error(`operator session "${sessionId}" is not a real competition`);
      }
      const comp = await competitionDb.getCompetition(sessionId);
      if (!comp) {
        throw new Error(`operator session "${sessionId}" is not a real competition`);
      }

      // Superadmins (timer group) reach any competition; every other ISA user is
      // a scoped manager and may only join a competition they hold a grant on.
      if (!groups.includes(process.env.COGNITO_TIMER_GROUP)) {
        const grant = await competitionDb.getManagerGrant(sessionId, sub);
        if (!grant) {
          throw new Error(`User ${sub} has no manager access to competition ${sessionId}`);
        }
      }

      return allowPolicy(event.methodArn, sub, { readOnly: 'false' });
    }

    const secret = await getReadTokenSecret();
    if (!secret) {
      throw new Error('not a valid operator token (and the read-token secret is not configured)');
    }
    const result = verifyReadToken({ token, secret });
    if (!result.ok) {
      throw new Error(`read token rejected: ${result.reason}`);
    }

    const sessionId = event.queryStringParameters?.['sessionId'] ?? 'default';
    if (sessionId !== result.claims.compId) {
      throw new Error(`read token is scoped to ${result.claims.compId}, not session ${sessionId}`);
    }

    const comp = await competitionDb.getCompetition(result.claims.compId);
    if (!comp || comp.tokenVersion !== result.claims.tokenVersion) {
      throw new Error(`read token revoked or competition missing (${result.claims.compId})`);
    }

    return allowPolicy(event.methodArn, `reader:${comp.compId}`, { readOnly: 'true' });
  } catch (error: any) {
    console.log(error.message);
    return denyAllPolicy();
  }
};

const denyAllPolicy = (): APIGatewayAuthorizerResult => {
  return {
    principalId: '*',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: '*',
          Effect: 'Deny',
          Resource: '*',
        },
      ],
    },
  };
};

const allowPolicy = (
  methodArn: string,
  principalId: string,
  context: Record<string, string>,
): APIGatewayAuthorizerResult => {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: methodArn,
        },
      ],
    },
    // WS authorizer context surfaces on $connect as string values.
    context,
  };
};
