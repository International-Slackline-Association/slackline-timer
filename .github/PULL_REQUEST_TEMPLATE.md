<!--
The PR title becomes the squash commit's subject on `main`, so write it as a
Conventional Commit: feat(web): add athlete admin table
-->

## What and why

<!-- What changes, and what problem it solves. Link the issue: Closes #123 -->

## How it was verified

<!-- Which tests cover it, and anything driven by hand (a timer cycle, an
     overlay in OBS, a gamepad button). -->

## Checklist

- [ ] Behaviour is covered by a test that failed before the change.
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass locally.
- [ ] Operator-visible behaviour: `doc/user/` is updated (it ships at `/help`).
- [ ] Protocol change: both ends of the WebSocket union are in sync.
- [ ] Infra change: `server/scripts/decommission/stacks.json` is current.
- [ ] No real athlete data, credentials or account-specific config committed.

<!-- The full Definition of Done is doc/dev/workflow.md. -->
