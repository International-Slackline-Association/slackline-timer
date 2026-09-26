# Judge + live-stream data-path e2e smoke

The repeatable headless control+preview driver that certifies the **judge
result-recording** success path on both planes, against real data instead of
blank-data shots.

Where the retired overlay visual signoff eyeballed _fidelity_ against the LAAX
reference art — client-delivered material that is not part of this repository,
see [`design-system/design-system.md` §7](./design-system/design-system.md) —
this one asserts the timer/scoring consoles actually **persist** results and the
live stream **reflects** them.

## Why it lives in `.claude/`, not here

The browser driver (`.claude/skills/timer-run-speedline-timer/driver.mjs`, the
`judge-e2e` subcommand) is Claude Code tooling — the whole `.claude/` tree is
git-ignored (`.gitignore` line `.claude/`) and out of the lint/typecheck/test
gates. This doc is the **version-controlled record** of the harness: what it
certifies and how to re-run it. The driver is the executable; this is the spec.

Unblocked by `local-dataplane-harness-for-ci` (the local HTTP harness boots the
data plane headlessly) — see [`decisions.md` 0023](./decisions.md).

## Run it

```bash
# 1. Bring up the whole local stack. Needs Docker; `npm run dev` starts the
#    LocalStack container and provisions the tables + bucket via `dev:api`.
npm run dev            # Vite :5173, relay :3001, HTTP API :3002 (see doc/dev/local-dev.md)

# 2. Drive the e2e (self-seeds an isolated `judge-e2e` comp — no db:seed needed).
cd .claude/skills/timer-run-speedline-timer
npm install            # once: puppeteer-core, system Chrome/Edge
node driver.mjs judge-e2e
```

Each assertion prints `PASS`/`FAIL` with a one-line reason; the run exits
non-zero on any failure. The driver self-seeds a fresh `judge-e2e` competition
(two female athletes + one seeded `final/female` speed Match) and clears it on
each run, so it is independent of `npm run db:seed` and repeatable.

## What it certifies — the checklist

### Speed (timer console, `/speedline/control` + `/speedline/preview`)

- [ ] Selecting the seeded `final/female` **Match fills both lanes** (+ round/gender).
- [ ] The assigned lane **`shortName` mirrors to the preview** over `updateLaneNames`.
- [ ] An **aborted start** (the pre-GO Abort Start button mid-sequence) **records
      nothing** — and, per rule S4, never stops a lane (ADR 0035).
- [ ] A clean heat raises the **saved-chip** and the **success toast**.
- [ ] A **Time is POSTed** for each assigned lane (and only with an athlete — a
      stop on cleared lanes records nothing).
- [ ] A **mid-run reconnect** (a late preview tab opened while lanes are running)
      resyncs via `request_state` / `state_snapshot` — never blank.
- [ ] **Void run** deletes the run's Times **and** decrements the best-of-3 tally.
- [ ] A **hand-timer correction** PUTs the new `timeMs` and **re-derives the match winner**.

### Freestyle (scoring console, `/freestyle/control`)

- [ ] **`overall` computes when blank** (the four components minus the penalty)
      and **honours a typed override**.
- [ ] **Discipline scopes the Match list** — the speed Match is absent from the
      freestyle plane (separate brackets over one athlete pool).
- [ ] Both players' **Scores are POSTed**.
- [ ] Freestyle **rankings sort by `overall` DESC**.
- [ ] A `/stream/rankings?discipline=freestyle&token=…` overlay renders
      **read-only** (read token, no Cognito) and **refreshes live** on `db_update`
      (a Score upsert updates the overlay without a reload).

## On a failure

This item is the verification _harness_, not the fixes. A `FAIL` is either a
stale **driver assertion** (fix it in the driver) or a real **behaviour gap** on
the certified data path — decide which, and for a genuine gap **file it as its
own fix item** in `@work/status.md` / `@work/plans.md`, fix it
there, then re-run `judge-e2e` to confirm green.

The first live run-and-reconcile pass (`judge-e2e-live-stack-run`, 2026-07-02)
found **every check green** and surfaced **no app behaviour gaps** — every
discrepancy was a stale driver assumption, corrected in the driver:

- the athlete seed lacked the now-required `birthDate` (ADR 0016) and used
  hard-coded past dates (the read-token event window had expired) — the seed now
  sends `birthDate` and anchors the competition window to "now";
- the Gender/Round pickers are MUI **menu** selects (not native), and the
  category label is "Men"/"Women" (not "Male"/"Female") — the select helper
  gained a menu fallback and the option text was corrected;
- the start sequence now opens with a **T-5s pre-beep** (GO ~5s after Start), so
  a fixed post-Start wait clicked Stop before the lanes ran — the driver now
  waits on the lane **Stop button** enabling, and re-arms Start (a completed
  heat leaves it disabled until Reset — `reset series` only clears the tally).
