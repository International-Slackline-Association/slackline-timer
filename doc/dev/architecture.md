# Architecture

Why Slackline Timer is built the way it is, and the data model behind it. This
is the enduring rationale ported out of the (now-complete) timertimer→AWS
migration (the original phase-by-phase plan lives in git history). Settled
decisions with their trade-offs are recorded in [`decisions.md`](./decisions.md).
The message protocol itself (which message carries what) is the discriminated
union in [`web/src/app/hooks/useWebSocket.tsx`](../../web/src/app/hooks/useWebSocket.tsx); how those messages become a correct clock
on every screen is "Timing" and "What an overlay needs to stay in sync" below.

## The sport, in the app's words

The app's two timer modes are the two ISA competition disciplines of a highline
event, under shorter in-code names — worth stating once, because the code, the
rules and the athletes use different words for the same thing:

| In the code / UI    | ISA discipline         | What it is                                              |
| ------------------- | ---------------------- | ------------------------------------------------------- |
| `speed` / Speedline | **Speed Highline**     | two athletes race parallel lines; fastest crossing wins |
| `freestyle`         | **Freestyle Highline** | judged on the tricks landed inside a timed run          |

ISA's third discipline, **Freestyle Trickline**, is not modelled. "Lane" is the
app's word for one timing channel — a stopwatch with an athlete on it; the
physical thing the athlete crosses is a **line**. The operator-facing wording
lives in the published manual ([`user/getting-started.md`](../user/getting-started.md)).

## The two planes

Slackline Timer is a **pure broadcast relay** for live timing plus a **competition
data plane** for everything persistent. The two are deliberately separate:

```
web/ (React SPA, S3 + CloudFront)
  ├─ /admin/*            CRUD: competitions, athletes, times, scores, matches  ── HTTP API (fetch)
  ├─ /speedline/control  + athlete/round selectors per lane                    ── HTTP POST on stop
  ├─ /freestyle/control  + per-player score entry                              ── HTTP POST on submit
  ├─ /stream/*           read-only OBS overlays (event read token)             ── HTTP read + WS db_update
  └─ data client (fetch + React Query)
server/ (AWS CDK, eu-central-2 / prod)
  ├─ WS API   ── relay; $connect also accepts read tokens                       live timing + db_update
  ├─ HTTP API ── competitions/athletes/times/scores/matches CRUD + rankings + bracket seed/advance + token minting
  ├─ DynamoDB ── connections table (relay) + competition table (data plane)
  └─ S3 + CloudFront ── athlete photos (presigned upload, signed-URL reads)
```

The **server holds no timer logic** — all timing, state, and audio live in the
browser; the relay only forwards each message to the other connections in the
same session. The data plane is additive: it never touches the relay's hot path.
State recovery is peer-to-peer too: a (re)joining page asks for the current
timer state and every control panel replies, so the relay stays stateless
(`decisions.md` 0011). Control panels are themselves mirroring peers — any
panel may act, each applies the others' messages, and data-plane writes bind
to the panel whose operator physically acted (`decisions.md` 0038).

## Timing — how a race time is computed

There is no server clock and no clock-skew handshake (ADR 0021). Every displayed
time is a **subtraction of two epochs**, and the whole design is about making
both operands come from the same machine wherever it matters:

| Lane state   | Displayed value           | Skew                                                                       |
| ------------ | ------------------------- | -------------------------------------------------------------------------- |
| **finished** | `stopEpoch − startEpoch`  | none — both epochs are minted by the operator's control page               |
| **running**  | `Date.now() − startEpoch` | the rendering machine's offset vs the operator's; freezes on the real stop |

The persisted record follows the finished case: `Time.timeMs = stop − goEpoch`
(`elapsedMs` in `app/util/raceTime.ts`, clamped ≥ 0) and `Time.startTime =
goEpoch`. That start epoch is also the **run key** — both lanes of one run share
it, which is how `tallyFromTimes` regroups a best-of-3 series from the persisted
Times alone.

### The race start is scheduled, not announced — the delay budget

Naively broadcasting "GO now" would start each surface one relay-latency later
than the operator, and the green light, the long beep and the clock leaving zero
would land at a different instant on every screen. Instead the operator
broadcasts **one seed, on the arm edge**, and every surface derives the rest:

```
updateSignalPhase { currentPhase: PRE_BEEP_PHASE (0.5), anchorEpoch, lanes }
        │  ← the ONLY message on the wire; set1/set2/GO are never sent
anchor +0ms   armed   pre-beep cue (short), no lights lit
       +3000  set1    ── the 3s latency budget lives here ──
       +4000  set2
       +5000  go      GO light + long beep + the race clock leaves zero
       +6000  cleared
```

The offset table (`PHASE_SCHEDULE` in `app/hooks/useStartSignalTimer.tsx`,
`GO_OFFSET_MS = 5000`) is the single definition of the sequence. Consequences
worth knowing:

- **The armed→set1 gap is the delay tolerance.** As long as the seed lands
  anywhere inside those 3 s, every later instant — lights, beeps, and the race
  clock — is exact on every receiver; only machine clock skew remains.
- **The clock anchors on the _scheduled_ GO epoch** (`anchor + GO_OFFSET_MS`),
  never a `Date.now()` sampled inside the GO callback: a throttled or
  backgrounded tab fires that callback late and would smear the start off the
  light schedule. Phases are likewise derived from `Date.now() − anchor`, so a
  late timer fire **snaps to the right phase** instead of losing a step.
- **Previews ignite their own lane clocks** at their locally-derived GO edge.
  The authoritative `start { startTime, lanes }` still follows at GO as
  idempotent confirmation and recovery truth — same epoch means same race, so
  the stopwatch no-ops it rather than blipping to zero.
- **A late seed degrades, it doesn't break.** The light fast-forwards to the
  correct phase; a beep whose instant is more than `BEEP_GRACE_MS` (400 ms) past
  stays **silent** (a beep in the past is worse than none — the light, being
  state, is always shown); a seed arriving after GO still ignites with the true
  past epoch, so even a laggy display shows the correct running time.
- **Abort is the one event no schedule can express**, so it is sent explicitly
  (`updateSignalPhase { currentPhase: -1 }`) and cancels both the mirrored
  sequence and its pending clock ignition — no retraction protocol. Abort is
  pre-GO only, and a false-start flag never stops a live lane (rule S4, ADR 0035).

## What an overlay needs to stay in sync

Four independent conditions. An overlay is only trustworthy on air when all four
hold — most "the overlay is wrong" reports are one of these, not a render bug.

1. **Same room.** The relay `sessionId` **is** the competition `compId`.
   `/stream/*` pages address it as `?compId=` and projectors as `?sessionId=`;
   `useRelaySessionId` resolves both.
2. **An open socket.** Reconnects are unbounded with jittered backoff and an
   8-minute keepalive `ping` (ADR 0024) that also heartbeats the 20-minute
   connection row. Off-`ready` an overlay renders **nothing** (fail-safe blank)
   and raises `ConnectionLostBadge` after a 5 s grace — suppressed on chroma
   grounds, where it would key through to air. The corner pair reads the same
   `useLinkPhase` grading the control boards do (the surface calls it once and
   feeds both plates, which partition the five phases between them), so a first
   handshake and a drop are told apart on air too: `No signal — retrying` is a
   link this source never had — its token / compId / URL is as likely as an
   outage — while `Signal lost — reconnecting` names one it lost, and only that
   one arms the green `Reconnected` flash.
3. **Catch-up on open.** The relay buffers nothing, so a page joining after the
   action sends `request_state` and every control panel answers with a
   `state_snapshot` (ADR 0011/0038). Two precedence rules carry the weight:
   roll-back-able display state (light phase, text, badges) is only taken when
   **no live message arrived since open**; lane timer state always flows through
   and merges **newer-wins per lane** — a blank lane takes anything, a newer
   `startTime` is a later heat, the same `startTime` with the snapshot
   `finished` while the display still runs is **a stop this display missed**
   (freeze it), and older/idle never rolls a lane back. That merge is what heals
   a stuck on-air timer within seconds of the next control re-broadcast.
4. **Who is live.** Round, gender, match, lane athletes, the best-of-3 tally and
   the false-start counts all ride the relay-only `updateSelection` (ADR 0014),
   re-pushed on every change **and** every socket OPEN so late joiners recover
   free. Consumers must filter on `discipline` (both disciplines share one room)
   and honour the last-writer-wins `seq` stamp **and the `echo` rank** (ADR 0038
   §4, in `app/util/selectionLww.ts`) — relay fan-out order is not send order, so
   an unstamped consumer can be rolled back by the losing side of a crossed edit,
   and a re-statement of an adopted value (`echo`) must never outrank the panel
   that authored it.

Persisted data (rankings, brackets, winners) is a **separate axis**: React Query
over the HTTP API, invalidated by the server-side `db_update` broadcast (below).
An overlay can be perfectly synced on the live plane and stale on the data
plane, or the reverse.

Two messages sit outside the relayed unions and are never fanned out: the
keepalive `ping`, and `ack` — a receipt telemetry frame in which each display
confirms the `start`/`stop`/`reset` it consumed, keyed by that message's own
epoch plus its page and user-agent. `messageHandler` logs and swallows both. The
acks exist so CloudWatch can name the consumer a relayed message never reached,
which is how the missed-stop class of incident gets diagnosed at all.

## Why this shape (vs the Phoenix original)

Ported from the Phoenix app `timertimer`, which kept state in a `TimerManager`
GenServer + SQLite and pushed live refreshes over a `Phoenix.PubSub` `"db"`
topic. Slackline Timer had only the relay — no persistence, no athletes, no
results. The migration added the **missing data plane** (HTTP API + a second
DynamoDB table + S3 photos) and a **read/refresh plane**: a `db_update` WS
message broadcast server-side so overlays re-fetch live — the analogue of the
`"db"` PubSub topic.

| Concern       | timertimer                        | Slackline Timer                                |
| ------------- | --------------------------------- | ---------------------------------------------- |
| State owner   | `TimerManager` GenServer + SQLite | browser (relay holds none) + DynamoDB for data |
| Persistence   | Ecto/SQLite                       | DynamoDB single-table (per plane)              |
| Live refresh  | `Phoenix.PubSub` `"db"` topic     | server-side `db_update` → React Query refetch  |
| Read surfaces | LiveViews subscribe + render      | React pages consume HTTP + `db_update`         |
| Photos        | `picture_data` binary blob in DB  | S3 object, CloudFront-signed URL               |

Persistence **extends the existing AWS serverless backend** rather than adding a
new runtime: a new HTTP API (REST over API Gateway + Lambda) and a new DynamoDB
table, with the WebSocket relay untouched.

## Scoping: `compId` = `sessionId`

Competition data is keyed by `compId`, which is the same value every page
already passes as the relay `sessionId`. Each session is its own
competition/event. The difference between the planes: the relay accepts **any**
room key, but the data plane only accepts `compId`s that exist as a
`COMP#<compId>` / `META` item — writes reject unknown competitions.

## Read-auth: two credential types, three roles, one custom authorizer

Both the HTTP API and the WS `$connect` are guarded by a single small custom
Lambda authorizer (reusing the relay's `aws-jwt-verify` code) accepting:

1. **Cognito IdToken** (operator) — verified against pool `eu-central-1_iGaYGKeyJ`.
   Carries `timeradmin` in `cognito:groups` → role `admin` (global read+write,
   `compId: '*'`). Any other valid ISA login → role `manager` (read+write scoped
   to the competitions granted to them — the per-competition ACL, ADR 0045). The
   context carries the caller's `sub`/`email`.
2. **Event read token** (overlays) — an HMAC-signed JWT minted by the operator-only
   `createReadToken` Lambda: `{ compId, role: 'reader', tokenVersion, exp }`,
   `exp ≤ now + ~10 days`, secret in SSM, carried as a URL query param on
   `/stream/*` → role `reader` (read-only, scoped to its one `compId`).

A native API Gateway Cognito JWT authorizer can't express this — it can only
assert `authorizationScopes` against a `scope` claim (which an IdToken lacks)
and cannot check `cognito:groups`; and it can't accept the second credential
type at all. See [`decisions.md`](./decisions.md).

Enforcement notes: the authorizer passes `{ role, compId, sub?, email? }` as
context, and shared tested helpers gate every route — `requireCompAccess`
(admins pass, readers match their one `compId`, managers must hold a live
`COMP#<compId>/MANAGER#<sub>` grant), `requireWrite` (readers can't write), and
`requireAdmin` (superadmin-only: create competition, manage the manager list).
The WS `$connect` authorizer runs the same grant check against the joined
session, so an ungranted manager can't open the socket. Manager-grant revocation
is immediate for HTTP (the grant is read live per request; the 60s authorizer
cache memoizes only the role, not the grant). **Read-only WS connections** are
flagged on the `$connect` row and their sends dropped by `messageHandler`, so a
leaked overlay token can't inject timer messages — with one exception,
`request_state`, which carries no data and only prompts the control panels to
re-broadcast what the overlay may already read (without it a mid-event joiner
could never catch up).
**Revocation** is a `tokenVersion` bump on the competition `META` item,
instantly invalidating every outstanding token for that competition: HTTP reads
and future WS `$connect`s fail the version check, and the revoke route also
force-closes the session's already-open `readOnly` overlay sockets
(`disconnectSessionReaders`) so a live-on-air feed cuts immediately rather than
lingering to the connection TTL — see [`decisions.md`](./decisions.md) ADR 0026.

## Data model — DynamoDB single-table (`slackline-timer-v1-competition-prod`)

A **second** single-table, separate from the relay's connections table.
`COMP#<compId>` partition, entity-prefixed sort keys:

| Entity      | PK              | SK                                              | Notes                                                                                                                                                                  |
| ----------- | --------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Competition | `COMP#<compId>` | `META`                                          | name, startDate, endDate, tokenVersion, `config?` (nested format params, e.g. `config.freestyle.breakMs` — the quali advisory break, ADR 0036)                         |
| Athlete     | `COMP#<compId>` | `ATHLETE#<athleteId>`                           | firstName + lastName (source of truth; `name` derived on write), `shortName?`, gender, country + `country2?` (ISO), photoKey (S3) — full shape: `web/src/app/types.ts` |
| Time        | `COMP#<compId>` | `TIME#<round>#<athleteId>#<timeId>`             | timeMs, startTime, `matchId?` (provenance); SK prefix → query-by-round (the **speed** plane)                                                                           |
| Score       | `COMP#<compId>` | `SCORE#<round>#<athleteId>`                     | the five judged components + `overall`, `dnf?`, `matchId?` (provenance) (the **freestyle** plane)                                                                      |
| Match       | `COMP#<compId>` | `MATCH#<discipline>#<gender>#<round>#<matchId>` | athlete1Id, athlete2Id, winnerId, optional `roundName` (display-only override; `round` is the functional source)                                                       |
| Manager     | `COMP#<compId>` | `MANAGER#<sub>`                                 | per-competition ACL grant (ADR 0045): email + grantedBy audit. Reverse adjacency `USER#<sub>` / `COMP#<compId>` lists a manager's comps — the one non-`COMP#` PK       |

Key design rules — these are load-bearing:

- **SK fields are immutable.** Editing a Time's `round`/`athleteId` (or a Match's
  `discipline`/`gender`/`round`) is a delete+put via `TransactWriteItems`; plain
  attribute edits (`timeMs`, `winnerId`, …) are normal updates. The CRUD Lambdas
  are built for this.
- **Referential integrity is on us** — DynamoDB has no FKs. Deleting an athlete
  with Times/Matches is **blocked** with a clear error (cheap `begins_with`
  existence check), never cascaded or orphaned.
- **Rankings are computed in-Lambda.** DynamoDB can't aggregate: query all
  `TIME#<round>#…` (or `SCORE#<round>#…`) for a round and compute
  best-per-athlete in the Lambda — fine for a single small competition. Gender
  is not on the Time/Score item; per-gender rankings join against the athlete
  list. The DNF sentinel must be excluded from "best".
- **Two disciplines, one athlete pool.** `discipline` (`speed | freestyle`)
  splits Matches — and the downstream rankings/overlays — into two independent
  brackets. Times are the speed plane (ranked **ascending**), Scores the
  freestyle plane (`overall` ranked **descending**).
- **Ranking tiebreaks (sport-correct, no arbitrary alphabetical primary).**
  SPEED: equal best time → faster **second-best** run (an absent backup counts as
  +∞, so any real second run wins), then athlete name. FREESTYLE: equal `overall`
  → highest single judged component in priority `difficulty → combo → style
→ bestTrick` (each higher = better), then name; a DNF loses on `overall` first
  (−∞ key) and never reaches the component compare. Both DNF encodings are
  untouched. The rankings overlay marks a genuine dead heat (athletes sharing the
  **displayed** result after tiebreaks) with a shared `=`-prefixed rank and the
  standard skip numbering (`=1, =1, =1, 4`).
- **Round enums (preserved exactly).** Match rounds =
  `[test, qualification, quarter, half, small_final, final]`; Time rounds = same
  **plus** `training`. Not interchangeable. Enums are **duplicated** web↔server
  (no npm workspaces) and guarded by parity tests — silent drift here corrupts
  SK prefixes permanently.
- **DNF, two planes (same intent, different mechanism).** Speed uses the magic
  Time `3_355_550` sentinel (a huge elapsed time that sorts last yet stays in the
  field), displayed `"DNF"`. Freestyle uses an opt-in `Score.dnf?: boolean`: a DNF
  Score keeps its real components but ranks with a `-Infinity` key, so it sorts
  below a genuine `0.0` while staying in the field — and renders `"DNF"`. Both
  distinguish attempted-and-failed (present, last) from no-attempt (excluded by
  the inner join). See DECISIONS 0012.

## Photos — S3 + CloudFront signed URLs, never public

DynamoDB items cap at 400 KB, so the photo blob lives in S3 (content-hashed key
`photos/<compId>/<sha256>.jpg` — unguessable, immutable, dedup) and the athlete
carries only `photoKey`. The bucket is **never public**: locked to CloudFront
via Origin Access Control + a trusted key group. Read Lambdas embed a
CloudFront-**signed** `photoUrl` (RSA key from SSM) expiring at
`competition.endDate` (≤ ~10 days, the same window as the read token). After the
event every URL dies at the edge automatically — the "archived" state needs no
cleanup job. Listing never ships bytes; signing is a cheap local RSA op, no S3
round-trip.

## Live refresh — server-side `db_update`

Every write Lambda broadcasts `{ type: 'db_update', sessionId: compId,
data: { entity, action, id } }` into the relay room via `core/broadcast.ts`
(the relay fan-out extracted for reuse). Clients invalidate the matching React
Query keys. Emitting **server-side** makes the refresh a guarantee, not a client
courtesy — a browser-fired message would be lost if the tab died between write
and send, leaving overlays stale mid-broadcast.

## Accepted risks

1. **Read-token leakage** via URLs (OBS configs, screenshots, logs). Mitigated by
   read-only role, comp scope, ≤10-day expiry, instant `tokenVersion` revocation;
   residual risk accepted. New Lambdas must not log full query strings.
2. **Coarse mid-event photo revocation** — rotating the CloudFront key-group key
   kills all events' URLs. Accepted; `tokenVersion` still covers all data reads.
3. **No server-side aggregation** — rankings are computed per request, fine for a
   single small competition, not for large datasets.
4. **Type duplication across packages** — no workspaces, so web and server each
   carry the entity types/enums; the parity tests are the only guard.
5. **No server-authoritative timing** — we did not port timertimer's
   server-side timer, and the original `sync_time_request`/`response` clock-skew
   handshake was found inert and removed (ADR 0021). Timing stays browser-local:
   the shared start schedule (see "Timing") removes relay latency from the
   equation, but **machine clock skew is not corrected** — a _running_ lane on a
   badly-set machine shows a slightly wrong elapsed until the operator's stop
   freezes it at the true value. Venue machines are NTP-synced to well under a
   frame; accepted.
