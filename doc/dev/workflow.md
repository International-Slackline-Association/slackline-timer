# Development Workflow

> **`doc/@work/`** holds the living project-management docs — `status.md` (the
> backlog), `plans.md` (per-item specs) and `human-tasks.md` (owner-only tasks).
> They are working state, not published with the source, so this repository does
> not carry them: references to them below are written as `@work/<file>` rather
> than as links. `doc/dev/` is the durable engineering reference and ships.

How we build Slackline Timer. The goal: every change is small, tested, and
reviewable, and `main` is always releasable.

## TL;DR

```bash
# one-time, per package
npm ci                      # root (installs husky + lint/format tooling)
npm --prefix web ci
npm --prefix server ci

# inner loop (TDD)
npm --prefix web run test:watch     # red → green → refactor
npm run typecheck                   # web + server
npm run lint                        # repo-wide eslint
```

Commits are linted (Conventional Commits), staged files are auto-fixed on
commit, and the full suite runs on push and in CI.

## Test-Driven Development

We work red → green → refactor:

1. **Red** — write a failing test that captures the desired behaviour. The test
   is the spec. Example: `web/test/app/util/time.test.ts` was written before
   `time.ts`, encoding the exact display rules ported from timertimer (incl. the
   `DNF` sentinel).
2. **Green** — write the minimum code to pass.
3. **Refactor** — clean up with the test as a safety net.

Guidance:

- **Pure logic first.** Timing math, ranking computation, key builders, parsers —
  these are pure and cheap to test exhaustively. Cover them before wiring UI/IO.
- **Test behaviour, not implementation.** Assert on outputs and rendered results,
  not internal calls.
- **Component tests** use `@testing-library/react` (`web/test/setup.ts` wires
  `jest-dom` + auto-cleanup). Query by role/text the way a user would — except
  behind an open MUI overlay, which `aria-hidden`s the page it covers and so
  hides it from every role query: reach the page under it through
  `web/test/behindOverlay.ts`.
- **Don't test the framework or AWS SDK.** Extract pure helpers (e.g.
  `server/src/core/keys.ts`) and test those; keep Lambda handlers thin.
- **Tests live in each package's dedicated `test/` directory**, mirroring the
  source tree: `web/src/app/util/time.ts` ↔ `web/test/app/util/time.test.ts`,
  `server/src/core/keys.ts` ↔ `server/test/core/keys.test.ts`. Shared setup
  sits at the test root (`web/test/setup.ts`). Import production code through
  the package's path aliases (`app/...` in web, `core/...` in server), never
  via `../../src/...` relative paths.

Run:

|               | command                              |
| ------------- | ------------------------------------ |
| web, once     | `npm --prefix web test`              |
| web, watch    | `npm --prefix web run test:watch`    |
| web, coverage | `npm --prefix web run test:coverage` |
| server        | `npm --prefix server test`           |
| everything    | `npm test` (from root)               |

## Code quality

- **ESLint** (`eslint.config.js`) + **Prettier** (`.prettierrc`) — Prettier runs
  _through_ eslint (`eslint-plugin-prettier`), so `npm run lint` also flags format
  drift. `npm run format:check` is the standalone format gate.
- **EditorConfig** (`.editorconfig`) — LF, 2-space, final newline.
- **TypeScript strict** mode is on in both packages; `npm run typecheck` must pass.
- **Exact deps** — `.npmrc` sets `save-exact=true`. Pin versions; no `^`.

## Git hooks (Husky)

Installed by `npm ci` at the root (`prepare` → `husky`).

| Hook         | Runs                                                    | Why                          |
| ------------ | ------------------------------------------------------- | ---------------------------- |
| `pre-commit` | `lint-staged` → eslint --fix + prettier on staged files | keep noise out of diffs      |
| `commit-msg` | `commitlint`                                            | enforce Conventional Commits |
| `pre-push`   | `npm run typecheck && npm test`                         | never push a red tree        |

Bypass only in emergencies with `--no-verify`, and fix forward immediately.

## Commit messages — Conventional Commits

`type(scope): subject`

- **types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`, `build`
- **scopes:** `web`, `server`, `ci`, `deps`, `docs`, `repo`
- subject ≤ 50 chars, imperative mood, no trailing period

```
feat(web): add athlete admin table
fix(server): prune stale connections on 410
test(web): cover DNF sentinel formatting
```

## Branching & merging

- **`main` is the mainline and is always releasable.** Branch off it
  (`feat/athlete-crud`, `fix/preview-clock-skew`); maintainers work in this
  repository, outside contributors from a fork.
- **Every change lands through a pull request, squash-merged.** `main` is
  protected: no direct pushes, no force-pushes, and CI must be green.

  ```bash
  git switch -c feat/athlete-crud main
  # …commit as you go; WIP commits are fine, the squash collapses them
  git push -u origin feat/athlete-crud   # pre-push hook: typecheck + test
  gh pr create --base main
  ```

  Squash-merging keeps one clean Conventional Commit per change on `main` and
  keeps WIP commits off it. **Set the squash commit's subject to a Conventional
  Commit** — GitHub defaults it to the PR title, so title the PR that way and it
  is correct by construction. The `commit-msg` hook lints local commits and
  `pre-push` blocks a red tree, but neither runs on GitHub's squash: CI and the
  PR title are the mainline's guard.

- Keep branches small and single-purpose; rebase on `main` before merging.
- CI (`.github/workflows/ci.yml`) runs on every PR targeting `main` and every
  push to it: repo-wide lint + format and per-package typecheck/test/build. The
  three jobs are required checks — a red PR cannot merge.
- Delete the branch after the merge (GitHub does it automatically).

The contributor-facing version of this section — fork, review expectations,
what to include in a PR — is [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Definition of Done

A change is done when:

- [ ] Behaviour is covered by a test that failed before the change.
- [ ] `npm run lint`, `npm run typecheck`, and `npm test` pass locally.
- [ ] **The data path is verified by a headless driver; only the realtime
      fan-out is smoke-tested by hand.** Changes touching the judge consoles
      (Speedline/Freestyle recorders) or the `/stream/*` overlays run the
      browser driver (`.claude/skills/timer-run-speedline-timer/`) — from that
      dir, `node driver.mjs judge-e2e` (see `doc/dev/judge-e2e-smoke.md`) for the
      record→persist→rank path, and `node driver.mjs overlays` for the overlay
      renders — a smoke that they render at all, not a fidelity diff: the LAAX
      reference composites they used to be compared against are not part of this
      repository (see design-system §7), and the behaviour that was load-bearing
      is pinned by `overlays.test.tsx` instead.
      **Any console/recorder UI change also re-runs the driver smokes
      that _drive_ the console — `realtime-recovery`, `freestyle-battle`,
      `display-signoff`, and `peer-mirroring` (the ADR 0038 two-tab pair) —
      not just the realtime/WS changes that own them.**
      A scenario is green on **zero FAIL, never on a fixed total** — most print
      a stable count, but `realtime-recovery`'s floats (74-79) because its
      `request_state` handshake legs assert only when a control panel happened
      to be in the room to hear the ask (each page backs off independently, ADR
      0024; the room re-converges either way, since every sender queues its own
      frames while its socket is down). Read the FAIL list, not the numerator.
      Those smokes step through the console UI (selecting round/gender/match,
      recording), so a console-only edit can silently break them: ADR 0033
      round-scoped the match dropdown and quietly broke `judge-e2e`, caught only
      later when `realtime-recovery` was built. A UI edit that "can't affect
      realtime" still owes this suite. That leaves only the **un-automatable
      realtime WS fan-out** as the genuine by-hand obligation: anything touching
      the WS protocol, timers, or sync runs once against `npm run dev` with a
      control and a preview tab side by side — the live relay loop, beeps,
      physical-gamepad polling, and backgrounded-tab throttling have no
      automated coverage. Keep both ends of the protocol in sync
      (`useWebSocket.tsx` is the source of truth).
- [ ] No new `any` without justification; no dead/commented-out code left behind.
- [ ] Public functions have a short doc comment when intent isn't obvious.
- [ ] Docs updated when behaviour or setup changed (`AGENTS.md`, this file, and
      `doc/user/` when operators see the change).
- [ ] **The published manual updated when something an operator _sees_ changed**
      — a console control, a button mapping, an admin field, an overlay link.
      `doc/user/` is shipped to operators at `/help`; a stale page there is a
      live-event problem, not a docs problem. Keep the linking rule
      (`@work/status.md` §0): a user page never links into `doc/dev/`.
- [ ] **Infra change: the stack ledger is current.** Adding/renaming a CDK stack
      or a `RemovalPolicy.RETAIN` resource updates `server/scripts/decommission/stacks.json`
      (a live/planned entry per synthesized stack + its RETAIN/orphan resources).
      `test/infra/stack-ledger.test.ts` enforces this — it fails if the ledger
      drifts — so the record of what each stack owns and how it is torn down is
      never lost to a code change.
- [ ] CI is green on the pull request.

## Deploy / release

Deploys are manual, per package, and **order matters**. Both need `AWS_PROFILE`.

```bash
cd server && npm run deploy   # cdk deploy (eu-central-2 / prod); first run: npm run deploy:guided
cd web    && npm run deploy   # eslint + vite build + sync dist/ to S3 + CloudFront bust
```

Rules:

- **Auth/protocol changes ship as a set.** The first deploy is the example: the
  `timeradmin` group + Hosted-UI app client must exist in the pool _before_ the
  new authorizer deploys, and server + web go out together — deploying one side
  alone locks every operator out (runbook: [`deploy.md`](./deploy.md)).
- **Backend first, frontend second** for additive changes (new HTTP API
  routes, new message types): the server can serve an endpoint nobody calls;
  the web must never call an endpoint that isn't there.
- **Never deploy a web build with `VITE_APP_LOCAL_DEV=true`** — it disables the
  UI auth gate. `vite build` doesn't read `.env.development`, but don't set it
  in the shell either.
- **Post-deploy smoke:** open a prod control + preview pair, run one full
  timer cycle (start light → start → stop → reset). Two minutes, catches what
  unit tests can't.

## CI pipeline

`.github/workflows/ci.yml` on every PR targeting `main` and every push to it:

- **quality** — `npm ci` at root, `eslint .`, `prettier --check`.
- **web** — `checkTs` → `test:coverage` → `build`, uploads coverage artifact.
- **server** — `checkTs` → `test:coverage` → `synth` (`cdk synth`, the
  deploy-path gate — the aws-cdk CLI ships as a devDependency so `npm ci`
  provides it; run locally from the repo root with `npm run synth`).

Runs cancel superseded ones on the same ref; everything pinned to Node 24 — the
same baseline as `engines.node`, the `dev:check` pre-flight, and the Lambda
runtime, so CI cannot pass on a version the deploy target doesn't run.
