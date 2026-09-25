# Decision log

Significant, settled decisions. Don't rewrite an entry when a choice is
revisited — add a new one and mark the old `superseded by NNNN`. An entry whose
**every** clause is fully superseded (nothing in it still constrains the
system, and its salvage lives on the superseder) is **deleted**, its number
retired and listed below — git history is the record. Each entry records the
forces (Context), the call (Decision), and what we accepted (Consequences).
Implementation-level trade-offs for not-yet-built features live with their
spec in `@work/plans.md`; the architectural end-state these produced
is described in [`architecture.md`](./architecture.md).

Format: `NNNN — title` · Status · Date.

> **Retired numbers** (deleted, never reused): `0008` (→ 0023), `0018` (→ 0019)
> — removed 2026-07-20; `0020` (→ 0023 §2) — removed 2026-09-25.

---

## 0001 — Extend the existing AWS serverless backend for persistence

**Accepted · 2026-06-12**

**Context.** The competition data plane (athletes/times/matches) had to land
somewhere. timertimer used a GenServer + SQLite; we have a Serverless v3 WS relay.

**Decision.** Add a new HTTP API (API Gateway + Lambda) and a new DynamoDB table
alongside the relay, rather than introducing a new runtime. The WS relay stays
exactly as-is.

**Consequences.** One deploy toolchain, one IAM model. DynamoDB's single-table
constraints (no aggregation, no FKs, immutable SK) become our design problem —
see ADR 0006 and `architecture.md`.

## 0002 — Competitions are explicit

**Accepted · 2026-06-12**

**Context.** The relay accepts any `sessionId` as a room key. Persistent data
needs a stronger identity so writes can't scatter under typos.

**Decision.** A competition is created in the admin UI as a `COMP#<compId>` /
`META` item; write Lambdas reject unknown `compId`s. `compId` doubles as the
relay `sessionId`.

**Consequences.** Writes validate against `META`. The free-form relay room key
still works for live timing, but only registered competitions persist data.

## 0003 — Overlay read auth = event read token

**Accepted · 2026-06-12** · revocation made instant on the live feed too by 0026
(a `tokenVersion` bump now also force-closes open reader sockets); reader reads
narrowed to broadcast-safe fields by 0022 (b)

**Context.** OBS/H2R streaming overlays (`/stream/*`) can't perform an
interactive Cognito sign-in, but the preview/data surfaces are gated.

**Decision.** Overlays authenticate with a signed (HMAC, secret in SSM),
**read-only, competition-scoped** JWT carried in the URL, `exp ≤ ~10 days`,
accepted by both the HTTP API and the WS `$connect`. Minted by an admin-only
`createReadToken` Lambda; revoked by bumping `tokenVersion` on the competition.

**Consequences.** A query-param token can leak (logs, screenshots) — accepted for
a read-only, comp-scoped, short-lived, instantly-revocable credential; Lambdas
must not log full query strings. Read-only WS connections are dropped by
`messageHandler` so a leaked token can't inject timer messages.

## 0004 — Custom Lambda authorizer over the native Cognito JWT authorizer

**Accepted · 2026-06-12**

**Context.** Operator access requires the `timeradmin` group, and the API must
also accept the read token (ADR 0003).

**Decision.** One small custom Lambda authorizer for both the HTTP API and WS,
reusing the relay's `aws-jwt-verify` code.

**Consequences.** API Gateway's native Cognito authorizer can only assert
`authorizationScopes` against a `scope` claim (absent on an IdToken) and **cannot
check `cognito:groups`** — so `timeradmin` isn't expressible natively, and a
custom authorizer was needed regardless to accept the second credential type.

## 0005 — Photos: CloudFront signed URLs, bucket never public

**Accepted · 2026-06-12** · relaxed for the **local dev container only** by
0023 §2 (public-read LocalStack bucket, unsigned object URL — prod unchanged)

**Context.** Athlete photos exceed practical DynamoDB item size and must not be
publicly enumerable, but overlays need to render them without a login.

**Decision.** Store the blob in S3 under a content-hashed key; lock the bucket to
CloudFront via Origin Access Control + trusted key group; read Lambdas embed a
CloudFront-signed `photoUrl` expiring at `competition.endDate` (≤ ~10 days).

**Consequences.** No public bucket, no cleanup job — URLs die at the edge after
the event. Chosen over S3 presigned GETs (capped at the Lambda role-session
lifetime) and a token-gated Lambda proxy. Mid-event revocation is coarse
(key-group rotation kills all events' URLs); accepted — `tokenVersion` still
covers data reads.

## 0006 — Server-side `db_update` broadcast for live refresh

**Accepted · 2026-06-12**

**Context.** Streaming overlays must refresh when data changes — the analogue of
timertimer's `"db"` PubSub topic.

**Decision.** Every write Lambda broadcasts `db_update` into the relay room via a
`core/broadcast.ts` extracted from `messageHandler`; clients invalidate the
matching React Query keys. Emission is **server-side**, not from the browser.

**Consequences.** The refresh is a server guarantee — a client-fired message
would be lost if the tab died between write and send, leaving overlays stale.

## 0007 — Web sign-in = ISA Hosted UI; operator group = `timeradmin`

**Accepted · 2026-06-12** · the group's _meaning_ is narrowed by 0045 (the
Hosted-UI sign-in stands; `timeradmin` now marks a global **superadmin**, not
the admission bar — any verified ISA login is a comp-scoped manager)

**Context.** Operators already have ISA logins (`isa-users`); maintaining a second
embedded auth form is redundant.

**Decision.** Sign in via the shared ISA Cognito Hosted UI
(`signInWithRedirect`, `auth.slacklineinternational.org`) instead of an embedded
`<Authenticator>`; the operator group is **`timeradmin`** (renamed from the
earlier `organizers`).

**Consequences.** One ISA login across apps; `@aws-amplify/ui-react` dropped.
Keep the client gate, `constants.ts` `TIMER_GROUP`, the stack's
`COGNITO_TIMER_GROUP`, and the pool's actual group name in sync. [As of 2026-07
the constant lives in the `COGNITO` block of `server/infra/slackline-stack.ts`
(`serverless.ts` is gone — ADR 0023), and the gate component is
`RequireSignedIn`, renamed from `RequireGroup` when 0045 turned the group from
an admission check into a superadmin marker.]

## 0009 — Speed/freestyle discipline split over a shared athlete pool

**Accepted · 2026-06-17**

**Context.** A competition runs both speed and freestyle, but they rank and
bracket independently.

**Decision.** Add a `discipline` enum (`speed | freestyle`), discipline-first on
the Match SK (`MATCH#<discipline>#…`). Times are the speed plane, Scores the
freestyle plane; rankings/matches/overlays filter by discipline; one athlete
pool feeds both.

**Consequences.** Two independent brackets without duplicating athletes. The new
enum is duplicated web↔server and parity-tested like the round enums.

## 0010 — Freestyle `overall` is one shared formula, ranked descending

**Accepted · 2026-06-17** · field renamed `composition` → `combo` by 0040

**Context.** Freestyle is judged on five components and must produce one ranked
score; the formula has to agree on web and server.

**Decision.** `overall` = `difficulty + composition + style + bestTrick −
controlPenalty` when left blank (an explicit value overrides it); ranked
**descending**. `computeOverall` is the single shared formula, duplicated
web↔server and parity-tested. One Score record per athlete+round — the SK is the
identity, so a re-submit is an idempotent upsert.

**Consequences.** Consistent totals across entry, admin, and overlays; no
server-side recompute drift.

## 0011 — Timer state recovery is peer-to-peer; the relay stays stateless

**Accepted · 2026-06-22** · single-owner premise revised by 0038 (the
request/reply flow stands; any control panel may now answer as an owner) ·
extended by 0047 for the **solo** panel, where no peer exists to answer (a
browser-local copy of the panel's own snapshot; relay statelessness untouched)

**Context.** The relay persists nothing (the "server holds no timer
logic" invariant — the former ADR 0008, now carried by 0023), so a preview/overlay that connects _after_ an operator
action — a projector reload, an OBS source restart, or a `shouldReconnect` drop
— renders a blank/idle timer until the next action. The realtime path had no
recovery.

**Decision.** Recover via request-reply between peers: on (re)open a preview emits
`request_state`; the control page (the sole owner of live state) replies with a
`state_snapshot` the preview applies. No server change, no message buffer, no
new DynamoDB. Two snapshot shapes (`SpeedlineSnapshot` epoch start/stop per lane,
applied directly; `CountdownSnapshot` carries
`remainingMs` adjusted for wall-clock elapsed at send). The snapshot is strictly
lower-priority than a live message that arrived since open (a guard ref), so it
never overwrites newer truth. These unions are web-only — the relay forwards
opaque JSON — so no web↔server parity change.

**Consequences.** The relay stays a dumb broadcast. A recovered running
Speedline lane resumes ticking from its control-start epoch (the clock-skew
sync this once referenced is gone — ADR 0021); a recovered running Freestyle
countdown can drift ~1s (no epoch timing). The pure snapshot helpers
(`app/util/timerSnapshot`) carry the unit-tested logic; the handshake itself is
covered end-to-end by the browser driver's `realtime-recovery` scenario.

## 0012 — Freestyle DNF ranks below 0.0, still in the field

**Accepted · 2026-06-23**

**Context.** The speed plane encodes attempted-and-failed via the `3_355_550`
`DNF_SENTINEL` — a very large elapsed time that sorts last but keeps the athlete
in the field, distinct from "no Time at all" (excluded by the inner join). The
freestyle judged plane had no equivalent, so a fall was indistinguishable from a
genuine low `overall` (ADR 0010).

**Decision.** Add an opt-in `dnf?: boolean` to the `Score` (duplicated
web↔server, optional-spread so a non-DNF never stores the attribute). A DNF
mirrors the speed sentinel verbatim: it stays in the ranked field but sorts
**strictly below every finite `overall`, including `0.0`** (ties broken by
name), via a `-Infinity` ranking key computed in the comparator only — the
stored Score keeps its real components. Athletes with no Score stay excluded.
The operator marks DNF with a per-player button on the live Freestyle console
(matching the speed timer's `recordDnf`); the Admin ScoreForm gets a checkbox for
the correction path. Renders "DNF" across rankings/overlays/admin.

**Consequences.** A freestyle fall is now visible and stays in standings instead
of hiding as a low score; cross-plane consistency with the speed sentinel. The
stored `overall` is meaningless when `dnf=true` (operator may send zeros) —
ranking ignores it, but any future consumer reading raw `overall` must check
`dnf` first.

## 0013 — Recorded results link to their match and define its winner (both planes)

**Accepted · 2026-06-23**

**Context.** `save-result-to-match` let the speed console derive a match winner
from the recorded elapsed times, but the link was indirect (a `winnerId` PUT
only) and the recorder's round/gender/athlete selects were decoupled from the
selected match — so a result could be filed inconsistently with the match it was
meant for. The freestyle plane had no match awareness at all. The match a result
belongs to needs to be unambiguous on both planes, and the recorded result —
not a separate manual pick — should decide the match.

**Decision.**

1. Selecting a match in the timer console **auto-fills** the lane/player athletes
   and syncs `round`/`gender` from the match (athlete1 = lane/player 1).
2. Add an explicit, optional **`matchId`** to both `Time` and `Score` (a
   non-key attribute; SKs unchanged, no GSI), duplicated web↔server and
   parity-tested, optional-spread like `Score.dnf` (ADR 0012). The recorded entry
   thus names its match directly, not only via shared `(round, gender, athlete)`.
3. The recorded **result defines the winner**: speed = faster `timeMs`
   (`DNF_SENTINEL` loses); freestyle = higher **`overall`**, using the computed
   value (`computeOverall`, ADR 0010) when the operator leaves the override blank
   and the typed value when set, `dnf` loses; a tie writes no winner. Derived in
   the browser recorder once both sides have a result this session and PUT onto
   the match. A freestyle player's result is finalised by the **Save** button
   (judges' components entered) or **DNF** — not the countdown reaching zero, which
   records nothing. Each Save/DNF re-derives the winner from the latest scores
   (idempotent), so a corrected re-save recalculates and re-PUTs `winnerId` (and
   may flip it) rather than being ignored as already-recorded.

**Consequences.** A result is unambiguously tied to one match even when an athlete
has several entries in a round, and the bracket advances off the recorded numbers
rather than a manual winner pick. Costs: a data-model field across web+server
(parity + create Lambdas + `competitionDb`) and a freestyle winner derivation that
must track "both players scored this match" via a per-match accumulator (Scores
are idempotent upserts with no per-run reset, unlike speed's lane stops). Storing
`matchId` does **not** make results queryable by match — that's deferred; the
winner is derived in-session, and `matchId` is provenance for now. Chosen over the
lighter implicit `(round, athlete)` association (rejected: silently ambiguous and
not auditable when an athlete has multiple results in a round).

## 0014 — The control board distributes its selection; overlays consume it

**Accepted · 2026-06-24**

**Context.** Two open backlog items converged on the same missing piece. The VS
overlay's "which match is live?" default fell back to bracket `position` (first
without a winner), and `match-recency-timestamp` proposed adding a `Match.updatedAt`
across the stack purely to break that tie by recency. Separately, the `svo-overlay`
proposal specified a single-athlete card with a `:type=intro|result` split, a
`round`, and a rankings/rank lookup — re-deriving from the URL what the operator
already knows at the control board. The operator's live selection (round, gender,
match, the two lane/player athletes) existed only on the control page; overlays
had no way to follow it without re-guessing.

**Decision.** The control board **broadcasts its current selection** over the
relay via one new, relay-only `updateSelection` WS message (a shared
`LiveSelection` on both the Stopwatch and Countdown unions; no server, DynamoDB,
or serverless change — the relay forwards it like every other message). Both
control pages push it on every selection change and on sender-socket OPEN,
mirroring the existing `updateLaneNames` re-push, so a late-joining overlay still
gets it. `StreamLayout` exposes the latest selection on its render-prop ctx (the
overlay's single relay socket already open for `db_update` now also tracks it —
no second connection). Consumers:

1. **VS overlay** match precedence becomes **explicit `&match=` > board's
   `selection.matchId` (when in the round) > first winner-less match by bracket
   position**. The bracket fallback stays as last resort so a fresh overlay
   isn't blank before the board pushes.
2. **SVO** splits into **SVO-A** (`/stream/svo/:athleteId`) — a pure identity
   card (photo + flag + name), and **SVO-B** (`/stream/svo-live/:side`) — the
   live, board-driven card that adds the discipline result for the board's round.

**Consequences.** `match-recency-timestamp` is **superseded, not built** — no
`updatedAt`, no types/parity change; the overlay follows the operator's actual
choice rather than inferring it. The SVO param set is **trimmed** versus the
proposal: SVO-A drops `:type`, `round`, `discipline`, and the rank lookup
(identity is round/discipline-agnostic; the "result" case is SVO-B's job, fed by
the board not the URL), and `:name` became the honest `:athleteId`. `compId`
stays required on every athlete read because an athlete is the pair
`(compId, athleteId)` — `athleteId` is a standalone `randomUUID()` that does not
embed `compId` (it is the DynamoDB PK + read-token scope). The one cost is a new
message both control ends must keep pushing; the socket wiring is covered by the
browser driver rather than unit tests, and `pickMatch` plus the overlay renders
carry light tests.

## 0015 — Freestyle warm-up is a third countdown channel; breaks extend the per-lane machine

**Accepted · 2026-06-24** · §2 (breaks) revised by 0019 and then **narrowed to
quali-only, advisory-only by 0036** (the enforced battle break retires for a
judge-facing pause count-up) · §1 (warm-up) stands, its re-arm chip becoming a
≥44 px button per 0046 §3 · §3 expiry tones split four ways by 0046 §3, and its
"both surfaces" rule narrowed for a second control board by 0046 §5

**Context.** The Freestyle mode is a bare two-player countdown. A real
highline-freestyle heat (reference: [AugustinMoinat/FreestyleTimer]) needs two
run-format pieces it lacks: a **warm-up** clock before the run, and **in-run
breaks** during a performance. The question for each is how it folds into the
existing per-player `Countdown` machine, the relay-only `CountdownWSMessage`
union, and the peer-to-peer state recovery (`CountdownSnapshot`) — without a
server change (the relay forwards opaque JSON; ADR 0011 keeps it dumb). The
two pieces have different shapes, so they integrate differently.

[AugustinMoinat/FreestyleTimer]: https://github.com/AugustinMoinat/FreestyleTimer

**Decision.**

1. **Warm-up = a third, shared countdown channel (`timerId: 0`)** reusing the
   _existing_ `start_countdown`/`stop_countdown`/`reset_countdown` messages and
   the `CountdownSnapshot.timers[]` array verbatim — **no new protocol**. A
   warm-up is just a countdown that happens to be shared and long, so it is
   modelled as one, not overloaded onto the per-player lanes. One shared clock
   for the heat (not per-player), default 300 s, operator-configurable; rendered
   as a single centered **WARM-UP** hero (the existing `Countdown` display,
   `timerId 0`) above the two lanes, with **WARM-UP OVER** at expiry. It runs
   **independently** of the lane mutual-exclusion (`runningTimerId` gates only
   lanes 1/2), and is **not** a gate on starting a performance — operators are
   trusted, as everywhere else.
2. **Breaks extend the per-lane state machine** (`running → onBreak → running`),
   because a break is a _sub-state of one running lane_ carrying extra per-lane
   data (a held run remaining + a break clock + a `breaksLeft` counter) — it is
   not a separate lane, so it cannot reuse the channel trick. This adds **new
   messages** `start_break` / `end_break` to the `CountdownWSMessage` union and
   **optional per-timer snapshot fields** (`onBreak`, `breakRemainingMs`,
   `breaksLeft`) so a mid-break reconnect recovers. Defaults: **2 breaks × 30 s**
   per lane (constants first; config UI deferred). Taking a break freezes the run
   remaining and starts the break clock; **resume is manual** (the break clock
   reaching 0 beeps and clears the break, but the operator presses Start to
   resume the run — matching the reference). A new gamepad button takes a break.
3. **Audio plays on both control and preview** (reusing `useSignalAudio`): short
   beep on warm-up/break start, long beep on any expiry (warm-up, break, or a
   performance lane). Each surface plays off the events it already processes
   (control off its actions + its local `Countdown` expiry; preview off the
   received `start_countdown`/`start_break` + its local expiry), so no new
   audio-sync message is needed.

The union changes are **web-only** — the relay forwards opaque JSON, so there is
no web↔server parity change (unlike the data-model ADRs 0012/0013).

**Consequences.** Warm-up is near-free (no new message types; the snapshot array
just gains `timerId 0`), at the cost of a `Countdown` `onExpire` callback and an
independent-of-`runningTimerId` warm-up control. Breaks are the larger change:
the `Countdown` component grows an on-break render (greyed held run + break clock

- "n left") and a second local tick, the recovery snapshot must classify an
  on-break lane, and a new pure `app/util` break-state helper carries the testable
  logic (mirroring `timerSnapshot`/`raceTime`). A recovered running warm-up
  inherits the same ~1 s drift as any recovered running countdown (ADR 0011).
  Battle-mode "elapsed time between rounds" is **out of scope**, filed as its own
  backlog item.

## 0016 — Athlete name is `firstName` + `lastName`; `name` is derived, `shortName` optional

**Accepted · 2026-06-25**

**Context.** The LAAX athlete cards render the given name **bold** over the family
name **light**, so the card needs the two parts separately — string-splitting a
single `name` at render time is fragile (mononyms, particled surnames). The
`Athlete` type is duplicated web↔server and read by ~26 consumers.

**Decision.**

1. **`firstName` + `lastName` are the source of truth**; **`name` stays as a
   derived `${firstName} ${lastName}`** attribute, computed at validation time
   and stored on write. Keeping `name` (vs dropping it) avoids touching every
   list/label/ranking consumer and gives the fallback chains a single stable
   string — the lower-drift choice given the blast radius.
2. **`shortName` becomes optional** (`shortName?`), stored only when non-empty.
   Short display falls back **`shortName` → `lastName` → `name`** (lane names,
   bracket plates).
3. **Migration is lazy, no backfill.** The athlete validator accepts **either**
   explicit `firstName`/`lastName` **or** a legacy `name` (split on the first
   space — first word given, remainder family, empty family allowed only via
   this path). `itemToAthlete` applies the same split to pre-split DynamoDB rows
   on read, so old records self-heal and existing API clients keep working.

`firstName`/`lastName`/`name` are non-key attributes (athleteId is the SK), so
edits are plain in-place puts — no delete+put SK dance. The split rule
(`splitName`/`fullName`) is duplicated web↔server like the rest of the type.

**Consequences.** Unblocks the bold-first/light-last card treatment in
`Competitor`, the bracket profile/name plates, and the SVO cards. No SK or
parity-enum change (the name fields are not in any sort key).

## 0017 — Speed best-of-3 is recorder-session state; only `winnerId` persists

**Accepted · 2026-06-25** · §2's tally is **re-keyed from lane to athlete by
0044** (athletes switch sides between runs; the lane `{1,2}` shape survives as a
projection through the live pairing) — §1, §3 and §4 stand

**Context.** A real speed match is decided **best of 3 runs** (first lane to win
two runs takes the match), not a single race. Today a speed match is one run: the
operator selects a Match, runs the lights, each lane's stop POSTs a `Time`, and
once both lanes have a result `deriveMatchWinner` PUTs the faster lane's athlete
as `Match.winnerId` (ADR 0013). The open question is how the three runs are
modelled — the `round` enum is the bracket stage (`quarter…final`), **not** a run
index, so best-of-3 is a new dimension. Verified in code before deciding:

- Bracket advancement (`server/src/core/bracketProgression.ts`) keys **only** off
  `Match.winnerId` — it never reads run counts. The downstream feeds need exactly
  one winner per match, however that winner was decided.
- Rankings derive from `Time` records by `(round, athleteId)` taking the **best**
  time (the speed plane); they do not distinguish runs.
- The per-run lane results already live in `useRaceRecorder` as an ephemeral
  `laneResults` ref, cleared on `onRaceStart`/`onReset` — in-session only, nothing
  persisted, nothing rendered off it.
- State recovery (`SpeedlineSnapshot`) reconstructs raw timer epochs, not
  record-keeping state; the relay forwards opaque JSON.

**Decision.**

1. **No new persisted field; no web↔server parity change.** Best-of-3 is **not**
   modelled as a `runIndex` on `Time` nor a run counter on `Match`. Each run POSTs
   its lane `Time`s **exactly as today** — they accumulate under the same
   `(round, athleteId)`, and rankings taking the best time across runs is the
   correct, desired behaviour (a competitor's best of the series is their ranked
   time). The only persisted match output stays `Match.winnerId`, so bracket
   advancement is untouched.

2. **The best-of-3 tally is recorder-session state.** `useRaceRecorder` gains an
   ephemeral per-match **run-wins tally** `{ 1: number, 2: number }` (a sibling of
   `laneResults`, but living **outside** the per-run reset). Each completed run is
   scored by the existing `deriveMatchWinner` lane comparison (faster non-DNF
   wins; a tie or both-DNF awards **no** run-win — the operator re-runs). The
   winning lane's tally increments; **`Match.winnerId` is PUT only when a lane
   reaches 2 run-wins** (best-of-3 ⇒ first to 2 is unbeatable). Until then the
   match has no winner, so a mid-series reconnect/overlay shows the match as still
   live — consistent with the existing "no winner until resolved" semantics.

3. **Reset semantics split into two scopes.** A **re-run of the current run**
   (`onRaceStart`) clears `laneResults` but **preserves** the tally (a re-light of
   the same run mustn't lose the series score). Selecting a **different Match**
   (or "— no match —") resets the tally to `{ 1: 0, 2: 0 }` (a new series). The
   tally also clears when the resolved match winner is reached (series over) and on
   an explicit operator series-reset control. **Void-run** (ADR's
   `voidRun`/`speed-false-start-round`): voiding the latest completed run decrements
   the run-win it awarded (if any) and clears `winnerId` when the series is no
   longer decided — keeping the standalone-void's "undo the recorded run" intent.

4. **No WS/protocol change for best-of-3 itself.** The tally is control-side
   session state; nothing in the relay, snapshot, or DynamoDB changes. The
   **summary/winner overlays** (`speed-rounds-summary-overlay`,
   `speed-winner-overlay`) are the consumers that need the tally on the wire — they
   will carry the series score as a sibling of the existing relay-only
   `updateSelection`/`LiveSelection` push (ADR 0014), settled with **their** specs,
   not here.

**Consequences.** Best-of-3 is a near-pure addition to `useRaceRecorder` + the
`app/util/raceTime` helpers (a `tallyRunWin`/`seriesWinner`-style pure function,
unit-tested like `deriveMatchWinner`) with **zero** data-model, parity, server, or
relay change — the lowest-drift shape given that the bracket only ever wanted a
`winnerId`. The cost is that the series score is **ephemeral**: a control-page
reload mid-series loses the 1–0/1–1 tally (the persisted `Time`s remain, but the
run→win attribution is not reconstructable from them, since a run is only
identifiable by its shared `startTime` across two lanes and that linkage isn't
stored). Accepted: a series runs in one sitting at one console, matching how the
operator works the bracket live; if mid-series recovery is later needed it is a
follow-up that adds run identity, not a precondition. Rankings intentionally keep
counting every run's `Time` (best wins), so a slow run doesn't hurt and there is no
special-casing. Foundational for the two best-of-3 broadcast overlays, which build
on the tally.

## 0019 — Freestyle is one Active+Break model; "dead time" was a misread of the enforced break

**Accepted · 2026-06-26 · implemented** (supersedes the former 0018 — the
battle-elapsed count-up, entry since removed; revises 0015 §2 — §1 warm-up
stands; §2 hardened 2026-07-01 — see the trailing revision note; **the enforced-battle
branch — §2 enforced mode, §4 routing/auto-start — is superseded by 0036**; the
active-budget model, warm-up, and the quali advisory break stand)

**Context.** ADR 0015 §2 and the former 0018 modelled **two** Freestyle features: an in-run
_break_ (a per-lane sub-state that freezes the running lane, manual resume, 2 × 30 s,
ADR 0015 §2) and a separate _battle-elapsed "dead time"_ count-**UP** clock
(`timerId 3`, the former ADR 0018) for the gap between turns. Re-grounded against how a real
highline-freestyle battle is actually judged, **both are wrong**: there is no
count-up dead time, and the two are the **same** mechanism — a break clock that
counts **DOWN** — differing only in whether it auto-starts the next performer.

The actual format (operator-confirmed, 2026-06-26):

- Each athlete has a **per-athlete active-time budget** (default 2:00) that counts
  **DOWN only while that athlete is performing** and **persists across their turns**.
- A performs; A falls; the judge **Stops** A's active clock (it freezes at its
  remaining). That stop **starts B's break clock** (count-down). B bounces to get
  going on the line.
  - Break reaches 0 → **B's active clock auto-starts** (enforced).
  - B is ready earlier → the judge **Starts** B; the break ends early (unused break
    time is discarded — a break is prep, not a budget).
- B falls → judge Stops B → **A's break clock** starts → … alternating. Breaks are
  **unlimited**. The **match ends when both athletes' active budgets reach 0**.
- **End-game (one athlete finished first).** A finished athlete (budget 0) is
  **skipped** in the rotation, so the "next to perform" resolves back to the
  survivor: when the survivor falls, the timer **directly starts the survivor's own
  break clock** (enforced — at 0 their active auto-starts again). The survivor keeps
  cycling through their own breaks until their budget is also 0 (no continuous run,
  no loss of breaks). One rule — "the break belongs to the next non-finished athlete
  due to perform" — covers both the alternating phase and the solo end-game.
- **Time-out vs fall.** A **fall** ends a turn on the judge's Stop. A **time-out**
  (active budget reaching 0 mid-performance) ends the turn automatically: the long
  beep fires and the next non-finished athlete's break **starts immediately, no judge
  interaction**. If no non-finished athlete remains, the match ends instead.

**Decision.**

1. **One concept: an Active clock + a Break clock, both count-DOWN.** The Active
   clock is per-athlete, persistent across turns, ticking only while that athlete
   performs. The Break clock is the **prep timer for the athlete about to perform**.
   There is **no count-UP "dead time."**

2. **The break has two modes, differing only at break-zero:**

   - **Enforced** (battle / 2 athletes): at 0 the about-to-perform athlete's active
     clock **auto-starts**. An early manual Start is always allowed.
   - **Not-enforced** (single-athlete qualification): at 0 the break just expires
     (beep); the **judge** manually Starts to resume — matching reference
     `Quali.html`. The reference **2-break allowance** is a quali-mode parameter;
     battle is unlimited.

3. **Delete the battle-elapsed / dead-time channel (the former ADR 0018) entirely** —
   `app/util/battleElapsed.ts`, the `BattleElapsed` component, `timerId 3`, and its
   snapshot handling. It modelled a feature that does not exist.

4. **Generalize the break (revises ADR 0015 §2).** A break is no longer "a sub-state
   that freezes the _running_ lane and resumes _that_ lane." In battle, A's Stop
   starts **B's** break, and the break belongs to the athlete **about to perform**
   (the other lane). On break-zero the control side either auto-sends
   `start_countdown` for that lane (enforced) or holds it paused (not-enforced).
   `start_break` gains an **`enforced` flag**; `breaksLeft` survives only for the
   quali allowance. The current freeze-and-hold of a lane's remaining is reusable
   (it _is_ the persistent budget); what changes is **which** lane the break attaches
   to and the enforced auto-start.

5. **Warm-up (ADR 0015 §1) is unchanged** — the orthogonal shared `timerId 0`
   count-down. The relay stays dumb; the union changes are web-only (no
   server/parity change, as in 0015).

6. **The break duration is per-competition config**, not a hardcoded constant. The
   `Competition` META gains an optional, editable timing config carrying
   `freestyleBreakMs` (default 30 s when unset); the freestyle break reads it via the
   selected competition. This is the first persisted format parameter and rides a
   **new competition update path** (the comp is currently create-only) — speced as
   `editable-competition` in PLANS, a prerequisite of this rework. (Active-budget and
   warm-up durations are natural future members of the same config object; out of
   scope here.) _As built: the field is the nested `config.freestyle.breakMs`
   (default `DEFAULT_FREESTYLE_BREAK_MS` = 30 s), not a flat `freestyleBreakMs` —
   see `editable-competition`._

**Consequences.** Net **simpler** — removes a whole channel + component rather than
adding one. The per-athlete budget falls out of the existing lane freeze-and-hold;
the real work is rerouting the break to the about-to-perform lane and adding the
enforced auto-start. The end-game (one athlete finished first), the
time-out auto-advance, and break-duration config are all settled above. The break
duration becoming per-competition config makes `editable-competition` a prerequisite. **The former
ADR 0018 is superseded (entry since removed from this ledger);
ADR 0015 §2 is revised by this entry.**

**As built.** The per-athlete budget is the lane's persisted held remaining,
never reset between turns — that half stands. The enforced half (the
`nextPerformer` routing, the `shouldAutoResume` break-zero auto-start, and the
`CountdownControl` button-state resync off looped-back relay messages) is gone:
0036 §4 deleted the routing and 0032/0043 removed the loopback entirely, so no
control surface reads its own echo any more.

**Revised 2026-07-01 (field testing).** Two §2 hardenings. (1) The "early manual
Start is always allowed" clause was not implemented — the Start button was disabled
during a break; it now stays live and **cancels the break**, resuming the held
budget via a plain `start_countdown` (which every consumer already treats as
break-clearing — no new message). This applies to quali breaks too. (2) A break
opening used to reflow the lane (the break clock + caption swap in above/below the
hero numeral), so the control buttons and the preview clocks jumped mid-match;
the performance lanes now **reserve the break rows' space** (`Countdown`'s
`reserveBreakRows` — mounted but hidden off-break; the warm-up channel skips it,
and so does any board that cannot break: the `TIME` caption row every lane
reaches is the separate `reserveCaptionRow`, `freestyle-board-fold-budget`).
The advisory quali Take-break button stays — it was briefly removed in this pass
and restored: the allowance is a real quali need, not UI noise.

## 0021 — Drop the Speedline clock-skew sync handshake (it was inert)

**Accepted · 2026-06-28 · supersedes the sync model noted in 0011 / ARCHITECTURE §"No clock-skew change"**

**Context.** `SpeedlineTimerDisplay` polled the control page every 30s with
`sync_time_request`; control replied `sync_time_response` with both epochs; the
preview computed `timeOffset = (epochControl − epochPreview) / 2` and threaded it
into both lane `Stopwatch`es as `epochOffset`. The intent was NTP-style clock-skew
correction. Reading the lane elapsed math shows it never corrected anything:
`epochOffset` is added to **both** sides of every subtraction, so it cancels —
running tick `(now + off) − (start + off)`, stop `(stopEpoch + off) − (startEpoch

- off)`, and recovery alike. No surface ever compared a control epoch against the
  preview's local wall clock in a way the offset survived, so the whole round-trip
  was dead weight that merely looked like a correctness mechanism.

**Decision.** **Remove** the handshake end to end rather than build a "real"
NTP correction. The displayed elapsed is either control-epoch − control-epoch
(skew-free by construction, for a finished lane) or preview-local-now −
control-start-epoch (for a running lane). The running case carries inherent skew,
but the operator's stop is authoritative and the lane freezes on the control's own
stop epoch the instant it lands — so a live running lane drifting by a few ms of
machine-clock difference is cosmetic and self-heals on stop. Browsers on a venue
network are NTP-synced to well under a frame anyway. A real correction would add a
protocol round-trip and state to fix a sub-frame cosmetic drift on a transient
display value — not worth it. Removed: the 30s interval, `initiateSync`,
`syncTimeOffset`, the `timeOffset` state, the `epochOffset` prop on `Stopwatch`,
the `sync_time_request` / `sync_time_response` message variants, and the
control-page reply.

**Consequences.** Net simplification (−58 lines), one fewer message pair in the
WS union, and the timer math reads as plain `now − start`. The
`request_state` / `state_snapshot` recovery (ADR 0011) is untouched and no longer
depends on a skew offset — its `SpeedlineSnapshot` epochs are applied directly. If
genuine skew correction is ever needed (it never has been), implement it properly:
apply the offset to the absolute `startTime` only, not as a self-cancelling delta
on both operands.

## 0022 — Overlay security hardening: reader PII strip + sessionId in the WS identitySource

**Accepted · 2026-06-28 · clause (c) superseded by 0031** (default-route gateway
throttling was built; the "account defaults only, no throttle" acceptance no
longer holds — (a) and (b) stand)

**Context.** The `overlay-security-hardening` backlog item raised three
defense-in-depth measures, none presently exploitable, to weigh:

- **(a)** The WS `$connect` authorizer's `identitySource` is `Authorization`
  only, while the decision also depends on `sessionId` (the read-token branch is
  comp-scoped against it). A latent footgun: if `resultTtlInSeconds` is ever set,
  a cached allow for a comp-A read token could let it join comp-B.
- **(b)** Read tokens (role `reader`) travel in OBS overlay URLs — an accepted
  leak risk (ADR 0003) — yet athlete reads return full PII (`birthDate`, `notes`)
  to readers.
- **(c)** Wildcard CORS + no per-principal throttle on the relay / HTTP API
  (account defaults only).

**Decision.** Adopt **(a)** and **(b)**; **accept (c)** as-is.

1. **(a)** Add `route.request.querystring.sessionId` to the `$connect`
   authorizer `identitySource`, so both query params are the cache key and a
   cached `Authorization` result can never carry across a different `sessionId`.
   The web always sends `sessionId` on the connect URL, so the stricter
   all-params-present requirement is satisfied.
2. **(b)** Strip `birthDate` and `notes` from athlete reads when
   `auth.role === 'reader'` (`forAudience` in `core/http.ts`), keyed off
   the authorizer **role, not the route**, so it covers every athlete-bearing
   read: the list, the single-athlete read, and both rankings branches
   (`rankings-reader-pii-strip`). Broadcast fields the overlays render survive:
   `firstName`/`lastName`/`name`/`shortName`, `country`/`country2`, `gender`,
   `photoKey`/`photoUrl`. Admins (the web UI) keep the full record.
3. **(c)** Accepted. Both surfaces require a bearer token; relay senders are
   `timeradmin`-gated and read-only connections are dropped by `messageHandler`.
   [As built: `request_state` is exempted from that drop — it carries no data and
   only prompts a re-broadcast the overlay may already read; see ARCHITECTURE
   "Read-auth".]
   Per-principal throttling and origin restriction are real hardening but not
   worth the operational cost (an authorizer-keyed usage plan, a CORS allow-list
   to maintain) against an already-authenticated, comp-scoped, short-lived
   credential. Filed as a future option, not built.

**Consequences.** A leaked overlay read token now exposes only the
broadcast-safe athlete fields, and the authorizer cache can never confuse two
sessions. Both are cheap, additive, and parity-free (no shared type changes —
the strip is a server-side projection, the `identitySource` is infra config).
The reader read shape is now narrower than the admin shape; no overlay consumes
`birthDate`/`notes`, so the contract is unaffected. The `sessionId`
identitySource is API Gateway config, not the message protocol; it was carried
through the CDK port (0023 §1) and has since served a live event.

## 0023 — Backend IaC: Serverless Framework v3 → AWS CDK (TypeScript) + LocalStack

**Accepted · 2026-07-01**

**Context.** The backend's IaC + deploy tooling was Serverless Framework v3
(`serverless.ts` + `infrastructure/*.ts` + `serverless-esbuild` /
`serverless-offline` / `serverless-prune-plugin`). v3 is **unmaintained** (no
security/bug fixes since early 2025 — the source of the server's held-back
dev-toolchain vulnerabilities) and **does not support Node 22**, while Node 20
LTS reaches EOL 2026-04-30. v4 introduces a mandatory access key + a paid plan
above $2M org revenue. The stack had **never been deployed**, so the move is a
clean greenfield: author the new app, deploy once, delete the old tooling — no
resource-import, name conflict, data migration, or downtime.

**Decision.** Adopt **AWS CDK v2 in TypeScript** for the IaC and **LocalStack**
for the local AWS data services. CDK because the whole repo is TypeScript: infra
becomes typed, testable, and can import the handlers' own `core/` modules, so
infra-vs-runtime drift is structural rather than hand-policed; ~889 lines of
CloudFormation collapse into L2 constructs that generate the per-function log
groups and IAM/permission boilerplate. Considered and rejected: Serverless v4
(license/cost), **AWS SAM** (still hand-written YAML — the maintainability
problem we're leaving, and no local runtime advantage over the harnesses below),
and staying on v3 (the problem).

1. **One `infra/` CDK app.** Entry `infra/app.ts` + a single backend stack
   (`infra/slackline-stack.ts`), sectioned tables → photo CDN → the
   `NodejsFunction` Lambdas (12 at the port, same esbuild flags, bundling the
   pinned @aws-sdk v3) → WebSocket relay → HTTP data plane → federated IAM
   roles. **One stack, not per-domain constructs**, because the functions need
   the WS stage's callback URL and the photo resources in their env —
   cross-wiring a single file expresses cleanly. [As of 2026-09 the class is
   `SlacklineTimerV1Stack` (construct id `slackline-timer-v1` — the kebab-case
   id _is_ the CFN stack name), and the app synthesizes two siblings beside it
   for reasons outside this rule: the web S3+CloudFront stack in `eu-central-1`
   and the `us-east-1` billing stack ADR 0031 needs for `EstimatedCharges`. The
   backend itself is still one stack.] `infra/` sits outside the tsc `outDir` (`lib/`), typechecked
   via the server tsconfig `include`; `cdk.json` (app cmd via `tsx`, region/stage)
   replaces `samconfig.toml`, and `cdk synth`/`deploy`/`watch` replace the `sam`
   scripts. Both APIs are L2: `HttpApi` + `HttpLambdaAuthorizer` (SIMPLE
   responses, 60s cache) for the data plane; and — the WebSocket constructs have
   graduated into `aws-cdk-lib`, so no alpha module — `WebSocketApi` +
   `WebSocketLambdaAuthorizer` for the relay, keeping the `Authorization`+
   `sessionId` identity source (ADR 0022). **Per-resource grants**
   (`table.grantReadWriteData`, `bucket.grantPut`, `api.grantManageConnections`)
   replace the single `dynamodb:*` role — scoped actions, per-function roles.
   Photos use `S3BucketOrigin.withOriginAccessControl` (OAC + read-only bucket
   policy generated). Secrets stay per-function via
   `StringParameter.valueForStringParameter` ({{resolve:ssm}} at deploy). `cdk
synth` was diffed to resource parity against the pre-existing infra.

2. **Local dev: LocalStack (community) for data, in-process harnesses for the
   Lambdas.** One `localstack/localstack` container (`:4566`, `dynamodb,s3`)
   replaces the DynamoDB Local + MinIO pair; `core/aws/clients.ts` points at it
   under `IS_OFFLINE`. The relay + data-plane **handlers run in-process** via
   `scripts/localWsHarness.mjs` + `localHttpHarness.mjs` — the real,
   esbuild-bundled handlers, so no drift from the deployed stack. CDK has no
   local emulator (there is no `cdk local`), and LocalStack's WebSocket +
   `postToConnection` and Lambda-**asset** deploy require the **Pro** license;
   until we take that (**phase 2**, then `cdklocal deploy` runs the whole stack
   natively), the harnesses are the local runtime. `dev:api` drops the SAM-CLI
   branch entirely: it ensures the tables + photo bucket in LocalStack, then runs
   the two harnesses. The shared offline env lives in one place
   (`scripts/offlineEnv.mjs`); the HTTP harness route table mirrors the CDK HTTP
   routes, guarded by a `GET /competitions → 200` boot smoke
   (`test/integration/localHttpHarness.int.test.ts`).

3. **No Serverless legacy remains.** `serverless.ts`, every `lambda.ts`,
   `infrastructure/*.ts`, the `serverless-*` / `@serverless/typescript` /
   `tsconfig-paths` devDeps, and the entire `IS_OFFLINE` config-accommodation
   layer are gone. The handler-level `IS_OFFLINE` branches (local-dev dummy
   token, LocalStack endpoints) stay — that's how the local backend reaches
   LocalStack, not framework config. This entry also **absorbs the former ADR
   0008** (entry removed 2026-07-20): its
   serverless-offline mechanism is retired, but its principle — local dev runs
   the **real** handlers, one implementation, no drift (the standalone `local/`
   relay package was deleted for exactly that, commit `7ad576f`) — is what the
   harnesses preserve. It also **absorbs the former ADR 0020** (entry removed
   2026-09-25): that entry's MinIO choice is superseded — the offline S3
   emulator is LocalStack (it serves DynamoDB too, so the "S3-only need" that
   favoured MinIO no longer holds) — but its **photo rule stands and is carried
   here**: local dev runs the _real_ `photoUpload` / read Lambdas against the
   local bucket, and because CloudFront signing has no local analogue (it is an
   edge operation over a private origin), the offline read returns the **direct,
   unsigned object URL** from a **public-read** local bucket instead of a signed
   one. That is a deliberate, contained `IS_OFFLINE` seam in the signer wiring
   (`core/photoUrl.ts`), documented at the seam, and it **relaxes ADR 0005's
   "bucket never public" for the throwaway dev container only** — prod stays OAC
   - trusted-key-group signed. The alternative 0020 rejected still stands
     rejected: a local-filesystem photo store + a fake upload endpoint would put
     an offline-only code path back inside the Lambdas, which is the divergence
     the single-implementation rule exists to remove.

**Consequences.** The Serverless-tree dev vulnerabilities are gone; the new
devDeps (`aws-cdk` CLI + `aws-cdk-lib` / `constructs` / `tsx`) add **zero**
prod-dependency vulnerabilities — the audit's remaining dev-only findings are the
pre-existing vitest/vite/esbuild chain, untouched here. The stack has since been
bootstrapped, deployed, and run a live championship, so the port is settled by
demonstration. Standing constraints it leaves: `cdk synth`/`deploy` need the CDK
CLI (not in CI today), and the three SSM params (`read-token-secret`,
`photo-public-key`, `photo-private-key`) must exist before a deploy into a fresh
account. **Phase 2:** a LocalStack Pro license enables `cdklocal deploy` of the
full stack (native WS + Lambda), retiring the harnesses to an optional
fast-path.

## 0024 — WS resilience: unbounded jittered reconnect + an app-level keepalive ping

**Accepted · 2026-07-02**

**Context.** `useWS` reconnected with `reconnectAttempts: 10, reconnectInterval:
3000`; react-use-websocket 4.8.1 resets its retry counter only on a successful
open, so any continuous outage past ~30 s (venue Wi-Fi blip, AP roam, backend
redeploy) left every open page with a permanently CLOSED socket until a human
reloaded it — previews blank, `/stream/*` OBS overlays silently frozen **on
air**, control no longer relaying, and no `onReconnectStop` registered so the
give-up was invisible. Separately there was **no keepalive**: API Gateway drops
idle WS connections at 10 min, so quiet stretches between heats guaranteed
recurring drop/reconnect churn. (Full option analysis was in PLANS
"ws-reconnect-resilience".)

**Decision.**

1. **Never give up reconnecting.** `reconnectAttempts: Infinity` with capped
   exponential backoff + half-jitter: `wsReconnectDelay(n)` draws uniformly from
   `(cap/2, cap]`, `cap = min(1000·2ⁿ, 30 000)` — fast first retries, a 30 s
   steady state, and no reconnect stampede when one outage drops a whole room.
   `onReconnectStop` stays registered as a loud console tripwire; it is
   unreachable under Infinity, and the _visible_ "connection lost" surface is
   driven off `readyState` instead (which also covers a hypothetical give-up):
   control keeps the `ControlStatusHeader` banner, and previews + `/stream/*`
   overlays get `ConnectionLostBadge` — a corner "signal lost — reconnecting"
   plate after a 5 s grace (so routine token-refresh reconnects never flash on
   air), fed on overlays by `useStreamRefresh`'s now-returned `readyState`.
   **Chroma-safe:** the badge never paints over a chroma-keyed ground (`?bg=key/
magenta/green/blue` or the projector variants' chroma default) — the keyer
   would pass it through to the venue screen / broadcast; keyed rigs keep the
   stale state observable off-air (control header, `/admin/overlays`).
2. **App-level keepalive** (option 2 of the PLANS analysis — churn-free behavior
   on air is worth ~3 relay lines over "accept the idle drop"). Every open
   socket sends `{type: 'ping', sessionId}` every 8 min (`KeepaliveWSMessage`,
   deliberately outside the relayed unions); `messageHandler` swallows it before
   the membership/read-only checks — no DynamoDB lookup, no drop-log noise,
   never fanned out, so peers never see it. Read-only overlay connections ping
   too: the send itself resets API GW's idle timer regardless of relay policy.
   The library's built-in `heartbeat` was rejected: it sends a raw `'ping'`
   string (the relay would JSON.parse-fail) and its `timeout` closes the socket
   when no message _arrives_ — the relay never answers pings.

**Consequences.** A venue outage of any length now self-heals: each recovered
open re-runs the lazy token getter (fresh IdToken) and the `request_state`
recovery (ADR 0011), and quiet heats no longer churn through the 10-min idle
drop. The 2 h hard connection limit still applies and lands as one jittered
reconnect + recovery. The swallow branch, backoff shape, grace period, and
chroma guard are unit-tested; the outage/reconnect behaviour itself is driven by
the browser driver's `realtime-recovery` legs.

## 0025 — Secrets are SecureString SSM params fetched at runtime, never Lambda env values

**Accepted · 2026-07-02**

**Context.** ADR 0023 carried the secrets forward as the Serverless template had
them: the read-token HMAC secret and the CloudFront RSA **private key** were
plain SSM `String` params resolved at synth
(`StringParameter.valueForStringParameter`) and injected as plaintext env vars
into their consumers (authorizer, httpAuthorizer, createReadToken; athletes +
rankings for the RSA key). Exposure: unencrypted at rest in SSM, readable via
`lambda:GetFunctionConfiguration` / the console, surfaced as resolved CFN
parameters — against explicit AWS guidance, and the RSA key never rotates, so
one config-plane read is a permanent compromise. Just flipping the params to
SecureString is impossible: CFN **rejects** `ssm-secure` dynamic references in
Lambda `Environment` blocks. (Options weighed in PLANS: this; Secrets Manager —
native rotation + audit for ~$0.40/secret/month, overkill for a single-operator
stack; or accept + document, ruled out by the never-rotating key.)

**Decision.** SecureString + runtime fetch, landed **before** the first deploy
so the params were provisioned correctly the first time:

1. The two secrets are provisioned as **SecureString** under the default
   `aws/ssm` KMS key. The photo **public** key stays a plain String — not a
   secret, and it must resolve at deploy into the CloudFront `PublicKey`
   resource.
2. The stack injects only the parameter **name** (`READ_TOKEN_SECRET_PARAM` /
   `PHOTO_PRIVATE_KEY_PARAM`); `core/secrets.ts` fetches the decrypted value on
   first use (`GetParameter` with `WithDecryption`) and caches it for the
   container lifetime. A fetch failure resolves `undefined` — every caller
   already denies/degrades on a missing secret — and is not cached, so a
   transient SSM error heals on the next invocation.
3. A direct env value (`READ_TOKEN_SECRET` / `PHOTO_PRIVATE_KEY`)
   short-circuits the fetch: the offline harnesses (`scripts/offlineEnv.mjs`)
   and unit tests keep injecting env directly and never touch SSM. Prod cannot
   regress into env injection unnoticed — the infra test pins that no function
   carries a `READ_TOKEN_SECRET`/`PHOTO_PRIVATE_KEY` env key.
4. IAM pairs with the least-privilege grants: `param.grantRead(fn)` per
   consumer only (the default `aws/ssm` key decrypts via-service, so no kms
   grant is needed); the infra test pins `ssm:GetParameter` to exactly the five
   consumers.

**Consequences.** One SSM round trip per secret per cold start (~10–50 ms,
cached thereafter) in the two authorizers and the three signing/minting
Lambdas; `photoUrlSignerFromEnv` became async. Secrets no longer appear in the
CFN template, function config, or console; rotating either secret is now a
`put-parameter` + waiting out container recycling (or a redeploy) instead of a
stack update. Supersedes the secrets sentence of ADR 0023 ("secrets stay
per-function via `valueForStringParameter`").

## 0026 — Read-token revocation force-closes open overlay feeds

**Accepted · 2026-07-02**

**Context.** ADR 0003 mints comp-scoped read tokens and revokes them by bumping
the competition's `tokenVersion`; `readToken.ts` and ARCHITECTURE describe this as
"revokes … **instantly**". But the version is only checked at WS `$connect` (and
per HTTP request). An overlay socket that connected before the bump keeps
receiving the live relay feed (`db_update`, timer messages) until its socket
drops — up to the connection-row TTL, and the app-level keepalive (ADR 0024)
keeps it alive indefinitely. So "instantly" was true for HTTP reads and future
connects, but a live-on-air overlay carrying a leaked token would keep updating.
Options: (a) correct the docs to "at next (re)connect; open feeds persist"; or
(b) on revoke, close the open reader sockets so behavior matches the docs.

**Decision.** Option (b). The revoke route (`POST …/revoke-read-tokens`) already
runs in the `competitions` Lambda, which is a `db_update` broadcaster — it holds
the `WS_API_ENDPOINT` env var and the `ManageConnections` grant. After the
version bump it calls `disconnectSessionReaders(compId)`
(`core/broadcast.ts`), which enumerates the session's connection rows, filters
`readOnly`, and `DeleteConnection`s each (pruning a 410 like the fan-out does).
The forced-closed overlay reconnects with its now-stale token and is denied by
the `$connect` authorizer's `tokenVersion` check. `db.getAllConnections` now
surfaces the `readOnly` flag (previously dropped) so the filter is possible.

**Consequences.** Revocation is now genuinely instant on all planes; the
`readToken.ts`/ARCHITECTURE wording is accurate as written. Best-effort: the
version bump persists first and a failure to close sockets only logs (the next
reconnect is still denied, so the gap self-heals within the socket's idle
timeout even in the worst case). Operator connections are untouched — only
`readOnly` rows are closed.

## 0027 — The Speedline control page owns lane timer state; loopback is no longer a delivery channel

**Accepted · 2026-07-03 · single-owner premise revised by 0038** (the
local-ownership + broadcast contract stands; a _peer_ control panel now also
applies the broadcasts — self-echo stays a non-channel, discriminated by
`senderId`).

**Context.** `SpeedlineControlPage` opens two relay sockets (a sender and a
receiver) and fed the RECEIVER's `lastJsonMessage` into `StopwatchControl` /
`Stopwatch`, so the operator's own lane clocks and Stop-button enablement
reacted to the page's own messages **echoed back through AWS**. Three verified
costs: (a) Stop was dead until the sender→AWS→receiver round-trip after Start,
and an own message lost in a reconnect gap was never replayed (control only
_answers_ `request_state`, never sends it), permanently diverging control and
preview for the heat; (b) the page kept six mirror refs (`startTimeRef`,
`stopTimeRef`, `lastTextRef`, `signalPhaseRef`, `runningTimerCountRef`, plus the
hook's `enabledPreviewRef`) as a THIRD copy of state purely to answer
`request_state`; (c) page-level gamepad handlers could not see lane running state
— the root cause of the `speedline-gamepad-stop-guard` bug.

**Decision.** Option (2) from PLANS — lift lane timer state into the control
page. The page holds one `laneTimers` state (`{ startTime, stopTime }` per lane)
plus `text`; `runningTimerCount` and each lane's `SpeedlineLaneState` are
_derived_ from it. `StopwatchControl`/`Stopwatch` became presentational on
control: a new controlled `laneState` prop drives the numeral and Stop
enablement and, when set, suppresses the loopback message effect entirely (the
preview leaves it unset and keeps consuming relay messages). The snapshot builder
and the stale-closure gamepad/reset guards read the one source via a single
`stateRef`, collapsing the mirror refs. **The relay contract is unchanged** — the
page still broadcasts the same `start`/`stop`/`reset`/`updateText`/… messages for
peers; only the control's _own_ display stopped depending on the echo.

**Trade-off (recorded).** The loopback previously doubled as an implicit
relay-delivery confirmation: if the operator's own clock advanced, the message had
provably round-tripped through AWS. Removing that coupling is acceptable — the
control clock is now driven by local truth and delivery to _peers_ is covered by
the manual control+preview smoke (and surfaced live by `ControlStatusHeader`'s
readyState). We consciously trade a silent, incidental delivery signal for
correct, latency-free local state and single ownership.

**Scope (at the time).** Speedline only. The Freestyle `CountdownControl`
already owned its button state locally and had no six-ref mirror; its remaining
loopback use was genuine cross-lane _orchestration_ (the enforced battle break,
the break-zero auto-resume — ADR 0019), not a self-delivery dependency, so
lifting it would have re-plumbed that flow without removing a defect. That
exemption is **spent**: 0032 lifted the Freestyle state into one reducer, 0036
deleted the orchestration it served, and 0043 closed the second socket — no
control surface consumes its own echo on either mode now.

## 0028 — `recordDnf` dedupes a repeat press but keeps DNF-after-finish

**Accepted · 2026-07-03**

**Context.** `speedline-gamepad-stop-guard` (ADR context, STATUS) gave
`recordFinish` a hard per-lane lock: once a lane holds any result this run it
records nothing more (corrections route through `editLaneTime`). Its sibling
`recordDnf` was left unguarded, so a repeat DNF press — a double gamepad/button
tap — POSTed a **second** identical DNF Time. The obvious fix (copy the hard
lock) is wrong: the DNF button is enabled purely on athlete assignment
(`disabled={!laneAthletes[lane]}`), and **DNF-after-finish is a used correction
path** — an athlete finishes (records a time), then the operator marks DNF
because they fell / were disqualified. A hard `laneResults[lane] !== null` lock
would break that correction.

**Decision.** A lighter idempotent dedupe, not the hard lock: `recordDnf`
no-ops only when the lane **already holds a DNF this run**
(`laneResults.current[lane] === DNF_SENTINEL`). A repeat DNF is thus a single
POST, while a lane holding a _time_ result still accepts a DNF as a correction
(the correction POSTs a second, DNF-valued Time — the same fast-create /
slow-correct split the console uses elsewhere; rankings/overlays sort DNF last
by construction). `recordFinish` keeps its hard lock — its late-stop case is a
stale machine event, not an operator correction.

**Consequences.** The repeat-press double-POST is closed without regressing the
DNF-as-correction workflow. Unit cases pin the split
(`useRaceRecorder.test.tsx`): repeat DNF = one write; DNF after a recorded
finish = still allowed. No relay-protocol or timer-sync surface is touched.

**Amendment (2026-09-25, `speedline-dnf-corrects-and-freezes-the-lane`).** The
correction PUTs, it does not POST. The second Time this decision accepted left
the athlete's real time in the field — `bestTimeByAthlete` ranks the faster of
the two, so the DNF never showed — and burned a second qualification attempt on
one run. A lane holding a save is now rewritten to the sentinel through the
`editLaneTime` path (`timeMs` is a non-key attribute, so it is a plain PUT):
one row per attempt, ranked DNF, attempt count unchanged. The dedupe, the
DNF-after-finish path and the hard lock on `recordFinish` are untouched; the
attempt cap guards only the POST branch, since the correction spends no new
attempt. The press also freezes the lane's clock — see `ControlPage.dnfLane`.

## 0029 — The no-reference card homes adopt the v2 panel language

**Accepted · 2026-07-03** · §2 is **moot since 0041 §3 retired the compact
bracket variant** (`CompactAthleteCard` is deleted, so its stroke has no home);
§1 stands, with its stroke weight re-split by the 2026-07-23 amendment below

**Context.** The `overlay-svg-art-pass` retuned every overlay that has a
dedicated LAAX reference SVG. Three card homes have none: the `WinnerOverlay` /
`RoundsSummaryOverlay` `Competitor` frames (the g2 fixed 240×380**px** portrait,
proportional `0.4cqh` stroke — "g2" being the overlay build round that predates
this LAAX art pass) and the bracket `?variant=compact`
`CompactAthleteCard` (also `0.4cqh`). During `vs-overlay-svg-art` the v2 panel
geometry (298.81×498.02 @1080p + the constant 9px stroke) was deliberately
scoped to the VS panels — a test even pinned the winner card at `240px` "must
not leak" — leaving open whether the no-reference homes should follow the art
or keep the g2 treatment.

**Decision.** Adopt v2 in all three homes; the g2 treatment is retired from the
stream surfaces.

1. **The v2 panel becomes the `Competitor` frame itself** (the `sx`/`edgeWidth`
   override plumbing is removed; VS drops its overrides). Two forces, verified
   in code: (a) the fixed 240×380px frame violated the resolved "responsive,
   tuned for 1080p" rule — every retuned overlay derives from the 1080p
   reference in vw/vh, so at a 4K browser-source the winner card rendered at
   half its intended frame share while its VS sibling scaled; (b) VS, winner,
   and rounds-summary are one lower-third family a broadcast cuts across
   _within a single match_ — an athlete card that pops from 299→240px between
   cuts reads as a glitch, not a design. Density holds: the rounds-summary
   worst case (three cards + gaps ≈ 990px) sits comfortably in a 1920 frame.
2. **`CompactAthleteCard` strokes at the art's constant 9px.** Its only home is
   the profile tree, where the connectors render at 9px non-scaling in _both_
   variants and the photo boxes already adopted 9px in identical geometry —
   the g2 `0.4cqh` edge computes to ~0.7px on a 171px quarter box, a hairline
   inside a 9px line system. The density objection is answered by the art
   itself: the reference strokes the 102.62px-wide quarter boxes at 9px, and
   the profile variant already pays that cost.

**Consequences.** One on-air card language across every stream surface — no
overlay carries the g2 edge anymore (the `AthleteCard` `0.4cqh` default now
serves only the admin `AthleteForm` preview). The winner/rounds-summary cards
grow (380→498px tall @1080p) and scale with capture resolution; both surfaces
join the consolidated `overlay-signoff-driver-rerun` list. Tests flip with the
decision: the winner-frame "must not leak" pin becomes the v2 parity pin, the
series cards and the compact 9px stroke are newly pinned. Closes
`overlay-v2-frame-parity-decision`.

**Amendment · 2026-07-23.** The "constant 9px" was later split. 9px clotted the
dense bracket boxes, so the shared stroke (`overlayArt.strokeWidth`, VS-box /
plate border / bracket connectors) was cut to **6px**. The big VS/winner
lower-third portrait frame still needs the heavier edge to read at venue
distance, so it keeps its own weight — **10px @1080p**, `Competitor`'s
`PANEL_EDGE` (decoupled from the shared token, not derived from it). So the card
edge is no longer one constant: 6px in the bracket, 10px on the lower-third
cards.

## 0030 — No DynamoDB secondary index; the key design already indexes the hot paths

**Accepted · 2026-07-04**

**Context.** Both single tables are plain `PK`+`SK` with no GSI/LSI
(`infra/slackline-stack.ts` `defineTables`). The `dynamodb-index-evaluation`
interim asked whether the competition table needs one before a real event loads
it, with `athlete-id-gsi` as the concrete candidate — the worry being the
list-then-filter paths in `core/competitionDb.ts` (`athleteHasReferences`,
`findTimeById`/`findScoreById`/`findMatchById`) that read a whole `COMP#<compId>`
partition. Evaluated analytically rather than by seed-and-measure: the numbers
are decisive without a harness.

**Decision.** Add **no** secondary index to either table. `athlete-id-gsi` is
retired to won't-do.

1. **`compId` needs no index — it _is_ the partition key.** Every API path is
   comp-scoped, so `PK = COMP#<compId>` is always known; that lookup is a hash
   jump to the partition, the native primary-key index. The SK front-loads
   `round`, so the hot reads (rankings, overlays, `listTimes/Scores/Matches` by
   round) are native `begins_with` range reads, not scans.
2. **The busiest paths are already index-optimal.** The `Score` upsert resolves
   by `getScore(compId, round, athleteId)` — a **direct `GetItem`**, because the
   SK _is_ the `(round, athleteId)` identity. The timer save-on-stop is a plain
   `PutItem`. Neither scans.
3. **The only non-native path is cold and cheap.** `find*ById` /
   `athleteHasReferences` list-then-filter because the surrogate `id` (and
   `athleteId`) aren't an SK prefix — but these run only on manual single-record
   admin edit/delete, over a partition a full LAAX-scale event fills to
   ~750 items / ≤300 KB, i.e. one ≤1 MB Query page, single-digit ms, sub-cent.
   The partition also lives ≤10 days then the read window closes
   (`core/eventWindow.ts`), so it never accumulates across events.
4. **A GSI would tax the hottest write to speed up the coldest read.** An `id`
   GSI projects into every `Time` write — the timer console POSTs a `Time` on
   _every lane stop_, the highest-frequency write on a race day — to accelerate a
   human-paced admin lookup. Net loss.

**Consequences.** No schema/infra change; the `dynamodb-index-evaluation`
tech-debt item and the deferred `athlete-id-gsi` both close as won't-do. The one
trigger that reopens this: `find*ById`'s single-prefix list needing pagination,
which only happens past a ~1 MB partition (~2,500+ Times) — far beyond a real
event. If that ever appears, `athlete-id-gsi` is the concrete candidate to
revisit.

## 0031 — AWS cost/abuse guardrail posture: gateway throttling + concurrency caps + Budgets backstop; on-demand kept; WAF authored-but-disabled

**Accepted · 2026-07-06 · Landed** — Budgets + billing alarm, gateway throttling, and the authored-but-off WAF shipped 2026-07-07; the reserved-concurrency caps shipped 2026-07-21 (once the account Lambda-concurrency quota was raised — see §3).

**Context.** The deployed backend (`slackline-timer-v1`, eu-central-2) and web stack (`slackline-timer-v1-web`, eu-central-1) are publicly reachable on one paying AWS account, and had **no** cost or abuse guardrails: no AWS Budgets/billing alarm, no API Gateway throttling on either the HTTP API or the WS `$connect`/`$default` stages, no Lambda `reservedConcurrentExecutions`, and no WAF (verified — `throttl|WAF|Budget|reservedConcurrent` match nothing in `infra/`). Both APIs front a custom Lambda authorizer (`authorizer`, `httpAuthorizer`) that does real work (DynamoDB `getCompetition`, JWKS/HMAC verify) on _every_ unauthenticated request, so a flood bills authorizer Lambda + DynamoDB reads before the deny. Three surfaces were already bounded: the presigned-POST photo path (`content-length-range` 0–8 MB + `eq $Content-Type`, admin-only, 300 s TTL — its bounds ARE the abuse ceiling), Lambda memory (floored at 128 MB), and log retention (30 days, `DESTROY`). The app is small, single-operator, event-shaped (≤10-day windows), so the target is a hard cost ceiling + early warning, not enterprise DDoS defence.

**Decision.**

1. **AWS Budgets + a us-east-1 `EstimatedCharges` billing alarm** → SNS email are the account backstop, built first. Managed **in-stack via CDK `CfnBudget`** (reproducible, infra-test-pinned): **€50 monthly ceiling**, 50/80/100% actual + forecast notifications → an SNS topic subscribed by the address passed as the **`billingAlertEmail`** CDK context value (deployment config, never committed). Alarm + topic live in **us-east-1** (the only region publishing `EstimatedCharges`).
2. **Default-route throttling on both API Gateway stages** (HTTP `HttpStage` + WS `WebSocketStage`). HTTP is **20 rps / 40 burst** — above a live admin + ~15 overlays refreshing on `db_update`, far below a flood. The WS bucket was first sized the same way (10 conn/s / 20 burst) for _inbound_ `$connect`/`$default` only — but the same bucket also meters the **outbound `PostToConnection` fan-out** (every relayed message spends fan-out-N posts through it), so a reconnect storm silently 429-dropped fan-out mid-event. It was raised to **2000 rps / 2000 burst** (2026-07-23), just under the 2500 rps account cap — the account limit is the real ceiling now; the stage throttle keeps the WAF-less cost-guardrail shape. This supersedes the "no per-principal throttle, account defaults only" acceptance in ADR 0022(c): default-route throttling protects the account without the per-key usage-plan ops cost that 0022 rightly declined.
3. **`reservedConcurrentExecutions` caps** — each both a spend/blast-radius ceiling and a guaranteed floor (no function can be starved out of the pool by another's storm). **Landed 2026-07-21**, once a Service Quotas increase raised the account's Lambda-concurrency pool to the standard 1000 (the first attempt, 2026-07-07, was rejected at the new-account cap of 10 — reserving any amount drops unreserved below its minimum of 10; the `makeFn` wiring was kept and restored when the pool grew). Caps: the two per-hit authorizers **50** each; the five entity writers **25** each; the WS relay **`messageHandler` carries its own larger cap, 100** — it is the only broadcaster that fans out to the whole room, and sharing the writers' 25 pegged it for a whole event and Lambda-throttled inbound frames before any fan-out ran (HWC 2026, a 241-connection room, ~3.3k throttled frames). Total reserved = 2×50 + 100 + 5×25 = 325, leaving 675 of the 1000 pool unreserved (AWS requires ≥100).
4. **DynamoDB stays on-demand** (`PAY_PER_REQUEST`); the cost exposure is capped via Budgets/throttling/concurrency, not a provisioned-capacity ceiling that would throttle a legitimate race-day burst. Consistent with ADR 0030 (cheap, single-page reads).
5. **AWS WAF is authored but left disabled by default** — a parameter-flagged, default-OFF rate-based WebACL (per-IP rate limit + `AWSManagedRulesCommonRuleSet`) on the web CloudFront dist + the two API GW endpoints — because its standing monthly cost rivals the app's idle bill and every data surface is already token-gated/comp-scoped/short-lived. Flip on only on an observed abuse event. **Landed** (`waf-ready-to-enable-option`): the shared rule set is `server/infra/waf.ts`; the `REGIONAL` WebACL + both API GW stage associations sit in the backend stack gated on a `WafEnabled` CFN parameter, and — because CloudFront-scoped WAF must be provisioned in us-east-1 — the `CLOUDFRONT` WebACL rides the existing us-east-1 billing stack (exports `WebAclArn`), which the web stack attaches via a default-empty `WafWebAclArn` parameter. No WAF resource synthesizes at the defaults (no standing cost); the enable step (per-stack `--parameters` deploys) is in [`deploy.md`](./deploy.md) §6 + `infra/waf.ts`. Burst→block behaviour owed post-enable (`guardrail-deploy-smoke`).

**Consequences.** The account gains a hard cost ceiling and early warning with near-zero standing cost (Budgets/alarms are free-tier-ish; throttling and reserved concurrency are free). The presigned-POST photo bounds, 128 MB memory floor, and 30-day log retention are confirmed sufficient — no change. Every control is pinned by `test/infra/slackline-stack.test.ts`, its sizes living with the code in `server/infra/{billing-stack,waf,slackline-stack}.ts`; as-deployed behaviour is owed to `guardrail-deploy-smoke` (HUMAN_TASKS "Live-AWS / operational" — needs the live stack, no local API GW emulator). Division of labour worth keeping straight: this ADR bounds **cost/abuse**, but **relay resilience under a reconnect storm** is a separate, code-side concern — bounded fan-out concurrency + 429/5xx retry + a module-scoped `PostToConnection` client that keeps DNS/sockets warm across invocations (`server/src/core/broadcast.ts`) — because throttle/concurrency headroom alone does not stop a storm from amplifying (the WS-throttle resize in §2 is exactly that lesson). Reopens only if an abuse event forces WAF on, or if event scale outgrows the chosen throttle/concurrency numbers.

## 0032 — Freestyle battle orchestration is a hand-rolled control-page state machine; absorbs the off-echo lift

**Accepted · 2026-07-06 · Landed 2026-07-06** — the reducer lift shipped (`freestyle-battle-hsm-reducer`): the pure machine is `web/src/app/util/battleMachine.ts`, `CountdownControl` is presentational, and the reducer state is the `request_state` snapshot source. Owes the control+preview + mid-break-reconnect smoke (`freestyle-battle-hsm-smoke`) — since closed (`node driver.mjs freestyle-battle` 23/23, 2026-07-13, incl. the mid-break reconnect asserted on the wire); only the beeps stay a human listen. _The **architecture** (single reducer, effects-as-data, snapshot source) stands; the **model** it encoded (enforced break routing/auto-resume, athlete-count mode) is revised by 0036._

**Context.** The Freestyle control board is already an implicit hierarchical state machine — armed → running → break → resume, cross-lane next-performer routing, enforced (battle) vs advisory (quali) break-zero, the solo end-game, and time-out auto-advance (ADR 0019). But the _state_ is smeared across three layers that each keep their own copy and are only reconciled by round-tripping through the AWS relay: the page holds `runningTimerId` + an imperative `laneStateRef` mirror + the routing callbacks; each `CountdownControl` re-derives `isRunning`/`remainingMs`/`startTime`/`breaksLeft` (plus refs) AND re-consumes its OWN looped-back `start_countdown`/`stop_countdown`/`start_break`/`end_break` messages (`CountdownControl.tsx:174-206`) purely to resync its buttons after a page-driven transition on the other lane; each `Countdown` holds a third copy for its tick. The pure transition logic is already correctly extracted into `app/util/breakState.ts` (`nextPerformer`, `shouldAutoResume`, `takeBreak`, `canTakeBreak`) and unit-tested — so what is duplicated and echo-coordinated is the _state_, not the rules. This relay-echo-as-coordination-bus is the same antipattern ADR 0027 removed for Speedline. The deferred `freestyle-countdown-orchestration-off-echo` targets exactly this echo dependency.

**Decision.**

1. **Freestyle-only.** Consolidate the cross-lane battle/break state into a single hand-rolled reducer/HSM owned by the Freestyle control page; push derived per-lane props (`phase`/`enforced`/`breaksLeft`/`disabled`) down to a presentational `CountdownControl` that no longer consumes its own echo; dispatch gamepad actions to that reducer. Reuse `breakState.ts` as the transition functions verbatim. The reducer state becomes the single `request_state` snapshot source, replacing `laneStateRef`. **The relay contract is unchanged** — the page still broadcasts the same messages to peers; only the control's own coordination stops depending on the echo.
2. **No xstate.** Hand-roll it. The machine is small (≈4 states × 2 lanes), the rules already exist as pure helpers, and a statechart library would add a runtime dependency and an idiom foreign to the rest of the codebase (useState/refs + relay-snapshot recovery) for no proportionate gain.
3. **Speedline excluded.** ADR 0027 already lifted its lane state into one derived source and collapsed the mirror refs; its only remaining machine is the linear start-light phase sequence in `useStartSignalTimer` (isolated, ~60 lines, no hierarchy, no cross-lane coordination). Formalizing it buys nothing.
4. **This ADR supersedes/absorbs `freestyle-countdown-orchestration-off-echo`** — the off-echo lift is the same refactor, framed as its outcome; it is retired as a separate backlog line and tracked here.
5. **Per-athlete active budgets become first-class** in the reducer (ADR 0019 §6), replacing the current held-remaining model — so the lift is state consolidation **plus** this model change. Wider blast radius; owes new unit coverage for the per-athlete budget transitions.

**Scheduling.** Build now — no longer gated. The flow is correct and was headlessly verified (`freestyle-battle-rework`), so there is no operator-facing gain, but the owner has scheduled this rework, so it proceeds. Run on a `feat/*` branch in the main checkout (never a worktree — Windows `MAX_PATH`), committed-not-pushed for review.

**Consequences.** Single ownership of the battle state (no triple-copied state, no echo-as-bus), latency-free local buttons, gamepad handlers that see real state — the Freestyle analogue of what ADR 0027 gave Speedline — plus first-class per-athlete budgets. The pure `breakState.ts` helpers and the per-athlete-budget transitions are unit-tested; the realtime fan-out is covered by the driver scenarios named in the status line above.

## 0033 — Control-page match dropdown filters strictly by round; the confirm guards the Round selector

**Accepted · 2026-07-09** (owner call) · **generalized by 0042** — the same
confirm now also guards the **Gender** select, and the cascade extends down to
the athlete pickers · on the Freestyle board this confirm is one of the three
0046 §2 keeps; the _format_ confirms there are replaced by locks

**Context.** On both control pages the operator picks a round + gender, then a match — but the match dropdown is filtered only by gender + discipline (`useMatches` sends no `round` param; `RaceRecorderControls` / `FreestyleScoreControls` render every match), and selecting a match silently overwrites the chosen round (`selectMatch` → `setRound(match.round)`). The request asked for two things that partly exclude each other: a round filter on the dropdown **and** a confirm before a match selection changes the round — but if the dropdown only ever lists the current round's matches, a wrong-round match can never be selected through it, so that confirm would never fire. The three candidate models weighed were: strict filter + confirm on the Round selector; soft filter with an "other rounds" group + confirm on match-select; strict filter with silent clear, no confirm.

**Decision.** **Option 1 — strict filter, confirm on the Round selector.** The match dropdown always shows only the current round's matches (client-side `m.round === round`). The confirm relocates to the **Round** control, the only event that can actually orphan a selection: if a match is selected and the operator changes the round, prompt "a match is selected for {oldRound} — change the round and clear it?" — _yes_ switches the round and clears the match plus its cascaded state (lane/player athlete selects, best-of-3 series / score accumulator), _no_ reverts the round select. Round becomes the single source of the match list, so a match selection can never surprise the round. Option 2 (soft filter + confirm-on-select) was rejected as adding an "all rounds" affordance the ask never specified; option 3 (silent clear) as dropping the "are you sure" safety the request explicitly wants.

**Consequences.** Web-only, display + local state — no relay/protocol, server, or entity change. Touches both control-page controls (`RaceRecorderControls`, `FreestyleScoreControls`) and both recorder hooks (`useRaceRecorder`, `useScoreRecorder`), with the clear-to-no-match reset factored so the confirm path reuses what `selectMatch('')` already establishes; the confirm reuses the existing MUI confirm-dialog pattern. The Round dropdown keeps its manual-recording role (stamping round on match-less records). Hook test suites pin the filter and both confirm branches. As-built: `requestRound`/`confirmRoundChange`/`cancelRoundChange` on both recorder hooks over a factored `clearMatch`, with `roundMatches` driving the dropdown.

## 0034 — The component layer ("micro templates"): token-access lint, three-value context, no-`sx`-on-leaves, unified overlay scaling

**Accepted · 2026-07-09 · Landed** (owner call — the seven §10 questions in `design-system/component-layer.md` were open at draft and are now settled). All three follow-on items shipped: both lint rules are in `eslint.config.js`, `app/util/overlayScale.ts`, `Stream/Plate.tsx`, `components/CornerBadge.tsx` and the single `AthleteName` with its `sizing` prop all exist. The one clause overtaken by events is §7's third copy — `CompactAthleteCard` was deleted by 0041 §3 rather than migrated.

**Context.** The design-token substrate is single-sourced and parity-tested, and the pure labels/formatters are largely centralized — but the **visual rendering of recurring domain concepts** is not, and that is where drift creeps in. `design-system/component-layer.md` researched the "micro-template" layer (the small presentational, formatting-owning components between the raw tokens and the pages) and surveyed `web/src` (its §7 duplication map). The survey is confirmed against the code: three time formatters (`app/util/time.ts` `formatMs` vs `Speedline/Stopwatch.tsx` `formatTime`, DNF-less, vs `Freestyle/Countdown.tsx` `formatClock` with its own `pad`); the broadcast "protection halo" text-shadow (`rgba(51,60,78,…)`) copied into `Stopwatch`/`Countdown`/`FreestyleTimerDisplay` (`SpeedlineTimerDisplay` a different one-off); `refVw`/`refVh` copied into `Competitor`/`VsOverlay`/`RankingsOverlay` while `WinnerOverlay`/`RoundsSummaryOverlay` use fixed `rem`; the athlete name split reimplemented inline in `AthleteCard`/`CompactAthleteCard` beside the canonical `Stream/AthleteName.tsx`; two flag components (`components/CountryFlag.tsx`, `Stream/FlagBlock.tsx`) + a hand-rolled dual-nation row in `PlayoffBracket.tsx`; plate chrome (fill/stroke/winner-ring) re-declared across `PlayoffBracket`/`RankingsOverlay`/`AthleteNameStrip`; numeral typography (`fonts.numerals` + `tabular-nums`) inline in ~8–9 files; three corner status badges (`ConnectingBadge`/`ConnectionLostBadge`/`AudioMutedBadge`); and two interchangeable token-access styles (the `colors`/`fonts` object import vs raw `var(--tl-*)`, the latter in 7 `.tsx` files). ESLint has **no** anti-hex / off-token rule — the token parity test is the only styling guardrail.

**Decision.** Adopt the COMPONENT_LAYER §9 synthesis and settle its seven §10 questions as the ruling for the layer. Keep the token substrate as-is (`tokens.ts` + `tokens.css` + parity test; **no** migration to `CssVarsProvider` — experimental, and the "must use `theme.vars`" claim was refuted in the research).

1. **Token-access convention is a lint rule, not a suggestion (§10 Q1).** Inside a React/MUI tree, reach tokens through the theme (`theme.palette` / imported `colors`); reach for `var(--tl-*)` **only** in genuinely non-React CSS/SVG/canvas seams. Enforced by a `no-restricted-syntax` rule flagging `var(--tl-` in `.tsx` outside an allow-list.
2. **The `context` prop vocabulary is exactly `"admin" | "control" | "broadcast"` (§10 Q2).** No finer split. A chroma-vs-solid overlay distinction would exist only to toggle the protection-halo shadow/stroke for chroma legibility, and that is already knowable at runtime from `?bg=` via `overlayBg.ts` (`isChromaBackground()`), so a `broadcast` component reads it there instead of forking the enum.
3. **No `sx` on templated leaf concepts; `sx` allowed on containers (§10 Q3).** The leaf micro-templates (`Numeral`, `ElapsedTime`, `AthleteName`, `RankBadge`, `FlagRow`, `ResultText`) do **not** accept `sx`/`style`/`className` (Braid-strict — gaps surface as new variants, not local overrides); container primitives (`Plate`, `Box`, overlay shells) **do**, because they exist to be composed. (This retires `AthleteName`'s current `sx` escape hatch — see item 7.)
4. **Unify overlay scaling on the vw/vh helper (§10 Q4).** OBS captures the overlays at HD 1920×1080 — exactly the reference frame the `refVw`/`refVh` math is keyed to — so the helper is correct to standardize on. Extract `app/util/overlayScale.ts` and **convert `WinnerOverlay`/`RoundsSummaryOverlay` off their fixed-`rem` sizing** onto it.
5. **No component gallery (§10 Q5).** Don't stand up Storybook/Ladle; the standing maintenance isn't justified. Keep `doc/dev/design-system/index.html`; extend it to show a component only if trivial.
6. **Enforcement scope = clear-cut rules only (§10 Q6).** Ship the two unambiguous rules — the **hex-literal ban** in `.tsx` and the **token-access rule** (item 1) — allow-listing `tokens.ts`/`tokens.css`/`overlayBg.ts` (all three carry legitimate hex/`var(--tl-*)`). Add a targeted "use the component" rule only where one canonical component exists to point at and it lints cleanly; **skip** broad/noisy rules (banning all inline `textShadow`, heuristic time-format detection).
7. **`AthleteName` is one component with a `sizing` prop (§10 Q7).** The three copies share an identical first/last split rule and differ only in unit (fixed vs `cqh`); unify as one component with `sizing="fixed" | "cqh"`, not a sibling.

**Consequences.** The work lands as three backlog items, foundation-first (specs in PLANS): `design-token-lint-enforcement` (S — the two rules + allow-list survey, prevents new drift while the rest lands), `formatting-micro-templates` (L — the braid-strict leaves + `AthleteName`/`FlagRow` unification, each wrapping an existing `app/util` formatter), then `overlay-container-primitives` (M — `overlayScale.ts` + the two `rem` conversions, `Plate`, `CornerBadge`, a broadcast protection-halo token/`BroadcastText`). Promotion follows the §8 rule-of-three / formatter-first guidance; recipes (`VsOverlay`, `RankingsOverlay`, admin tables) stay recipes until a second surface needs them. **This is a net-zero visual-change refactor** — the verify expectation is that every overlay/admin/control surface renders identically after migration (the signoff driver over the `/stream/*` set + a control/preview click-through). Three formatter homes differ from COMPONENT_LAYER §7's implication and are absorbed here (formatter-first): `rankLabels` currently lives **inside** `Stream/RankingsOverlay.tsx`, not `app/util`, so `RankBadge` must extract it first; `toAlpha2` lives in `components/CountryFlag.tsx` (map in `components/iocAlpha2.ts`); `splitName`/`fullName` live in `app/types.ts` — all already shared, just not under `app/util`.

## 0035 — Speed false starts: per-lane attribution as session state, a false start never stops the run, software advises the consequence

**Accepted · 2026-07-13** (LAAX rules S2–S4; design settled in PLANS)

**Context.** The old control page had one red "False Start" button that immediately stopped **both** lanes (`stop(-1)`) and flashed "FALSE START". The LAAX rules need more: a false start is attributed to **one** athlete/lane; in qualification a **second** false start (same attempt) fails the attempt (no time), in the finals a second by the same athlete **forfeits the round** to the opponent, and two false starts (both lanes) rerun. Crucially (S4) a false start must **not** stop the live run — the run finishes and the head judge decides on video review. The open modelling choices were where the FS state lives, how the buttons split, and how it reaches overlays.

**Decision.** (a) **State home:** a new pure `app/util/falseStartRules.ts` (capped `FsCount = 0|1|2`, `flagFalseStart`/`shouldRecordTime`/`fsCountsAfterStart`/`deriveFsOutcome`) + session state in `useRaceRecorder` (`fsCounts`, a `runWins` sibling — session-only, **not** persisted on `Time`), rejecting a page reducer (zero shared transitions with the lane timers) and an FS marker on `Time` (rankings/advancement never read it; FS#2 records no Time, so absence _is_ the record — a control reload mid-attempt loses the flag, re-flagging is one tap). "Attempt" (S2) and "round" (S3) are the same unit — one run — so one scoping rule serves both: counters are per-lane per-attempt, survive `reset`/void/rerun, and clear when the attempt closes with an accepted result (a per-lane `attemptClosed` ref consumed at the next start) or the attempt context changes (lane-athlete change, match select/clear, series reset, confirmed round change). (b) **Buttons:** the single phase-dependent button splits into a **pre-GO-only "Abort Start"** (sends `updateText 'START ABORTED'`, resets the lights, **no lane stop** — S4) plus **two always-armed per-lane FS flags** (a jump is flagged during the lights but may be confirmed on video after the run; gamepad 5 = abort, 6/7 = FS lane 1/2). `recordFinish` skips both the Time POST and the lane-result on a lane's 2nd FS, so a run can never auto-tally to the offender — the finals award stays an operator tap (`awardRunTo`, factored with `voidRun` over a shared `discardRunTimes`). Software advises via `deriveFsOutcome` (`rerun-round`/`round-to-opponent`/`rerun-start`/`result-stands`/`awaiting-finish`); the head judge decides (the `deriveFreestyleMatchWinner` house pattern). The 2-vs-1 both-flagged case reruns (a forfeit needs one clean lane) — pinned in the outcome table. (c) **Wire:** `LiveSelection.falseStarts` + a `SpeedlineSnapshot.falseStarts` field (the ADR 0017 §4 route — overlays get it free, snapshot recovery reconstructs a flagged lane on reconnect). **Web-only union change, relay opaque; no server/parity change.**

**Consequences.** The preview/broadcast grows a lane-scoped flashing "FALSE START" / "2ND FALSE START" badge (alert only on a count _increase_, since the selection re-pushes on every OPEN). The console grows a clearable per-lane FS chip + a match-scoped advisory strip that folds in the void/award one-taps. `stop(-1)` and the all-lanes-stop branch are gone; `stop` is now lane-only (`1 | 2`). Removing the auto-stop is a behaviour change operators must be briefed on. Coverage: `falseStartRules.test.ts` (the full `deriveFsOutcome` table incl. the 2-vs-1 precedence), `useRaceRecorder.test.tsx` (FS#2 records nothing / never tallies, counters survive reset+void and clear on context change, `awardRunTo` with/without saved Times), `timerSnapshot`/`SpeedlineTimerDisplay`/`RaceRecorderControls` for the wire + UI. **Owes the manual control+preview realtime smoke** — since closed (`false-start-rules` driver command 24/24, 2026-07-13); only the physical pad + the audible alert stay human. A durable jury record of tolerated first false starts stays an open owner question — a later additive `Time.falseStart?: boolean` slots in without disturbing this session-only design. [As built the pad map is `0` start, `1` reset, `5` abort, `10`/`11` lane-1 stop/FS, `15`/`16` lane-2 stop/FS — the two-handset layout in [`buzzer-hardware.md`](./buzzer-hardware.md), not the `6`/`7` this entry drafted.]

## 0036 — Freestyle board: explicit Quali/Battle modes; the battle break countdown retires for a judge-facing pause count-up

**Accepted · 2026-07-19 · Landed 2026-07-19 · addendum's confirm amended by 0046** (owner call; spec was PLANS
`freestyle-board-rework`) — shipped as-specced: `pauseStartedAt` + the
`PauseClock`, the explicit toggle + `FreestyleSelectionPanel` + the
operator-chronology board order, `LiveSelection.freestyleMode` + the quali
single-hero preview collapse, and the `enforced` plumbing deleted end-to-end.
The `freestyle-battle` driver scenario was rewritten and runs green; the only
residue is the irreducible human **beep listen** on both surfaces (STATUS §2).

**Context.** The Freestyle control board carries two model decisions that field
practice contradicts. (1) **Mode inference:** quali-vs-battle is derived from the
athlete selection (`enforced = both athletes assigned`, ADR 0019 §2 / 0032), and the
board always renders **two** lanes — but qualification runs one athlete at a time, so
a quali operator faces a two-lane board with a dead lane and an implicit mode they
can't see or set. (2) **The battle break:** ADR 0019 modelled the gap between battle
turns as an **enforced 30 s count-DOWN** routed to the next performer
(`nextPerformer`), auto-starting their run at break-zero (`shouldAutoResume`). In
practice there is **no 30 s counter in battle**: the judges pace the changeover
themselves, and what they need is a simple **count-UP** showing how long the pause
has lasted since the last stop. (History guard: the former ADR 0018's count-up "dead time"
_broadcast channel_ was rightly deleted by 0019 — what returns here is a different
thing: judge-facing, control-local, unrelayed. The former 0018's snapshot-recovered `timerId 3`
channel stays dead; `timerId 3` meanwhile belongs to best trick.)

**Decision.**

1. **Mode is an explicit Quali/Battle toggle** on the Freestyle control board — not
   athlete-count inference (rejected: invisible, and wrong the moment an operator
   pre-selects two quali athletes), not round-driven (rejected by the owner: the
   round selector shouldn't force the board shape). The toggle is disabled while a
   lane runs. **Quali renders a single athlete selection + a single timer**; battle
   renders the two-lane board. Best trick (battles only, rule F6) and the match
   selector are battle-only surfaces; the warm-up channel is mode-independent.
2. **Battle has no break clock.** STOP (fall) / TIMEOUT freeze or finish the lane
   exactly as today (persistent budgets, long beep at run-zero — F7), but no
   `start_break` is sent and nothing auto-resumes. Instead a **control-local pause
   count-up** anchors at every turn end (while a next turn is still possible) and
   clears on the next Start/Reset — judge information only, **never relayed, not in
   the snapshot**. A control-page reload during a pause loses the clock; accepted
   (the judges own the changeover pace; re-observing a gap is a glance).
3. **The quali advisory break stays exactly as-is** (reaffirming the 2026-07-01
   field-testing restore): Take-break, the `MAX_BREAKS = 2` allowance, the
   `config.freestyle.breakMs` count-down, hold-at-zero for a manual Start, early
   Start cancels. The break machinery thus becomes **quali-only and advisory-only**:
   the `enforced` flag disappears from the machine, the `start_break` payload, the
   snapshot fields, and the `Countdown` break render (web-only union change; the
   relay stays opaque — no server/parity change; `config.freestyle.breakMs` and its
   edit UI survive as quali parameters).
4. **Deleted:** `routeEnforcedBreak` + the BREAK_ZERO auto-resume branch
   (`battleMachine.ts`), `nextPerformer` + `shouldAutoResume` (`breakState.ts`), the
   `enforced` event/payload/snapshot plumbing, and the athlete-count mode derivation.
5. **The preview/broadcast collapses to a single centred hero in quali**, driven by
   an explicit mode field on the relayed board selection (`updateSelection`) rather
   than inferring from a missing athlete 2 — the ADR 0014/0035 route (re-pushed on
   every OPEN, so late joiners recover it free).

**Consequences.** `battleMachine` shrinks (STOP/TIMEOUT lose `enforced`/`breakMs`; a
`pauseStartedAt` anchor joins the state) and the board gains a mode it can show.
LAAX F5's "auto-resume within ~10 s" clause re-verdicts to ⚪ operator-practice —
the §4.4 rationale (judges control pace) now covers the whole changeover, not just
the stabilise window; F2 (quali breaks) stays ✅. **Supersedes ADR 0019's enforced
branch** (§2 enforced mode, §4 break routing/auto-start — the active-budget model,
warm-up, and quali break stand) **and revises ADR 0032's model** where it encoded
that routing; the 0033 round-change confirm and 0035 selection wiring are untouched.

**Addendum (2026-07-19, the single-mode-control respec — landed 2026-07-19).**
Operator rule: format and mode are the **same** input. The Setup format-preset
button row is gone and the Quali/Battle toggle moved to the top of the Setup
strip as the single control — picking a mode applies its format timings
(`FREESTYLE_FORMAT_PRESETS`, now keyed by mode: quali 120 s run / 300 s warm-up,
battle 150 / 420) behind the same lock + confirm; the manual second-fields stay
as the fine-tune escape hatch. The mode also owns the **Round vocabulary**
(`roundsForMode` / `defaultRoundForMode` in `app/util/rounds.ts`): quali = test +
qualification, battle = test + the playoff rounds, and a mode switch normalizes
an out-of-mode round through `requestRound` (riding the 0033 confirm when a
match is selected). The selection panel keeps an out-of-mode current round
listed — a cancelled normalization or a peer mirror can leave one, and 0038's
wire-values-are-the-truth mirroring is untouched. This is mode→round coupling
only; §1's rejection of round-driven board shape stands. Supersedes the round-1
preset↔toggle coupling landing (the `FreestyleFormatPreset.label`/`mode` fields
are gone with the preset buttons).
The `freestyle-battle` driver scenario was rewritten with it (enforced-break
assertions → pause/toggle/single-lane assertions).

## 0037 — One-button advance: a single buzzer/Space press steps the Freestyle board through its sequence

**Accepted · 2026-07-19 · §1 amended by 0046** (owner request; spec in PLANS `freestyle-one-button-flow`;
builds on 0036's explicit mode + pause anchor — sequenced after it)

**Context.** The reference tool (AugustinMoinat/FreestyleTimer — the same reference
behind 0015/0019/0036) is driven by **one key**: Space toggles run↔break in
quali, and in battle alternates stop-current / start-next, where "next" is whichever
player still holds budget. Our board instead requires per-lane button hunting
(Start/Stop/Take-break × 2 lanes + the best-trick try buttons) — slow and
error-prone for a single operator with a physical buzzer. ADR 0036 deleted the
enforced-break **automation** (`nextPerformer` routing + break-zero auto-resume)
because the judges pace the changeover — but the operator still needs to know which
lane goes next _when they press_.

**Decision.**

1. **One page-level ADVANCE input** — keyboard Space (guarded: never while a text
   input has focus or a dialog is open) plus one pad button constant, default
   **index 10** (0–9 are all claimed: lanes 0/1/2/4 + 5/6/7/9, best trick 3/8) —
   dispatches a single reducer event. The per-lane buttons stay as the manual
   override; warm-up stays outside the cycle (own buttons, reference parity).
2. **Battle cycle:** a running lane → that lane's STOP (turn end; the 0036 pause
   count-up anchors); nothing running → START the **advance target** = the other
   lane than the one that last ran if not `finished`, else the same lane if not
   `finished`, else no-op (both spent = battle over). First press starts lane 1.
   While the best-trick series is armed, ADVANCE routes there instead: no try open
   → `START_TRY(currentTurn)`, try open → `END_TRY`.
3. **Quali cycle:** idle → START; running → TAKE_BREAK if allowance remains, else
   **no-op** (a press never kills a run — Stop stays a deliberate manual act);
   onBreak / hold-at-zero → START (the existing early-start cancel); finished →
   no-op (Reset stays manual). This is exactly the reference's run↔break toggle.
4. **This does not reopen 0036's no-auto-resume:** nothing fires on a timer edge —
   every transition stays a human press. What returns from the deleted
   `nextPerformer` is a slim pure `advanceTarget` _suggestion_ consumed only by the
   press (plus a "Next:" hint on the board), not routing; the battle store gains
   `lastRan: PlayerId | null` to derive it.

**Consequences.** `battleMachine` gains `ADVANCE` + `lastRan` + `advanceTarget`
(cycle-table tests for both modes); the try-series routing lives at the page so the
two reducers stay independent. The board shows a small "Next: <name>" hint beside
the pause clock so the operator can trust the buzzer blind. The pad index is one
constant pending real buzzer hardware — many USB buzzers present as keyboard Space
(works as-is) or as pad **button 0**, which would collide with lane-1 Start and
need that mapping re-homed; venue call, flagged in the PLANS spec.

**Addendum (2026-07-20, athlete-display-next-up — landed).** The same `nextUp`
hint now also warns the **audience**: the battle athlete display
(`/freestyle/athletes` + `/stream/athletes-freestyle`) shows a subordinate
"NEXT UP: <name>" during the changeover pause. The board's `advanceTarget` is
control-local, so it rides the relayed board selection as an additive optional
`LiveSelection.nextUp` (battle-only, null while a lane runs — the same window as
the board's "Next:" hint), consumed by `useFreestyleTimerFeed` and recovered on
OPEN like `freestyleMode`/`bestTrick`. The one source is the battle reducer's
`advanceTarget`; the display never re-derives next-up from replayed timer
messages (that echo-derivation is the thing the peer-mirroring/state rules
forbid). This **supersedes the "next-up marker deliberately NOT ported" clause**
carried on `FreestyleAthleteDisplay` since ADR 0036: 0036 deleted the enforced-
break _automation_ (`nextPerformer` routing), not a pure human-facing hint — and
0037 already re-legitimized that hint on the operator board. Web-only union
change, relay-opaque; no server/parity change.

**Addendum (2026-09-07, `fsux-advance-route` — landed).** The cycle tables above
are unchanged, but the router moved OUT of the reducer: `battleMachine`'s
`ADVANCE` event is deleted and `app/util/advanceRoute.ts` (`advanceRoute` →
`advanceLabel`) now decides which machine and which event a press dispatches,
returning an explicit `{ kind: 'noop', reason }` for each of the four dead ends.
Two reasons, both from ADR 0046: the board must render the _same_ decision the
press will dispatch (a reducer-internal delegation cannot be labelled), and a
mode-shaped `ADVANCE` inside the battle machine could not reach the try series
at all — that half of the routing already lived on the page, so the press had
two routers. The page now cues **after** deciding: `short` on a real route,
`alert` on a no-op (0046 §"cue after decide").

## 0038 — Control panels are mirroring peers: any panel may act, writes bind to local operator actions

**Accepted · 2026-07-19** (owner request; specs in PLANS
`control-panel-peer-mirroring` + `freestyle-control-peer-mirroring`; revises the
single-owner premise of 0011/0027 — both otherwise stand. **§3's echo-drop
mechanism retired by 0043**: control pages are single-socket now, so no page
receives its own sends; `senderId` survives as the §4 LWW tiebreak)

**Context.** 0011/0027 assume exactly one control page per session: control is
"the sole owner of live state", broadcasts but never ingests peer timer
messages, and treats the relay echo of its own messages as a non-channel. A
second open control panel (a backup operator, a second device, a leftover tab)
therefore silently diverges: its Start/Stop buttons derive from its own idle
state while a race runs on the other panel, stopping from it is impossible
(`canStopLane` reads local state), both panels answer `request_state` with
disagreeing snapshots, and both re-push `updateSelection`/`updateLaneNames`
from their own recorder — fighting over what the overlays show.

**Decision.** Control pages become mirroring peers, all equally able to act:

1. **Mirror, don't own exclusively.** A control page applies incoming peer
   timer messages (Speedline `start`/`stop`/`reset`/`updateText`/
   `updateSignalPhase`; the Freestyle countdown family) and `updateSelection`
   into its own state, and sends `request_state` on open — the preview's 0011
   catch-up pattern, including the live-beats-snapshot guard and the
   cross-mode snapshot drop.
2. **Writes bind to local operator actions.** A peer-applied event NEVER
   writes to the data plane (no Time/Score POST, no Match winner PUT): the
   panel where the operator physically acted does the write, so every write
   keeps exactly one author and two panels can't double-record.
3. **Self-echo is discriminated, not load-bearing.** Every page stamps a
   per-mount `senderId` on outgoing messages and drops incoming ones carrying
   its own id (the relay echoes a page's sends back on its second socket —
   0027). An additive envelope field; the relay stays opaque, no server change.
4. **Conflicts are last-writer-wins.** Near-simultaneous actions on two panels
   converge on the last relayed message; no locking, no leader. Both panels
   keep answering `request_state` — converged panels agree.

A leader/follower lock (second panel read-only) was rejected: it blocks the
real backup-operator/second-device use case and needs leader election over a
deliberately stateless relay.

**Consequences.** A second panel's buttons stay true, and either panel can
stop, reset, or abort a heat the other started. Accepted risks: an RTT-window
race on simultaneous conflicting actions, and a selection mistake now
propagates to every panel. Speedline + the shared plumbing landed first;
Freestyle mirroring landed the same day on top of the 0036/0037 reducers as a
dedicated `PEER_*` event family (wire values are the truth, guards invert to
last-writer-wins, never a `ws` effect — the drain can't re-broadcast; audio
stays per 0015 §3, deduped against the local expiry timers, which keep arming
off mirrored state so whichever panel survives still fires the period end).

**Addendum (2026-09-25, §2 clarified).** A panel MAY delete its own persisted
record when a peer withdraws the lane it recorded (`notePeerResume`). The
timeId lives only in the feedback of the panel that POSTed it — the peer never
saw the reply, so it has nothing to relay and no panel but the holder can
retract the row. That is a withdrawal of this panel's own write, not a second
author for it, and it is idempotent; the alternative (relaying the timeId on
`resume`) cannot work without first broadcasting timeIds, so §2's "writes bind
to local operator actions" holds unchanged and the wire is untouched.

**Addendum (2026-07-19).** The mirrored-field set was incomplete: a peer's
live `updatePreview` (show/hide-preview) toggle was converged only by the
join-time `state_snapshot`, so a later peer toggle drifted until the next
`request_state`. `useControlSession` now mirrors `updatePreview` live too
(write-free ref+state set — no re-broadcast, so no cross-panel echo).

**Addendum (2026-07-19, §3 completed).** One raw-echo reader had survived the
landing: the Freestyle control page's Countdown/BestTrickPanel clocks still
rendered off the raw receiver stream, so a _local_ start ticked the local
display only via the relay echoing it back. `useControlSession` now merges
local live-timer sends (mirrored at send time — no relay round-trip, clocks
tick with the socket down) with peer live-timer messages into one
`displayMessage` stream and stops returning `lastJsonMessage`; the self-echo
is now dropped everywhere and genuinely non-load-bearing.

**Addendum (2026-07-20, §4 needs a tiebreak for `updateSelection`).** "Converge
on the last relayed message" was unsound for the selection: a value-changing
peer application re-pushes (the push effect can't tell a local edit from a
mirrored one), so two selection edits crossing in flight make each panel adopt
and re-push the value it doesn't hold — on **every** round trip, forever. The
value guard never fires (identical consecutive values never occur), and no
symmetric protocol can converge a crossed pair; a two-panel FIFO-delivery
simulation test pinned the oscillation as unbounded, not the assumed "few
round trips". `updateSelection` therefore carries an optional last-writer-wins
stamp: `useControlSession` mints a monotonic `seq` (wall-clock anchored,
Lamport-bumped past everything seen; the envelope `senderId` tiebreaks equals)
on every outgoing selection and drops incoming ones at or below its last seen
stamp — exactly one side of a crossed pair yields, quieting the room within
two round trips. Additive: unstamped (pre-feature) messages apply
unconditionally, the relay stays opaque. Since 2026-07-20 the passive
consumers (`useStreamRefresh`, the timer displays' selection followers) apply
the same drop-if-stale rule (`app/util/selectionLww.ts`) rather than ignoring
the field — arrival order across the relay fan-out is not the send order, so
the losing side of a crossed pair could otherwise roll an overlay back. Timer
messages don't need this — they carry epochs and converge on wall-clock truth,
and `updatePreview`/`state_snapshot` application never re-broadcasts.

**Addendum (2026-09-10, §4 minting is for LOCAL edits only).** A mirrored
re-push was minting a _fresh_ wall-clock stamp for a value it had only ADOPTED,
so a mirror whose adoption diverges (it rebuilds its own `bestTrick` wire view)
outstamped the acting panel's very next edit — minted in the same millisecond —
and the whole room dropped it: a peer match change left the mirror armed on the
series belonging to the match it had just left, because the retracting
`bestTrick: undefined` lost to the echo of the value before it. The echo now
**forwards** the stamp it accepted, so it can only tie, and a tie is resolved by
`senderId` rather than by the mirror's clock. It stays one-shot: the forward is
armed on acceptance and consumed by the adoption's own push, and dropped in the
same commit when that push never comes (an equal or ignored peer selection
changes nothing), so a local edit always mints its own authority. The mirror
keeps re-pushing — with the stamp forwarded it is a re-statement, not a claim,
and it is still how a panel whose adoption diverges tells the room.

**Addendum (2026-09-10, every mirrored frame arms the forward, not only a
selection).** The same mint was reached by the other class of peer frame. A board
sends **two** frames for one operator event — the selection and the drained
countdown — and a peer's countdown moves the mirror's DERIVED selection too (a
try clock starting or resting flips `bestTrick.clockRunning`/`turn`), so the
re-push that follows was minting fresh authority for the acting panel's own
event and getting that panel's real edit dropped: a mid-try `Reset series` left
the mirror on the tally it had just cleared. The forward is therefore armed for
**any** frame `peerEventKind` counts as mirroring (an `updateSelection` refines
it to the stamp just accepted); the one-shot consume/drop is unchanged, because
the drop already keys on that same peer-event token. This closed one race, not
the class — the residue was `fsux-peer-series-stamp-race` in STATUS §3, closed by
the addendum below.

**Addendum (2026-09-22, §4 ranks authority on the wire, not sender id).** The
residue was not an unlocated timing window — it was a **coin flip fixed at
mount**. A mirror's re-push forwards the stamp it adopted, so it can only
**tie** the panel that authored the value, and `acceptSelectionStamp` broke ties
on `senderId`: two `crypto.randomUUID()`s. Whether a re-statement outranked its
own author was therefore decided once, for the life of the room, by which UUID
sorted higher — the 50 % run-level split on `peer-mirroring`, with the red
rotating through `fs best-trick` / `fs series-reset` / `fs peer-match` because
the coin flip is necessary and the timing window only selects which leg pays.
A second instance of the same class went uncovered: the `request_state` answer
minted **fresh wall-clock authority for a value the panel merely holds**, so a
mirror answering a joiner mid-event restated its pre-adoption tally above the
acting panel's live edit, at every consumer, until the next edit.

`updateSelection` therefore carries an optional `echo?: true` — _a re-statement
of an adopted value, carrying the stamp it adopted; it must lose every tie_ —
and `acceptSelectionStamp` ranks `seq`, then **authority**, then `by`: an
authoritative frame beats a stored echo at equal `seq` (a consumer that took the
echo first is corrected when the author's frame lands), an echo never beats a
stored authoritative frame, echo-vs-echo still falls back to `by`, and unstamped
messages still pass untouched. Both emitters follow: a forwarded stamp and the
`request_state` restatement go out marked `echo` (derived as
`echo === (forwarded !== null)`, so the flag cannot drift from the forward it
describes) and **no longer overwrite** `selectionStampRef` — the old overwrite
downgraded the panel's own stored authority to the mirror's id and re-opened the
tie against a third panel's echo. A panel holding no stamp yet still mints under
the `stampAnchoredRef` rule, so the joiner-defaults guard is untouched.
Additive and web-only: the relay stays opaque, no server change, no snapshot or
reducer change.

This supersedes the 2026-09-10 addenda only in _how a tie resolves_. The mirror
keeps re-pushing, and a consumer that missed the author's frame entirely (higher
`seq` than anything it holds) still recovers off the echo free — a diverging
panel simply can no longer tell the room _against_ the author. Rejected on the
way, and not to be relitigated: carrying the tally on a single channel (the
tally already rides one — what is duplicated is the clock, and the only truly
single-channel design puts a tick anchor behind a droppable stamp, where a lost
frame is a clock that never starts), and suppressing the mirror's echo (needs a
per-field authorship bit, silences the divergence report, and fixes one field
where the ranking fixes the class for `runWins`, `falseStarts`, `nextUp` and
`freestyleMode` at once). The coin flip is a **test dimension** now: the
two-panel convergence simulation runs `describe.each` over both id orders.

**Addendum (2026-09-23, §4's stamp forward is causal, not a commit window).** The
last residue of the class: the forward was armed by _when_ a frame landed, not by
_what_ it caused. A peer frame arriving in the render the operator acted in lent
its stamp to that LOCAL edit, which then went out marked `echo` — and a
re-statement loses every tie by design, so every peer dropped an edit nobody had
re-stated (`fs best-trick: B's tally consumes the try`, `fs series-reset`, 1 red
run in 5). Worst when the frame moved nothing here (a re-push of a value this
panel already holds): no adoption follows to re-push the edit under authority of
its own, so it is gone for good. A peer frame reaches the selection only through
a state write, so the adoption it causes lands no earlier than the NEXT commit:
the arm therefore records the selection **signature this panel held when the
frame landed**, and the push forwards the stamp only for a value that differs
from it. An equal signature is the operator's own intent — the forward is dropped
and the frame mints fresh wall-clock authority (`echo: false`), and the adoption
still to land re-pushes the MERGED value, which is what carries the operator's
edit to the room. The check sits on the selection push itself because the board
sends the selection **before** it drains the countdown belonging to the same
operator event, so ending the forward on a local live-timer send would be one
frame too late. Implementation-only: wire, snapshot and rank are untouched, and
the one-shot consume/drop on the peer-event token is unchanged.

**Addendum (2026-09-25, a mirrored best-trick series dies with the context, not
with the field).** The class's last red (`fs peer-match`, reliably 100/102 on
the mainline) was not in the stamp at all. A peer's match change sends the board's
whole answer as separate frames — the bestTrick-less `updateSelection`, the lane
names, the drained `reset_countdown(0)` — and the mirror hung its disarm on the
one field of the one frame: `PEER_SELECTION` with no `bestTrick`.
`PEER_CONTEXT`, dispatched from the same `applySelection` call, merely _recorded_
the new match, on the reasoning that the peer's field should decide the phase's
fate. So while that field had not been applied, a panel held a series belonging
to the match it had already adopted — and every re-push it made carried an armed
`bestTrick` stamped with the peer's NEW match, which re-armed the panel that had
just left it.

`PEER_CONTEXT` now **drops the mirrored series itself** — silently, where the
local `CONTEXT` rule broadcasts (a `reset_countdown(0)` from the mirrored path
would freeze the acting panel's own clock, and it has already sent its own). The
peer's field still decides the outcome: the `PEER_SELECTION` riding the same
frame re-arms the store when the phase survived the change. It just no longer
has to _arrive_ for the stale series to go — so the unordered clock frames of
the same event find nothing to keep or re-arm on either side of the selection,
and the illegal state (a series under a context the board has left) stops being
reachable rather than being detected. Reducer-only, as §4 resolved: the relay
fans out concurrently by design and the preview already tolerates reorder.

## 0039 — Freestyle score values: no imposed judging resolution, float noise normalized at the formula boundary, 2-decimal display

**Accepted · 2026-07-19** (owner request; spec in PLANS
`freestyle-score-precision`)

**Context.** Freestyle score values are IEEE 754 doubles end-to-end (JS has one
number type; DynamoDB stores exact decimals wider than a double — nothing to
widen). But `computeOverall` is plain float addition, so decimal inputs produce
binary-representation noise (`8.1+7.2+6.3+5.4−0.3 → 26.700000000000003`) that
is **stored** as the overall, **rendered raw** on the admin ScoresPage /
freestyle-rankings rows / the console's computed-overall preview, and — the
correctness problem — **compared with `===`** in `deriveFreestyleMatchWinner`'s
tie detection and by the server ranking sort: two mathematically equal overalls
built from different component mixes can differ by ~1e-14, silently declaring a
battle winner (or skipping the judged-component ranking tiebreak) off
representation noise. Display was also inconsistent: overlays `toFixed(1)`,
admin/console raw.

**Decision.**

1. **No judging resolution is imposed** (owner call). Judges may enter any
   decimal; components and an explicit `overall` override are stored exactly as
   entered. Rejected: rounding scores to a fixed step (tenths/hundredths) —
   quarter-point entries are real and must not be distorted.
2. **Normalize noise, not values.** `computeOverall` (both parity-guarded
   copies) rounds its result to **6 decimals** — orders of magnitude finer than
   any human judged input, orders coarser than the ≤1e-12 binary noise at
   overall magnitudes (max 120) — so equal sums become bit-identical without
   touching entered precision. The server's `validateScoreInput` normalizes an
   explicit `overall` the same way; tie/winner comparison compares normalized
   values.
3. **Display is 2 decimals everywhere** via one shared formatter
   (`app/util/resultLabel.ts`): overlays (through `freestyleResultLabel`, which
   the H2R bridge inherits), admin tables, and the console previews. The
   `combined` standings figure stays `toFixed(1)` — it is a **rank average**
   (steps of 0.5), not a judged score.

**Consequences.** Exact-tie detection and the difficulty-first ranking tiebreak
fire on mathematical equality, not float luck; no migration (prod holds zero
Scores, local re-seeds). The 6-decimal constant and the formatter are the two
new invariants; both live beside the formula they guard and ride the existing
web↔server parity test.

## 0040 — The freestyle Score field `composition` is renamed `combo`, hard, with no back-compat

**Accepted · 2026-07-19** (spec in PLANS `score-combo-rename`)

**Context.** The Score's second judged component was `composition` in every
type/API/DB field — legacy timertimer vocabulary. The LAAX 2026 rules (F8) call
it **Combo**, and the UI had half-renamed: admin table headers and the console
label said "Combo"/"Compo" while `ScoreForm` said "Composition" and the
wire/storage field stayed `composition` — a standing translation layer in every
head that touched scoring.

**Decision.** Rename the field **`composition` → `combo`** everywhere in one
atomic commit: web+server types (`Score`/`ScoreInput`, `computeOverall`,
`SCORE_COMPONENT_MAX`, `validateScoreInput`), the stored DynamoDB attribute
(`core/mappers.ts`), the ranking tiebreak (`JUDGED_TIEBREAK` — priority order
unchanged: difficulty → combo → style → bestTrick), all labels ("Composition" →
"Combo", console "Compo" → "Combo"), seed scripts/fixtures, the driver, and the
docs. **No dual-read aliasing, no DDB migration**: prod holds zero Score
records (seeding is still a §2 ship blocker and writes reject unknown
`compId`s), local data is re-seedable, and the API field's only consumers are
this repo. Rejected: back-compat aliasing — a permanent tax to protect data
that does not exist.

**Consequences.** Code, API, storage, and rules vocabulary agree; the parity
tests pin both copies. Pre-rename **local** rows read `combo: undefined` —
re-seed (`db:seed`) rather than alias. This ledger stays append-only: ADR 0010's
formula text keeps its historical `composition`.

## 0041 — Overlay owner calls resolved: idle signal goes dark, idle digits get the footage halo, the compact bracket variant retires, "SMALL FINAL" stays

**Accepted · 2026-07-20** (owner resolutions over the parked `human-tasks.md`
owner decisions from the overlay HD review)

**Context.** Three overlay owner's calls sat parked: (1) the idle
`/stream/timer*` `StartSignal` paints both bulbs red indefinitely (the
documented "armed standby"), which on air reads as an error/recording indicator
and collides with the abort colour language; (2) idle timer digits carry no
footage scrim and can vanish keyed over dark footage ("idle is sparse by
design" was the standing choice); (3) the compact bracket cards' deliberate
photo-lessness reads as failed image loads (`compact-card-idle-fill`), blocked
on fill-vs-collapse direction; plus the open vocabulary question whether the
bracket caption keeps the rules' "SMALL FINAL" or renames to "3RD PLACE MATCH".

**Decision.**

1. **Idle signal goes dark.** Phase 0 renders unlit bulbs; red arms only from
   `PRE_BEEP_PHASE`. The shared `StartSignal` serves preview and broadcast
   alike — one behaviour, no variant fork. "Armed standby" is retired.
2. **Idle digits get the standard `overlayTextShadow` footage halo** in the
   shared timer displays ("idle is sparse" stays for layout, not legibility).
3. **The compact bracket variant retires.** The owner's condition was "keep
   only if SVG source art exists"; the delivered masters cover **Profile** and
   **Name** brackets only (the client-delivered LAAX vector masters, which are
   not part of this repository — see design-system §7), so `?variant=compact` and
   `CompactAthleteCard` are removed and cleaned up rather than redesigned.
4. **"SMALL FINAL" stays** — the rules' vocabulary wins over a viewer-jargon
   rename. No code change (the landed labels already read SMALL FINAL).

**Consequences.** Both codeable follow-ups have landed
(`timer-idle-broadcast-treatment` — phase 0 renders `race.idle` bulbs and the
shared displays carry `overlayTextShadow`; `compact-bracket-variant-removal` —
`CompactAthleteCard` and `?variant=compact` are gone); (4) and the checks in (3)
closed with no code owed. The `display-signoff` smoke's
pre-beep-red assertion is untouched by (1). Shared helpers the compact cards
used but don't own (`useFitToWidth`, `overlayTypeFloor`) survive (3). Future
reviews must not re-file: red idle bulbs, the sparse idle digits, the
compact-card fill, or the caption rename.

## 0042 — Control selection filters cascade Round → Gender → Match → Athletes; the gender select joins the ADR 0033 confirm

**Accepted · 2026-07-20** (operator request `control-selection-cascading-filters`)

**Context.** The 2026-07-20 operator review asked the Speed + Freestyle control
selection panels to filter their dropdowns as early as possible: each choice
narrows the following dropdowns, and with a match selected only its related
options remain selectable. Round already narrowed the match list behind the
ADR 0033 confirm and gender scoped the match fetch, but the athlete pickers
always listed the whole pool — and a gender change with a match selected
silently stranded the selection (`selectedMatchId` survives the gender-scoped
refetch, so the label degrades to the raw id and winner PUTs silently no-op).

**Decision.** The cascade order is **Round → Gender → Match → Athletes**, one
rule in two directions, generalizing ADR 0033:

1. **Below a choice, option lists narrow strictly.** Gender narrows the athlete
   pickers to `selectedGender` athletes; a selected match narrows them further
   to its two assigned athletes (+ "— not recording —", so a lane opt-out and a
   manual swap stay possible; a TBD slot isn't listed). One pure shared helper,
   `app/util/athleteOptions.ts`, feeds both panels and always keeps the current
   pick listed even off-filter (peer-mirrored selections must show what will be
   recorded — the `roundOptions` pattern).
2. **Above a selected match, changes are confirm-guarded.** The gender select
   rides the same confirm as the round: `pendingRound` generalized to one
   discriminated `pendingChange` union (`{ kind: 'round' } | { kind: 'gender' }`
   — the two pendings can't coexist) with `requestRound` / `requestGender` /
   `confirmPendingChange` / `cancelPendingChange` on both recorder hooks.
   `setSelectedGender` left the hooks' public API (the guard is the only door);
   the peer path (`applySelection`, ADR 0038) still sets directly — wire values
   are the truth and bypass local confirms. A match-less gender change applies
   immediately and clears the now-off-filter athlete picks (speed also drops
   the FS counters — a new attempt context, as with `setLaneAthlete`).

**Consequences.** Web-only, display + local state — no relay/protocol, server,
or entity change. Touches both recorder hooks and both selection panels; the
hook/panel suites pin the gender guard and both narrowings, and
`athleteOptions` is table-tested. An off-bracket run with a match selected now
requires clearing the match first (the narrowing is the point of the request).

## 0043 — Control pages open one relay socket; the sender/receiver pair retires

**Accepted · 2026-07-22** (owner request; retires 0038 §3's echo-drop mechanism —
§3's _intent_, self-echo as a non-channel, now holds by construction)

**Context.** Both control pages opened **two** relay connections (a send-only
"sender" and a receive-only "receiver", via `useControlSession`). The pattern
existed because the relay excludes only the sending _connection_ from its
fan-out, so a second connection was the only way for a page to receive its own
messages — and originally that loopback was load-bearing: the control's lane
clocks and Stop enablement fed off the AWS echo (0027 context), and Freestyle
used it for cross-lane orchestration (0015/0019). Every consumer of the echo
has since been removed — 0027 lifted Speedline lane state into the page, the
0036/0037 reducers replaced the Freestyle loopback, and 0038 §3 added the
per-mount `senderId` stamp precisely so the surviving echo could be _dropped_.
End state: the second socket's only remaining function was receiving peer
traffic — which the first socket also receives — while costing a second
`$connect` authorization + DynamoDB connection row + 8-min keepalive per
control page, plus one wasted `PostToConnection` per operator send (the echo,
delivered only to be discarded), and the filter machinery to discard it.

**Decision.** `useControlSession` opens **one** socket for both directions
(every other page already did). The incoming stream is peer traffic by
construction — the relay never fans a message back to the connection that sent
it — so the `senderId` self-echo filter is deleted rather than kept as dead
defense. `senderId` itself stays on the envelope: it is the equal-`seq`
tiebreak of the 0038 §4 selection LWW stamp. The `request_state`-on-open
effect, previously gated on both sockets reaching OPEN, keys on the one
socket's `readyState`; the hook returns a single `readyState` (the pages'
`senderWSState`/`receiverWSState` split collapses with it). The relay contract,
message unions, and peer-mirroring semantics are untouched — no server change.

**Consequences.** Half the WS connections per control page (one fewer
authorizer invoke + DDB row + ping loop), no self-echo `PostToConnection` per
send, and one less state axis (a page can no longer be half-connected with the
sender up and the receiver down — the truthful-buttons gate and the
mirror-on-open gate now read the same socket). Trade-off: send and receive now
share one TCP connection's fate — a reconnect blackout hits both directions at
once instead of possibly only one; acceptable, since a half-open pair was
never a designed-for state (every gate demanded both OPEN anyway). The
own-echo unit tests (impossible scenario now) were removed with the filter.

## 0044 — The best-of-3 series tally is athlete-keyed; overlay sides follow the board's lane pairing

**Accepted · 2026-07-24** (extends 0017 §2/§4; hardens the 0038-era lane swap)

**Context.** Every persisted record is keyed by **athlete** — a `Time` binds to
whoever stands on the lane at stop time, `Match.winnerId` is an athlete id, the
freestyle plane is athlete-keyed end to end. Two things were still keyed by
**physical lane** and silently assumed `athlete1 == lane 1` for a whole match:
the recorder's best-of-3 `runWins` tally (0017 §2), and the head-to-head
overlays' side order. But athletes routinely **switch sides between the runs**
of a best-of-3 (neutralising a lane advantage), and the Swap button
(control-athlete-lane-swap, 2026-07-20) deliberately left `runWins` untouched —
so a mid-series swap re-credited every earlier run-win to whoever now stood on
that lane, and the clinch could PUT the **loser** as `Match.winnerId`. On air,
the overlays disagreed among themselves: SVO-B and the lane names follow the
board's live `selection.athlete{1,2}Id`, while the VS card rendered the
persisted `match.athlete1Id` left — and the rounds-summary overlay paired
selection-order **names** with lane-keyed **digits**, mislabelling the tally
after a swap.

**Decision.**

1. **The tally's identity is the athlete.** `useRaceRecorder` keeps
   `seriesWins: Record<athleteId, number>`; a completed run credits the athlete
   on the winning lane _at the moment the run resolves_, void/award undo by
   the credited athlete id (`lastRunWinnerId`, not the lane), and the clinch
   check (`seriesWinnerId`) yields the athlete directly. `tallyFromTimes`
   reseeds athlete-keyed (its `athlete1 == lane 1` orientation assumption
   drops out). Lane-oriented consumers read a **projection**: `runWins =
laneRunWins(seriesWins, laneAthletes)`, recomputed through the live pairing
   each render.

2. **No wire change.** `updateSelection.runWins` keeps its `{ 1, 2 }` shape —
   it is the lane **view** projected through the SAME message's
   `athlete1Id`/`athlete2Id`, so any consumer pairing name↔digit from one
   message is consistent by construction (the rounds-summary overlay needed no
   code change). Peer panels re-key the wire view by those athlete ids on
   application (ADR 0038 mirroring), so swaps converge across panels.
   Additive-compatible with pre-feature senders.

3. **Swap is a full athlete-context exchange.** `swapLanes` carries every
   athlete-scoped piece to the new side: the FS counters (already did), the
   attempt-closed markers, this run's lane results, and the save feedback (so
   a post-swap hand-timer correction edits the right athlete's Time). The
   series tally needs no touch — athlete-keyed. Only the physical stopwatches
   stay lane-fixed, so the console **disables Swap while a heat is live**
   (lights running or a lane timing — `swapLocked`, fed by the control page's
   live lane state); between runs it stays enabled, which is exactly the
   side-switch moment.

4. **One source of truth for on-air side order: the board's live pairing.**
   `VsMatchup` renders in selection order via `matchSideOrder` — honoured only
   when the live selection names _this_ match with its two athletes exactly
   transposed (a pure swap); anything else (another match, a hand-edited
   athlete, no selection yet) falls back to the persisted match order, so a
   stale or foreign push can never misplace a card. All result data is
   athlete-keyed, so a swap moves the cards, never the numbers. SVO-B, the
   lane names, rounds-summary and VS now all agree with the operator's board.

**Consequences.** A between-runs side switch is now a supported operator action
with correct points, winner writes, and broadcast graphics; the freestyle plane
was already athlete-keyed and is untouched. The recorder exposes the same
lane-view `runWins` API as before (tests and consumers unchanged). Residual
edge: clearing a lane's athlete mid-series hides (locally: parks) that
athlete's run-wins until they are re-assigned — acceptable, as un-assigning
mid-series has no competition meaning and the Times-based reseed recovers the
truth.

## 0045 — Per-competition manager ACL: a third scoped role, grants keyed by Cognito sub

**Accepted · 2026-07-26**

**Context.** Authorization was binary and identity-blind: any member of the
shared ISA Cognito `timeradmin` group became a **global** admin
(`{ role: 'admin', compId: '*' }`) over every competition, and any ISA user
_not_ in the group was rejected outright at both the client gate and the server
authorizers. There was no way to let one person run one event without handing
them the keys to all of them (the parked "Per-user competition ACL" item). ISA
runs several events on the shared pool; the `timeradmin` group is owned by ISA
and can't grow a group per event.

**Decision.**

1. **Three roles.** `admin` (a `timeradmin` — global superadmin, unchanged),
   `manager` (any other authenticated ISA user — read+write scoped to the
   competitions granted to them), `reader` (overlay read token — unchanged).
   Both authorizers now carry the caller's `sub`/`email` in the context; a
   verified ISA login without the group is a `manager`, no longer a deny.

2. **Grants are keyed by the immutable Cognito `sub`.** The admin grants by
   email; the managers Lambda resolves email→`sub` via `cognito-idp:ListUsers`
   at grant time and stores the `sub`, so a later email reassignment can't
   inherit access. Grants live in the competition table as an item **pair** —
   forward `COMP#<compId>/MANAGER#<sub>` (check access, list a comp's managers)
   and reverse `USER#<sub>/COMP#<compId>` (list a manager's comps) — written and
   deleted transactionally (`core/keys.ts`, `core/competitionDb.ts`).

3. **Isolation is enforced server-side, per request.** `requireCompAccess`
   (now async) admits a manager only when a live grant lookup for
   `(sub, compId)` succeeds; `requireWrite` additionally rejects readers. The
   WS `$connect` authorizer runs the same grant check against the joined
   session, so an ungranted manager can't even open the socket. `POST
/competitions` (create) and the manager-management routes stay
   `requireAdmin` (superadmin only). The client gate (`RequireSignedIn`,
   formerly `RequireGroup`) now admits any ISA login and hides the
   superadmin-only affordances on `isSuperadmin`; enforcement is not there.

**Consequences.** A manager operates only their granted competitions —
`GET /competitions` is filtered to the grant set, every entity read/write is
scoped, and the timer socket is gated. Revocation is immediate for HTTP (the
grant is read live per request; the 60s authorizer cache memoizes only role
classification, not the grant); an already-open WS socket survives to its
disconnect/TTL — a deferred follow-up can force-close a revoked manager's
sockets (generalizing `disconnectSessionReaders`). Two accepted costs of the
scheme: (a) the **gateway ingress surface widens** from "timeradmin members"
to "any verified ISA login" — an ungranted ISA token is now authorized at the
gateway and burns an entity-Lambda invocation + one grant read before its 403
(bounded by the 20 rps stage throttle and reserved-concurrency caps); (b) a
revoked manager's **reconnect attempts stay silent**: on an established
session `useWS` deliberately does not raise the denied screen (the same
`everOpened` guard that keeps a live control page mounted through a venue
network blip), so denied reconnects just retry at the jittered 30s-capped
backoff (~2 authorizer calls/30s/tab) until the page is left. A **pre-open**
denial (e.g. a stale selected comp after revocation) does surface — and is
recoverable in place: the denied screen offers "Go to competitions", and the
competitions list drops a selection the server-filtered response no longer
contains. New dependency + IAM: the managers Lambda carries
`@aws-sdk/client-cognito-identity-provider` and a `cognito-idp:ListUsers`
grant on the ISA pool — sound as one in-stack statement only if the backend
deploys into the pool's own account (which is why the stack builds that ARN
from the deploying account, not a literal); otherwise a cross-account role is
required (see `human-tasks.md`). Email→sub resolution grants only on
an exact, unique email match (duplicates → not found — never guess on an
access decision). Offline dev has no Cognito, so the `local-dev` operator
stays a superadmin and the manager path is exercised by unit/integration
tests + a dev-stack deploy (the managers UI itself works offline via a
deterministic fake sub in `core/cognitoUsers.ts`).

## 0046 — Freestyle board UX contract: the TALLY plate as a third ADVANCE trigger, locks replace the format confirms, the re-arm chip becomes a button

**Accepted · 2026-09-07 · revised same day (iteration 2) · §2 amended 2026-09-08
(`armedMs` rides the snapshot) and 2026-09-23 (it rides `timerId 0` too) ·
accepted 2026-09-08 on its stated trigger, the
first landed `fsux-*` slices — Rounds 1–6 were in and §§1–4 all built · §5 added
2026-09-10 (expiry-tone ownership) and built the same day
(`fsux-expiry-beep-owner`), so §§1–5 are all in; the §3 tone listen stays a
human check** (from the freestyle-board design review;
brief in
[`design-system/freestyle-board-ux.md`](./design-system/freestyle-board-ux.md))

**Context.** A five-lens audit of the Freestyle control page scored it 4.2/10:
the board renders almost none of what its reducers know (no mode, no next-press
statement, hue-only lane state), "live" is defined three different ways so a
quali break leaves Setup open and `Set both lanes` RESETs a held run, two
native `window.confirm`s sit in the live path, every time-critical control is
under 44 px, and the non-happy paths (failed save, blocked audio, a silent
peer Start, a no-op press) are computed and discarded. Three of the fixes touch
settled text: ADR 0037 §1 names exactly two ADVANCE inputs (Space + pad 10);
the ADR 0036 addendum puts the mode/format switch "behind the same lock +
confirm"; ADR 0015 names a "re-arm chip" and a `long` beep on every expiry.
The iteration-1 draft also (a) would have re-armed only the acting panel —
`SET_BUDGETS` emits no `ws` effect while the two-RESET path it replaced
broadcast `reset_countdown` — and (b) kept a `New entry` button that, because
the score POST upserts on `SCORE#<round>#<athleteId>`, overwrote a saved score
from the live board against the manual's "corrections on the Scores page" rule.

**Decision.**

1. **A third ADVANCE trigger: the on-screen TALLY plate.** The plate renders
   `advanceLabel(advanceRoute(mode, battle, trySeries))` — the same pure route
   the press dispatches — and a click on it calls the same `onAdvance()`. The
   single-event property of 0037 §1 is kept (one route, one dispatch, one
   table test for label and press). Rationale: the manual promises "the board
   is fully usable from the screen; buzzers are optional", yet the one-button
   workflow had no on-screen affordance at all. The plate never takes mouse
   focus (`onMouseDown` preventDefault + blur after click), so it cannot
   double-fire with Space. The Space guard widens from "text input or dialog"
   to any element that owns keystrokes (`select`, MUI combobox/listbox/option,
   a focused button/link) or any open dialog/listbox/menu; a focused button +
   Space is the browser's native click of that button, never ADVANCE as well.
   **All three triggers share one `advanceBlocked()` predicate, and a press
   while a confirm is open is that confirm's safe action** (Keep timing / Keep
   match / Keep series) and nothing else — Space via the autoFocused safe
   button, pad 10 via the predicate's safe close, the plate via the modal
   backdrop — so the triggers cannot diverge behind a modal and the buzzer is
   never dead. Cue plays **after** the route decides: `short` on a transition,
   `alert` on a no-op (which also flashes the plate with the reason). Router
   order pins a running lane's STOP ahead of the armed try series; the
   interlocks make that pair unreachable, the order is a safety invariant.
2. **Locks replace the format confirms** (amends the 0036 addendum). Two named
   predicates: `boardLive` (a lane/break/pause/warm-up/try is ticking) drives
   the leave guard and the running-clock field locks; `boardHoldsState`
   (`boardLive` ∨ series armed ∨ any lane not idle at its armed budget) drives
   the mode toggle and `Set both lanes`. "Armed budget" is a new per-lane
   reducer field `armedMs` (set by RESET / PEER_RESET / SET_BUDGETS /
   PEER_SNAPSHOT) — never the Run (s) field, which is a draft
   until applied. **The room owns `armedMs`, so it rides the `state_snapshot`
   row** (amended 2026-09-08; the iteration-2 draft kept it control-local). A
   joiner seeding it from its own format default reads a mirrored lane as _held_
   whenever the room is armed to anything else — which locks the joiner's format
   controls, and then makes a routine joiner Reset (quali resets once per
   athlete) broadcast that default as its `reset_countdown`, which every peer
   applies as `PEER_RESET`: the room's armed budget rewritten to a value no
   operator picked. One additive optional field on `CountdownTimerRow` fixes it;
   a pre-feature sender omits it and the receiver falls back to the lane budget
   on an **idle** lane (its remaining is an armed budget) and keeps its local
   value on running / on-break / finished (a spent-down remaining says nothing
   about the armed value). The peer `applyFormat` path still dispatches nothing:
   a re-arm reaches a mirroring panel as `PEER_RESET` or on the snapshot, never
   as a locally-invented preset. **The warm-up channel emits `armedMs` too**
   (amended 2026-09-23, `fsux-preview-surface-peer-snapshot`): the field answers
   "is this clock pristine or has it been used?", and the audience surface has
   the same question about `timerId 0` — a window the operator stopped part-way
   is the normal end of a warm-up, and without the armed default a joining
   projector cannot tell it from the next pair's fresh one, so it paints the
   warm-up hero over the lane clocks. `warmupSnapshotRow` carries it in all three
   phases and `nextWarmupSurface` narrows "pending" to a remaining that still
   equals `armedMs`; no shape change (the field ships optional today), the board
   ignores it on `timerId 0` (`warmupChannel`'s `PEER_SNAPSHOT` reads the clock,
   not the budget), and the best-trick try clock still omits it — it has no armed
   budget to report. Under `boardHoldsState` the mode switch and the re-arm only
   ever touch **pristine** lanes (idle at `armedMs`) — nothing is lost,
   re-picking is the undo — so both `window.confirm`s are deleted with no
   replacement dialog and no undo snackbar. `SET_BUDGETS` re-arms only
   pristine lanes and **emits one `reset_countdown` per lane it re-armed** (the
   message RESET already sends), so peers `PEER_RESET` and the preview/athlete
   display mirror exactly as before; no new message type. Exactly three MUI confirms
   remain: lane Reset while the lane holds state (phase not idle **or** budget
   not at `armedMs` — widened from "running"; text rendered live), Round/Gender
   over a selected match (0033), and Reset series once a try is used. The
   live-board `New entry` button is **removed** rather than confirmed: a saved
   panel unlocks only on athlete change and links to the Scores page — the
   settled correction rule is upheld, not amended.
3. **The warm-up re-arm is a ≥44 px button in a reserved slot, and the four
   expiry channels get four tones** (amends 0015 §1/§3). The 32 px Chip was
   under the control-page target floor and its swap-in moved the lanes ~100 px
   at the worst moment. Tone map: run zero `long`, quali break-over `alert2`
   (the shipped, unused `beep-alert2.mp3`), warm-up expiry `alert`, try end
   `short` — where four expiries shared `long`/`short`. 0015's semantics
   (independent channel, manual re-arm, beep on expiry) are untouched; whether
   `alert` and `alert2` are discriminable in a tent is a human check owed when
   the tone slice lands.
4. **`lastRan` stays off the wire.** A rejoining panel derives it from the
   already-relayed `LiveSelection.nextUp` (`PEER_HINT` → `lastRan =
otherLane(nextUp)` while nothing runs and the mode is battle; `PEER_SNAPSHOT`
   sets it to the running lane). `advanceTarget` reproduces the correct target
   from that in every branch, so the snapshot shape does not change (PLANS
   guardrail). This makes `useControlSession`'s Lamport-only-until-anchored
   stamp rule load-bearing: a joiner's default `nextUp` must never outstamp the
   room, or it would rewrite every panel's alternation.
5. **An expiry horn has an owner, not a dedupe** (narrows 0015 §3, added
   2026-09-10). 0015 §3's "every surface beeps on every expiry" is right for the
   venue surfaces and wrong for a second control panel: two panels mirroring one
   competition sit at one desk, so `PEER_STOP` at zero and `PEER_BREAK_END`
   sounding `long`/`alert2` is one crossing heard twice. The relay carries no
   presence (0038), so the panels cannot elect a speaker between them — the
   ownership rule replaces the election: **the panel whose OWN clock crossed
   zero sounds it** (`TIMEOUT` / `BREAK_ZERO`), and the mirrored application of
   the same crossing is silent. The mirrored `short` start/break cue stays: an
   acknowledgement of a press is wanted on every surface, and only the horns
   collided. Which panel that leaves holding the horn is a fact about the room's
   cabling, not about the software, so the second half is a persisted per-device
   **`Sound on this panel`** chip in the header health slot (a whole-panel mute:
   drains and press cue alike, clocks and relay sends untouched) — the owner's
   call surfaced as a visible control rather than settled silently in the
   reducer. Preview / athlete display / Speedline are unchanged.

**Consequences.** Web-only; no server change and no new message type, but the
`state_snapshot` countdown row gains one additive optional field (`armedMs`,
§2) and the Overall override upper bound is mirrored into `validators.ts` (same
rule the manual already states; negative overall stays legal in battle). The
snapshot change is what the PLANS "no snapshot change without an ADR"
guardrail asks for; both ends of `CountdownTimerRow` move together and a
pre-feature sender degrades to the stated per-phase fallback, so an old and a
new panel interoperate. The draft's opposite call — `armedMs` control-local,
its divergence "bounded, cosmetic, realigns on Reset" — was wrong on all three
counts: the realignment is to the _joiner's_ value, and it rewrites the room's
armed budget for every panel. Every live-path colour pair is
named with its ratio in the brief §6 and pinned by a contrast test that lands
before any slice paints it (`stop` fills are `stopDim`; `go`/`set` fills take
`ink.hi`; new `*Text` tiers for words under 24 px). The Speedline board keeps
its current button scheme until a follow-up applies the same race-button
contract (filed P3). ADR 0037 §2/§3 cycles, 0033, 0036 §1–§5 and 0038 are
unchanged. Every slice owes the manual update (`doc/user/freestyle-judging.md`)
and the four driver scenarios per the DoD; audio perception and physical
handsets stay human-only.

## 0047 — A control panel keeps a browser-local copy of its own state; the relay stays stateless

**Accepted · 2026-09-25** (fills the gap ADR 0011 leaves for a SOLO panel; extends
0038 §catch-up. Relay statelessness is untouched.)

**Context.** Timer-state recovery is peer-to-peer (0011): a (re)joining page emits
`request_state` and every control panel answers with a `state_snapshot`. With two
panels in the room that covers a reload, a crash and a laptop swap. With **one**
panel — the normal club/regional setup — there is nobody to answer: a solo board
that reloads mid-run loses the run outright, and `troubleshooting.md` had to tell
the operator so ("with no second board and a clock running there is nobody to
answer, so reload between turns"). The state that is lost is not the relay's and
never was: the panel itself holds it, and it is the same object the panel already
serialises on every `request_state`.

A second, smaller gap sat on the other side of the same wire. `Stopwatch`'s
snapshot merge (the HWC 2026 missed-stop fix) deliberately never **un**-freezes a
lane off a snapshot: a display that missed a `resume` frame stays frozen until the
next start, because a stale snapshot un-freezing a finished race is the worse
failure. The merge had no way to tell a newer snapshot from an older one — it
compared only lane `startTime`s, which a `resume` does not move.

**Decision.** One mechanism, two uses: **stamp the snapshot**.

1. `SpeedlineSnapshot` gains an optional **`at`** — the sender's wall clock at
   build, in the same control-minted clock as the `startTime`/`stopTime` epochs
   beside it. `buildSpeedlineSnapshot` stamps it; `speedlineLaneState` carries it
   onto the recovered lane as `assertedAt`. `mergeRecovery` then un-freezes a
   frozen lane on a same-run `running` snapshot **only** when `assertedAt` is
   later than the `stopTime` the lane froze on — a snapshot built before that stop
   is merely describing the lane as it was, and still changes nothing. Optional
   and additive: an unstamped sender keeps the old, never-un-freeze behaviour.
   The freeze direction (the missed-stop fix) is unchanged.
2. `useControlSession` persists the panel's OWN `state_snapshot` payload plus its
   `LiveSelection` to `localStorage`, keyed `sessionId` + discipline, coalesced
   250 ms behind every live timer send/apply and every selection change. On
   (re)open, if the mirror-on-open `request_state` draws no peer answer within
   `PEER_ANSWER_MS` **and** no live frame has flowed since open, a stored copy
   younger than 15 minutes holding an actual run is applied through the existing
   `applySelection`/`applySnapshot` paths, and the header says so. Live beats it
   in every case: a peer answer or any live frame inside the grace cancels the
   restore, which is the 0011/0038 precedence rule unchanged.

`snapshotHasRun` is the gate in both directions — a board with no run stores
nothing and drops any earlier copy, so a `reset` clears the record via its own
save instead of the store having to know what a reset is. The restore is offered
**once per mount**, not per (re)open: after a reconnect the panel already holds
its live state, and re-applying an older copy over it would be a rollback.

**Rejected.** Server-held timer state (0011 — the relay is a broadcast, and a
stateful one owns a correctness problem nobody wants at the edge of a race);
storing PEER snapshots as well (a panel would then resurrect a board it never
drove, and the peer answer that would correct it is exactly what is missing in
the case this serves); a per-panel monotonic `gen` alongside `at` (nothing
compares two snapshots to each other — the only comparison is against a
control-minted lane epoch, which `at` shares a clock with, so a generation
counter would be a field with no reader); persisting the lane NAMES (0038 already
re-derives them locally from the mirrored athlete ids — a stored copy would fight
that derivation).

**Consequences.** Web-only; no server change, one additive optional snapshot field
(`at`, the "no snapshot change without an ADR" guardrail), and one new
device-local store beside `freestyleModeMemory` / `panelSoundMemory` — nothing
leaves the browser and no data-plane write is bound to a restore (0038's
local-actions-only rule holds: the recovered run arms the recorder, and only a
LATER local stop records a Time). A solo operator can now reload mid-run; the
manual's reload guidance changes accordingly. Trade-off: a restored board is one
save-window (≤ 250 ms) behind the crash, and storage that is unavailable
(private mode, full quota) simply leaves the panel where it stood before this
existed.
