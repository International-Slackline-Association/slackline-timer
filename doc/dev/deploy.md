# deploy.md — shipping Slackline Timer to AWS

The runnable checklist for deploying to prod. Architecture rationale lives in
[`architecture.md`](./architecture.md); what is currently owed is
`@work/status.md` §2 "Deploy queue" — this file is the _how_, STATUS is
the _what's-left_. Local dev needs no AWS account; see
[`local-dev.md`](./local-dev.md).

The app deploys in **two halves that must ship together**:

| Half          | Tooling              | Command (from the package dir)          | AWS resources                                                                                                                                       |
| ------------- | -------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`web/`**    | Vite build + S3 sync | `npm run deploy`                        | `slackline-timer-v1-web` (eu-central-1): S3 + CloudFront, both resolved from the stack's `WebBucketName` / `WebDistributionId` outputs              |
| **`server/`** | AWS CDK (TypeScript) | `npm run deploy`                        | `slackline-timer-v1` (eu-central-2): WS relay (3 Lambdas), HTTP API, 2 DynamoDB tables, photo S3 bucket, photo CloudFront, IAM                      |
| **billing**   | AWS CDK (TypeScript) | `cdk deploy slackline-timer-v1-billing` | `slackline-timer-v1-billing` (**us-east-1**): monthly Budget + `EstimatedCharges` alarm → SNS email; the CloudFront-scoped WAF WebACL (default-OFF) |

The **backend** (CDK stack) is pinned to **`eu-central-2` / `prod`**
(`server/infra/app.ts`). Two things deliberately stay in **`eu-central-1`**: the
shared ISA **Cognito** pool (verified cross-region) and the **web frontend**
S3 + CloudFront. A **third** stack, `slackline-timer-v1-billing`, is pinned to
**`us-east-1`** — the only region publishing the `AWS/Billing EstimatedCharges`
metric and the only region a CloudFront-scoped WAF WebACL can live in. It is
independent of the app deploy (deploy it once, whenever). So the region split is
**three-way**: `eu-central-2` (backend + SSM + its bootstrap), `eu-central-1`
(web + Cognito), `us-east-1` (billing + CloudFront WAF). Regional CLI flags below
differ by resource accordingly.

> **Prerequisite:** `eu-central-2` (Zurich) is an **opt-in region** — it must be
> enabled on the account before anything can deploy there:
> `aws account enable-region --region-name eu-central-2` (account-wide; takes
> minutes–hours; check with `aws account get-region-opt-status --region-name eu-central-2`).
> Every deploy command needs `AWS_PROFILE`.
>
> **Deployment config lives in an ignored `.env.deploy` at the repo root** — copy
> [`.env.deploy.example`](../../.env.deploy.example) and fill in `AWS_PROFILE`,
> `AWS_ACCOUNT_ID` and `BILLING_ALERT_EMAIL` (the billing stack and the backend's
> ops alarms both subscribe it). It is loaded automatically by
> every piece of deploy/ops tooling — the CDK entrypoint (`server/infra/app.ts`),
> the web deploy (`web/internals/deployToS3.mjs`), and the two shared script
> modules `server/scripts/lib/awsCli.mjs` (commission / decommission /
> maintenance) and `server/scripts/cognito/cognitoCommon.mjs` (the Cognito
> helpers), so no `export AWS_PROFILE` is needed for any of them. An
> already-exported variable still wins, so `AWS_PROFILE=… npm run deploy` keeps
> working, and `--profile` still overrides per run. A `AWS_ACCOUNT_ID` that
> disagrees with the account the credentials resolve to fails the CDK synth
> (wrong-profile guard). The file is operator- and
> account-specific and is deliberately never committed. Real secrets are not in
> it — they live in SSM SecureString parameters (§0.2) and are fetched at runtime.

> **Ship server then web, together.** Auth/protocol changes ship as a set —
> deploying one side alone locks operators out.

---

## 0. One-time account setup (first deploy only)

Do these once per AWS account before the very first `server` deploy.

### 0.1 Cognito (the shared ISA pool)

The pool + Hosted UI are ISA-owned and hand-provisioned (not in any CDK stack);
the timer only references the pool/client IDs. Operator + app-client management
runs through the Node scripts in [`server/scripts/cognito/`](../../server/scripts/cognito/README.md)
(shell out to an authenticated AWS CLI v2 in `eu-central-1`).

- **Create the `timeradmin` group** and add operator users. Until an operator is
  in the group, login succeeds but the WS `$connect` is denied (the "Not
  authorized" screen). Manage membership with the group helpers —
  `node scripts/cognito/addToGroup.mjs <email>` / `getGroupMembers.mjs` /
  `removeFromGroup.mjs` / `findUser.mjs`.
- **Provision the Hosted-UI app client** — public SPA, no secret: auth-code
  flow, scopes `openid email`, the shared ISA Hosted-UI domain, and **every app
  origin registered as both a callback and sign-out URL** (`http://localhost:5173`
  for dev + the deployment's CloudFront URL). The pool, client, domain, region
  and operator group are then recorded once in `.env.deploy` (`COGNITO_*`, see
  [`.env.deploy.example`](../../.env.deploy.example)); the CDK stack, the web
  build and the Cognito scripts all read them from there rather than each
  carrying their own copy (ADR 0048).
- **Harden the app client to least privilege** — ✅ **done 2026-07-07**
  (`hardenAppClient.mjs --apply`, `verifyAppClient.mjs` clean). The SPA only reads `email` and
  requests `openid email`, so it needs no `aws.cognito.signin.user.admin` scope
  (the actual write-lock). Audit with `node scripts/cognito/verifyAppClient.mjs`
  and apply the desired config with `hardenAppClient.mjs [--apply]` (dry-run by
  default, writes a rollback backup). See the cognito README for the full policy.

### 0.2 SSM parameters (ADR 0025)

The Lambdas receive only parameter **names** and fetch + decrypt at runtime
(`server/src/core/secrets.ts`). Create these before `cdk deploy`:

```bash
# HMAC secret for event read tokens — at least 32 bytes (48 random bytes here)
aws ssm put-parameter --region eu-central-2 --type SecureString \
  --name /slackline-timer-v1/read-token-secret \
  --value "$(openssl rand -base64 48)"

# Photo CloudFront signing key pair (RSA-2048)
openssl genrsa -out photo-private.pem 2048
openssl rsa -in photo-private.pem -pubout -out photo-public.pem

aws ssm put-parameter --region eu-central-2 --type SecureString \
  --name /slackline-timer-v1/photo-private-key --value "file://photo-private.pem"

# Public half — plain String, resolved at deploy into the CloudFront public key
aws ssm put-parameter --region eu-central-2 --type String \
  --name /slackline-timer-v1/photo-public-key --value "file://photo-public.pem"
```

`SecureString` uses the default `aws/ssm` KMS key. Delete the local `.pem`
files afterward.

The read-token secret must be **at least 32 bytes** (UTF-8): read tokens are
public, so a short secret is brute-forceable offline. A shorter value is refused
at runtime as if it were missing — after the deploy every overlay link fails
(both authorizers deny, minting answers 503). Check an existing secret before
deploying:

```bash
aws ssm get-parameter --region eu-central-2 --with-decryption   --name /slackline-timer-v1/read-token-secret   --query Parameter.Value --output text | tr -d '
' | wc -c
```

If it is short, overwrite it (`--overwrite` on the `put-parameter` above) and
re-mint the overlay links on `/admin/overlays`: a new secret invalidates every
outstanding read token.

### 0.3 CDK bootstrap

```bash
cd server && AWS_PROFILE=… npx cdk bootstrap aws://<ACCOUNT_ID>/eu-central-2
```

Or use `npm run deploy:guided`, which runs `cdk bootstrap && cdk deploy`.

---

## 1. Pre-flight (safe, no AWS writes)

Run the repo-wide gates and a synth/diff before any deploy:

```bash
npm run typecheck && npm run lint && npm test   # repo root, all packages
npm --prefix server ci                          # clean install for the stack
npm --prefix server run synth                   # cdk synth — catches stack errors
AWS_PROFILE=… npm --prefix server run diff       # cdk diff vs the live stack
```

CDK has no local emulator and stack errors only surface at synth/deploy time, so
`synth` before every deploy is worth it.

---

## 2. Deploy the server (first)

```bash
cd server
# First ever deploy for this account:
AWS_PROFILE=… npm run deploy:guided     # cdk bootstrap && cdk deploy
# Every subsequent deploy:
AWS_PROFILE=… npm run deploy            # cdk deploy
```

The stack's outputs are what the web deploy reads, so nothing here has to be
copied anywhere by hand (ADR 0048):

- `HttpApiUrl` — the competition-data HTTP API base URL
- `WebsocketUrl` — the relay WS endpoint
- `PhotoCdnDomain` — the photo CloudFront domain
- `PhotoUploadOrigin` — the photo bucket's upload origin (the web CSP's
  `connect-src` entry for presigned POSTs, ADR 0054)

Replacing an API changes these values; step 3 picks the new ones up on its next
run. There is no source edit to forget.

For fast code-only iteration on a **dev** stack (never prod):
`AWS_PROFILE=… npm run watch` (`cdk watch --hotswap`).

---

## 3. Deploy the web (second)

The bundle carries no endpoints of its own — `vite build` refuses to produce
one unless all six `VITE_APP_*` values and the two `WEB_CSP_*` inputs of the
build-time CSP are supplied, and the deploy resolves them for you (ADR 0048,
ADR 0054). Run step 2 first: the URLs baked into the bundle come
from the backend stack's outputs, so a web deploy against a stale backend is
not possible.

```bash
cd web
AWS_PROFILE=… npm run deploy
```

`npm run deploy` = `internals/deployToS3.mjs`, which **resolves first, then
builds**:

1. Reads `.env.deploy` and the live stack per role from the decommission ledger
   — so the two regions (`eu-central-2` backend, `eu-central-1` web) are not
   restated here either.
2. `describe-stacks` on each: `WebsocketUrl`, `HttpApiUrl`, `PhotoCdnDomain` +
   `PhotoUploadOrigin` from the backend, `WebBucketName` + `WebDistributionId`
   from the web stack. A missing output
   names the stack, the region and what it _does_ publish.
3. Confirms the resolved bucket is owned by `AWS_ACCOUNT_ID`
   (`s3api head-bucket --expected-bucket-owner`) — before the build, not just
   before the upload. The sync runs with `--delete`, so "this bucket name exists
   and my credentials can reach it" is not good enough.
4. Runs `npm run build` with the resolved `VITE_APP_*` + `WEB_CSP_*` env; the
   build writes the enforcing CSP `<meta>` into `index.html` (ADR 0054).
5. Syncs `dist/` to the resolved bucket with `--delete` and a 1-day cache,
   forces `index.html` to `no-cache`, and invalidates the resolved distribution.

Any unresolved value aborts before the build, listing each one with where it was
supposed to come from (a stack output, or a key in `.env.deploy`).

> **Never** build web with `VITE_APP_LOCAL_DEV=true` — it ships a fake auth
> token. The build refuses this flag, but don't set it.

---

## 4. Cutover check — session IDs must be real competitions

The `$connect` authorizer **denies** an operator whose `sessionId` is
`"default"` or an unregistered `compId`. Before/with the deploy, seed at least
one competition and confirm prod control/preview URLs carry that competition's
`compId` as `sessionId` — otherwise operators can't connect.

---

## 5. Post-deploy smoke tests

Run these after any deploy that touches auth, the protocol, or the timers. The
first go-live pass is closed — the app then ran the 2026 championships live
(STATUS §1) — so this is the **re-deploy** checklist, not a one-time gate:

- **HTTP** — hit every route group (competitions / athletes / times / scores /
  matches / rankings / photo-uploads / read-tokens); confirm a signed-photo read.
- **WS** — a control + preview round; a pre-GO **Abort Start** records no Time
  and never stops a lane (rule S4, ADR 0035); a Time is POSTed only when a lane
  has an athlete; the start light, the long GO beep and the clock leaving zero
  land together on control **and** preview (the schedule-anchored start — see
  ARCHITECTURE "Timing").
- **Realtime paths** — state recovery (reconnect a preview mid-run → resyncs via
  `request_state`/`state_snapshot`), lane names propagate, reconnect resilience
  (kill backend >30s → connection-lost surface, retries, self-heals; keepalive
  ping visible in relay log).
- **Freestyle** — five score components; `overall` computes when blank and
  honours a typed override; Speed/Freestyle toggle scopes Matches + bracket;
  a `/stream/rankings/…?discipline=freestyle&token=…` overlay renders read-only
  and refreshes live on `db_update`.
- **Web security headers (§6.6)** — the web distribution sends
  `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Browser sources (OBS, vMix)
  load `/stream/*` top-level, so they are unaffected; only a page that _iframes_ the
  app breaks, and nothing should. Confirm the headers, then that one overlay still
  renders in a browser source and that Hosted-UI sign-in completes:
  ```bash
  curl -sI "<WebUrl output>/stream/rankings/final/female" | grep -iE     'x-frame-options|content-security-policy|strict-transport|x-content-type|referrer-policy'
  ```
- **Build-time CSP (ADR 0054)** — after every web deploy. The `<meta>` policy
  allows only the origins resolved at build time, so a missed origin shows up
  as a blocked request, not a failed build. Keep the DevTools console open
  (filter `Content-Security-Policy`) through each step; any violation is a
  failure:
  1. `curl -s "<WebUrl output>/" | grep -o 'Content-Security-Policy" content="[^"]*'`
     names the deployed API, WS, Cognito, photo CDN and upload origins.
  2. Hosted-UI sign-in from a fresh private window (the code exchange on the
     Cognito domain).
  3. A token refresh: leave a signed-in control page open for more than 1 h,
     then act (an admin save, a WS reconnect) — Amplify refreshes against
     `cognito-idp.<region>`. Sign out once (token revoke).
  4. WS connect on a control + preview pair.
  5. Photo upload on `/admin/athletes` (the local preview is a `blob:`, the
     POST goes to the upload origin), then the photo renders from the CDN.
  6. A `/stream/*?token=…` overlay renders, photos included.
  7. The H2R bridge pushes to `http://127.0.0.1:4001` (or H2R's local port).

  **Rollback:** redeploy the web from the previous commit
  (`git switch --detach <previous>` → `cd web && npm run deploy`). The backend
  and the header policy need no change; the extra `PhotoUploadOrigin` output is
  inert.

---

## 6. Cost & abuse guardrails (ADR 0031)

The controls: a us-east-1 billing stack (✅ deployed 2026-07-07), API-Gateway
throttling (✅ deployed 2026-07-07, rides the `eu-central-2` backend deploy in §2),
Lambda reserved-concurrency (✅ deployed 2026-07-21, §6.2), a default-OFF
CloudFront WAF on the web distribution (§6.3; the APIs have none), and the
operational alarms in the backend stack (§6.5).
Sizes + rationale live in `server/infra/{billing-stack,waf,slackline-stack}.ts` and
ADR 0031. The one open item is the post-deploy burst smoke (§6.2 / HUMAN_TASKS §"Live-AWS / operational"
`guardrail-deploy-smoke`).

### 6.1 Billing stack (us-east-1) — `billing-stack-deploy`

✅ **Done 2026-07-07** — stack live, SNS subscription confirmed. Steps kept for the record / re-deploys.

```bash
cd server
AWS_PROFILE=… npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1   # one-time, new region
AWS_PROFILE=… npx cdk deploy slackline-timer-v1-billing
```

**Verify (both required):** stack `CREATE_COMPLETE` with the `CfnBudget` ($55 ≈ €50) +
`EstimatedCharges` alarm (fires above $25 — an earlier warning than the Budget's
100%); then **click the SNS confirmation link** emailed to
the address in `BILLING_ALERT_EMAIL` (`aws sns list-subscriptions-by-topic --region us-east-1
--topic-arn <arn>` → a real ARN, not `PendingConfirmation` — an unconfirmed
subscription silently drops every alarm). The Budget's own 50/80/100% emails come
from Budgets directly and need no confirmation.

> The `EstimatedCharges` metric only publishes once **Receive Billing Alerts** is
> enabled (Billing console → preferences). If it was off, the alarm sits in
> `INSUFFICIENT_DATA` until the next ~6h billing publish — expected, not a failure.

### 6.2 Throttling + reserved concurrency — carried by the §2 backend deploy

Both ride `npm run deploy` in `server/` (§2) — no separate command.

✅ **Throttling** — HTTP-stage default **20 rps / 40 burst**; WS-stage `$connect`/`$default`
**2000 rps / 2000 burst**. The WS bucket also meters the outbound `PostToConnection` fan-out (every relayed message spends fan-out-N posts through it), so it was raised from
the initial inbound-only sizing (10/20) to just under the 2500 rps account cap on
2026-07-23 (ADR 0031 §2).

**Per-route HTTP throttles (security review M1)** — every HTTP route carries its own
rate / burst bucket (`RouteSettings` on the stage, `HTTP_ROUTE_THROTTLE` in
`server/infra/slackline-stack.ts`), so a flood on one route no longer 429s the others;
the stage default above now meters only requests that match no route:

| Class  | rps / burst | Routes                                                                                                                          |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| write  | 10 / 20     | `POST` times, scores, matches; `PUT`/`DELETE` `times/{id}`, `scores/{id}`, `matches/{id}`                                       |
| read   | 30 / 60     | `GET` competitions, `competitions/{compId}`, athletes, `athletes/{id}`, times, scores, matches, `rankings/{round}`              |
| roster | 5 / 10      | `POST` athletes, `PUT`/`DELETE` `athletes/{id}`, `POST` photo-uploads                                                           |
| admin  | 2 / 5       | `POST`/`PUT` competitions, read-tokens, revoke-read-tokens, `matches/seed`, `matches/advance`, managers (`GET`/`POST`/`DELETE`) |

`roster` sits above `admin` because `seedRemote.mjs` enters a whole roster back-to-back
(photo presign + athlete `POST` per athlete); the seed client backs off on `429`. The
sizes are first estimates: **re-size them from the HWC 2026 `HttpApi` 429 counts**
(CloudWatch `AWS/ApiGateway` `4xx`) — HUMAN_TASKS §"Live-AWS / operational"
`http-route-throttle-resize`. The first deploy adds `RouteSettings` + a stage→route
`DependsOn` to the existing stage (an in-place update, no replacement).

✅ **Reserved-concurrency caps deployed 2026-07-21** — authorizers 50, the five entity
writers 25, the relay `messageHandler` 100 (its own larger fan-out cap, ADR 0031 §3). The
first attempt (2026-07-07) was rejected at the new-account concurrency cap of 10; the caps
landed once a Service Quotas increase raised the pool to the standard 1000.

**Verify (`guardrail-deploy-smoke`) — needs the live eu-central-2 stack:**

1. **Normal traffic unthrottled.** Operator login + an admin page + a `/stream/*`
   overlay + a driven round → no `429`, WS stays open.
2. **HTTP burst is rate-limited per route.** Point a load tool at a cheap authorized
   GET above its `read` bucket (30 rps / 60 burst; keep it to seconds — each hit bills
   the authorizer + a DynamoDB `getCompetition`), confirm a share of `429`s, and that a
   time saved from the admin UI during the burst still lands (its `write` bucket is
   separate):
   ```bash
   oha -z 20s -q 100 -c 20 -H "Authorization: <IdToken-or-read-token>" \
     "<HttpApiUrl output>/competitions/<compId>/rankings/final?gender=men"
   ```
   (`oha -q` is overall QPS, not per-worker; `hey -z 20s -q 100 -c 20 -H …` is an
   equivalent fallback.)
3. **WS reconnect wave.** The WS default-route throttle is now 2000/2000 (≈ the account
   cap), so a hand-run burst won't trip it. This step instead confirms a normal reconnect
   wave (dozens of near-simultaneous `$connect`s) is _accepted_ and the fan-out is not
   429-dropped — watch `failed=`/`retried=` in the messageHandler logs stay ~0, i.e. the
   resize + fan-out retry did their job:
   ```bash
   for i in $(seq 1 30); do websocat -1 \
     "<WebsocketUrl output>?Authorization=<IdToken>&sessionId=<compId>" \
     >/dev/null 2>&1 & done; wait
   ```

### 6.3 Abuse runbook — what works today

There is **no WAF in front of the APIs.** A regional WAF ACL attaches to API
Gateway REST APIs only, not to HTTP or WebSocket APIs, so the backend carries none.
API-level WAF arrives with the CloudFront edge layer in front of the HTTP API
(backlog `api-edge-layer` in `@work/status.md`, blocked on a custom API domain;
a future ADR). Until then, in order of reach:

1. **Leaked overlay link → revoke.** `/admin/overlays` → revoke (`POST
/competitions/{compId}/revoke-read-tokens`) bumps the competition's
   `tokenVersion`: every outstanding read token fails at once, HTTP and future WS
   `$connect`s, and open `readOnly` overlay sockets are force-closed (ADR 0026). Mint
   fresh links for the real overlays afterwards.
2. **Flood on the web app → the CloudFront WAF.** The only ACL that can attach today
   is the CLOUDFRONT-scope one on the web distribution (default-OFF; per-IP rate
   limit 2000 req / 5 min, `infra/waf.ts`). It covers the SPA's static assets, not
   the APIs or the photo CDN. **At a venue every client shares one NAT address**
   (241 connections at HWC 2026), so a mass reload can exceed 2000 / 5 min and block
   the venue itself: raise `RATE_LIMIT_PER_5MIN` (≈ 10 000) before enabling it
   during an event.

   ```bash
   cd server
   AWS_PROFILE=… npx cdk deploy slackline-timer-v1-billing --parameters WafEnabled=true
   AWS_PROFILE=… npx cdk deploy slackline-timer-v1-web --parameters WafWebAclArn=<WebAclArn output>
   ```

   **Verify** a synthetic per-IP burst is `403`-blocked (`RateLimitPerIp` metric),
   then flip back so no standing cost lingers:

   ```bash
   AWS_PROFILE=… npx cdk deploy slackline-timer-v1-billing --parameters WafEnabled=false
   AWS_PROFILE=… npx cdk deploy slackline-timer-v1-web --parameters WafWebAclArn=""
   ```

3. **Flood on the APIs → the throttles are the ceiling.** The per-route HTTP
   throttles and the WS stage (2000/2000) throttle plus the reserved-concurrency caps
   (§6.2) bound Lambda and DynamoDB spend; a flood that fills one route's bucket also
   429s legitimate operators on that route until it stops. A missing `Authorization` (HTTP) or
   missing `Authorization`/`sessionId` (WS `$connect`) is 401'd by API Gateway
   before any Lambda runs. Budgets + the billing alarm (§6.1) are the early warning.
   A sustained targeted flood has no per-IP block at the API today; lowering the
   hit route's class in `HTTP_ROUTE_THROTTLE` (`server/infra/slackline-stack.ts`)
   and redeploying is the remaining lever.

### 6.4 Restoring the competition table (PITR)

`slackline-timer-v1-competition-<stage>` has point-in-time recovery with a 35-day
window (`defineTables`); the relay table has none (its rows live 20 min). A restore
never rewinds the live table — it **creates a new table**:

```bash
AWS_PROFILE=… aws dynamodb restore-table-to-point-in-time --region eu-central-2 \
  --source-table-name slackline-timer-v1-competition-prod \
  --target-table-name slackline-timer-v1-competition-prod-restore \
  --restore-date-time <ISO-8601, before the bad write>
```

The restored table has no PITR, no deletion protection and no tags until set. Then
either:

- **Copy back (preferred):** read the affected `COMP#<compId>` partition from the
  restored table and write those items into the live one (a one-off script over
  `Query` + `BatchWriteItem`; delete rows the bad write added first). The stack, the
  table name and every Lambda env stay as they are. Delete the restore table after.
- **Swap (whole-table loss), outside an event:** once the restore table checks out,
  turn deletion protection off on the live table, delete it, and restore again into
  the **original name**. The stack and every Lambda env address the table by name,
  so nothing is redeployed; but CloudFormation does not re-apply what the restore
  dropped, so set it by hand (`aws dynamodb update-continuous-backups
--point-in-time-recovery-specification PointInTimeRecoveryEnabled=true,RecoveryPeriodInDays=35`,
  `aws dynamodb update-table --deletion-protection-enabled`), then check `cdk diff`
  is clean. If the backend stack itself is gone, re-adopt the restored table with the
  commission tooling (`server/scripts/commission/`, `cdk deploy
--import-existing-resources`).

---

### 6.5 Operational alarms (security review L10)

Rides the §2 backend deploy. Five CloudWatch alarms in `eu-central-2` notify the SNS
topic `slackline-timer-v1-ops-<stage>`, subscribed by the same `BILLING_ALERT_EMAIL`
address (a separate topic: alarm actions must target a topic in the alarm's region,
and the billing topic is us-east-1). All treat missing data as not breaching — an idle
stage publishes nothing.

| Alarm (`slackline-timer-v1-…-<stage>`) | Fires when                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `message-handler-throttles`            | ≥ 1 `messageHandler` throttle in 1 min (a dropped relay frame)             |
| `authorizer-throttles`                 | ≥ 1 WS + HTTP authorizer throttle (summed) in 5 min                        |
| `message-handler-errors`               | ≥ 1 `messageHandler` error in 5 min                                        |
| `http-api-5xx`                         | ≥ 5 HTTP API `5xx` in 5 min                                                |
| `log-ingest`                           | > 1 GiB `IncomingBytes` in 1 h across the messageHandler + authorizer logs |

`log-ingest` is the log-cost early warning: it fires within the hour, where
`EstimatedCharges` lags 6–24 h. Standing cost ≈ $0.80/month (8 alarm metrics).

**After the first deploy, click the SNS confirmation link** emailed to
`BILLING_ALERT_EMAIL` — an unconfirmed subscription silently drops every alarm:

```bash
aws sns list-subscriptions-by-topic --region eu-central-2   --topic-arn arn:aws:sns:eu-central-2:<ACCOUNT_ID>:slackline-timer-v1-ops-prod
```

(`SubscriptionArn` must be a real ARN, not `PendingConfirmation`.) Cost Anomaly
Detection is not in CDK: AWS creates a default services monitor on most accounts and
allows one per account, so a stack-owned monitor would collide — subscribe the email
to the existing monitor in the Billing console instead, if wanted.

### 6.6 Web security headers (security review M6, slice 1)

Rides the web-stack deploy (`npx cdk deploy slackline-timer-v1-web` from `server/`).
A custom `ResponseHeadersPolicy` on the web distribution (`server/infra/web-stack.ts`)
adds to every response, the SPA's 403/404 → `index.html` rewrites included:

- `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`, no `preload`:
  the host is a `*.cloudfront.net` name);
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`;
- an **enforcing** `Content-Security-Policy` of the deployment-free directives only:
  `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
  (`form-action` does not touch sign-in: Amplify's `signInWithRedirect` navigates via
  `window.location`, and the admin forms submit through `fetch`);
- `Content-Security-Policy-Report-Only` with a generic full policy (`default-src 'self'`,
  `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https:`,
  `connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:*`, `font-src`/
  `media-src 'self' data:`, `worker-src 'none'`). It blocks nothing and has no report
  endpoint — violations show in the browser console only.

The first deploy creates the policy and updates the distribution in place (no
replacement; edge propagation takes minutes). After it, run the §5 header check and
open the console on a control page, an overlay and `/admin/athletes` (photo preview):
any `Report-Only` violation listed there is input for slice 2, the build-time
enforcing CSP with exact origins (ADR 0054, smoke in §5).

## 7. Ported Node scripts — live-AWS verification (`scripts-nodejs-live-aws-verification`)

The six shell/PowerShell scripts were ported to Node ESM (commit `7946aa2`) and owe
a one-time live-AWS run (gates + faithful-translation are covered; live behaviour
isn't). With `AWS_PROFILE` exported:

```bash
cd web && AWS_PROFILE=… npm run deploy          # dist sync, index.html no-cache, /* invalidation
cd ../server
AWS_PROFILE=… node scripts/commission/commissionStack.mjs --what-if
AWS_PROFILE=… node scripts/decommission/decommissionStack.mjs --what-if
AWS_PROFILE=… node scripts/maintenance/gcBootstrapAssets.mjs            # dry run
AWS_PROFILE=… node scripts/maintenance/gcBootstrapAssets.mjs --delete
```

**Verify:** each `--what-if`/dry-run prints its plan without mutating; the web
deploy's `create-invalidation --paths /*` reaches AWS **literally, un-mangled**
(the `execFileSync` argv-passing replaced the old `MSYS_NO_PATHCONV` workaround).

---

## 8. Deploy-session gotchas

- **CDK SSO token expiry** (`Assuming role failed: ExpiredToken` even while
  `aws sts get-caller-identity --profile <your-profile>` succeeds — the plain CLI
  refreshes the SSO role cred, CDK's embedded SDK does not). Materialize
  concrete env creds, then run CDK **without** `--profile` (a profile flag
  overrides env creds and re-triggers the failing role-assume). The proven
  PowerShell one-liner (worked 2026-07-15):

  ```powershell
  aws configure export-credentials --profile <your-profile> --format powershell | Out-String | Invoke-Expression; npx cdk deploy slackline-timer-v1 --require-approval never
  ```

  (bash equivalent: `eval "$(aws configure export-credentials --profile <your-profile> --format env)"`;
  `--format json` is **not** a valid choice on this box's CLI 2.34.45 — use
  `powershell`/`env`/`process`.)

- **Wrong-account fallback.** If CDK prints role ARNs in account
  `<another-account>` (`cdk-hnb659fds-…-<another-account>-…`) it fell back to the
  `default` profile (IAM user `dev-account`) because `AWS_PROFILE` wasn't in
  effect — the stacks live in the ISA account (`<your-profile>`). The env-creds
  one-liner above avoids this too, since the exported creds are unambiguous.
- **git-bash leading-slash mangling.** MSYS rewrites a leading `/` in a CLI arg
  into a Windows path (bit the CloudFront `--paths /*` and SSM `--name /slackline-timer-v1/…`).
  The ported `.mjs` scripts pass argv via `execFileSync` so their own calls are
  safe; for **hand-run** `aws`/`cdk` commands in git-bash prefix `MSYS_NO_PATHCONV=1`
  (or run them from PowerShell).
- **Auto-mode classifier gates destructive/Cognito/secret ops.** `cdk destroy`, the
  decommission scripts, and the Cognito harden step touch delete/identity/secret
  APIs a restricted session may block — run them in an interactive/approved session.
- **Deploy outside live heats.** A Lambda-only deploy keeps open WS sockets, but
  the first frames after it hit cold starts (300–600 ms) on the relay and the
  authorizers; a stop landing then is late on every display.
- **RETAIN + deletionProtection orphans.** Both DynamoDB tables and the photos
  bucket are `RemovalPolicy.RETAIN` + deletion-protected; `cdk destroy` leaves them
  behind by design (the decommission ledger `server/scripts/decommission/stacks.json`
  is the record). Don't expect a clean-slate teardown.

---

## 9. Go-live order (dependency-correct)

1. **Pre-flight** (§1) — gates + `synth` + `diff`.
2. **Deploy backend** `slackline-timer-v1` / eu-central-2 (§2) — ✅ **re-deployed 2026-07-07**
   carrying the photos-bucket presigned-POST CORS **and** the throttling guardrails (§6.2);
   the reserved-concurrency caps were deferred (account concurrency limit 10 — §6.2).
3. **Deploy web** `slackline-timer-v1-web` / eu-central-1 (§3).
4. **Cognito harden** (§0.1 `hardenAppClient.mjs --apply`) — ✅ **done 2026-07-07**
   (`verifyAppClient.mjs` clean).
5. **Bootstrap us-east-1 + deploy billing** (§6.1) — ✅ **done 2026-07-07** (stack live,
   SNS subscription confirmed).
6. **Seed a competition + real operator URLs** (§4) — ✅ **done**; the 2026
   championships ran on a seeded comp whose `compId` was the relay `sessionId`.
7. **Smoke tests** (§5) — ✅ **closed by the live event**
   (STATUS §1). §5 is now the re-deploy checklist.
8. **Guardrail burst smoke + WAF enable rehearsal** (§6.2, §6.3) — ⬜ **still
   open** (`guardrail-deploy-smoke`, HUMAN_TASKS §"Live-AWS / operational"); the WS half was answered in
   production by the HWC 2026 reconnect storm.
9. **Ported-scripts live verification** (§7) — opportunistically alongside a real
   web deploy / any commission or decommission run.
