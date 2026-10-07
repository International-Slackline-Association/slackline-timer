# TELEMETRY — Design System Specification

> The canonical design system for the slackline speed-competition race-timer web app.
> Audience: designers and developers. Status: authoritative. Do not change token values without updating this document.

---

## 1. Overview & Philosophy

### What this app is

A real-time timer system for slackline competitions — head-to-head **speed** races and judged **freestyle** battles. It has several distinct surfaces, each with different legibility demands:

- **Control page** — the operator's cockpit. Drives the race; emits every state change.
- **Preview page** — projector/spectator display. Consumes state and renders it big.
- **Broadcast / streaming overlays** — OBS Studio (or similar) browser-source layers composited over live video; they render on a `?bg=`-selected background, transparent by default (see §7).
- **Admin CRUD** — competitions, athletes, times, matches management.
- **Playoff bracket & live rankings** — head-to-head tournament art and leaderboards.

Two timer modes:

- **Speedline** — a dual stopwatch (two lanes, head-to-head) with a two-bulb **start-light signal sequence** and per-lane false-start flags.
- **Freestyle** — a judged mode with an explicit Quali/Battle board (ADR 0019/0036): per-athlete count-down active budgets that persist across turns, a quali-only advisory break count-down (holds at zero for a manual start), a control-local battle changeover pause count-up, and a shared warm-up countdown (ADR 0015).

### Design goals

Athletic. Precise. Broadcast-grade. **Legible at distance** (projectors, streams) and **over live video**. Every surface must read instantly from across a venue or through a compressed video feed.

### Design philosophy

TELEMETRY borrows the visual grammar of **IFSC speed climbing** — two-lane head-to-head racing, the start-light tree, false-start detection, and the winner-green / loser-red convention — and dresses it in the **International Slackline Association (ISA)** brand. The result is a **light, teal-forward** system: on-brand with the ISA website (light/white surfaces, teal links, an orange-red logo accent) while keeping the race-state heritage of the sport.

The system rests on a few non-negotiable principles:

1. **Light, layered surfaces.** A near-white canvas with white cards lifted by hairline borders and soft shadows. Quiet, on-brand with the ISA's light/white site, and easy on the eyes for long operator sessions. Depth comes from borders + shadow, not darkness.
2. **Teal carries identity.** The ISA teal is the brand thread — links, active states, the brand mark, and the "running" timer state. The orange-red is a restrained warm accent (attention, brand pop), echoing the ISA logo. Restraint here keeps the state colors unambiguous.
3. **A single RACE-STATE LANGUAGE.** Gray / amber / teal / green / orange-red mean exactly the same thing everywhere — the running timer, the lane resolution, the light tree, the leaderboard. Learn it once, read it anywhere.
4. **Monumental tabular numerals are the hero.** The number is the product. Everything else is chrome arranged around it.
5. **Restraint over decoration.** Motion is state-driven, not ornamental. Surfaces are quiet so the data is loud.

> The number is the hero. Design everything else to get out of its way.

---

## 2. The Race-State Language

This is the single most important contract in the system. Each race state maps to **one** color, and that color appears **identically** across every surface. A spectator who learns "green = winner" on the light tree reads it the same way on the leaderboard.

| State                                | Token     | Hex       | Meaning                                  | Where it appears                                                                                                 |
| ------------------------------------ | --------- | --------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Idle / not-started**               | `idle`    | `#8A939D` | Armed but nothing happening; placeholder | Stopped timer at `00.000`, empty lane, dark light-tree bulb, unresolved bracket slot                             |
| **Set**                              | `set`     | `#F2A93B` | Start sequence in progress               | The start light's two **SET** phases, "ready" lane indicator                                                     |
| **Running**                          | `running` | `#13A89E` | A lane actively timing                   | Running timer digits, the live/ticking lane while counting                                                       |
| **Go / winner**                      | `go`      | `#65BC7B` | GO light; the faster lane                | **GO** light, winning lane on resolution, leaderboard leader, bracket winner glow                                |
| **Stop / false-start / DNF / loser** | `stop`    | `#F04E34` | Fault, the armed cue, or the slower lane | Start light **armed** (§6), false-start flash, **DNF** badge, losing lane on resolution, eliminated bracket slot |

Dimmed variants (`goDim` `#2E8F50`, `setDim` `#B0741A`, `stopDim` `#C2391F`) are for **numeral-weight** contrast on the light theme and for unlit/recessed treatments of the same state — e.g. a winner numeral on white (use `goDim`), an unlit bulb's housing tint, a state-colored panel border, a hover-rest fill. They were tuned for digits at ≥24 px: `goDim` (3.79:1 on canvas) and `setDim` (3.65:1) clear the ≥3:1 large-text/non-text floor but **not** the 4.5:1 body-text floor.

Text variants (`runningText` `#0B6B65`, `goText` `#1F7A40`, `setText` `#8F5E12`) are the third tier: state **words** under 24 px on the light theme — a lane card's `RUNNING` / `BREAK` / `CHANGEOVER` label, an outlined Start's caption, a why-line in its state colour. Each clears 4.5:1 on both light grounds (canvas 4.99–5.91, panel 5.36–6.35). `stop` needs none — `stopDim` already clears it (5.01 / 5.39) — and `running` has no Dim, so `runningText` also serves its digits. The tier is the answer for **any** state colour used as ink rather than as a fill, alarms included: an outlined `error` control or chip writes in `stopDim` and an outlined `warning` chip in `setText`, since `error.main` as ink is 3.34:1 and `warning.main` 1.94:1 (the MUI theme carries both as alarm variants). Every live-path pair is pinned in `web/test/app/theme/contrast.test.ts`; the full board table is freestyle-board-ux §6.

Bright variants (`runningBright` `#45E5D8`, `setBright` `#FFC75E`, `stopBright` `#FF9B82`) are the same hues stepped up as **text accents on dark grounds** — the athlete display's `void` ground and its over-footage stream twin, where the base hues fall to ~3–4:1 as text. They hold ~7:1 on `void` (teal/amber) and 5.4:1 for the red family (its ceiling before the hue reads pink). Use them for caption-weight state text (the "TIME" expiry caption, the best-trick turn highlight, the on-deck arrow); secondary greys use `ink.faint` (`ink.hi` is byte-identical to `void`). Only states that actually paint on dark grounds carry a Bright, mirroring the Dim precedent.

**Hero numerals on dark grounds do not take state hues at all.** Even the bright tier caps at ~5:1 for red — short of what a distant, sunlit venue screen needs. The digits stay white (`ink.onBrand`, 11:1 — the contrast ceiling) and the state moves to a **stroked frame** around the clock — stroke only, **never a fill/tint inside the frame**, which would lighten the ground exactly behind the digits and eat the white-on-void contrast the frame exists to protect. The frame tiers by **luminance and weight**, because distance vision separates brightness and shape, not hue (base teal and `idle` grey are near-identical in luminance and read alike from far): **idle** = the dim `idle` grey stroke, thin; a **counting** clock (running / break) = the `*Bright` stroke with **wide left/right strokes** (`0.50em` of the numeral) — a weight cue that reads at distance; **expired** = `stopBright` stroke, thin (resolved, not live). Weight goes to the sides only: top/bottom keep the thin `0.125em` broadcast stroke, so the frame never grows toward the name row above and paints no light near it (a glow was tried and rejected for exactly that bleed). Standalone resolution text ("Battle Over") uses the DNF-badge language instead: solid `stop` fill, `ink.onBrand` caps, pill radius.

### Specific renderings

- **Running timer** — digits in `running` (teal) while counting; fall back to `ink.hi` (slate) once stopped and unresolved.
- **Hero timer arc** — reads slate (`ink.hi`) when idle, **teal** (`running`) while running, then resolves **green** (winner) / **orange-red** (loser). On the light theme use `goDim` for winner numerals/text so the green carries contrast on white.
- **Lane resolution** — at race end, the winning lane background/border resolves to `go`, the losing lane to `stop`. The win is also signaled by a one-shot flash (see §8 Motion).
- **Start-light tree** — two bulbs: armed = both `stop`, then `set` → both `set` → both `go`. The tree carries **no** false-start state (ADR 0035 moved it to a lane-scoped preview badge). See §6.
- **DNF** — the sentinel value `3_355_550` is **never rendered as a number**. It renders as a compact **`DNF`** badge (`stop` fill with `ink.onBrand` text, or `stop` text, pill radius).
- **Idle / not-started** — neutral `idle` gray. Distinct from `stop` so "nothing yet" never reads as "fault."

> Rule: a state color may only express its state. Do not reuse `set`/`running`/`go`/`stop` for decoration, links, or hover states. (Note: `running` and the brand `teal` share a hex but live in different token namespaces — running is the timing state, teal is identity.)

---

## 3. Color Tokens

The system is **light and ISA-branded**. Aim for a **7:1 contrast ratio** for at-a-glance scoreboard data (timer digits, leaderboard names, lane labels) so it survives distance and video compression; UI chrome and secondary labels may relax toward 4.5:1. On the light theme, use the **dimmed** state tokens (`goDim`, `tealDark`, `orangeDark`, `stopDim`, `setDim`) for **numeral-weight** contrast on white, and the **text** tier (`runningText`, `goText`, `setText`, `stopDim`) for words under 24 px — the base state hues are tuned for fills and lights, not body text. Slate `#333C4E` on white is ~9:1.

### Surfaces

Light, layered planes. Cards are white, separated from the canvas by a hairline border + soft shadow (not by darkness). The deepest tone, `void`/slate, is reserved for projector grounds, broadcast overlays, and footers.

| Token        | Hex       | Usage                                                 | Note                                                                                   |
| ------------ | --------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `void`       | `#333C4E` | Slate — projector grounds, broadcast overlays, footer | The deepest tone. **Not** the app background — reserved for over-video / dark grounds. |
| `canvas`     | `#F5F7F8` | Page background                                       | The default page ground                                                                |
| `base`       | `#FFFFFF` | Base surface                                          | Plain white surface                                                                    |
| `panel`      | `#FFFFFF` | Primary panels, cards, table bodies                   | White; separated from `canvas` by a 1px `line` border + soft shadow                    |
| `raised`     | `#FFFFFF` | Surfaces lifted above a panel                         | Same white as `panel` — the lift comes from shadow, not tone                           |
| `muted`      | `#EDF1F2` | Input fills, inset wells, disabled fills              | Recessed tint within a panel                                                           |
| `line`       | `#E1E6E8` | Default borders, dividers, table grid                 | Hairline separators                                                                    |
| `lineStrong` | `#C7D0D3` | Emphasized borders, focus outlines, header rules      | Higher-contrast edges                                                                  |

### Ink (text & icons)

On light surfaces.

| Token     | Hex       | Usage                                                       | Note                                         |
| --------- | --------- | ----------------------------------------------------------- | -------------------------------------------- |
| `hi`      | `#333C4E` | Slate — primary text, timer digits, headings, hero numerals | ~9:1 on white                                |
| `mid`     | `#5B6776` | Secondary/body text, captions, inactive labels              | ~4.5:1+                                      |
| `low`     | `#8A939D` | Tertiary text, meta, placeholders                           | Decorative/low-priority only                 |
| `faint`   | `#B7BFC6` | Disabled, watermarks, ghost states                          | Not for readable content                     |
| `onBrand` | `#FFFFFF` | Text/icon on teal / orange / slate fills                    | High-contrast foreground on dark/brand fills |

### Brand (ISA)

Identity only. **Not** a race-state color (though `teal` shares its hex with the `running` state — see §2).

| Token        | Hex                     | Usage                                                          | Note                                |
| ------------ | ----------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `teal`       | `#13A89E`               | Primary — links, active, brand mark, the "running" timer state | The ISA brand thread                |
| `tealDark`   | `#0E837B`               | Hover/pressed; teal as **text on light**                       | Darker teal for contrast on white   |
| `tealTint`   | `rgba(19,168,158,0.12)` | Selected/hover surfaces                                        | Subtle teal wash                    |
| `orange`     | `#F04E34`               | Warm accent — attention, brand pop                             | Echoes the ISA logo accent          |
| `orangeDark` | `#C73A23`               | Hover/pressed; orange as **text on light**                     | Darker orange for contrast on white |

> The brand `orange` and the state `stop` share `#F04E34` (the ISA logo accent doubles as the fault/loser hue). Keep them in their own token namespaces so intent stays clear in code.

### Race states

See §2 for semantics. Hexes:

| Token     | Hex       | Dimmed (numerals on light) | Dimmed hex | Text (words on light) | Text hex  | Bright (on dark) | Bright hex |
| --------- | --------- | -------------------------- | ---------- | --------------------- | --------- | ---------------- | ---------- |
| `running` | `#13A89E` | —                          | —          | `runningText`         | `#0B6B65` | `runningBright`  | `#45E5D8`  |
| `go`      | `#65BC7B` | `goDim`                    | `#2E8F50`  | `goText`              | `#1F7A40` | —                | —          |
| `set`     | `#F2A93B` | `setDim`                   | `#B0741A`  | `setText`             | `#8F5E12` | `setBright`      | `#FFC75E`  |
| `stop`    | `#F04E34` | `stopDim`                  | `#C2391F`  | (`stopDim`)           | `#C2391F` | `stopBright`     | `#FF9B82`  |
| `idle`    | `#8A939D` | —                          | —          | —                     | —         | (`ink.faint`)    | `#B7BFC6`  |

```ts
// Race-state palette (semantic — see §2; dim = on-light text, bright = on-dark grounds)
running: { base: '#13A89E', text: '#0B6B65', bright: '#45E5D8' },  // a lane actively timing (teal)
go:      { base: '#65BC7B', dim: '#2E8F50', text: '#1F7A40' },     // GO light / winner (goDim numerals, goText words)
set:     { base: '#F2A93B', dim: '#B0741A', text: '#8F5E12', bright: '#FFC75E' }, // armed / SET light / break
stop:    { base: '#F04E34', dim: '#C2391F', bright: '#FF9B82' },   // false-start / DNF / loser / STOP / expiry (stopDim serves words too)
idle: '#8A939D',                                              // not-started (ink.faint on dark grounds)
```

### Overlay plates & chroma key

Tokens for the broadcast streaming surfaces (`/stream/*`). The LAAX reference set
shares one plate treatment across VS frames, ranking plates, and bracket boxes: a
**solid white stroke** around a fill — `6px` at the art's 1920×1080 reference frame
(`overlayArt.strokeWidth` / `--tl-overlay-stroke-width`; scale off a 1080p
baseline, don't hard-pin). The big VS/winner lower-third portrait frame is the one
exception: it needs a heavier edge to read at venue distance and carries its own
**10px** `PANEL_EDGE` in `Stream/Competitor.tsx`, decoupled from the shared token
(ADR 0029 amendment). See §7.

**Two-tier colour language (NOT all text white).** The overlay text colour is _not_
the white that compositing the transparent source art on black makes it look — the
full-colour refs show two tiers, and the `overlay.*` group names each so overlay code
never falls back to an ISA `ink`/`common.white` default:

1. **Structural marks are white** — section labels (`SEMI FINALS`, `FINALS`,
   `{GENDER}'S {DISCIPLINE}`, `WINNER`), the `VS` glyph, bracket connector lines, and
   the **empty** slot plates (translucent fill + white stroke). Footage-borne
   text inherits the `overlayTextShadow` halo from the `StreamLayout` root.
2. **Filled athlete-name plates flip to solid white with near-black name text** —
   every name bar/band in the refs (`AMANDA MONTMINY`, `TAYLOR ST. GERMAIN`) is a
   white background with dark condensed caps, not white text.

The same two tiers govern the **result cells** of the VS stat tables and the
freestyle score card (`Stream/ScoreCell.tsx`, the one home for both): a cell
holding a value is a filled plate (`plateFilled` + `nameInk`, footage shadow
off), an unrun slot stays the art's translucent `plateName` box with its white
stroke. The `TOTAL` box (solid `nameInk`) and the `CONTROL PENALTY` box (solid
`race.stop`) are the unconditional exceptions — a saturated ground that already
carries white numerals. The penalty box is drawn solid in **both** homes even
though one LAAX art washes it at ~28% alpha: legibility over bright footage wins
over matching that one file.

A **DNF** on any white plate — a names-cut row, a VS run cell, a profile or SVO
card result — is a race-state word, not a value: it inks in `race.stopDim`
(5.01:1 on `plateFilled`, the stop tier's words-on-white form; `resultInk` in
`util/resultLabel.ts`), on the plate's own sharp corners rather than a pill. The
near-black `TOTAL` box keeps its white `DNF`, since `stopDim` fails on that
ground.

The **stat label** on a VS table row sits on the 48% `plateStrip` band, not on
footage, so it takes the filled-plate tier too: `nameInk`, footage shadow off
(≈12:1 over bright footage, ≈4.6:1 over dark; 32px caps are large text). White
caps there wash out to ≤1.9:1. The bandless `TOTAL` row keeps the white caps +
footage shadow.

| Token                        | Value                    | Use                                                                                                           |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `overlay.plate`              | `rgba(255,255,255,0.3)`  | **Empty** profile-box fill — VS photo frame, portrait card, profile bracket box (the profile art's 30% white) |
| `overlay.plateName`          | `rgba(255,255,255,0.35)` | **Empty** name-bar fill — the name bracket's TBD plate (the names art's 35% white)                            |
| `overlay.plateStrip`         | `rgba(255,255,255,0.48)` | Row backing band behind a VS stat label (the art's 48% white); the label on it inks `nameInk`, no shadow      |
| `overlay.plateFilled`        | `#FFFFFF`                | **Filled** named-plate fill — solid white bar behind a dark athlete name                                      |
| `overlay.stroke`             | `#FFFFFF`                | Plate border + thin bracket connector lines (width = `overlayArt.strokeWidth`)                                |
| `overlay.nameInk`            | `#231f20`                | Name/value ink on a filled plate, incl. the `/stream/timer` plate's idle/stopped digits; **not** `ink.hi`     |
| `overlay.nameInkSubordinate` | `#737172`                | Subordinate words on a filled plate (source tag, `PTS`/`AVG`), 4.85:1 — a colour step, not `nameInk` + alpha  |
| `overlay.label`              | `#FFFFFF`                | Structural / section labels (reuses `ink.onBrand`)                                                            |
| `overlay.scrim`              | `rgba(51,60,78,0.9)`     | Slate legibility backing for white overlay text — caption gradient + per-text shadow                          |
| `overlay.backdrop`           | `rgba(35,31,32,0.6)`     | Full-bleed frame dim behind an overlay composition — the LAAX "60% Black" layer (distinct from `scrim`)       |
| `chromaKey`                  | `#FF00FF`                | Chroma-key body fill for ALL overlay surfaces, painted when `?bg=key`                                         |
| `chromaKeyGreen` / `Blue`    | `#00B140` / `#0047BB`    | The `?bg=green` / `?bg=blue` grounds (keyer presets) — they erase our own greens/blues                        |
| `overlayArt.strokeWidth`     | `6px`                    | Plate/VS-box border + connector weight, at the art's 1920×1080 reference frame                                |
| `overlayArt.headingTracking` | `-0.02em`                | Tight display-caps letter-spacing on overlay headings (the art runs −.01…−.03em)                              |
| `overlayArt.bannerTracking`  | `0.08em`                 | Open banner caps — the `WINNER` banner/tag, the best-of-3 caption and tally names                             |
| `overlayArt.nameTracking`    | `0.01em`                 | Athlete names and initials on every plate and card                                                            |

All three translucent-white alphas are measured in the art (the plate-opacity
audit): every profile-language file (`Profile top 4`, `Profile Brackets`, `vs`)
fills its boxes at `opacity .3`, every names-language file (`Names top 4/8`,
`Name Brackets`) at `.35`, and the VS stat-row bands at `.48` — so the split is
the art's, not a drift.

On a solid chroma ground (`?bg=key`/`magenta`/`green`/`blue`) the three
translucent fills flatten to opaque neutrals — the same alpha over `surface.void`
(`#707783` / `#7A808C` / `#959AA3`), so the keyer sees a fixed band instead of
white blended into the key. The TS tokens resolve through their vars for this;
the rule and the `tl-chroma-ground` class are owned by
[`../broadcast-overlays.md`](../broadcast-overlays.md).

CSS vars: `--tl-overlay-plate`, `--tl-overlay-plate-name`, `--tl-overlay-plate-strip`, `--tl-overlay-plate-filled`, `--tl-overlay-stroke`,
`--tl-overlay-name-ink`, `--tl-overlay-name-ink-subordinate`, `--tl-overlay-label`,
`--tl-overlay-scrim`, `--tl-overlay-backdrop`, `--tl-chroma-key`,
`--tl-chroma-key-green`, `--tl-chroma-key-blue`, `--tl-overlay-stroke-width`,
`--tl-overlay-heading-tracking`, `--tl-overlay-banner-tracking`,
`--tl-overlay-name-tracking`.

**Name face & weights.** Names use `fonts.display` (`Oswald`, see §4) and pair a
**bold** given name with a **lighter** family name — over the loaded `300–700`
axis the pairing is `700`/`300` (`Stream/AthleteName.tsx`). The LAAX v2 art sets
most marks in a single Medium (~`500`) with the Black weight (→ `700`) reserved
for the biggest labels.

`chromaKey` is the single source of truth for the key hue (retune in
`theme/tokens.{ts,css}` to match a venue's keyer). Why magenta and not green, the
`?bg=` mode switch, and the capture pipeline:
[`../broadcast-overlays.md`](../broadcast-overlays.md).

---

## 4. Typography

Three roles, each with its face. The numeral face is sacred — it carries the hero element.

| Role         | Family             | Use for                                                                                             |
| ------------ | ------------------ | --------------------------------------------------------------------------------------------------- |
| **Numerals** | `'JetBrains Mono'` | Giant timers and **all** numeric content — clocks, splits, ranks, lane numbers, scores              |
| **Display**  | `'Oswald'`         | Headings, athlete names, leaderboards, bracket slots — anything that needs presence in narrow space |
| **Body**     | `'Saira'`          | UI text, form labels, captions, buttons, table cells                                                |

**Every family is bundled self-hosted** via `@fontsource`, imported in
`web/src/app/index.tsx`; `web/index.html` carries **no** font `<link>` and no
CDN preconnect. Captured `/stream/*` overlays run with **external hosts
blocked**, and the numeral face draws every timer digit — one CDN font is a
blank clock on air. Loaded weights: JetBrains Mono `300–700`, Oswald `300–700`,
Saira `400–700`, Saira Condensed `300/500/600/700/800`. Oswald ships no `800`,
so a `fontWeight: 800` on the display face silently resolves back to `700`.

The display face is **`Oswald`**, the free stand-in for the LAAX art's commercial
`Placard Next` (Oswald `500` ≈ `PlacardNext-Medium`; `700` covers the art's Black
weight). `Saira Condensed` stays in the stack as the loaded fallback.

The numeral face **must be a true monospace** — see the fixed-width-digit rule below for why this is non-negotiable. `JetBrains Mono` is the chosen face: a genuine monospace (so every digit shares one advance width by construction), freely licensed, with a tall x-height that holds legibility at distance and on compressed video, and clearly disambiguated glyphs (dotted zero). Any swap must preserve the true-monospace property.

### The fixed-width-digit rule (non-negotiable)

> **Every digit must occupy the exact same advance width.** A live timer that re-lays-out as the value changes is broken, not styled.

This is the single hardest constraint on the numeral face. The hero timer ticks at sub-second cadence and a countdown sheds digits (`10` → `9`); if a `1` is narrower than a `0`, or the seconds column reflows when the minutes change, the whole number **shifts and flickers** on every frame — unacceptable on a projector or a broadcast overlay where it's the focal point.

There are two ways a font can guarantee equal-width digits, in order of robustness:

1. **A true monospace face (preferred for the numeral role).** Every glyph — including each digit — shares one fixed advance by construction. The width is intrinsic to the font, so it holds even mid-load, under font fallback, and regardless of CSS feature support. This is why the **numeral** family (§ Type families) must be monospaced, not merely tabular-capable.
2. **`font-variant-numeric: tabular-nums` on a proportional face.** Switches the font's digits to its tabular figure set so digit columns align. Correct and sufficient for leaderboard/table numbers in the **Display**/**Body** faces — but it depends on the chosen face actually shipping tabular figures and on the feature surviving fallback, so it is the second-best guarantee and never the choice for the hero timer.

**Rules:**

- The hero/race timer and any actively-ticking value use the **monospace numeral face**. Do not substitute a proportional font here, even with `tabular-nums`.
- **Always** also set `font-variant-numeric: tabular-nums` explicitly, even on the monospace face — it's free insurance if the face ever falls back.
- The fallback stack must stay **all-monospace** (`ui-monospace, monospace`) so a load failure degrades to another fixed-width font, never a proportional one — a proportional fallback is exactly what produces the flicker.
- Leaderboard times, ranks, and table numerics that are _not_ live-ticking may use a tabular-capable Display/Body face with `tabular-nums`, but the monospace numeral face is still preferred wherever columns of numbers must align.

```css
.tl-number {
  font-family:
    'JetBrains Mono', ui-monospace, monospace; /* monospace → equal advance per digit, by construction */
  font-variant-numeric: tabular-nums; /* belt-and-braces: survives fallback */
}
```

### Type scale

| Token      | rem   | px @16 | Typical use                                                                         |
| ---------- | ----- | ------ | ----------------------------------------------------------------------------------- |
| `display1` | 3     | 48     | Hero timer numeral (scales up further via clamp on preview/overlay)                 |
| `display2` | 2.25  | 36     | Secondary big numbers, lane times                                                   |
| `h1`       | 1.875 | 30     | Page titles                                                                         |
| `h2`       | 1.5   | 24     | Section headings                                                                    |
| `h3`       | 1.25  | 20     | Card titles, athlete names in lists                                                 |
| `body`     | 1     | 16     | Default UI text                                                                     |
| `small`    | 0.875 | 14     | Captions, secondary cells                                                           |
| `label`    | 0.75  | 12     | **UPPERCASE**, `letter-spacing: 0.08em` — field labels, status tags, column headers |

**Live-path floor.** Nothing the operator reads mid-match renders under **14 px** (`liveCaption`
in `theme/tokens.ts`) — venue sunlight, read from a step back. `label`'s 12 px is for field chrome
and column headers, never a board string; a live-path caption keeps its variant and lifts only the
size through that one token.

The hero timer on preview/overlay surfaces exceeds `display1` — use a responsive `clamp()` so it fills the viewport (e.g. `clamp(3rem, 18vw, 16rem)`) while keeping `JetBrains Mono` + `tabular-nums`.

---

## 5. Spacing & Radii

### Spacing

Base unit **8px**. Use the scale; avoid arbitrary values.

```
4 · 8 · 12 · 16 · 24 · 32 · 48 · 64   (px)
```

| Step  | px  | Typical use                     |
| ----- | --- | ------------------------------- |
| `0.5` | 4   | Icon gaps, tight inline spacing |
| `1`   | 8   | Base unit; compact padding      |
| `1.5` | 12  | Control padding, list gaps      |
| `2`   | 16  | Default component padding       |
| `3`   | 24  | Card padding, section gaps      |
| `4`   | 32  | Major section spacing           |
| `6`   | 48  | Page gutters                    |
| `8`   | 64  | Hero/feature spacing            |

### Radii

| Token  | Value   | Use                                      |
| ------ | ------- | ---------------------------------------- |
| `sm`   | `4px`   | Inputs, badges, small chips              |
| `md`   | `8px`   | Buttons, default cards, table containers |
| `lg`   | `14px`  | Large cards, modals, hero panels         |
| `pill` | `999px` | Tags, DNF badge, status pills, toggles   |

### Strokes

Console-chrome mark widths (`strokes` in `tokens.ts`); the overlay frame is `overlayArt.strokeWidth`.

| Token     | Value | Use                                                           |
| --------- | ----- | ------------------------------------------------------------- |
| `keyline` | `2px` | Ground ring that keeps a state tier legible on any plate fill |
| `rule`    | `4px` | Current-step gutter rule beside a desk caption                |

### Desk rails

The control boards' fixed columns at their wide gate (`deskRails` in `tokens.ts`, emitted as
`deskColumns`); the live column takes the rest. One pair for Speedline and Freestyle.

| Token    | Value   | Use                           |
| -------- | ------- | ----------------------------- |
| `setup`  | `248px` | Setup rail, left              |
| `record` | `360px` | Recording / score rail, right |

### Control targets

Minimum press and field sizes (`controlTargets` in `tokens.ts`; §6 "Buttons", §9 "Responsive contract").

| Token       | Value   | Use                                                                   |
| ----------- | ------- | --------------------------------------------------------------------- |
| `floor`     | `40px`  | General controls: admin nav tabs, chrome buttons                      |
| `live`      | `44px`  | Every live-path press and field (MUI's `small` field is 40)           |
| `race`      | `56px`  | Start / Stop / Start try / End try height                             |
| `raceWidth` | `120px` | Start / Stop minimum width                                            |
| `chip`      | `32px`  | Icon toggle sharing the health row (the control header's sound press) |

### Field widths

`minWidth` floors and `maxWidth` caps (`fieldWidths` in `tokens.ts`), never a fixed track width (§9). A floor used
inside a desk rail must fit it. Px, not `ch`: a Select's label and value fonts differ, so a `ch` width drifts per
field.

| Token     | Value   | Use                                                                              |
| --------- | ------- | -------------------------------------------------------------------------------- |
| `compact` | `140px` | Short selects                                                                    |
| `short`   | `160px` | Filter selects                                                                   |
| `field`   | `200px` | Default admin select; the controller picker, which must fit the 248px setup rail |
| `wide`    | `240px` | Wide selects; the manual's contents column                                       |
| `card`    | `360px` | Card cap: the handset card                                                       |
| `prose`   | `820px` | Reading measure: the manual article                                              |

### Admin preview

The athlete form's broadcast card preview (`adminPreview` in `tokens.ts`): a fixed height the card's container-query
type scales off, its width following the card's 298.81 × 498.02 aspect.

| Token        | Value   | Use                        |
| ------------ | ------- | -------------------------- |
| `cardHeight` | `240px` | The athlete card's preview |

### Board geometry

A board's measured floors, caps and reserved rows (`boardGeometry` in `tokens.ts`). They are not a scale: each value
is a fold-budget measurement its brief signed off, so a change re-measures the board. The Freestyle set is
tabulated in [`freestyle-board-ux.md`](./freestyle-board-ux.md) §6. Speedline holds two: the 880 px live-deck ceiling
(`deckMax.speedline`, the Freestyle rule with the start strip between the lanes) and the start strip's 184 px floor
(`speedline.startStrip`), the slot the race pair's why-line wraps in.

### Marks

Round indicator marks (`marks` in `tokens.ts`).

| Token | Value  | Use                     |
| ----- | ------ | ----------------------- |
| `dot` | `10px` | Corner badge status dot |
| `key` | `14px` | Handset map key swatch  |

### Signature: the track-curve card

The identity radius. An **asymmetric** corner treatment evoking the sweep of a slackline / a race track:

```css
border-radius: 14px 4px 14px 4px; /* top-left / top-right / bottom-right / bottom-left */
```

Optionally pair it with a **partial border** on the bottom + right edges only (in `line` or a dimmed state color) to reinforce the swept identity. Reserve the track-curve for high-identity cards (VS head-to-head, bracket slots, feature panels). Standard utility cards use `md`/`lg`.

```css
.tl-card--track {
  border-radius: 14px 4px 14px 4px;
  border-right: 1px solid var(--tl-line);
  border-bottom: 1px solid var(--tl-line);
}
```

---

## 6. Components & Patterns

### Hero timer numeral

The centerpiece. `JetBrains Mono`, `tabular-nums`, sized to dominate its surface (`display1`+ via `clamp` on preview/overlay).

- **Idle:** digits in `ink.hi` (slate `#333C4E`).
- **Running:** digits in `running` (teal `#13A89E`).
- **Resolved (winner/loser context):** inherit lane resolution color — winner uses `goDim` (`#2E8F50`) for numeral contrast on white, loser uses `stop` (`#F04E34`).
- Sub-second digits (the milliseconds) may render at `ink.mid` or slightly smaller for hierarchy, but stay tabular.
- Never let the digit box reflow — fixed-width via tabular figures.

### Dual-lane race view (Speedline)

Two stacked or side-by-side lanes, each its own track-curve panel:

- **Idle:** `panel` background, `idle` accent stripe, athlete name in `fonts.display`.
- **Running:** lane accent + timer in `running` (teal).
- **Resolved:** winner lane → `go` border/glow (numerals/text in `goDim` for contrast); loser lane → `stop` border. One-shot win-flash on the winner (see §8).
- Lane number in `JetBrains Mono`; athlete name in `fonts.display` at `h3`.

### Start-light tree

**Two** bulbs, not an IFSC-length tree (`Speedline/StartSignal.tsx`). On the overlay and the projector preview the pair sits in one sharp-cornered `void` (slate) housing on the shared white plate stroke, for maximum bulb contrast over any ground; metrics in §7. The control page draws bare px bulbs with no housing.

| Phase (wire value)                   | Left bulb        | Right bulb       |
| ------------------------------------ | ---------------- | ---------------- |
| **idle** (`0`)                       | `idle` `#8A939D` | `idle` `#8A939D` |
| **armed** (`PRE_BEEP_PHASE` = `0.5`) | `stop` `#F04E34` | `stop` `#F04E34` |
| **set 1** (`1`)                      | `set` `#F2A93B`  | `idle` `#8A939D` |
| **set 2** (`2`)                      | `set` `#F2A93B`  | `set` `#F2A93B`  |
| **GO** (`3`)                         | `go` `#65BC7B`   | `go` `#65BC7B`   |

`cleared` (`-1`) hides the housing entirely; the control page's bare bulbs go invisible but hold their slot, so Start / Abort / Reset under them never lift mid-run (and never paint idle grey after GO, which would read as re-armed). Idle must **not** be red: red-red on air reads as a recording/error indicator and collides with the abort colour language (ADR 0041). There is no false-start state here — a flagged lane raises its own preview badge (ADR 0035). The GO transition is instantaneous — no fade — to preserve start-accuracy perception. The phase schedule and its delay budget live in [`../architecture.md`](../architecture.md) ("The race start is scheduled, not announced").

### Buttons

Built on MUI `Button`, restyled by the theme.

- **Primary / brand action:** `tealDark` fill, `ink.onBrand` text, `md` radius — `teal` under white is 2.9:1, so the fill is the dark tier and the hover dips its brightness instead (`freestyle-board-ux.md` §6 "Save contained", 4.61:1).
- **Race-critical actions** (Start / Stop / Reset / False Start): use the **state** color, not brand — e.g. Start = `go`, Stop/False-Start = `stop`, Arm = `set`. These are the loudest controls on the control page.
- **Secondary:** `base`/`panel` fill, `ink.hi` text, `line` border. Hover → `muted` / `tealTint`.
- **Ghost / tertiary:** transparent, `ink.mid` text, hover → `muted`.
- Labels in `Saira` (or `label` style — UPPERCASE — for compact controls).
- Target sizes come from `controlTargets` (§5): `floor` (40px) for general controls, `live` (44px) on the live path, `race` (56px tall, `raceWidth` 120px wide) for Start / Stop — the operator presses them under pressure, possibly via gamepad. `RaceButton` owns the live and race sizes.

### Inputs & forms (admin)

- Background `muted`, border `line`, text `ink.hi`, placeholder `ink.low`, `sm` radius.
- Focus: border → `teal`; visible focus ring (accessibility).
- Labels: `label` style (UPPERCASE, `0.08em`, `ink.mid`).
- Error: border + helper text in `stop`.

### Target-pair assignment controls

When the operator assigns people to two live targets — athlete 1/2, left/right,
lane A/B — render the assignment as **one compound control**, not as loose fields
in a wrapping toolbar.

- **Separate context from assignment.** Round / gender / match are one group;
  the two target selectors plus their transform (`Swap`, `Flip`, `Move`) are a
  second group.
- **Keep the pair spatially fixed.** Desktop may use `target | action | target`;
  narrow layouts may stack `target → action → target`. Use grid-to-stack
  transitions, **never free-wrap** that lets one target drift beside unrelated
  fields.
- **A binary side/lane selector is required-choice.** One side is always
  selected; the active side never toggles off. A locked selector preserves the
  visible selected state.
- **Swap is a transform, not a selector.** Place it between the two targets it
  exchanges, and enable it only when the resulting mapping is unambiguous.
  Clearing a side belongs to that side's selector, not the swap action.
- **Use neutral chrome.** The group itself uses the ordinary panel / muted-well
  surfaces; race-state hues remain reserved for actual live state and live
  actions, never generic selection scaffolding.
- **Empty states must still say something.** Render `TBD`, `Not recording`, or an
  equivalent explicit placeholder rather than leaving a target visually blank.

### Tables (admin CRUD)

- Container `panel`, `line` border + soft shadow, `md` radius.
- Header row: `muted` background, `label` style column headers (UPPERCASE), bottom rule `lineStrong`.
- Body rows: `panel`; zebra via `muted` or hover → `tealTint`.
- Row dividers `line`.
- **Numeric columns** (times, ranks) in `JetBrains Mono` + `tabular-nums`, right-aligned.
- DNF cell → `stop` `DNF` pill, not a number.

### Cards (track-curve)

See §5. High-identity cards use `14px 4px 14px 4px` + optional partial bottom/right border. Padding `24px` (`spacing.3`). Title in `fonts.display` `h3`.

### Leaderboard / rankings row

- Row is a horizontal track-curve-light card on `panel`.
- **Rank** in `JetBrains Mono` (large, tabular), leader row tinted `tealTint`.
- **Athlete name** in `fonts.display`.
- **Time** in `JetBrains Mono` + `tabular-nums`, right-aligned for column alignment.
- DNF → `stop` `DNF` badge.
- Active/highlighted row: `tealTint` + `go` accent stripe for the leader (leader numerals in `goDim`).

### VS head-to-head card

The marquee matchup component. Two athletes mirrored around a central `orange` **VS**:

- Each side a track-curve panel; names in `fonts.display` (`h2`/`display2`).
- Central divider/VS glyph in `orange` (the ISA warm-accent brand moment).
- On resolution: winner side → `go` (numerals `goDim`), loser side → `stop`.
- Times in `JetBrains Mono` tabular under each name.

### Playoff bracket slot

- Slot box: `panel`, `line` border, athlete name in `fonts.display`, seed/score in `JetBrains Mono`.
- **Winner:** `go` border + soft `go` glow (advances).
- **Loser / eliminated:** `stop` border or dimmed (`ink.low`).
- **Empty / TBD:** `idle`, `Saira` placeholder.
- Connector lines in `line` / `lineStrong`.

---

## 7. Broadcast / Overlay Rules

Overlays composite over **arbitrary live video** in OBS Studio (or similar). They cannot assume a background and paint none by default (rule 1).

> **Plate treatment (LAAX broadcast set) — CURRENT.** This is the recipe the shipped
> `/stream/*` overlays use; the slate-scrim recipe below it is the **superseded** earlier
> approach, kept for the contrast rationale (rules 4–6 on per-text protection still apply).
> The current set uses a
> lighter recipe than the slate scrim below: a transparent canvas with
> **solid white-stroked, translucent plates** (`overlay.stroke` at
> `overlayArt.strokeWidth` — `6px` @1080p — over `overlay.plate` 30% /
> `overlay.plateName` 35% white, see §3),
> heavy condensed white caps (`fonts.display`, tracked tight with
> `overlayArt.headingTracking`) for section labels, and `fonts.numerals` for
> times/scores/rank numbers. A composition may sit on the full-bleed
> `overlay.backdrop` dim (the LAAX "60% Black" layer) instead of per-text scrims.
> Plates have **sharp corners** (no radius) and rely on the white stroke +
> per-text shadow for legibility, not a slate fill. Winner edge → `go`,
> loser/DNF → `stop` — the loser edge only on the decided VS head-to-head
> (`Plate loser`); the bracket's eliminated boxes keep the white edge as their dim.

> **The light-app / slate-overlay split (superseded — see the LAAX plate treatment above).** The app theme is **light** (white cards on a near-white canvas), but broadcast overlays **invert to the slate (`void` `#333C4E`) ground** — a light UI cannot sit legibly over live video. Overlays are the one place the deepest tone becomes the dominant surface. The recipe: **slate scrim + teal identity edge + white text (`ink.onBrand`) + per-text shadow + title-safe inset.** Do not reuse the light page surfaces here.

1. **Background mode (`?bg=`).** The overlay root paints **no** background by default — only the graphic elements paint (the fail-safe-blank baseline), and the foreground layers are identical in every mode except that a chroma ground flattens the translucent plates to opaque neutrals. The mode table, the chroma choice, and the capture pipeline are owned by [`../broadcast-overlays.md`](../broadcast-overlays.md).
2. **Slate scrim, not light surfaces.** Each block sits on a `void`/slate semi-transparent scrim, **not** the light `panel`/`canvas` surfaces.
3. **Teal identity edge.** A `teal` accent edge/keyline marks the graphic as ISA-branded over the slate scrim.
4. **Per-text protection.** Every text/numeral element carries its **own** slate scrim backing **or** a text-shadow so it survives over bright, busy, or light video. Never rely on the global background.
5. **Title-safe margins.** Inset all content **~5–10%** from every edge. Nothing critical in the outer 5%.
6. **White text + shadow is the contrast workhorse.** `ink.onBrand` (`#FFFFFF`) with a heavy dark drop-shadow reads over almost any footage. Use state colors for accents and resolution, but the readable mass stays white-on-shadow.
7. **Restrained motion only.** State-driven transitions (light tree, lane resolution) are fine; no idle/looping/decorative animation that distracts from the broadcast.

```css
/* Text protection for overlays — white on slate, regardless of the light app theme */
.tl-overlay-text {
  color: var(--tl-ink-on-brand); /* #FFFFFF */
  /* text-shadow: the six-layer slate halo, `overlayTextShadow` (tokens.ts) —
     the StreamLayout root default; filled plates cancel it with `none`. */
}
.tl-overlay-scrim {
  background: var(--tl-overlay-scrim); /* void / slate legibility backing */
  border-left: 3px solid var(--tl-teal); /* teal identity edge */
  border-radius: var(--tl-radius-md);
}
```

### Athlete flag art has two fidelity tiers

The `AthleteCard` foot strip is the one surface whose ~10:1 band takes flag art
drawn **for** that rectangle, and that art comes from two places. The
distinction is not cosmetic — one tier is the client's own design, the other is
our reconstruction of it — so it is modelled explicitly rather than merged into
one table:

| Tier          | Origin                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| **delivered** | the event **designer's** own art, lifted from the delivered card masters |
| **rebuilt**   | **reconstructed by an LLM** for nations the designer never delivered     |

`app/pages/Stream/flags/wide/` owns this, including the precedence
(delivered always wins) and the rule that the two tiers stay disjoint. Its
`index.ts` is the source of truth — read it rather than restating it here. Two
consequences for design work: a nation in the **rebuilt** tier is a best-effort
match, not a signed-off asset, so judge it more sceptically on air; and a nation
in neither tier deliberately falls back to the undistorted flag-icons flag on
its edge colour rather than to a stretched approximation.

### Overlay reference geometry (the LAAX 2026 master art)

**Provenance — read this first.** The `/stream/*` overlays were originally built
and signed off against **client-delivered LAAX 2026 master art**: vector masters
for the bracket, VS, rankings and freestyle score-card compositions, per-athlete
card and name-strip raster masters, and a set of dark-composited reference
composites used for the visual signoff. **That art is not part of this
repository** — it is the event client's material and was never redistributed
here. Code comments across `app/pages/Stream/`, `app/pages/Admin/` and
`app/util/bracket.ts` cite master filenames (`LAAX 2026_vs speed.svg`,
`Profiles_W_*.png`, …) purely as **provenance labels**: they name where a number
came from, not a file you can open.

This section is consequently the surviving measurement record. It exists so the
overlay geometry can be verified, re-derived or deliberately changed from this
document alone. **The code is the implementation of record** — where a number
here and a number in code disagree, the code wins and this table is stale.

**The reference frame.** Every metric below is **px on a 1920×1080 frame** — the
resolution OBS captures at. `app/util/overlayScale.ts` carries them to any
capture size: `refVw(px)` = `px/1920` in `vw` for widths, `refVh(px)` =
`px/1080` in `vh` for heights **and font sizes**. A 1080p capture therefore lands
pixel-for-pixel on the master; every other 16:9 resolution scales cleanly, and no
overlay is pinned to a fixed canvas. Bracket trees additionally work in
percentages of the 16:9 canvas (`artX`/`artY` in `bracket.ts`).

**Reference-frame constants.** A number shared across overlays lives in
`tokens.ts`: the type floor `OVERLAY_TYPE_FLOOR_PX`, the WINNER word
`OVERLAY_WINNER_WORD_PX` / `OVERLAY_WINNER_GAP_PX`, the timer lower-thirds'
`OVERLAY_LANE` (inset, name-to-clock gap, lane banner height, clock plate) and
the name lower-third's native `OVERLAY_NAME_STRIP` (720 × 92). A number that
belongs to one composition lives in its overlay's art table: `VS_ART`
(`VsOverlay.tsx`), `SUMMARY_ART` (`RoundsSummaryOverlay.tsx`: the 24
caption-tally-cards gap, the 16 tally gap, 32 / 40 / 64 caption / name /
numeral) and `PROFILE_ART` (`RankingsOverlay.tsx`). Gaps and padding follow the
same rule: an overlay body never uses MUI theme spacing (`spacing={3}`,
`pt: 6`), which stays fixed device px at a 720p or 4K capture while the plates
around it scale. `web/test/app/noRawColour.test.ts` enforces this for every
`pages/Stream/*Overlay.tsx`.

**Type substitution.** The masters set display caps in the commercial **Placard
Next** and value numerals in **Montserrat Bold**; the app substitutes `Oswald`
(500 ≈ PlacardNext-Medium, 700 ≈ the Black weight) and the house numeral face
(`fonts.numerals`). Display cap height is ≈ **0.72em**, the constant behind every
"caps as a share of the box" derivation below. Oswald runs **wider** than Placard
Next — the source of the deliberate deviations listed at the end.

#### Name bracket — `bracket.ts` `nameTreeLayout`, `PlayoffBracket.tsx`

Every plate is the **same** bar: quarters, all four semi-finalists, finals,
winner and the small-final trio alike. Pairs feed inward through white elbow
connectors drawn at the pair midpoint.

| Metric                                        | Reference px                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Plate (all rounds)                            | 390.54 × 49.92                                                                                                                                 |
| Column left edges (quarter/semi/final/winner) | 106.33 / 561.98 / 1014.35 / 1466.73                                                                                                            |
| Semi plate centres (y)                        | 287.57, 485.70, 683.83, 881.95                                                                                                                 |
| Quarter pair centre-to-centre gap             | 68.47 (each plate ± 34.235 off its semi centre)                                                                                                |
| Small-final pair centres (y)                  | 941.15, 1009.62 (bronze plate at their midpoint)                                                                                               |
| Plate border stroke                           | 5                                                                                                                                              |
| Connector elbow stroke                        | 4 — one step under the plates (the art's 4-under-5 hierarchy)                                                                                  |
| Label sizes (font px)                         | QUARTER FINALS 39 (rotated −90°, x 72) · SEMI FINALS 71.29 · FINALS 129.96 (y 592) · WINNER 55 (y 651) · SMALL FINAL 44 (y 885) · 3RD PLACE 55 |

Finals and winner centres are **derived**, not measured: each is the midpoint of
the pair feeding it (matches the master to < 0.01%). `3RD PLACE` sits at the
`WINNER` caption's exact offset below its own plate so the two result bars read
as a pair. Name caps are `55cqh` of the plate height — the ranking plates' ratio,
so both filled-plate families read at one size side by side. An undecided plate
carries the shared `UnknownAthlete` mark at the plate's full inner height on its
`tight` viewBox (the border is the inset, so the portrait card margin is
cropped; ink ≈ 31.5 of the 34.9px inner bar at 1080p).

#### Profile (photo) bracket — `bracket.ts` `profileTreeLayout`

Every box is a **0.6-aspect portrait rect** growing round by round. Only the
**left** side is encoded: the master is a mirror (its right-side rects are the
left rects rotated 180°, within ~3px), so the right side derives as
`1920 − x − w`.

| Box              | x                | top                               | w × h           |
| ---------------- | ---------------- | --------------------------------- | --------------- |
| Quarter (×4)     | 104.95           | 244.29 / 435.74 / 654.34 / 845.79 | 102.62 × 171.03 |
| Semi (×2)        | 326.36           | 320.45 / 730.60                   | 125.98 × 209.97 |
| Finalist         | 570.83           | 499.17                            | 157.61 × 262.68 |
| Centre FINALS    | 851.78           | 247.38                            | 216.44 × 360.73 |
| Small-final pair | 795.50 / 1007.47 | 811.74                            | 117.03 × 195.05 |

Tree midline **y = 630.51** (the finalist boxes' y-centre); the QUARTER/SEMI
FINALS labels centre on it. Labels: QUARTER FINALS 34.79 at x 72.8, rotated ∓90°
per side; SEMI FINALS 68.09 on **two** lines at the master's 0.95 line spacing;
FINALS 85.06 at y 719.9; SMALL FINAL 32.32 at y 1045.

Connectors are traced from the master's polylines and differ from the name tree:
each pair routes through a **C-shape** attached ~38px inside the pair's outer
edges, plus a separate stub into the next box's edge. Key x stations are
207.57 → 271.96 → 326.36 (quarters → semis) and 452.35 → 516.57 → 570.83 (semis →
finalists); the finalist cross-line runs y 661.65 from x 728.44 to 1194.9 with a
stub rising at x 960 to y 608.11; the small-final pair joins at y 915.09 between
x 912.53 and 1007.47. Connectors and box edges share one **6** stroke, authored
frame-relative (`refVh`) like the name tree's, so both variants' line systems
scale identically away from 1080p.

**Both trees are re-centred before render** (`recentreTree`). The masters were
framed with an empty top quarter (an event-logo slot that no longer exists) and
captions running into the bottom 1.5%, so the measured geometry hangs
bottom-heavy and breaks the 5% title-safe rule (rule 5 above). The re-centre
shifts the whole tree — boxes, label bands, connector coordinates — so its
bounding box centres on the canvas, leaving every relative percentage the master
encodes untouched.

#### VS head-to-head — `VsOverlay.tsx`, `Competitor.tsx`, `VsStatsTable.tsx`

The composition is a centred row:
`[stats table] [photo card] VS [photo card] [stats table]`.

| Metric                                  | Reference px                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Portrait panel (the `Competitor` frame) | 298.81 × 498.02                                                                                                                           |
| Gap between the two cards               | 176.19, holding the VS glyph at 109.98                                                                                                    |
| Left stats table → left card            | 67.06                                                                                                                                     |
| Right card → right stats table          | 61.03                                                                                                                                     |
| Panel edge stroke                       | 10 @1080p — heavier than the shared `overlayArt.strokeWidth` (6) on purpose: at venue distance the big lower-third frame needs the weight |
| Stats table width / cell stroke         | 400 / ~5                                                                                                                                  |
| Stat row height / pitch                 | 57 / 70 (gap 13)                                                                                                                          |
| Speed value box                         | 233.96 × 56.79; value 36.44, label 32                                                                                                     |
| Freestyle component box                 | 166.88 × 56.79; value 36.44, label 32, CONTROL PENALTY label 25 (the master shrinks it so the long label fits)                            |
| Freestyle TOTAL box                     | 194.82 × 86.39, 10.59 below the last component row; value 40, label 62.61                                                                 |

The rounds-summary pair reuses the frame at **half** the card gap (88.095,
`VS_ART.vsGap / 2`) — no VS glyph between them, but enough ground for the 10px
outset winner rim to clear the second card. Its caption, tally and cards stack
24 apart, with 16 between the tally's names and digits (`SUMMARY_ART`).

The table container matches the card height (498.02) so the shorter speed block
centres against the card exactly as the master does. Values sit on the **outer**
edge, labels on the **inner** edge, so the left table mirrors the right. The
admin `AthleteForm` broadcast preview reproduces the same card with a constant
**9px** frame stroke on the 498.02-tall card (`(9/498.02)·100 cqh`).

#### Rankings, name plates — `RankingsOverlay.tsx`

One recipe at two cuts. Top-4:

| Metric        | Reference px                                                                           |
| ------------- | -------------------------------------------------------------------------------------- |
| Rank-1 plate  | 828.48 × 105.9                                                                         |
| Row gap       | 45.65                                                                                  |
| Rank numerals | 72.68, starting 49.79 left of the plate edge — split into a 35.79 digit box + a 14 gap |
| Plate stroke  | 5                                                                                      |

Top-8 is the **same** recipe uniformly scaled by **626.93 / 828.48** (rows, gap
and numerals alike → 55px numerals) — **except the 5px stroke, which stays
constant in both masters**. Within a cut, each row is a uniformly scaled (width
_and_ height) copy of the row above; the measured cumulative taper is identical
in both files and goes **flat from row 5**: `[1, 0.9444, 0.8953, 0.8347,
0.7779]`. The numeral column is laid out at the field's **widest** label, so
every plate keeps one left edge and no numeral escapes the title-safe inset.

The standings and combined cuts carry a right column the masters never
budgeted (placing-round tag + result). Every row reserves it at the field's
widest tag and widest result (hidden sizers, so a DNF or an em dash pads to a
time), and the plate grows by the tag's share of it. The name slot then
matches the round cut's, the taper stays monotonic, and an 8-row top-8 field
still ends well inside the 1824 title-safe edge. Plain round cuts keep the
art widths exactly. `SMALL FINAL` is never abbreviated to save room: the
bracket overlays use the same label.

#### Rankings, profile cards — `RankingsOverlay.tsx`

Four uniformly tapering portrait cards sharing a **bottom edge at y = 816.92**;
the stroke stays a constant **9** across all four.

| Rank | Card w × h                          | Numeral size | Gap from the previous card's right edge to this numeral |
| ---- | ----------------------------------- | ------------ | ------------------------------------------------------- |
| 1    | 298.81 × 498.02 (the VS panel size) | 156.12       | —                                                       |
| 2    | 254.88 × 424.80                     | 107          | 61.25                                                   |
| 3    | 223.87 × 373.11                     | 83.99        | 52.85                                                   |
| 4    | 196.48 × 327.47                     | 66           | 39.42                                                   |

Each numeral's baseline sits on the shared card foot. The residual between a
numeral's right edge and its card runs ~5–12px in the master (glyph-width
dependent, Oswald ≠ Placard) and is therefore held as a constant **10**. Each
numeral sits right-aligned in a box reserving the field's **widest** label at
the names cut's digit advance (35.79 / 72.68 of the numeral size), so a tie's
`=` moves every card by one rule whichever row carries it.

#### Freestyle score card — `ScoreCardOverlay.tsx`

Eight rows of **56.79** on an **88.97** pitch (gap 32.18), capped at the master's
8 rows; plate stroke **5** throughout. Rank numerals **50.1**, with the 34.32
between the rank glyph start (x 83.63) and the plate (x 117.95) split into a
20.32 digit box + a 14 gap, laid out at the widest label like the rankings
recipe. Name plate width **444.26**. Values **36.44**, headers **40**, TOTAL
header **70.07**, and **14.4** from the last header baseline (280.63) to the
first row top (295.06).

Column widths and the gap from the previous box's right edge — the master's
inter-column gaps are **deliberately irregular**, so each column carries its own:

| Column           | Gap   | Width  |
| ---------------- | ----- | ------ |
| TOTAL            | 39.66 | 194.82 |
| TRICK DIFFICULTY | 28.36 | 166.88 |
| COMBO            | 42.63 | 166.88 |
| STYLE            | 41.72 | 166.88 |
| CONTROL PENALTY  | 34.95 | 166.88 |
| BEST TRICK       | 35.89 | 166.88 |

The **qualification** round is judged without a control penalty or best trick, so
its card drops those two columns and spreads the freed width across the
survivors.

#### Athlete card & name strip — `AthleteCard.tsx`, `AthleteNameStrip.tsx`

Measured off the per-athlete card and name-strip masters, which are authored on
a **250-tall** card; the card's own metrics are therefore **proportional**
(container-query units), so one component serves the fixed-size `Competitor`
frame and the tiny profile-bracket quarter boxes alike.

| Element                     | Master value                                                                      | As authored                                                   |
| --------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Foot flag band              | y ≈ 235 → 251 of 250                                                              | 6% of card height                                             |
| Divider rule above the flag | y = 234.67, ~2px on the 250-tall card                                             | 93.9%, `0.8cqh`                                               |
| Name block foot clearance   | not in the masters (they carry no caption under the name)                         | `1.5cqh` above the divider rule                               |
| White plate top edge        | concave-upward arc — ~54% of the card at the sides, sagging to ~58% at the centre | radial-gradient mask, rx = 50%, ry = 10% of the 40%-tall band |
| Name strip (lower third)    | 720 × 92                                                                          | `OVERLAY_NAME_STRIP` (`tokens.ts`), 720 × 92                  |
| Name caps in the strip      | ≈ 0.63 of the strip height (caps do **not** fill the plate)                       | `0.63 / 0.72` cap-height factor                               |

The plate ink is the masters' near-black **`#231f20`** (`overlay.nameInk`, also
the `overlay.backdrop` hue). Translucent fills likewise come from the masters:
**30%** white for a profile box, **35%** for a name bar, **48%** for the stat-row
backing band; the full-bleed dim is the masters' "60% Black" layer — `#231f20` at
0.6.

#### Lane clock plates — `TimerLaneBlock.tsx` (`OVERLAY_LANE` in `tokens.ts`)

Both timer overlays draw one white time plate: **320** wide with **12**
inner padding each side (the reference's `w-80 p-3`), the Speedline
`M:SS.CC` and the Freestyle `mm:ss` alike. It stays fixed so the digits never
reflow when the minutes gain a glyph. The time hugs its lane's **outer** edge
(left lane left, right lane right; the Freestyle quali single lane and the
warm-up slot follow their column: centred and left). That mirrors the name
strip above it and the SVO cards composited over the same corner.

#### Speedline start light — `StartSignal.tsx`, `SpeedlineTimerDisplay.tsx`

Not from the masters (they carry no timer row); sized to sit on the lane clock
plates' row. The control page's `small` light is outside this frame (30px
bulbs, px).

| Metric                | Reference px                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| Bulb diameter         | 60                                                                          |
| Bulb gap / inner pad  | 8 / 8                                                                       |
| Housing edge          | 6 (`overlayArt.strokeWidth`, emitted `refVh` so it scales with the bulbs)   |
| Housing (outer)       | 156 × 88, `surface.void` fill, `overlay.stroke` edge, no radius             |
| Housing foot (bottom) | 139 — the clock plates' bottom edge (112 corner inset + the UNOFFICIAL row) |

#### Deliberate deviations from the masters

Each of these is a measured value the code **knowingly** does not follow:

- **Shared plate stroke is 6px, not the masters' 9.** 9px clotted the dense
  bracket boxes. The heavier weight survives only where it is needed: the
  `Competitor` panel edge (10 @1080p) and the profile-rankings cards (9).
- **The profile bracket's SMALL FINALS caption is one line, not two.** The master
  wedges two lines into the pair's 94.94px gap; Oswald runs wider than Placard
  Next and collided with the card frames (boxes paint over labels), so it renders
  as a single line under the pair, in the region the tree keeps clear, at the
  master's size. Singular ("SMALL FINAL") per `roundLabel`'s vocabulary.
- **The CONTROL PENALTY box is drawn solid.** The master washes it at ~28% alpha;
  solid keeps the white digits on a saturated ground over bright footage, and
  matches the VS table — one penalty language across two surfaces.
- **Both bracket trees are re-centred** rather than framed as measured (see
  above).
- **A top-4 bracket drops the quarter column** (`seededFromSemis`: no quarter
  match, ≥ 1 semi): its boxes, QUARTER FINALS label(s) and feed connectors go,
  every other box keeps the master's x, and the recentre runs on what is left.
  The name tree is also shifted horizontally onto the canvas centre (it would
  otherwise hug the right edge); the mirrored profile tree is already centred.
- **The `compact` bracket variant does not exist.** The delivered masters cover
  Profile and Name brackets only; the owner's condition for keeping a compact
  variant was that SVG source art exist for it, so it was removed rather than
  invented — [`decisions.md` 0041](../decisions.md).

---

## 8. Motion

Motion is **state-driven, never decorative.** It communicates what just happened, then stops.

- **Light-tree timing** follows the schedule, not a CSS duration: the armed cue holds **3 s** (the relay delay budget), then set 1 / set 2 / GO one second apart — see [`../architecture.md`](../architecture.md). The GO transition is a hard cut, not a fade — start perception must be crisp.
- **False start** flashes `stop` on the offending **lane's** preview badge (not the light housing) until cleared.
- **Lane-win flash** is a single one-shot pulse on the winning lane at resolution (brief `go` brightness bump settling to the resolved state). No looping.
- **No bouncy, springy, or ornamental easing.** Use short, linear or ease-out transitions (≤200ms for UI affordances). Respect `prefers-reduced-motion` — reduce non-essential motion; keep state-critical signals (light tree, false-start flash) since they convey information.

---

## 9. Implementation Notes

Tokens have a single source of truth, exposed in two forms so both MUI and non-MUI (overlay/preview) surfaces consume the same values.

| File                                       | Purpose                                                                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/app/theme/tokens.ts`              | TypeScript token objects — the canonical values (now **light / ISA-branded**). Imported by the MUI theme and any TS that needs raw tokens.                                                                                                        |
| `web/src/app/theme/tokens.css`             | The same values as **CSS custom properties**, prefix **`--tl-`** (e.g. `--tl-teal`, `--tl-bg-panel`, `--tl-radius-lg`; surface colors carry a `--tl-bg-*` sub-prefix). Consumed by non-MUI surfaces.                                              |
| `web/src/app/theme/theme.ts`               | `telemetryTheme` (MUI, now **`palette.mode: 'light'`**). Maps tokens onto MUI's palette/typography/shape/components: `primary` = teal, `secondary` = orange, `success` = go, `warning` = set, `error` = stop. MUI surfaces inherit automatically. |
| `doc/dev/design-system/index.html`         | Live visual reference — renders the tokens and components for eyeballing. Keeps its **own** hand-mirrored `--tl-*` subset under the tokens.css names (plus the `tl-chroma-ground` flatten), pinned value-for-value by `tokens.parity.test.ts`.    |
| `doc/dev/design-system/component-layer.md` | Companion spec for the **component** layer ("micro templates") that renders this look — which recurring concepts get a shared component, and the rules governing them (ADR 0034).                                                                 |

Guidelines:

- **MUI surfaces** (admin, controls, most app chrome) get styling for free via `telemetryTheme`. Reach for `theme.palette` / `sx`, not hardcoded hex.
- **Non-MUI surfaces** (overlays, preview, the playoff bracket SVG/canvas) consume the `--tl-*` CSS variables so they share the exact same palette without importing the MUI theme.
- Keep `tokens.ts` and `tokens.css` in lockstep — they must encode identical values. A parity test (`web/test/app/theme/tokens.parity.test.ts`, mirroring the round-enum guard) asserts every `colors.*`, `fonts.*`, and `overlayArt.*` token has a matching `--tl-*` var with an equal value; a new token is a deliberate addition to its mapping table.
- Never inline a raw colour (hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`) anywhere under `web/src/app/` outside `app/theme/`, where the tokens are defined. If a value isn't in the tokens, it doesn't exist yet — add it here first. The one exemption is **real-world reference colours** that must match a physical object rather than the palette: the Buzz! handset swatches (`util/buzzer.ts`) and the national-flag art under `pages/Stream/flags/`. Tokenising them would let a palette retune drift them off the thing they depict. `web/test/app/noRawColour.test.ts` enforces both halves: any other file with a raw colour in code (comments are not scanned) fails, and an exempted file that no longer holds one fails as a stale exemption.
- Raw px lengths follow the same rule. `noRawColour.test.ts` ("app/ px lengths") fails a quoted px literal (bar the allowlisted `1px` hairlines), numeric `sx` geometry and any `${…}px` template, and its `RAW_PX_DEBT` ledger is empty, so a new one has no budget. A template passes only over a `tokens.ts` scale member (`radii`, `strokes`, `space`, `deskRails`, `controlTargets`, `fieldWidths`, `OVERLAY_NAME_STRIP`, a `boardGeometry` path), a `.toFixed(2)` length measured at runtime, the `?sideMargin` / `?bottomMargin` producer knobs (raw output px by contract), or the three `PANEL_PX` clock-frame strokes `util/countdownSkin.ts` owns (pinned by `countdownSkin.test`). A new length goes into one of those scales first.

```css
/* tokens.css excerpt — light / ISA-branded */
:root {
  --tl-bg-void: #333c4e;
  --tl-bg-canvas: #f5f7f8;
  --tl-bg-base: #ffffff;
  --tl-bg-panel: #ffffff;
  --tl-bg-raised: #ffffff;
  --tl-bg-muted: #edf1f2;
  --tl-line: #e1e6e8;
  --tl-line-strong: #c7d0d3;
  --tl-ink-hi: #333c4e;
  --tl-ink-mid: #5b6776;
  --tl-ink-low: #8a939d;
  --tl-ink-faint: #b7bfc6;
  --tl-ink-on-brand: #ffffff;
  --tl-teal: #13a89e;
  --tl-teal-dark: #0e837b;
  --tl-teal-tint: rgba(19, 168, 158, 0.12);
  --tl-orange: #f04e34;
  --tl-orange-dark: #c73a23;
  --tl-running: #13a89e;
  --tl-go: #65bc7b;
  --tl-go-dim: #2e8f50;
  --tl-set: #f2a93b;
  --tl-set-dim: #b0741a;
  --tl-stop: #f04e34;
  --tl-stop-dim: #c2391f;
  --tl-idle: #8a939d;
  --tl-radius-sm: 4px;
  --tl-radius-md: 8px;
  --tl-radius-lg: 14px;
  --tl-radius-pill: 999px;
}
```

### Responsive contract (operator surfaces)

Every operator surface (the Speedline and Freestyle control boards and `/admin/*`) holds at four viewports. Overlays are outside it: they are authored on the 1920×1080 frame (§7).

| Viewport  | Role                                           | MUI band | Control boards                                                           |
| --------- | ---------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| 1440×900  | Laptop, the primary operator screen            | `lg`     | Both desks, every live control and both Saves above the fold             |
| 1280×720  | Compact: a 720p laptop or a mirrored projector | `lg`     | Freestyle tabs (fails its desk gate on height); Speedline keeps its desk |
| 1920×1080 | Wide, the venue monitor                        | `xl`     | Both desks; the live column caps its width instead of spreading          |
| 1024×768  | Tablet, or a second operator's peer panel      | `md`     | Freestyle tabs; Speedline stacks with setup folded to one row            |

Rules at all four:

- No horizontal page scroll; no clipped or overlapping plates.
- The live controls (lane transport, ADVANCE, the clocks, the TALLY plate) stay above the fold and keep ≥44 px targets, over §6's 40 px floor for general controls; Start/Stop are ≥56 px ([`freestyle-board-ux.md` §6](./freestyle-board-ux.md#6-tokens-type-sizes)).
- Type scales with the container: `cqw` / `clamp()` or the MUI breakpoints.
- Setup and score-entry chrome collapses before the live path does. Reflow never reorders: setup → live → rail at every width.
- Layout switches on `theme.breakpoints` or container queries. Inside a desk nothing pins a track: the 248 | fill | 360 grid is the board brief's ([`freestyle-board-ux.md` §2](./freestyle-board-ux.md#2-the-desk--wireframes)), its `minmax(0, 1fr)` live column absorbs the viewport, and a component in a track sizes by flex, `ch` or `minWidth: 0`, never a pixel width.

**Breakpoints.** `telemetryTheme` sets none, so MUI's defaults apply: `sm` 600, `md` 900, `lg` 1200, `xl` 1536. 1280 and 1440 both sit in `lg`, so a side-by-side layout opening at `lg` (the `/admin/overlays` Speed | Freestyle columns, the control header's one-row health block) is still side by side at 1280×720. Admin's side-by-side layouts stack below `lg`, at the 1024 tablet; 1280 is never a stacking width.

**Desk gates.** Each board switches between its desk and the narrow layout on a viewport media query sized to what that desk was measured to hold, not on a breakpoint. One owner: `deskGate` in `tokens.ts` holds the two numbers and `deskMedia` renders each board's query from them, for both the desk grid's `@media` key and the board's `useMediaQuery`:

- Freestyle (`deskMedia.freestyle`): `(min-width:1280px) and (min-height:900px)`. 1280×720 is wide enough and fails on height, so it takes the tab layout; the reasoning is the brief's §2 desk-gate paragraph.
- Speedline (`deskMedia.speedline`): `(min-width:1280px)` alone. Its start strip sits between the two lane columns, which holds the transport above a 720 px fold; stacking at 1280×720 is what would bury it (`Speedline/ControlPage.tsx`, `DESK_SX`).

Every other viewport switch in `app/` is a `theme.breakpoints` key; `noRawColour.test.ts` fails on a px viewport query anywhere else (an `@container` query keys on its panel and is exempt), and `tokens.parity.test.ts` holds the two quotes above to the token. `web/test/util/deskGeometry.ts` derives the jsdom suites' desk viewport from `deskGate`.

**Fold rule.** A surface is above the fold when `document.documentElement.scrollHeight ≤ innerHeight`, and its headroom is `innerHeight − scrollHeight`, never `innerHeight` minus the last control's bottom. A trailing reserved slot or gap after the last control adds page height without moving that control, so a control-`y` check passes a page that scrolls. Measure the tallest state the surface reaches (both battle scores saved, winner line up). The per-board measurements are the brief's iteration 4 fold budget ([`freestyle-board-ux.md`](./freestyle-board-ux.md)).

---

## 10. Adoption / Migration Path

Roll out by identity priority, not all at once.

1. **Theme provider first.** Wrapping the app in `telemetryTheme` restyles **all MUI surfaces immediately** — admin, forms, tables, buttons inherit the light, ISA-branded TELEMETRY look for free. This is the cheapest, highest-coverage step.
2. **High-identity surfaces get bespoke treatment first.** Hand-craft these against the tokens, in roughly this order:
   - Hero **timer** numeral
   - **Start-light tree**
   - **Preview** page
   - **Broadcast overlays**
   - **Playoff bracket**
   - **Rankings / leaderboard**
     These are what spectators and broadcasters see; they justify per-pixel attention.
3. **Admin CRUD migrates opportunistically.** It already inherits the theme from step 1, so it looks correct. Polish individual admin screens (track-curve cards, tabular numeric columns, DNF badges) as they're touched — no big-bang rewrite required.

> Net effect: the whole app looks like TELEMETRY the moment the theme provider lands; the surfaces that matter most for the broadcast experience get the deepest craft, and the long tail of CRUD catches up over time.
