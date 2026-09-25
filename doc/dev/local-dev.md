# Local Development

How to run the whole app — timer (control/preview), the WebSocket relay that
syncs them, and the competition data plane (`/admin/*` + `/stream/*`) — entirely
on your machine, with no AWS account and no Cognito login.

## What runs locally

In production the browser talks to an AWS backend: an API Gateway **WebSocket**
API (the relay — authorizer / connection / message Lambdas) and an API Gateway
**HTTP** API (the data plane — competitions / athletes / times / matches /
rankings), both over DynamoDB, plus an S3 + CloudFront photo pipeline.

Locally, two harnesses run **that exact Lambda code** in-process against a
LocalStack container (DynamoDB + S3 on `:4566`) — there is no separate
reimplementation, so there is nothing to drift from prod (ADR 0023):

- the **WebSocket relay** on `ws://127.0.0.1:3001` — a small `ws` harness
  (`server/scripts/localWsHarness.mjs`) that runs the real `authorizer` /
  `connectionHandler` / `messageHandler` (esbuild-bundled) and replicates the
  `$connect`/`$disconnect`/`$default` routing + the `:3001` management API. CDK
  has no local WebSocket emulator, and LocalStack WS needs the Pro license (ADR
  0023, phase 2), so the harness fills that gap.
- the **HTTP data API** on `http://127.0.0.1:3002` —
  `server/scripts/localHttpHarness.mjs`, a `node:http` server that runs the same
  data-plane handlers in-process. See below.

The web app gets a matching escape hatch: with `VITE_APP_LOCAL_DEV=true` it
skips the Hosted-UI sign-in / `timeradmin`-group gate and sends a `local-dev`
dummy credential, which the offline authorizers accept as an operator (real
event read tokens still resolve to read-only). `VITE_APP_WS_URL` /
`VITE_APP_API_URL` repoint it from the prod endpoints to `:3001` / `:3002`.

> Use `127.0.0.1`, not `localhost`, in those URLs: the backend binds IPv4 and
> some browsers resolve `localhost` to IPv6 `::1`, which it isn't listening on
> (→ "CORS request did not succeed").

> Photos work locally against **LocalStack S3**, not real AWS — see
> [Photos](#photos-localstack-s3) below. The one divergence from prod: reads
> serve the **direct, unsigned** object URL (CloudFront signing has no local
> analogue; the bucket is public-read). Decision of record: `decisions.md` 0023 §2.

## Quick start

Prerequisites: **Docker Desktop running** (the data plane needs the LocalStack
container — DynamoDB + S3). No SAM CLI, no CDK CLI, and no AWS account are needed
for local dev: the relay + data-plane handlers run in-process via the harnesses,
so a headless agent/CI boots the full stack with just Docker.

```bash
# one-time: install deps in each package (multi-package repo, no workspaces)
npm ci
npm --prefix web ci
npm --prefix server ci

# one-time: create the web env file from the example
cp web/.env.development.example web/.env.development

# run the whole stack (Ctrl-C stops the host processes; the DB container stays up)
npm run dev
```

`npm run dev` runs `dev:check` (deps, Docker, web env), brings up the LocalStack
container (`db:up`), then starts the backend (the HTTP harness on `:3002`
alongside the WS harness on `:3001`) and the Vite dev server (`:5173`) side by
side.

Open two tabs and drive the timer on control; preview follows in real time. Use
the **same `sessionId`** on both — that is the room key:

- Control: <http://localhost:5173/speedline/control?sessionId=demo>
- Preview: <http://localhost:5173/speedline/preview?sessionId=demo>

(Freestyle lives at `/freestyle/control` and `/freestyle/preview`.) The Speedline
control page's race recorder lists athletes from the data plane, so create a
competition with `sessionId` as its `compId` first (see below).

## Scripts

All from the repo root:

| command             | what it does                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | deps/Docker/env check, `db:up`, then the backend (`:3001` + `:3002`) + web                                                                                                                                                                                                                                                                                                            |
| `npm run dev:web`   | just the Vite dev server                                                                                                                                                                                                                                                                                                                                                              |
| `npm run dev:api`   | just the backend: ensure tables + bucket, then the HTTP harness + the WS harness (needs `db:up`)                                                                                                                                                                                                                                                                                      |
| `npm run dev:check` | pre-flight: deps, Docker reachable, web env points at the local backends                                                                                                                                                                                                                                                                                                              |
| `npm run db:up`     | start the LocalStack container (`:4566`, DynamoDB + S3)                                                                                                                                                                                                                                                                                                                               |
| `npm run db:init`   | create the two tables + the photo bucket (public-read + CORS), idempotent                                                                                                                                                                                                                                                                                                             |
| `npm run db:seed`   | reset + seed `demo`: 8 athletes/gender (a generated identicon each), a training + a qualification Time and a qualification Score each, then a bracket played out to a final winner per discipline×gender, plus that final's results — three best-of-3 Times per speed finalist (the loser's last run a DNF) and a judged Score per freestyle finalist, so the VS cards read populated |
| `npm run db:down`   | stop the LocalStack container (data is kept until the volume is dropped)                                                                                                                                                                                                                                                                                                              |

`dev:api` (`server/scripts/devApi.mjs`) injects the offline env so the backend
runs with **no AWS account**: a dummy `READ_TOKEN_SECRET`, the table/bucket
names, a dummy `AWS_ACCOUNT_ID`, empty CloudFront `PHOTO_*` keys, the LocalStack
S3 env (`PHOTOS_BUCKET`, `S3_ENDPOINT`, `S3_PUBLIC_URL`), `DYNAMODB_ENDPOINT`,
`WS_API_ENDPOINT=http://127.0.0.1:3001`, and throwaway creds (one source of
truth: `server/scripts/offlineEnv.mjs`, shared by both harnesses). CDK resolves
`{{resolve:ssm:…}}` only at **deploy**, never locally, so **SSM/STS are never
called** — `dev:api` provides the values instead. With `IS_OFFLINE` set, the
DynamoDB/S3 clients point at LocalStack (`core/aws/clients.ts`), the authorizers
accept the `local-dev` dummy, and the WS harness + the messageHandler fan-out
post to `:3001` so `db_update` push and the timer relay work locally. Both
harnesses bundle the real handlers with esbuild, so there is no drift from the
deployed code.

### HTTP API: the in-process harness

CDK has no local emulator (there is no `cdk local`), and running the stack inside
LocalStack needs the Pro license (ADR 0023, phase 2), so the HTTP data plane runs
via `server/scripts/localHttpHarness.mjs` — a `node:http` server on `:3002` that
runs the **real** esbuild-bundled handlers in-process. Per request it matches
method + path to the `routeKey` the handlers dispatch on (one entry per
`src/functions/*` route, mirroring the CDK HTTP routes in
`infra/slackline-stack.ts`), captures path params, and builds a minimal
`APIGatewayProxyEventV2` with an injected admin authorizer context (the same
operator identity the offline authorizers grant the `local-dev` dummy). Same
drift posture as the WS harness: one route table to keep in sync, guarded by a
`GET /competitions → 200` boot smoke in
`test/integration/localHttpHarness.int.test.ts`.

## Env reference

`web/.env.development` (loaded automatically by Vite in dev):

| var                  | meaning                                                    |
| -------------------- | ---------------------------------------------------------- |
| `VITE_APP_WS_URL`    | WebSocket backend — set to `ws://127.0.0.1:3001`           |
| `VITE_APP_API_URL`   | competition-data HTTP API — set to `http://127.0.0.1:3002` |
| `VITE_APP_LOCAL_DEV` | `true` to bypass Cognito sign-in / group checks            |

> ⚠️ `VITE_APP_LOCAL_DEV` only affects the **UI** gate. The real security
> boundary is the authorizer Lambdas in prod. Never set this in a production
> build — `vite build` does not read `.env.development` **and refuses to build
> when the flag is set**, so a normal `npm run build` / `npm run deploy` is
> unaffected.

## Working the data plane

With the stack up, the **whole admin/overlay data plane works locally**: create a
competition on `/admin/competitions`, add athletes/times/matches, mint an overlay
link on `/admin/overlays`, and open the `/stream/*` URL — it live-refreshes on
writes (the write Lambdas broadcast `db_update` through the relay).

Tables + photos live in the LocalStack container; `npm run db:down` stops it and
`db:up` restarts it. **Note:** LocalStack community does not persist across a full
container recreate, so `db:init` (idempotent) re-provisions the tables + bucket on
each fresh start — `npm run dev` runs it for you. (`docker compose -f
docker/docker-compose.yml down -v` also drops the volume.)

### Photos (LocalStack S3)

Athlete photos run end-to-end offline against **LocalStack S3**, so the **real**
`photoUpload` / read Lambdas exercise locally — no fake upload route, no
offline-only branch in the browser. Under `IS_OFFLINE` the `S3Client` points at
LocalStack (`:4566`, path-style; `core/aws/clients.ts`) and the content-hashed
presigned POST (with its policy fields) works unchanged. The bucket
(`slackline-timer-v1-photos-local`) is created **public-read** with a CORS rule by `db:init`
(`server/scripts/createLocalBucket.mjs`), so the browser FormData POST and the
overlay `<img>` GET work cross-origin.

The one divergence from prod is the **read URL**: CloudFront signing is an edge
operation over a private origin with no local analogue, so offline
`photoUrlSignerFromEnv` (`core/photoUrl.ts`) emits the **direct, unsigned** object
URL `http://127.0.0.1:4566/<bucket>/<key>` instead of a signed CloudFront URL.
Prod stays OAC + trusted-key-group signed, unchanged. Decision of record:
`decisions.md` 0023 §2.

`npm run db:seed` gives **every** demo athlete a photo: a generated identicon
drawn from the name (`server/scripts/lib/avatar.mjs`), so the profile-card
overlays come up fully populated offline with no real person's likeness in the
repo. No real portrait fixtures ship with this repository, and there is no
`seedPhotos.mjs` step — the identicons are the only offline photo source.

**Seed datasets (`resources/seed/`).** The repo-root `resources/` directory is
**operational data**, not reference material: `*.seed.json` datasets fed to
`server/scripts/seedRemote.mjs` (`npm --prefix server run seed`) for a real
deployment. `resources/seed/prod/` is git-ignored (real event data, athlete PII);
the committed `demo.seed.json` athletes are invented and carry no `photo` —
`seedRemote.mjs` uploads whatever `photo` a dataset names, while the local
generator (`seedLocal.mjs`, behind `npm run db:seed`) draws the identicon
described above instead.

### Integration tests (data plane)

The server suite includes `test/integration/*.int.test.ts` — they drive the
data-access layer (`competitionDb`, the connections `db`) and the HTTP-API Lambda
handlers against the **same LocalStack container**:

```bash
npm run db:up && npm run db:init   # container + tables (once)
npm --prefix server test           # runs unit + integration suites
```

They **self-skip** (not fail) when the container is unreachable — a `vitest`
setup file points `core/aws/clients` at `localhost:4566`, and each suite probes
the port at collection time. So CI and the `pre-push` hook stay green without
Docker, while a developer with the container up gets full coverage. Each test
uses a throwaway `compId`/`sessionId` and cleans its partition, so the suites are
safe to run repeatedly against the persistent volume.

### Deploy & fast-iterate against real AWS

Deploys use the CDK CLI and need `AWS_PROFILE` (backend pinned to
`eu-central-2` / `prod`; Cognito + the web frontend stay `eu-central-1` — full
runbook in [`deploy.md`](./deploy.md)):

```bash
cd server
npm run diff            # cdk diff — preview the change set
npm run deploy          # cdk deploy
npm run deploy:guided   # first time only: cdk bootstrap && cdk deploy
```

The three SSM params + the `timeradmin` Cognito group must exist first
(first-deploy prerequisites: [`deploy.md`](./deploy.md) §0). For a fast inner loop
against a **personal dev stack**, `npm run watch` (`cdk watch --hotswap`) pushes
Lambda code changes in seconds — dev only, never prod (it deliberately
introduces CloudFormation drift). **Phase 2:** with a LocalStack Pro license,
`npm run deploy:local` (`cdklocal deploy`) runs the whole stack — incl. native
WebSocket + Lambda — locally.

## Troubleshooting

- **Preview doesn't update.** Check both tabs use the same `sessionId`, and that
  the WS-harness log shows the message being relayed when you act on control.
- **App asks me to sign in.** `VITE_APP_LOCAL_DEV` isn't `true` in
  `web/.env.development`, or you ran `npm run build` (prod) instead of
  `npm run dev`.
- **Connection refused / falls back to prod.** The backend isn't running, or
  `VITE_APP_WS_URL` / `VITE_APP_API_URL` aren't set — `npm run dev:check` flags
  these.
- **"CORS request did not succeed" / status `null`.** A `localhost` vs IPv6 `::1`
  mismatch — use `127.0.0.1` (not `localhost`) in `VITE_APP_WS_URL` /
  `VITE_APP_API_URL`, then restart `npm run dev`.
- **Admin pages error / "HTTP_API_URL is not configured".** The backend isn't
  running or the web app isn't pointed at it: confirm `VITE_APP_API_URL=http://127.0.0.1:3002`
  in `web/.env.development` and restart `npm run dev` after changing env.
- **`dev:api` hangs on "Waiting for DynamoDB" / `db:up` fails.** Docker Desktop
  isn't running (`docker info` should succeed).
- **Port 3001/3002 already in use.** A previous harness (or an old process) is
  still bound — stop it before `npm run dev`.
- **Local data table errors after a schema change.** Wipe and recreate:
  `docker compose -f docker/docker-compose.yml down -v && npm run db:up && npm run db:init`.
