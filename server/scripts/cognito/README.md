# Cognito operator-group helpers

Thin AWS-CLI wrappers for managing timer operators — the members of the
operator group (`$COGNITO_TIMER_GROUP`) in the shared ISA Cognito pool. A user
must be in that group for the WebSocket `$connect` authorizer to accept them;
without it, login succeeds but the timer shows "Not authorized".

This folder also holds the **app-client hardening** scripts — see "Harden /
verify the app client" below. Everything is a Node `.mjs` script that shells out
to an authenticated AWS CLI v2; the shared glue (config resolution, the CLI
runner, user lookup) lives in `cognitoCommon.mjs`.

## Prerequisites

- **Node** (the repo's version) and **AWS CLI v2** on `PATH`, authenticated for
  the account that owns the pool, in `$COGNITO_REGION` — the pool does not live
  in the backend's region, which is why the two are configured separately.
- The AWS profile comes from the repo-root `.env.deploy` (`AWS_PROFILE`, loaded
  automatically — see `.env.deploy.example`); an exported `$AWS_PROFILE` or a
  per-run `--profile` overrides it. When none is set, the AWS CLI's default
  credential resolution is used. If your SSO creds are expired:
  `aws sso login --profile <your-profile>`.

Pool id, region, group and app-client id come from the repo-root `.env.deploy`
(`COGNITO_USER_POOL_ID` / `COGNITO_REGION` / `COGNITO_TIMER_GROUP` /
`COGNITO_CLIENT_ID` — see `.env.deploy.example`), each overridable per-run via
`--pool-id` / `--region` / `--group` / `--client-id`. None has a committed
fallback: with nothing to resolve, a script names the missing variable and stops
rather than act on another deployment's users. Run any script with `--help`.

## Usage — operator group helpers

```bash
# AWS_PROFILE comes from .env.deploy; export it (or pass --profile) to override.

# Find a user by any substring of email/name (case-insensitive):
node scripts/cognito/findUser.mjs smith

# Add a user to the operator group (resolves username by exact email, then verifies):
node scripts/cognito/addToGroup.mjs user@example.com

# List current operators:
node scripts/cognito/getGroupMembers.mjs

# Revoke operator access:
node scripts/cognito/removeFromGroup.mjs user@example.com

# A different profile / group:
node scripts/cognito/addToGroup.mjs user@example.com --group <group> --profile <your-profile>
```

## Harden / verify the app client

The timer's public SPA app client (`$COGNITO_CLIENT_ID`) is ours to manage on
ISA's behalf. It should be **read-only, least privilege** — the app only reads
the `email` claim + the auto-injected `cognito:groups` claim and requests
`openid`+`email` over the auth-code flow (`web/src/main.tsx`); it never writes
user attributes. The desired config (single-sourced in `appClientPolicy.mjs`):

| Setting              | Value                     | Why                                                                    |
| -------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `AllowedOAuthScopes` | `openid`, `email`         | **no `aws.cognito.signin.user.admin`** — this is the actual write-lock |
| `AllowedOAuthFlows`  | `code`                    | auth-code only, no implicit grant                                      |
| `ReadAttributes`     | `email`, `email_verified` | all the app reads (`cognito:groups` isn't an attribute)                |
| `WriteAttributes`    | _left unchanged_          | see the write note below — an empty list is a no-op, not a lock        |
| client secret        | none                      | public SPA client                                                      |

> **Why removing the scope — not clearing `WriteAttributes` — is the write-lock.**
> Per the [UpdateUserPoolClient docs](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateUserPoolClient.html),
> an empty/omitted `WriteAttributes` means **all standard attributes are
> writable** — there is no way to express "zero writable attributes". What
> actually authorizes `UpdateUserAttributes` / `DeleteUser` / `GetUser` is the
> **`aws.cognito.signin.user.admin`** scope; with it absent, the client's tokens
> can't call those APIs at all, so `WriteAttributes` is moot. `hardenAppClient.mjs`
> therefore leaves `WriteAttributes` alone by default (narrowing it can also break
> IdP attribute-mapping updates on a shared pool) — pass `--write-attributes a,b`
> to additionally restrict it to an explicit non-empty set (e.g. your IdP-mapped
> attributes) as blast-radius reduction.

Two Node scripts (shell out to the same authenticated AWS CLI v2 as above):

| Script                | Does                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `hardenAppClient.mjs` | describe → back up → diff → `update-user-pool-client` (dry-run unless `--apply`), then self-verify |
| `verifyAppClient.mjs` | read-only audit against the policy; prints pass/fail, exits non-zero on any hard failure           |

`update-user-pool-client` **replaces** the whole config, so `hardenAppClient.mjs`
starts from the live config and overrides only the fields above — callback URLs,
token validity, etc. are carried over verbatim. It writes a timestamped rollback
backup (`appclient-<id>-before-<stamp>.json`) to the current directory before
applying.

```bash
# AWS_PROFILE comes from .env.deploy; export it (or pass --profile) to override.

# See the current state (likely FAIL if writes/extra scopes are enabled):
node scripts/cognito/verifyAppClient.mjs

# Preview the change — prints the before→after diff + backup path, writes nothing:
node scripts/cognito/hardenAppClient.mjs

# Apply, then re-audit:
node scripts/cognito/hardenAppClient.mjs --apply
node scripts/cognito/verifyAppClient.mjs
```

Both accept `--client-id` / `--pool-id` / `--region` / `--profile`;
`hardenAppClient.mjs` also takes `--write-attributes a,b`, and
`verifyAppClient.mjs` takes `--json`. Run `--help` for the full list.

> ⚠️ Assumes the client is **timer-dedicated**. If it is shared with other ISA
> apps, `--write-attributes` (narrowing writable attributes) could affect any of
> them that write user attributes or map IdP attributes — the default scope-only
> hardening is safe either way (a login-only app is unaffected).

## Notes

- **Group changes take effect on the user's next login.** The group claim is
  baked into the Cognito IdToken at sign-in — an already-logged-in operator must
  sign out and back in (or wait for token refresh) before access changes apply.
- **Users must already exist in the pool.** They're created on first sign-in via
  the ISA Hosted UI; `addToGroup.mjs` fails clearly if the email isn't found.
