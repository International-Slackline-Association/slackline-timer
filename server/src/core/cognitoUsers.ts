import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

/**
 * Resolve an ISA user by email against the shared Cognito pool, used by the
 * managers Lambda to key a grant on the caller's immutable `sub` rather than
 * their (mutable, reassignable) email. Only the managers function has the
 * `cognito-idp:ListUsers` grant on the pool (see infra/slackline-stack.ts).
 */

const REGION = process.env.COGNITO_REGION ?? 'eu-central-1';

// One client per container. The pool lives in eu-central-1 even when the backend
// runs elsewhere, so the region is pinned rather than inherited from AWS_REGION.
const client = new CognitoIdentityProviderClient({ region: REGION });

export interface ResolvedUser {
  sub: string;
  email: string;
}

const attr = (
  attrs: { Name?: string; Value?: string }[] | undefined,
  name: string,
): string | undefined => attrs?.find((a) => a.Name === name)?.Value;

/**
 * Look up a user by email; returns `{ sub, email }` or `null` if no ISA user has
 * that address. `poolId` is passed in (not read from env) so callers and tests
 * stay explicit.
 */
export const resolveUserByEmail = async (
  poolId: string,
  email: string,
): Promise<ResolvedUser | null> => {
  const normalized = email.trim();

  // Offline: no Cognito. A deterministic fake sub keeps the managers UI (grant/
  // list/revoke against the LocalStack table) exercisable in local dev — the
  // same handler-level IS_OFFLINE pattern as core/aws/clients.ts. The manager
  // *login* path still needs real Cognito (the offline authorizer only knows
  // the `local-dev` operator).
  if (process.env.IS_OFFLINE === 'true') {
    return { sub: `offline-${normalized.toLowerCase()}`, email: normalized };
  }

  // Quotes are the only character that could break out of the filter string;
  // emails never legitimately contain them, so strip rather than escape.
  const safe = normalized.replace(/"/g, '');
  const res = await client.send(
    new ListUsersCommand({
      UserPoolId: poolId,
      Filter: `email = "${safe}"`,
      Limit: 2,
    }),
  );
  const users = res.Users ?? [];
  // A grant is an access decision — never guess. Only a user whose email
  // attribute equals the requested address (case-insensitively) counts, and it
  // must be UNIQUE: zero candidates or duplicates (a pool without email
  // uniqueness) → not found, rather than granting to an arbitrary account.
  const exact = users.filter(
    (u) => attr(u.Attributes, 'email')?.toLowerCase() === normalized.toLowerCase(),
  );
  if (exact.length !== 1) return null;
  const sub = attr(exact[0].Attributes, 'sub');
  if (!sub) return null;
  return { sub, email: attr(exact[0].Attributes, 'email') ?? normalized };
};
