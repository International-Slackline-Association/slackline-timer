import type { APIGatewayProxyResultV2 } from 'aws-lambda';

import { competitionDb, type ConditionFailed } from './competitionDb';
import type { Competition } from './types';
import type { Validated } from './validators';

/**
 * Shared plumbing for the HTTP API Lambdas: the authorizer context contract,
 * role/scope assertions, body parsing, and uniform error → response mapping.
 */

/** Authorization role. `manager` = scoped operator (per-competition ACL). */
export type Role = 'admin' | 'manager' | 'reader';

/** Context attached by the httpAuthorizer Lambda (simple-response mode). */
export interface AuthContext {
  role: Role;
  /**
   * Competition the credential is scoped to: `'*'` for admins, the single comp
   * for readers, and `''` for managers (multi-comp; scope resolved per request
   * from `sub` against the grant table by `requireCompAccess`).
   */
  compId: string;
  /** Cognito subject of the operator (admins + managers); absent for readers. */
  sub?: string;
  /** Cognito email of the operator, for audit/logging; absent for readers. */
  email?: string;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Shape-validate the authorizer context (payload v2: requestContext.authorizer.lambda). */
export const getAuth = (event: {
  requestContext?: { authorizer?: { lambda?: unknown } };
}): AuthContext => {
  const ctx = event.requestContext?.authorizer?.lambda as Record<string, unknown> | undefined;
  const role = ctx?.role;
  const compId = ctx?.compId;
  const sub = typeof ctx?.sub === 'string' ? ctx.sub : undefined;
  const email = typeof ctx?.email === 'string' ? ctx.email : undefined;
  if (role === 'admin' && compId === '*') return { role, compId, sub, email };
  if (role === 'reader' && typeof compId === 'string' && compId !== '') {
    return { role, compId };
  }
  if (role === 'manager' && sub) return { role, compId: '', sub, email };
  throw new HttpError(403, 'missing or malformed authorizer context');
};

export const requireAdmin = (auth: AuthContext): void => {
  if (auth.role !== 'admin') {
    throw new HttpError(403, 'admin credentials required');
  }
};

/**
 * The single per-competition scope gate — called at the top of every entity
 * handler, covering reads and establishing scope for the write gate below.
 *  - `admin`   → any competition.
 *  - `reader`  → only the competition its read token is scoped to.
 *  - `manager` → only a competition it holds a grant on (live table lookup, so a
 *    revoked grant takes effect on the next request).
 */
export const requireCompAccess = async (auth: AuthContext, compId: string): Promise<void> => {
  if (auth.role === 'admin') return;
  if (auth.role === 'reader') {
    if (auth.compId !== compId) {
      throw new HttpError(403, `credential is not scoped to competition ${compId}`);
    }
    return;
  }
  if (!auth.sub || !(await competitionDb.getManagerGrant(compId, auth.sub))) {
    throw new HttpError(403, `no manager access to competition ${compId}`);
  }
};

/**
 * The write gate. Managers and admins may write; readers may not. Scope for a
 * manager is already established by the mandatory `requireCompAccess` call at the
 * top of the handler, so this stays a cheap synchronous role check (no second
 * grant lookup). Every write route MUST be preceded by `requireCompAccess`.
 */
export const requireWrite = (auth: AuthContext): void => {
  if (auth.role === 'reader') {
    throw new HttpError(403, 'write access requires operator credentials');
  }
};

/**
 * Load a competition or reject with the uniform 404 every entity handler shares.
 * Writes reject unknown compIds, so each CRUD Lambda gates on this after the
 * access check.
 */
export const loadCompetitionOrThrow = async (compId: string): Promise<Competition> => {
  const competition = await competitionDb.getCompetition(compId);
  if (!competition) throw new HttpError(404, `competition ${compId} not found`);
  return competition;
};

/**
 * Defense-in-depth (ADR 0022): a read token travels in an OBS overlay URL, an
 * accepted leak risk (ADR 0003). Overlays render only the broadcast fields, so a
 * reader never sees the operational PII — `birthDate` and `notes`. Admins (the
 * web UI) get the full record. Stripping is keyed off the authorizer role, not
 * the route, so every athlete-bearing read (list, single, rankings) applies it.
 */
export const forAudience = <T extends { birthDate?: string; notes?: string }>(
  athlete: T,
  auth: AuthContext,
): T | Omit<T, 'birthDate' | 'notes'> => {
  if (auth.role !== 'reader') return athlete;
  const { birthDate: _birthDate, notes: _notes, ...broadcast } = athlete;
  return broadcast;
};

export const parseJsonBody = (event: { body?: string; isBase64Encoded?: boolean }): unknown => {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'request body is not valid JSON');
  }
};

/**
 * Parse + validate a JSON request body in one call: the validate triad
 * (parseJsonBody → validator → 400-on-!ok) that every CRUD write repeated,
 * collapsed so the handlers stay thin. Framework-free — the validator is any
 * `unknown → Validated<T>` function, so a validator needing extra state (e.g.
 * `validateTimeInput(body, now)`) is passed as a closure at the call site.
 * `invalidMessage` is the 400 summary; the validator's errors become `details`.
 */
export const parseBody = <T>(
  event: { body?: string; isBase64Encoded?: boolean },
  validator: (body: unknown) => Validated<T>,
  invalidMessage: string,
): T => {
  const result = validator(parseJsonBody(event));
  if (!result.ok) throw new HttpError(400, invalidMessage, result.errors);
  return result.value;
};

export const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Structural identity for ConditionFailed. We can't use `instanceof` here:
 * the esbuild bundler elides the class binding when it's imported
 * across the module boundary purely for an `instanceof`, compiling the check to
 * `e instanceof void 0` — which throws at runtime and made errorResponse return
 * a malformed 200 (the body being the thrown TypeError). Matching on the class's
 * own `name`/`kind` discriminant is bundler-proof.
 */
const isConditionFailed = (e: unknown): e is ConditionFailed =>
  e instanceof Error && e.name === 'ConditionFailed' && 'kind' in e;

/** Uniform error mapping; logs only unexpected failures. */
export const errorResponse = (e: unknown): APIGatewayProxyResultV2 => {
  if (e instanceof HttpError) {
    return json(e.status, { message: e.message, ...(e.details ? { details: e.details } : {}) });
  }
  if (isConditionFailed(e)) {
    return json(e.kind === 'not_found' ? 404 : 409, { message: e.message });
  }
  console.error('Unhandled error:', e);
  return json(500, { message: 'internal server error' });
};
