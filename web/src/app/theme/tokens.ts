// TELEMETRY design system — single source of truth for design tokens.
//
// Palette is derived from the International Slackline Association (ISA) brand:
// teal #13A89E (primary), orange-red #F04E34 (accent), slate #333C4E (ink),
// green #65BC7B (secondary), on light off-white surfaces — matching
// slacklineinternational.org. Race-state colors reuse ISA's own green/orange-red.
//
// These typed const objects are consumed by the MUI theme (`app/theme/theme.ts`)
// and are mirrored 1:1 as CSS custom properties in `app/theme/tokens.css` for the
// non-MUI surfaces (stream overlays, preview pages). Keep the two files in sync.

import { refVh } from 'app/util/overlayScale';

export const colors = {
  // Surfaces (light, ISA off-white → white panels; slate as the deep contrast tone)
  surface: {
    void: '#333C4E', // ISA slate — deep contrast blocks, projector/preview ground, footer
    canvas: '#F5F7F8', // page background (ISA uses ~#f8f8f8)
    base: '#FFFFFF',
    panel: '#FFFFFF', // cards / panels (separated from canvas by border + soft shadow)
    raised: '#FFFFFF', // use shadow for lift
    muted: '#EDF1F2', // input fills, subtle wells
    line: '#E1E6E8', // dividers, borders
    lineStrong: '#C7D0D3', // emphasis borders
  },
  // Ink (text/foreground on light surfaces)
  ink: {
    hi: '#333C4E', // ISA slate — headings, hero timer numerals
    mid: '#5B6776', // body / secondary
    low: '#8A939D', // meta / captions (close to ISA body gray #7e8890)
    faint: '#B7BFC6', // disabled / hints
    onBrand: '#FFFFFF', // text on teal/orange/slate fills
  },
  // Brand / accent (ISA)
  brand: {
    teal: '#13A89E', // primary — links, active states, brand mark
    tealDark: '#0E837B', // hover / pressed / text-on-light contrast
    tealTint: 'rgba(19, 168, 158, 0.12)', // selected / hover tint surfaces
    orange: '#F04E34', // warm accent — attention, brand pop
    orangeDark: '#C73A23',
  },
  // Race states (the color contract, mapped identically everywhere).
  // Two contrast tiers of the same hues: *Dim = text-weight variants on light
  // surfaces (winner numeral on a white plate); *Bright = TEXT-ACCENT variants
  // for DARK grounds (the athlete display's slate `void`), where the base hues
  // fall to ~3–4:1 as text — captions, the best-trick turn highlight, the
  // on-deck arrow. Hero NUMERALS on dark do not take state hues at all: they
  // stay white and the state rides a stroked frame that tiers by LUMINANCE
  // and WEIGHT (idle = dim base grey, thin; counting = *Bright stroke, wide
  // sides; expired = *Bright, thin — §2), since distance vision separates
  // brightness and shape, not hue.
  // Brights hold ~7:1 on void (teal/amber) and 5.4:1 for the red family (its
  // ceiling before the hue reads pink). Only the states that actually paint
  // on dark grounds carry a Bright, mirroring the Dim precedent.
  // *Text = the third tier, for state WORDS under 24 px on light grounds
  // (FREESTYLE_BOARD_UX §6): the Dims were tuned for numerals at >=24 px and
  // sit at 3.6-4.1:1, under the 4.5:1 body-text floor. `stopDim` already
  // clears it (5.01 canvas / 5.39 panel), so stop needs no *Text; `goDim` and
  // `setDim` stay numeral-only. Pinned pair by pair in test/app/theme/contrast.test.ts.
  race: {
    // `running` and `stopDim` resolve through their vars (canonical values in
    // tokens.css :root) so the colour-adaptation mode (`?bg=h2r`) can
    // pre-compensate the keyed chain's measured white lift — rationale +
    // numbers at the tl-key-composite override block in tokens.css.
    running: 'var(--tl-running)', // teal — a lane actively timing ("live")
    runningBright: '#45E5D8', // running on dark — 7.1:1 on void
    runningText: '#0B6B65', // running words/digits on light — 5.91 canvas / 6.35 panel
    go: '#65BC7B', // ISA green — GO light / winner fill
    goDim: '#2E8F50', // darker green for winner numerals on light (numeral-only, 3.79)
    goText: '#1F7A40', // go words on light — 4.99 canvas / 5.36 panel
    set: '#F2A93B', // amber — armed / SET light
    setDim: '#B0741A', // break/pause numerals on light (numeral-only, 3.65)
    setText: '#8F5E12', // set words on light — 5.17 canvas / 5.56 panel
    setBright: '#FFC75E', // set/break on dark — 7.2:1 on void
    stop: '#F04E34', // ISA orange-red — false start / DNF / loser
    stopDim: 'var(--tl-stop-dim)', // colour-adapted in ?bg=h2r, see `running` above
    stopBright: '#FF9B82', // stop/expiry on dark — 5.4:1 on void
    idle: '#8A939D', // neutral / not started
  },
  // Streaming overlays (transparent OBS/H2R surfaces composited over live video).
  // Two-tier colour language (verified against the full-colour LAAX refs — the
  // brief's earlier "all text white" rule was a misread of the dark composites):
  //   1. STRUCTURAL marks are white — section labels (`SEMI FINALS`, `FINALS`,
  //      `{GENDER}'S {DISCIPLINE}`…), bracket connectors, empty slot plates.
  //   2. FILLED NAME plates flip to solid white with near-black name text — every
  //      athlete-name bar/band in the refs is white-bg + dark caps, not white text.
  // The empty plate stays a thin white stroke around a translucent fill (white at
  // low alpha, so it reads as a translucent slate over any footage). The LAAX art
  // carries TWO measured plate alphas (the opacity audit): the profile-language
  // files (Profile top 4/Brackets, vs) fill at 30%, the names-language files
  // (Names top 4/8, Name Brackets) at 35% — hence the plate/plateName pair. Caps
  // labels use fonts.display, numbers fonts.numerals. See DESIGN_SYSTEM §3
  // (overlay plates & chroma key) + §7 (broadcast/overlay rules).
  overlay: {
    plate: 'rgba(255, 255, 255, 0.3)', // empty PROFILE-box fill — VS frame / portrait card / profile bracket (art: 30% white)
    plateName: 'rgba(255, 255, 255, 0.35)', // empty NAME-bar fill — name-bracket TBD plate (art: 35% white)
    plateStrip: 'rgba(255, 255, 255, 0.48)', // row backing band behind a stat label — VS speed/freestyle tables (art cls-8/cls-16: 48% white)
    plateFilled: '#FFFFFF', // solid fill for a FILLED named plate (dark name on white)
    stroke: '#FFFFFF', // solid plate border + bracket connectors (width = overlayArt.strokeWidth)
    nameInk: '#231f20', // near-black name text on a filled plate (= the card masters' #231f20, also overlay.backdrop)
    label: '#FFFFFF', // structural / section labels (= ink.onBrand)
    // Slate legibility backing for white overlay text/captions: void (#333C4E)
    // at high alpha — caption-strip gradient + per-text shadow on transparent
    // overlays, so white survives over bright/busy footage (DESIGN_SYSTEM §7).
    scrim: 'rgba(51, 60, 78, 0.9)',
    // Full-bleed darkening layer behind an overlay composition — the LAAX
    // `2026_60_ Black.svg` layer (#231f20 at .6). Distinct from `scrim`, the
    // per-text backing: backdrop dims the whole frame under the graphics.
    backdrop: 'rgba(35, 31, 32, 0.6)',
  },
  // Chroma-key fill for ALL overlay surfaces (projector + `?bg=key` broadcast),
  // MAGENTA not green: the design uses green as live content (race.go winner
  // #65BC7B + the GO start light) and teal/flag-blues, so a green or blue key
  // would erase our own graphics. Magenta is absent from the palette and from
  // national flags, so everything keys cleanly. Single source of truth — retune
  // here to match the venue keyer.
  chromaKey: '#FF00FF',
} as const;

export const fonts = {
  // Every family below is bundled self-hosted via @fontsource (imported in
  // `app/index.tsx`) — never load one from a font CDN, see there for why.
  // Loaded weights: JetBrains Mono 300–700, Oswald 300–700, Saira 400–700,
  // Saira Condensed 300/500/600/700/800. Oswald ships no 800, so a `fontWeight:
  // 800` on the display face silently resolves back to 700.
  numerals: "'JetBrains Mono', ui-monospace, monospace",
  // Oswald stands in for the LAAX art's commercial Placard Next (500 ≈
  // PlacardNext-Medium, 700 covers the Black weight).
  display: "'Oswald', 'Saira Condensed', system-ui, sans-serif",
  body: "'Saira', system-ui, sans-serif",
} as const;

// Overlay art metrics — non-color constants measured on the LAAX 2026 master
// art's 1920×1080 frame (the surviving measurement record is DESIGN_SYSTEM §7;
// the art itself is the client's and is not in this repo). Components derive
// sizing from a 1080p baseline (vw/vh + clamp), so these are the reference
// values, not hard pins.
export const overlayArt = {
  strokeWidth: '6px', // VS-box / plate border + bracket connectors (9px clotted the dense bracket boxes; the heavier VS/winner card frame is Competitor's own PANEL_EDGE)
  headingTracking: '-0.02em', // tight display-caps letter-spacing (the art runs −.01…−.03em)
} as const;

// The broadcast "protection halo" (DESIGN_SYSTEM §7): a tight slate outline plus
// a soft drop so overlay text survives BOTH the bright magenta chroma-key ground
// and busy broadcast footage. The four offset shadows raise contrast for the dark
// slate idle/loser hues against the key ground — a single soft drop alone left
// dark-on-key low-contrast. Single source for the stack copied across the timer
// displays (ADR 0034 §4). Slate = ink.hi #333C4E = rgb(51,60,78).
export const overlayTextShadow = [
  '0 0 3px rgba(51,60,78,0.95)',
  '0 0 6px rgba(51,60,78,0.85)',
  '1px 1px 0 rgba(51,60,78,0.9)',
  '-1px -1px 0 rgba(51,60,78,0.9)',
  '1px -1px 0 rgba(51,60,78,0.9)',
  '-1px 1px 0 rgba(51,60,78,0.9)',
].join(', ');

// The SVG-`filter` analogue of overlayTextShadow, for vector marks that can't take
// a text-shadow — the white UnknownAthlete "?" placeholder on the empty overlay
// plate. Chained slate drop-shadows give the same protection halo so the white
// mark survives BOTH the magenta chroma-key ground and bright/busy footage (where
// white-on-translucent-white would otherwise wash out). Slate = ink.hi #333C4E.
export const overlayMarkHalo = [
  'drop-shadow(0 0 3px rgba(51,60,78,0.95))',
  'drop-shadow(0 0 6px rgba(51,60,78,0.6))',
  'drop-shadow(1px 1px 0 rgba(51,60,78,0.9))',
].join(' ');

// The legibility floor for the shrink-to-box overlay card type, in reference px
// on the 1080p capture. Bracket cards size their name/result in `cqh` of their
// own box, so the smallest boxes (the ~171px-tall quarter/semi profile boxes)
// shrink the narrow name and the smallest profile-ranking result numeral to
// ~13px. `max(<cqh>, the floor)` lifts those sub-floor boxes; larger boxes keep
// their proportional cqh size unchanged.
//
// 20px is the low end of the usual 20-24px broadcast text minimum. The former
// 16px sat under it and the quarter/semi names sat exactly ON it, so the densest
// tier of the board was also its least legible tier on air.
export const OVERLAY_TYPE_FLOOR_PX = 20;

// Frame-relative (refVh, ADR 0034 §4), not raw px, so the floor tracks the
// capture frame: a hard px value outran the cards' own shrink-to-fit on every
// smaller canvas, and sibling cards read as a size lottery the broadcast never
// shows. A canvas that does NOT track the viewport (the /admin/matches bracket
// preview, capped by its Container) overrides `--tl-overlay-type-floor` off its
// own measured width instead — see `PlayoffBracket`.
export const overlayTypeFloor = refVh(OVERLAY_TYPE_FLOOR_PX);

export const radii = {
  sm: 4,
  md: 8,
  lg: 14,
  pill: 999,
  // Signature "track-curve" card radius.
  trackCurve: '14px 4px 14px 4px',
} as const;

// Base spacing unit (px). Matches MUI's default spacing(1) = 8.
export const space = {
  unit: 8,
} as const;

// Type scale (rem). `label` is uppercase with widened tracking.
export const typeScale = {
  display1: 3,
  display2: 2.25,
  h1: 1.875,
  h2: 1.5,
  h3: 1.25,
  body: 1,
  small: 0.875,
  label: 0.75,
  labelLetterSpacing: '0.08em',
} as const;

// The daylight floor for text on the LIVE PATH — anything the operator reads
// mid-match, from a step back, in venue sunlight (FREESTYLE_BOARD_UX §8 C12,
// whose anti-pattern list ends "text <14 px on the live path"). MUI's `caption`
// is 12 px, so a live-path caption keeps the variant (family, weight, its
// `span` mapping) and lifts only the size through this one owner rather than
// each call site picking a number. Off the live path — form helper text, the
// admin pages — 12 px stays as it is.
//
// Absolute px, not `typeScale.small`'s rem: this is the reserved why-line's
// proven size (`app/components/WhyLine.tsx`, which takes it from here), and a
// floor that a root-font-size setting can lower is not a floor.
export const liveCaption = { fontSize: 14 } as const;

// The CHOSEN KEY of a segmented setting — the mode toggle, the best-trick cap
// pair (FREESTYLE_BOARD_UX §6). MUI marks a selected key in brand teal (2.72:1
// on its own tinted well) and fills a contained one with the brand, both of
// which §6 confines to links and nav; a fill + ink step inside the grey family
// clears 4.5:1 instead, and reads the same live and locked — a lock may not
// take which option is chosen. One owner: a theme override and an `sx` share it.
export const chosenKey = {
  color: colors.ink.hi,
  backgroundColor: colors.surface.lineStrong,
} as const;

export type Colors = typeof colors;
export type Fonts = typeof fonts;
export type OverlayArt = typeof overlayArt;
export type Radii = typeof radii;
export type Space = typeof space;
export type TypeScale = typeof typeScale;
