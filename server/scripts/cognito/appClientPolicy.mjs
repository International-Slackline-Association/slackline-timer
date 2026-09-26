// Shared policy + AWS-CLI glue for the app-client hardening scripts
// (hardenAppClient.mjs / verifyAppClient.mjs). ONE source of truth for the
// desired least-privilege config so "harden" and "verify" can never drift.
//
// Like the rest of scripts/cognito/, these shell out to an already-authenticated
// AWS CLI v2 session rather than pulling an SDK dependency the server package
// doesn't otherwise carry.
//
// WHAT ACTUALLY PREVENTS ATTRIBUTE WRITES
// ---------------------------------------
// NOT an empty WriteAttributes. Per the UpdateUserPoolClient API docs, "When you
// don't specify the WriteAttributes for your app client, your app can write the
// values of the Standard attributes" — i.e. empty/omitted == ALL standard
// attributes writable. There is no way to express "zero writable attributes"
// through that parameter (an earlier `WriteAttributes: []` here was a no-op).
//
// The real gate is the OAuth scope: `aws.cognito.signin.user.admin` is what
// authorizes self-service UpdateUserAttributes / DeleteUser / GetUser. Without it
// in AllowedOAuthScopes, the client's access tokens simply cannot call those
// APIs, so WriteAttributes (and ReadAttributes) are moot. So the authoritative
// write-lock is REMOVING that scope, which DESIRED does. WriteAttributes only
// matters as blast-radius reduction IF the scope is ever re-added — and narrowing
// it can break IdP attribute-mapping updates on a shared pool, so we leave it
// alone by default and only set an explicit list on opt-in (--write-attributes).

import { POOL, requireConfig, runAws, runMain } from './cognitoCommon.mjs';

// Re-export the shared CLI helpers so the app-client scripts import everything
// from one module.
export { requireConfig, runAws, runMain };

// --- defaults: the timer's public SPA app client ------------------------------
// Pool/region/profile come from cognitoCommon (shared with the group scripts);
// clientId is COGNITO_CLIENT_ID from the same `.env.deploy` the web build and
// the CDK stack read. No fallbacks — see cognitoCommon's POOL.
export const DEFAULTS = {
  poolId: POOL.poolId,
  clientId: process.env.COGNITO_CLIENT_ID,
  region: POOL.region,
  profile: POOL.profile,
};

// --- the desired least-privilege config --------------------------------------
// Derived from what the app actually consumes (web/src/main.tsx + the authorizers):
//  - scopes openid+email and the auth-code flow (the Amplify oauth block)
//  - reads only the `email` claim + the auto-injected `cognito:groups` (not an
//    "attribute" — it isn't governed by these lists), so `email`/`email_verified`
//    is all it ever needs to READ (moot without the admin scope anyway; kept
//    minimal as defense-in-depth)
//  - writes NOTHING — enforced by the ABSENT `aws.cognito.signin.user.admin`
//    scope, NOT by WriteAttributes (see the header note above)
// WriteAttributes is deliberately NOT in DESIRED: an empty list is a no-op and
// narrowing it can break IdP mappings — see buildDesiredInput / --write-attributes.
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
      // Opt-in explicit writable set (comma-separated). Empty string clears to
      // "no override" — but note AWS treats an empty LIST as all-writable, so to
      // truly restrict you must pass a NON-empty set (e.g. only your IdP-mapped
      // attributes). Whatever you list becomes the ONLY writable attributes.
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
 * WriteAttributes is set only on a NON-empty `opts.writeAttributes` opt-in — an
 * empty override is indistinguishable from the all-writable default (see the
 * header note).
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
