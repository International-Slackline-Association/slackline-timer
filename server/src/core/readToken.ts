import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Event read tokens — the credential OBS/H2R overlays carry in their URL.
 *
 * A minimal HS256 JWT (compact JWS) minted by the admin-only `createReadToken`
 * Lambda and verified by both the HTTP API authorizer and the WS `$connect`
 * authorizer. Hand-rolled on node:crypto on purpose: the claim set is fixed
 * and tiny, and this avoids pulling a general-purpose JOSE dependency into
 * every authorizer bundle. See doc/dev/architecture.md → "Read-auth".
 *
 * Claims: { compId, role: 'reader', tokenVersion, iat, exp } — `exp` is capped
 * at mint time to ~10 days; `tokenVersion` is compared against the competition
 * item so bumping the version revokes every outstanding token instantly (the
 * revoke route additionally force-closes open overlay sockets, ADR 0026).
 */

/** Hard cap on read-token lifetime (seconds). */
export const MAX_READ_TOKEN_TTL_SECONDS = 10 * 24 * 60 * 60;

export interface ReadTokenClaims {
  compId: string;
  role: 'reader';
  tokenVersion: number;
  /** Seconds since epoch (JWT convention). */
  iat: number;
  exp: number;
}

export type VerifyResult =
  | { ok: true; claims: ReadTokenClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'bad_claims' };

const b64url = (buf: Buffer): string => buf.toString('base64url');

const sign = (signingInput: string, secret: string): Buffer =>
  createHmac('sha256', secret).update(signingInput).digest();

/**
 * Mint a read token for a competition. `expiresAt` (epoch ms) is clamped to
 * `now + MAX_READ_TOKEN_TTL_SECONDS`; pass the competition's endDate (+ grace).
 */
export const mintReadToken = (params: {
  compId: string;
  tokenVersion: number;
  expiresAt: number;
  secret: string;
  now?: number;
}): { token: string; expiresAt: number } => {
  const nowMs = params.now ?? Date.now();
  const capMs = nowMs + MAX_READ_TOKEN_TTL_SECONDS * 1000;
  const expMs = Math.min(params.expiresAt, capMs);
  if (expMs <= nowMs) {
    throw new Error('read token would already be expired');
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const claims: ReadTokenClaims = {
    compId: params.compId,
    role: 'reader',
    tokenVersion: params.tokenVersion,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(expMs / 1000),
  };

  const signingInput =
    b64url(Buffer.from(JSON.stringify(header))) + '.' + b64url(Buffer.from(JSON.stringify(claims)));
  const signature = b64url(sign(signingInput, params.secret));

  return { token: `${signingInput}.${signature}`, expiresAt: claims.exp * 1000 };
};

/** Verify signature, expiry, and claim shape. Pure; does NOT check tokenVersion. */
export const verifyReadToken = (params: {
  token: string;
  secret: string;
  now?: number;
}): VerifyResult => {
  const nowMs = params.now ?? Date.now();

  const parts = params.token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerB64, claimsB64, signatureB64] = parts;

  const expected = sign(`${headerB64}.${claimsB64}`, params.secret);
  const actual = Buffer.from(signatureB64, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const c = claims as Partial<ReadTokenClaims>;
  if (
    typeof c.compId !== 'string' ||
    c.compId === '' ||
    c.role !== 'reader' ||
    typeof c.tokenVersion !== 'number' ||
    typeof c.iat !== 'number' ||
    typeof c.exp !== 'number'
  ) {
    return { ok: false, reason: 'bad_claims' };
  }

  if (c.exp * 1000 <= nowMs) return { ok: false, reason: 'expired' };

  return { ok: true, claims: c as ReadTokenClaims };
};
