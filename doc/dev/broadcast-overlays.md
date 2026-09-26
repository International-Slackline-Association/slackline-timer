---
last-updated: 2026-07-24
---

# Broadcast overlays — capture, compositing & the `?bg=` mode

How the app's `/stream/*` overlay pages (and the projector/preview timer pages)
are taken into a live production, and the one knob that adapts them to any
pipeline: the `?bg=` background mode. Visual/design rules live in
[`design-system/design-system.md`](./design-system/design-system.md) §7; this doc
is the **integration spec** (what the producer plugs in, and why).

> **Producer-facing view.** The runnable "paste this into OBS" steps live in the
> published manual, [`user/broadcast-overlays.md`](../user/broadcast-overlays.md).
> This file is the **engineering** spec behind them: why transparent is the
> default, why magenta is the key colour, and the measured numbers the `h2r`
> adaptation is built on.

## TL;DR

- The overlays are **browser sources**, built to be captured by **OBS Studio**
  (or a similar browser-source compositor — vMix, NDI, a hardware capture rig).
  You add the `/stream/...` URL as a Browser Source; nothing else hosts them.
- **Default = transparent** (alpha) — what OBS Browser Source, vMix Web Browser,
  and NDI-RGBA composite cleanly over live video, with no key artefacts.
- **`?bg=<mode>`** flips a single overlay to a solid **chroma-key** fill for
  pipelines that can't carry alpha (HDMI capture, ATEM-Mini-class switchers,
  generic hardware ingest). Default key color is **magenta `#FF00FF`**.
- **`?bg=h2r`** keeps the ground transparent and applies a **measured colour
  adaptation** (currently the running teal + the finished/loser red) for the
  H2R keyed chain, which flattens the overlay onto H2R's pink `#EC008C`
  **before** the keyer and shifts colours on the way.
- `/admin/overlays` defaults to transparent links for normal live operation;
  keyed and `h2r` variants are advanced options for pipelines that cannot carry
  alpha cleanly.

## Operator UX contract (live use)

Keep the overlays admin surface aligned with the freestyle control-board
operator model:

- **Live-first disclosure:** keep live-following links (VS live, SVO, timer)
  primary; keep round-pinned and specialist variants as secondary/reveal
  choices.
- **No-scroll critical path:** the operator should be able to mint and copy the
  live set without page travel through secondary options.
- **Narrow-screen behavior:** mobile/small-tablet usage is copy/revoke-oriented;
  full scene-building workflows remain desktop-first.

These are UX constraints on page structure and wording, not protocol changes.

## The `?bg=` query parameter (the mode switch)

Read by `StreamLayout` (data overlays) and the timer display pages
(`app/pages/Stream/overlayBg.ts`). Applies to **every** overlay surface.

| `?bg=` value               | Background painted                          | Use when…                                                                                                                  |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| _(absent)_ / `transparent` | none (alpha)                                | **Default.** OBS Studio Browser Source, vMix Web Browser, NDI-RGBA.                                                        |
| `key` / `magenta`          | `#FF00FF` (`--tl-chroma-key`)               | **Recommended chroma.** Any hardware/colour keyer; safe vs our greens/blues.                                               |
| `green`                    | `#00B140`                                   | Operator's keyer only has a green preset **and** no green is on-screen.                                                    |
| `blue`                     | `#0047BB`                                   | Blue-screen rigs where no blue/teal is on-screen.                                                                          |
| `h2r`                      | none (alpha) + **colour adaptation**        | **Keyed composite chains**: the transparent overlay is flattened onto a chroma ground _before_ the keyer (see §h2r below). |
| any CSS color              | that color (e.g. `%23123456`, `rgb(0,0,0)`) | Escape hatch — exotic keyers / solid backers.                                                                              |

- Transparent is the default and preserves the §7 "fail-safe blank" rule: an
  empty overlay paints nothing and composites away invisibly.
- The chroma fill is an opaque full-viewport ground behind the graphic layers;
  the foreground (white plates, green winner, GO light) is unchanged and survives
  the magenta key.

## The colour-adaptation mode (`?bg=h2r`) {#h2r}

Some chains flatten the transparent overlay onto a chroma ground **upstream**
of the keyer instead of carrying alpha end-to-end — the motivating rig runs an
H2R Graphics output chain whose ground is H2R's pink **`#EC008C`**, with our
transparent overlay composited into the same frame and the switcher's chroma
key set to that pink.

Hue-wise the palette is safe against `#EC008C` (hue ≈ 324°): the running teal
`#13A89E` (≈ 176°) is on the opposite side of the wheel, and even the closest
family — the stop/DNF orange-reds (≈ 10–15°) — sits ≥ 45° of hue away with no
magenta component. But the keyer is not the whole chain: **measured on that rig
(2026-07-24), the running teal aired as `#48BBB2`** — per channel a uniform
~21.6 % **white lift** with the hue intact, i.e. white contamination from
compositing/scaling, not a keyer hue shift.

`?bg=h2r` keeps the ground **transparent** and flips the `tl-key-composite`
class on `<body>` (`app/pages/Stream/overlayBg.ts`), whose override block in
`tokens.css` pre-compensates the measured shift with each colour's inverse of
the lift. Channels below the lift's ~55 white floor clamp at 0, so dark
saturated targets are only approachable:

- running teal `--tl-running`: `#13A89E` → `#009083` (airs ≈ `#37A89E`);
- finished/loser red `--tl-stop-dim`: `#C2391F` → `#B10200` (airs ≈ `#C23937`;
  un-adapted it would air ≈ `#CF644F`, predicted from the same lift).

If the chain's lift is fixed, delete those overrides; the numbers live at the
block in `tokens.css`.

Known limitation (accepted while the colour adaptation is under test): the
mode does not change the **translucent** surfaces — the 30–48 % white plates
and the blurred protection halos blend with the pink ground during the flatten
and can fringe or tint through the keyer.

The corner status badges treat the mode as a keyed ground (suppressed — they
would hit air through the downstream keyer). `/admin/overlays` mints it as the
third Background option.

## Why magenta for the key (not green)

The cardinal rule: **the content must not contain the key color**, or matching
pixels get erased. Our palette commits **green** to meaning (winner `#65BC7B`, GO
light) and **teal** `#13A89E` (brand), and athlete **flags** carry every primary —
so a green key erases the winner/GO and a blue key risks teal/flag blues.
**Magenta `#FF00FF`** ("magic pink") is a recognised alternative key, absent from
our palette and from flags → maximal separation. `--tl-chroma-key`
(`theme/tokens.ts` + `tokens.css`) is the single source of truth; retune it there
to match a venue's keyer.

## Pipeline → which mode

| Capture path                                                                                       | Alpha?        | Use                                         |
| -------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------- |
| **OBS Studio** Browser Source (the default)                                                        | yes           | transparent                                 |
| vMix Web Browser input                                                                             | yes           | transparent (or its own colour key)         |
| NDI (RGBA)                                                                                         | yes           | transparent                                 |
| Blackmagic **ATEM Mini** (HDMI, no key+fill)                                                       | no            | `?bg=key` (magenta)                         |
| Capture card / HDMI ingest of a 2nd machine                                                        | no            | `?bg=key` (magenta)                         |
| Hardware colour keyer with green-only preset                                                       | no            | `?bg=green` (if no green on-screen)         |
| Keyed composite chain (flattened onto a chroma ground before the keyer, e.g. an H2R `#EC008C` rig) | upstream only | `?bg=h2r` (transparent + colour adaptation) |

## External graphics tools (H2R Graphics & similar)

Tools like [H2R Graphics](https://h2r.graphics) are **separate graphics
controllers** a producer may run alongside OBS for lower-thirds/tickers. They
render their **own** graphics and **cannot host our overlay pages** (no
arbitrary-URL ingest), so our overlays always go straight into OBS/vMix — never
"through" such a tool. The question we answered: whether to expose our live data
_to_ them, so a producer who has standardised on H2R for lower-thirds can draw
the athlete card themselves from our feed. Below is that assessment — findings +
recommendation — and the **`/stream/bridge`** page that shipped from it ("As
built" at the end of this section).

### The load-bearing constraint: H2R is push-only

The first thing to verify (evidence-not-defaults) is how H2R actually ingests
external data — it changes the whole shape of the problem. H2R's local API on
`http://127.0.0.1:4001`:

- `POST /updateVariableText/<id>` sets one of its **text variable** slots.
- `POST /data/<id>` feeds the **HTTP-listener data source** — an array of
  social-style messages (`snippet.displayMessage`, `authorDetails.displayName` +
  `profileImageUrl`, `platform.name`); H2R fetches the `profileImageUrl` itself.
- Companion ([`bitfocus/companion-module-h2r-graphics`](https://github.com/bitfocus/companion-module-h2r-graphics))
  and OSC drive the same control surface from a control desk.

**H2R does not poll a remote REST URL.** Every documented path is _data pushed
into H2R_, not H2R pulling from us. So the question "which read API do we
expose?" is the wrong frame — exposing a perfect REST snapshot still leaves
nobody to call it. The real question is: **what gets our live data into H2R's
`:4001`?** Three answers, none of which is a new server endpoint:

| Who pushes into H2R                                                            | What it costs us                     | When it fits                                           |
| ------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------ |
| **Operator types it** (H2R text variables, by hand)                            | nothing                              | one-off lower-thirds; no live sync — out of scope here |
| **A thin bridge we ship** subscribes to our existing signals and POSTs `:4001` | a small client, **no server change** | the live, hands-free case — **recommended**            |
| **Companion** wired to both our data and H2R                                   | nothing from us (producer-built)     | producer already lives in Companion                    |

### Why a bridge, and why no new read API

The data H2R wants is the **currently-selected athlete(s)** resolved to
display-ready fields — name, country, signed `photoUrl`, rank/result. Crucially,
that data already exists in two places we ship, and **the bridge is what joins
them** — exactly the join the `/stream/*` overlays already do client-side:

1. **Who is live** is the control board's `updateSelection` → `LiveSelection`
   (round, gender, `matchId`, `athlete1Id`, `athlete2Id`) — **relay-only, never
   persisted** (ADR 0014). It is on the **WebSocket**, reachable today with a
   comp-scoped **read token** on `$connect` (the same credential `/stream/*`
   uses; read-only connections can't inject, ADR 0003).
2. **Display fields** (name/country/`firstName`+`lastName`, rank, signed
   `photoUrl` expiring with the event) come from the **HTTP API** — the
   `rankings` Lambda is the exact precedent: it already maps each athlete through
   `attachPhotoUrl` (ADR 0005) and returns rank+result. Athletes/times/matches
   reads take the same read token.

So a bridge that (a) opens one read-token WS to follow `updateSelection`, (b) on
each change GETs the two athletes (or the round's rankings, which carries
rank+`photoUrl` in one call), and (c) POSTs the resolved fields into H2R's
`:4001` — needs **zero new backend**. It is a packaging of the existing read
token + existing read endpoints, living entirely on the operator's machine next
to H2R. This is the `/stream/svo-live` overlay's data flow (ADR 0014) re-aimed
at H2R instead of at our own React card.

A **new "resolved live selection" REST endpoint** (one GET that does the
WS-selection→athlete→photoUrl join server-side and returns H2R-ready JSON) is
the tempting alternative. Reject it for now: the selection is deliberately
relay-only and ephemeral (ADR 0014 — no `Match.updatedAt`, no server state), so
a server endpoint would have to _reconstruct_ "who is live" from persisted data,
which is precisely the brittle position 0014 removed. It also can't be pulled by
H2R anyway (push-only). If a future, non-H2R consumer genuinely needs a pull
feed, a thin **read-token GET that projects rankings/match into a flat shape**
is the cheapest server addition — but that is a separate item, not this one.

### As built — `/stream/bridge`

Shipped as the headless **`/stream/bridge?compId=&token=&h2r=`** page (the form
chosen over a CLI: it reuses `useWS` + the read hooks + the Cognito-skip-for-
`/stream`-with-token path verbatim, so there is no second auth/data stack to
maintain). It is **not** an OBS source — it is a tab the operator keeps open on
the machine running H2R; it paints a small visible status panel (not the
overlays' fail-safe blank) so the operator can confirm it is connected. It reuses
the comp-scoped read token verbatim (no new auth), follows `updateSelection`, and
adds no persisted data and no protocol change.

The per-side WS-selection → athlete → result join is `useLiveSideAthlete`,
factored out of `SvoLiveOverlay` and shared with the bridge.

**The fixed field → H2R mapping** (`app/util/h2rBridge.ts`, `H2R_VARIABLE_MAP` —
retune there to match a producer's H2R project). Both sides are pushed on every
selection change; an empty lane pushes empty values so a stale competitor never
lingers, which makes single-athlete (SVO) and the VS pair the same code path:

| Per side _n_ ∈ {1,2} | H2R target                           | Value                                                                                            |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `name_n`             | `POST /updateVariableText/name_n`    | full `Athlete.name`                                                                              |
| `country_n`          | `POST /updateVariableText/country_n` | `country` (or `country / country2`)                                                              |
| `result_n`           | `POST /updateVariableText/result_n`  | best time / judged overall / `DNF`                                                               |
| `photo_n`            | `POST /data/photo_n`                 | HTTP-listener array, signed `photoUrl` → `authorDetails.profileImageUrl` (empty array clears it) |

A **rankings ticker** push and the **Companion + OSC** no-code path stay
documented-but-unbuilt: Companion wired to both our data and H2R is the
producer-built alternative for those already living in Companion (nothing from
us), and a ticker is a thin addition over the same mapping if a producer asks.

## Sources

- OBS Browser Source alpha transparency: obsproject.com forum (transparent browser source)
- ATEM Mini lacks key+fill over HDMI → needs chroma: resources.overlays.uno (chroma key background for video switchers)
- vMix Web Browser alpha / Colour Key: vmix.com/help27/WebBrowser.html ; NDI alpha (RGBA): Blackmagic forum
- Magenta `#FF00FF` as a key color ("magic pink"): en.wikipedia.org/wiki/Chroma_key
- `?bg=`/`?bgcolor=` query convention: overlays.uno ; VDO.Ninja transparent-video guide
- H2R HTTP-listener data source (push-only POST to `:4001/data/<id>`): h2r.graphics/docs/control/data-source/http-listener
- H2R text-variable HTTP API (`POST :4001/updateVariableText/<id>`): h2r.graphics/docs/api/http ; h2r.graphics/docs/control/variables
- Companion module (control-desk path): github.com/bitfocus/companion-module-h2r-graphics
