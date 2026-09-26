# AGENTS.md — orientation for AI coding agents

Read this first, then the linked documents. Everything referenced here is in the
repository; if a path does not resolve, the reference is stale — fix it rather
than guess.

## What this system is

`slackline-timer` is a real-time race-timer and judging system for slackline
competitions, in two planes:

- a **WebSocket relay** for live sync between operator, audience and broadcast
  surfaces, and
- an **HTTP data plane** for persisted competitions, athletes, times, scores and
  brackets.

Three facts shape almost every change:

1. **The server holds no timer logic.** It forwards each message to the other
   connections in the same room. All timing, state and audio live in the
   browser. Do not move timing decisions server-side.
2. **`compId` is also the relay room key (`sessionId`).** Control, preview and
   overlay pages must share it to stay in sync.
3. **The message protocol's source of truth is
   `web/src/app/hooks/useWebSocket.tsx`.** Change a message shape and you must
   update sender and consumer together.

## Where to read, in order

| Document                                                                             | What it settles                                                      |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [`README.md`](./README.md)                                                           | what the project is, how to run it                                   |
| [`doc/dev/architecture.md`](./doc/dev/architecture.md)                               | data flow, the timing model, overlay sync, the data model            |
| [`doc/dev/decisions.md`](./doc/dev/decisions.md)                                     | the ADR record — **why** things are the way they are                 |
| [`doc/dev/workflow.md`](./doc/dev/workflow.md)                                       | branching, hooks, TDD, definition of done                            |
| [`doc/dev/local-dev.md`](./doc/dev/local-dev.md)                                     | the offline harness model and its runbook                            |
| [`doc/dev/design-system/design-system.md`](./doc/dev/design-system/design-system.md) | design tokens, the race-state colour language, overlay geometry (§7) |
| [`doc/dev/broadcast-overlays.md`](./doc/dev/broadcast-overlays.md)                   | how `/stream/*` pages are captured and composited                    |
| [`doc/dev/deploy.md`](./doc/dev/deploy.md)                                           | shipping to AWS                                                      |
| [`doc/user/`](./doc/user/)                                                           | the operator manual, served in-app at `/help`                        |

Before changing behaviour, check [`doc/dev/decisions.md`](./doc/dev/decisions.md) for an ADR that
already settles it. A constraint recorded there was usually paid for.

## Repository shape

Multi-package, **not** npm workspaces — each package has its own
`package.json`, lockfile and `node_modules`. Install and run scripts from within
the package, or with `npm --prefix <pkg>`.

- **`web/`** — React + Vite frontend. Routes: `/speedline/*`, `/freestyle/*`,
  `/admin/*`, `/stream/*`. Data access through React Query hooks in
  `web/src/app/api/`.
- **`server/`** — the AWS backend as CDK (`server/infra/slackline-stack.ts`),
  Lambda handlers in `server/src/functions/*`, shared logic in
  `server/src/core/*`.
- **`doc/dev/`** vs **`doc/user/`** — engineering reference vs the published
  manual. The split is a rule, not a convention.

## How to work here

- **Tests first, and tests stay green.** Suites live in each package's `test/`
  directory, mirroring the source tree, and import production code through the
  path aliases. Never weaken or delete an assertion to make a change pass — if a
  test is wrong, say so and fix it deliberately.
- **Run the gates from the repo root before you call anything done:**
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`.
- **Commits follow Conventional Commits.** `pre-commit` auto-fixes staged
  files, `commit-msg` enforces Conventional Commits, and there is no push
  hook: CI's required checks gate `main`, so run the gates yourself before
  calling work done. Never bypass a hook to get a commit through.
- **Match the surrounding code.** Comment density, naming and idiom are already
  established. Comments explain _why_ and record constraints — never narrate
  what the code plainly does.
- **When operator-visible behaviour changes, updating `doc/user/` is part of the
  job**, not a follow-up.

## Conventions that will bite you

- **Node `>=24`** in both packages.
- **Design tokens are enforced by ESLint in `.tsx`:** no raw hex colours and no
  `var(--tl-*)` inside React components — reach tokens through
  `theme.palette` or the imported `colors`/`fonts`. `var(--tl-*)` is for
  non-React CSS/SVG seams only.
- **Types are duplicated between `web` and `server`** (no workspaces). Change a
  round, discipline or entity shape and you must update both sides; parity tests
  will fail if you do not.
- **The auth seam is centralised in `web/src/app/auth/*`.** Do not scatter
  `LOCAL_DEV` branches through the codebase — each line in that seam selects a
  whole strategy module.
- **`doc/user/` pages may link only to sibling `doc/user/` pages or external
  URLs** — never to `doc/dev/` or source paths. The manual is read inside the
  app, where nothing else exists. A test enforces this.
- **Path aliases:** `web` resolves imports against `src` (`app/...`); `server`
  uses `@functions/*` and `core/*`.
- **Line endings are LF**, pinned by `.gitattributes`.

## Names that must not be renamed

The repository is `slackline-*` throughout, with deliberate exceptions bound to
deployed AWS resources. Renaming any of these is a migration, never a string
edit:

- **`SpeedlineTimerTable`** — the CloudFormation _logical id_ of the relay
  table, which is retained and deletion-protected. Changing it makes
  CloudFormation replace the resource and orphan live data.
- **`SPEEDLINE_TIMER_TABLE`** — the deployed Lambda environment key. It can only
  change as one atomic code-plus-deploy.
- **The retired entries in `server/scripts/decommission/stacks.json`** — these
  are real physical names of stacks that once existed. They are history, not
  identity.

Separately, **"Speedline" is the name of a timer mode** (dual-stopwatch speed
racing, as opposed to Freestyle countdown judging). Route paths, components,
protocol types and manual pages that use the word are domain vocabulary and are
correct as they stand.

## Running it locally

```bash
npm ci && npm --prefix web ci && npm --prefix server ci
npm run dev          # LocalStack + the offline backend + the web dev server
```

`npm run dev` needs Docker. The harnesses run the **real** Lambda handlers
in-process against LocalStack, so local behaviour does not drift from
production. `npm run dev:api` runs the backend half alone; `npm run db:up`,
`db:init` and `db:seed` manage the local database and demo data.

Local URLs use `127.0.0.1`, not `localhost` — the harnesses bind IPv4 and some
setups resolve `localhost` to `::1`.

## Deployment, in one paragraph

Backend stacks deploy to `eu-central-2`; Cognito and the web hosting live in
`eu-central-1`. Deployment configuration — the AWS profile and the cost-alert
address — is read from a git-ignored `.env.deploy` at the repository root; copy
[`.env.deploy.example`](./.env.deploy.example) to create it. Real secrets are
never in the repository: they live in SSM SecureString parameters and are
fetched at runtime. See [`doc/dev/deploy.md`](./doc/dev/deploy.md).
