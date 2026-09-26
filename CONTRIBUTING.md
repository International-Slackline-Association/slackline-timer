# Contributing to Slackline Timer

Thanks for helping. This is live-event software: when it misbehaves, it does so
in front of athletes, judges and a broadcast feed. That shapes everything below.

## Before you start

- **Bugs and features** — open an [issue](https://github.com/International-Slackline-Association/slackline-timer/issues)
  first. For anything larger than a fix, say what you intend to change before
  building it; some parts of the timing path are constrained in ways the code
  doesn't advertise (see [`doc/dev/architecture.md`](./doc/dev/architecture.md)).
- **Security problems** — do **not** open an issue. Follow
  [`SECURITY.md`](./SECURITY.md).
- **Conduct** — participation is covered by the
  [Code of Conduct](./CODE_OF_CONDUCT.md).

## Getting set up

Node 24+ and Docker are required. The repository is a **multi-package repo, not
npm workspaces** — each package installs on its own:

```bash
npm ci && npm --prefix web ci && npm --prefix server ci
npm run dev      # LocalStack + the offline backend + the web dev server
```

`npm run dev` needs no AWS account: it runs the real Lambda handlers against a
local container. The full guide is [`doc/dev/local-dev.md`](./doc/dev/local-dev.md).

## Making a change

1. Branch off `main` (`feat/…`, `fix/…`). Maintainers branch in this repository;
   everyone else forks.
2. **Write the failing test first.** TDD is the house style and the reason the
   timing code can be changed at all — see
   [`doc/dev/workflow.md`](./doc/dev/workflow.md).
3. Keep the branch small and single-purpose.
4. Run the gates before you push:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```

   The git hooks cover part of this: `pre-commit` auto-fixes staged files and
   `commit-msg` enforces Conventional Commits. Typecheck and tests run in CI
   on your PR, so run them locally first.

5. Open a pull request against `main` and fill in the template.

## Commit and PR titles

[Conventional Commits](https://www.conventionalcommits.org/): `feat(web): add
athlete admin table`, `fix(server): prune stale connections on 410`. PRs are
**squash-merged**, and GitHub seeds the squash commit's subject from the PR
title — so the **PR title must itself be a Conventional Commit**. That is what
keeps the history on `main` readable.

## What gets a change merged

`main` is protected: a PR needs a green CI run (lint/format, and typecheck +
tests + build/synth for both packages) and a maintainer's approval. Beyond that,
the Definition of Done in [`doc/dev/workflow.md`](./doc/dev/workflow.md) is the
checklist reviewers actually apply. The parts contributors most often miss:

- **Behaviour is covered by a test that failed before the change.**
- **Operator-visible behaviour updates the manual.** `doc/user/` ships inside
  the app at `/help`; a stale page there is a live-event problem, not a docs
  problem. A `doc/user/` page may link only to a sibling `doc/user/` page or an
  external URL — never to `doc/dev/` or a source path. A test enforces this.
- **Infra changes update the stack ledger** (`server/scripts/decommission/stacks.json`).
  A test enforces this too.
- **Never commit real athlete data.** `resources/seed/prod/` is git-ignored and
  stays that way; use `resources/seed/demo.seed.json` for anything shared.

## Where the answers live

| Question                                           | File                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| How does the realtime sync work, and why that way? | [`doc/dev/architecture.md`](./doc/dev/architecture.md)                               |
| Why is it built like this?                         | [`doc/dev/decisions.md`](./doc/dev/decisions.md)                                     |
| How do I run it locally?                           | [`doc/dev/local-dev.md`](./doc/dev/local-dev.md)                                     |
| How do the broadcast overlays get captured?        | [`doc/dev/broadcast-overlays.md`](./doc/dev/broadcast-overlays.md)                   |
| Colours, type, spacing                             | [`doc/dev/design-system/design-system.md`](./doc/dev/design-system/design-system.md) |
| How is it deployed?                                | [`doc/dev/deploy.md`](./doc/dev/deploy.md)                                           |

## Licence

By contributing you agree that your contribution is licensed under the
[GNU GPL v3 or later](./LICENSE), the licence covering this project.
