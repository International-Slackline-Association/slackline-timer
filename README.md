# slackline-timer

A real-time race timer and live result system for slackline speed and freestyle
competitions, built for the International Slackline Association. It times the
runs, records the results, ranks the field automatically, and puts all of it on
screen — in the venue and on the broadcast.

An operator drives a **control** page in one browser tab; spectators, judges and
the broadcast watch **preview** and **overlay** pages. Every surface stays in
sync over a WebSocket relay. Two timer modes are supported:

- **Speedline** — a dual stopwatch with a race-start signal-light sequence, for
  Speed Highline head-to-head racing.
- **Freestyle** — a countdown clock with a five-component score sheet.

On top of the relay, the backend persists competitions, athletes, times, scores
and brackets. **Rankings are computed from the recorded results** — per round,
gender and discipline, with the tiebreaks and DNF handling the rules require —
and playoff brackets seed from qualification and advance their winners.
Read-only **broadcast overlays** (`/stream/*`) render the live standings,
head-to-head cards, brackets and winner cards, and are designed to be captured
directly as OBS Studio browser sources.

## Layout

This is a multi-package repository, **not** npm workspaces — each package has its
own `package.json` and `node_modules`.

| Path        | What it is                                                                        |
| ----------- | --------------------------------------------------------------------------------- |
| `web/`      | the frontend — Vite + React + MUI, deployed to S3 + CloudFront                    |
| `server/`   | the AWS backend — CDK: the WebSocket relay, the competition data plane, photo CDN |
| `doc/dev/`  | engineering documentation (architecture, decisions, workflow)                     |
| `doc/user/` | the operator manual, bundled into the app and served at `/help`                   |

The server holds **no timer logic** — it is a pure broadcast relay. All timing,
state and audio live in the browser.

## Getting started

```bash
npm ci && npm --prefix web ci && npm --prefix server ci
npm run dev           # LocalStack + the offline backend + the web dev server
```

`npm run dev` needs Docker running. The full local-development guide is
[`doc/dev/local-dev.md`](./doc/dev/local-dev.md); the architecture rationale is
[`doc/dev/architecture.md`](./doc/dev/architecture.md).

Repo-wide quality gates:

```bash
npm run lint
npm run typecheck
npm test
```

## Deployment

The backend deploys with AWS CDK and the frontend syncs to S3 + CloudFront; both
require an `AWS_PROFILE`. The cost backstop needs its alert address passed at
deploy time (`-c billingAlertEmail=<address>`) — it is deployment configuration
and is deliberately not committed. See [`doc/dev/deploy.md`](./doc/dev/deploy.md).

## Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](./CONTRIBUTING.md) has
the setup, the branch/PR flow and what reviewers look for; participation is
covered by the [Code of Conduct](./CODE_OF_CONDUCT.md).

Found a security problem? Please report it privately —
[`SECURITY.md`](./SECURITY.md). This system holds athlete data, so please never
test against the live production deployment.

## License

Copyright (C) 2026 Can Sahin, Simon Hiller.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. See [`LICENSE`](./LICENSE) for the full text.

Country flag assets in `web/src/app/flag-icons/` are vendored from
[flag-icons](https://github.com/lipis/flag-icons) and remain under their own MIT
license.
