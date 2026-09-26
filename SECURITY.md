# Security Policy

Slackline Timer runs competition scoring and holds athlete data, including
personal details and photographs. Vulnerabilities here can affect real people
and real results, so please report them privately.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security
problem.**

Use one of these instead:

1. **GitHub private vulnerability reporting** — the "Report a vulnerability"
   button under this repository's
   [Security tab](https://github.com/International-Slackline-Association/slackline-timer/security).
   This is the preferred route: it opens a private thread with the maintainers.
2. **Email** — <info@slacklineinternational.org>, with `slackline-timer
security` in the subject.

Please include what you can: the affected component (web app, WebSocket relay,
HTTP data plane, photo pipeline, deploy tooling), steps to reproduce, the impact
you believe it has, and any log output or request/response pairs. A minimal
proof of concept helps more than a scanner report.

We will acknowledge your report and tell you whether we can reproduce it. If a
fix is needed we will keep you updated as it is prepared and released, and we
are happy to credit you in the release notes unless you would rather stay
anonymous.

## Please do not

- **Test against the live production system.** It is used for actual
  competitions; a disrupted event cannot be re-run. Reproduce locally instead —
  `npm run dev` stands up the whole backend against a local container with no
  AWS account required (see [`doc/dev/local-dev.md`](./doc/dev/local-dev.md)).
- Access, modify or exfiltrate athlete data that is not yours.
- Run load, stress or denial-of-service tests against any deployed environment.

## Scope

In scope: this repository's source, its infrastructure definitions
(`server/infra/`), its GitHub Actions workflows, and the deployed application
operated by the International Slackline Association.

Out of scope: vulnerabilities in third-party services and dependencies (report
those upstream; tell us too if this project is exposed), findings that require a
compromised operator device or browser, and missing hardening that has no
demonstrable impact.

## Supported versions

This is a deployed application, not a distributed library. Only the current
`main` branch and the running production deployment are supported; fixes ship
forward rather than as patches to older states.

## Handling of secrets

No credentials belong in this repository. Runtime secrets live in AWS SSM
SecureString parameters and are fetched at runtime; deploy configuration lives
in a git-ignored `.env.deploy` (template: `.env.deploy.example`). If you find a
committed credential, treat it as a vulnerability and report it via the routes
above — do not open an issue.
