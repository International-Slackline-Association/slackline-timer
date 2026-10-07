// Shared least-privilege policy for hardenAppClient.mjs / verifyAppClient.mjs,
// so "harden" and "verify" cannot drift.
//
// WHAT ACTUALLY PREVENTS ATTRIBUTE WRITES
// ---------------------------------------
// NOT an empty WriteAttributes: per the UpdateUserPoolClient docs, empty/omitted
// == ALL standard attributes writable; "zero writable" is inexpressible there.
// The gate is the `aws.cognito.signin.user.admin` scope, which authorizes the
// self-service UpdateUserAttributes / DeleteUser / GetUser; without it in
// AllowedOAuthScopes, Write/ReadAttributes are moot. WriteAttributes is only
// blast-radius reduction if the scope is re-added, and narrowing it can break
// IdP attribute mappings on the shared pool, so it is set only on opt-in
// (--write-attributes).

import { POOL, requireConfig, runAws, runMain } from './cognitoCommon.mjs';

export { requireConfig, runAws, runMain };

// --- defaults: the timer's public SPA app client ------------------------------
// No fallbacks — see cognitoCommon's POOL.
export const DEFAULTS = {
  poolId: POOL.poolId,
  clientId: process.env.COGNITO_CLIENT_ID,
  region: POOL.region,
  profile: POOL.profile,
};

// --- the desired least-privilege config --------------------------------------
// Derived from what the app consumes (web/src/main.tsx + the authorizers):
//  - scopes openid+email and the auth-code flow (the Amplify oauth block)
//  - reads only `email` + the auto-injected `cognito:groups` (not governed by
//    these lists); moot without the admin scope, kept minimal as defense-in-depth
//  - writes NOTHING, via the absent admin scope (header note); WriteAttributes
//    is therefore not in DESIRED
export const DESIRED = {
  ReadAttributes: ['email', 'email_verified'],
  AllowedOAuthScopes: ['openid', 'email'],
  AllowedOAuthFlows: ['code'], // authorization-code only; no implicit grant
  AllowedOAuthFlowsUserPoolClient: true,
};

// The master gate for self-service attribute reads/writes. Must NEVER appear in
// AllowedOAuthScopes — its absence is what makes attribute writes impossible.
export const FORBIDDEN_SCOPE = 'aws.cognito.signin.user.admin';

// describe-user-pool-client returns fields update-user-pool-client rejects.
const NON_INPUT_FIELDS = ['CreationDate', 'LastModifiedDate', 'ClientSecret'];

/** Parse `--key value` / `--flag` argv into an options object over DEFAULTS. */
export function parseArgs(argv) {
  const opts = { ...DEFAULTS, apply: false, json: false };
  const alias = { 'client-id': 'clientId', 'pool-id': 'poolId' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'apply') opts.apply = true;
    else if (key === 'json') opts.json = true;
    else if (key === 'help' || key === 'h') opts.help = true;
    else if (key === 'write-attributes') {
      // Comma-separated; becomes the ONLY writable set. Empty = no override (AWS
      // reads an empty LIST as all-writable), so restricting needs a NON-empty
      // set, e.g. only the IdP-mapped attributes.
      const value = argv[(i += 1)] ?? '';
      opts.writeAttributes = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      const value = argv[(i += 1)];
      opts[alias[key] ?? key] = value;
    }
  }
  return opts;
}

/** describe-user-pool-client → the UserPoolClient object. */
export function describeClient({ poolId, clientId, profile, region }) {
  const out = runAws(
    ['cognito-idp', 'describe-user-pool-client', '--user-pool-id', poolId, '--client-id', clientId],
    { profile, region },
  );
  return JSON.parse(out).UserPoolClient;
}

/**
 * Build the full update-user-pool-client input from the current client config.
 * update-user-pool-client REPLACES everything omitted (defaults it), so we start
 * from the live config and override only the security-relevant fields.
 *
 * WriteAttributes is set only on a NON-empty `opts.writeAttributes` (header note).
 */
export function buildDesiredInput(current, opts = {}) {
  const input = { ...current };
  for (const field of NON_INPUT_FIELDS) delete input[field];
  Object.assign(input, DESIRED);
  if (opts.writeAttributes?.length) input.WriteAttributes = opts.writeAttributes;
  return input;
}

const asSet = (list) => new Set(list ?? []);
const sortedList = (list) => [...(list ?? [])].sort();

/**
 * Evaluate a client config against the policy. Returns { checks: [{name, ok,
 * level, detail}], ok }. `level: 'fail'` is a hard failure; `level: 'warn'` is
 * advisory (over-broad but not an attribute-write path).
 */
export function evaluate(client) {
  const checks = [];
  const add = (name, ok, level, detail) => checks.push({ name, ok, level, detail });

  const scopes = asSet(client.AllowedOAuthScopes);
  const hasAdminScope = scopes.has(FORBIDDEN_SCOPE);

  // 1. THE write-lock: the self-service scope is absent. Without it no access
  //    token can call UpdateUserAttributes/DeleteUser/GetUser at all.
  add(
    'self-service scope disabled',
    !hasAdminScope,
    'fail',
    hasAdminScope
      ? `${FORBIDDEN_SCOPE} PRESENT — self-service attribute reads/writes possible`
      : `${FORBIDDEN_SCOPE} absent — attribute writes impossible regardless of WriteAttributes`,
  );

  // 2. WriteAttributes. Empty/omitted == ALL standard attributes writable (AWS
  //    default). That is only reachable WITH the admin scope, so:
  //      - admin scope absent  → moot, informational pass
  //      - admin scope present + all-writable → hard fail (actually writable)
  //      - admin scope present + explicit narrow list → advisory
  const write = sortedList(client.WriteAttributes);
  const allWritable = write.length === 0; // AWS omits the field when all-writable
  add(
    'attribute writes not broad',
    !hasAdminScope || !allWritable,
    'fail',
    allWritable
      ? hasAdminScope
        ? 'ALL standard attributes writable (empty WriteAttributes) + admin scope present'
        : 'WriteAttributes unset (all-writable default) — moot without the admin scope'
      : `WriteAttributes restricted to [${write}]`,
  );

  // 3. Scopes are exactly openid+email (no over-broad phone/profile/etc.).
  const extraScopes = [...scopes].filter(
    (s) => !DESIRED.AllowedOAuthScopes.includes(s) && s !== FORBIDDEN_SCOPE,
  );
  const missingScopes = DESIRED.AllowedOAuthScopes.filter((s) => !scopes.has(s));
  add(
    'scopes are minimal (openid, email)',
    extraScopes.length === 0 && missingScopes.length === 0,
    missingScopes.length ? 'fail' : 'warn',
    `[${sortedList(client.AllowedOAuthScopes)}]${extraScopes.length ? ` — extra: ${extraScopes}` : ''}${missingScopes.length ? ` — missing: ${missingScopes}` : ''}`,
  );

  // 4. Auth-code flow only (no implicit grant).
  const flows = sortedList(client.AllowedOAuthFlows);
  const flowsOk = flows.length === 1 && flows[0] === 'code';
  add('auth-code flow only (no implicit)', flowsOk, 'fail', `[${flows}]`);

  // 5. Read attributes not broader than needed (advisory — moot without the
  //    admin scope, but kept tight as defense-in-depth).
  const read = asSet(client.ReadAttributes);
  const extraReads = [...read].filter((a) => !DESIRED.ReadAttributes.includes(a));
  const missingReads = DESIRED.ReadAttributes.filter((a) => !read.has(a));
  add(
    'read attributes minimal (email)',
    extraReads.length === 0 && missingReads.length === 0,
    'warn',
    `[${sortedList(client.ReadAttributes)}]${extraReads.length ? ` — extra: ${extraReads}` : ''}${missingReads.length ? ` — missing: ${missingReads}` : ''}`,
  );

  // 6. Public client — no secret.
  add(
    'public client (no secret)',
    !client.ClientSecret,
    'fail',
    client.ClientSecret ? 'has a client secret — not a public SPA client' : 'no secret',
  );

  const ok = checks.every((c) => c.ok || c.level !== 'fail');
  return { checks, ok };
}
