// Tier 2 of the wide flag art (see ./index.ts): nations the designer never
// delivered, RECONSTRUCTED here — authored by an LLM against the same contract
// rather than drawn by the event's designer. Lower fidelity than ./delivered.ts
// by construction, and the place any new nation goes.
//
// The reconstruction is of the LAYOUT only — the stripes, which the band
// stretches.
// Where a nation's flag carries a CREST, the crest itself is the real thing at
// full resolution, lifted out of the vendored flag-icons artwork (`./emblems.ts`)
// and placed undistorted: Spain's coat of arms, Argentina's Sun of May. Those
// entries run well past the 32 KB the simple flags hold to, which is why the
// `WideFlag` size guard exempts them.
// `./index.ts` resolves ./delivered.ts first, then this table, so a nation the
// designer ever delivers automatically outranks its reconstruction here — drop
// the entry when that happens (a test asserts the two never overlap).
//
// Same contract as the delivered art: one SVG string per ISO alpha-2, sized
// `width:100%;height:100%` with `preserveAspectRatio="none"` so it fills the
// AthleteCard foot band edge-to-edge.
//
// EVERY entry uses the band's own rectangle, `0 0 150 16.3`, and follows the one
// rule the delivered masters follow without ever stating it:
//
//     the FIELD takes the stretch, the DEVICE never does.
//
// Fields and stripes span the full 150 and splay with the band. Anything with a
// fixed shape — a cross, a canton, a crest, a saltire — is drawn at its true
// proportion and scaled DOWN to the band's height, so it occupies only a small
// share of the width. That is the masters exactly: the Swiss cross is square
// (9.32 x 9.21), Chile's canton stays near-square at the hoist rather than
// scaling to its real width, the USA's canton drops from 40% of the flag to 8.4%
// of the band, and Brazil's globe is an ellipse NARROWER than it is tall
// (rx 3.82 / ry 3.87) so the stretch lands it round.
//
// Do NOT reach for a flag's own rectangle as the viewBox. It is harmless only for
// designs that are pure horizontal bands, and those work in the band rectangle
// anyway; for anything carrying an angle or a circle it is the bug. The Union
// Jack spent a release in a `0 0 60 30` viewBox, stretched 4.6x, its saltire
// flattened into near-horizontal streaks.
// Colours are flag DATA (sampled national palettes), not TELEMETRY tokens — the
// same reason the delivered art carries its own hex.
//
// `clipPath` ids are file-unique but not instance-unique: two cards showing the
// same nation inline the same id twice, and both references resolve to the first
// (identical) definition, so the render is unaffected.

import { VENDOR_EMBLEMS } from 'app/pages/Stream/flags/wide/emblems';

const svg = (viewBox: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="none" style="width:100%;height:100%;display:block">${body}</svg>`;

/** The band rectangle: full-bleed stripes plus square-on-air emblems. */
const BAND = '0 0 150 16.3';
const BAND_W = 150;
const BAND_H = 16.3;

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Share of the band height every crest is drawn at. One constant rather than each
 * emblem's own share of its source flag: flag-icons draws Argentina's sun at only
 * 28% of the flag, which on a ~29px-tall band is an unreadable speck, while the
 * delivered masters put their emblems at 50–56%. 42% sits in that family, matches
 * the Argentine flag's own spec for the sun, and still leaves Spain's arms inside
 * the gold stripe the way the real flag does.
 */
const CREST_BAND_SHARE = 0.42;

/**
 * Place a nation's real crest (`./emblems.ts` — the full-resolution vector
 * lifted out of the vendored flag-icons flag) centred on the band.
 *
 * A nested `<svg>` is what keeps it undistorted: its x/y/width/height land in the
 * band's stretched user space, but its own viewBox maps the emblem into THAT
 * rectangle — so sizing the rectangle at the emblem's own aspect cancels the
 * outer `preserveAspectRatio="none"`.
 */
const emblem = (iso: string) => {
  const { viewBox, aspect, art } = VENDOR_EMBLEMS[iso];
  const h = BAND_H * CREST_BAND_SHARE;
  const w = h * aspect;
  return (
    `<svg x="${round2((BAND_W - w) / 2)}" y="${round2((BAND_H - h) / 2)}"` +
    ` width="${round2(w)}" height="${round2(h)}" viewBox="${viewBox}"` +
    ` preserveAspectRatio="xMidYMid meet">${art}</svg>`
  );
};

// Poland — white over red, split on the band's midline.
const pl = svg(
  BAND,
  '<rect fill="#ffffff" x="0" y="0" width="150" height="8.15"/>' +
    '<rect fill="#dc143c" x="0" y="8.15" width="150" height="8.15"/>',
);

// Luxembourg — red / white / light blue (the lighter blue is what separates it
// from the Netherlands).
const lu = svg(
  BAND,
  '<rect fill="#ed2939" x="0" y="0" width="150" height="5.44"/>' +
    '<rect fill="#ffffff" x="0" y="5.44" width="150" height="5.43"/>' +
    '<rect fill="#00a1de" x="0" y="10.87" width="150" height="5.43"/>',
);

// Czechia — white over red with the blue hoist wedge kept at its true 2:1
// proportion (apex at 0.75x the band height) rather than stretched to mid-band,
// the way the masters keep Chile's canton square.
const cz = svg(
  BAND,
  '<rect fill="#ffffff" x="0" y="0" width="150" height="8.15"/>' +
    '<rect fill="#d7141a" x="0" y="8.15" width="150" height="8.15"/>' +
    '<polygon fill="#11457e" points="0 0 12.22 8.15 0 16.3"/>',
);

// Colombia — yellow over half the hoist, then blue and red quarters.
const co = svg(
  BAND,
  '<rect fill="#fcd116" x="0" y="0" width="150" height="8.15"/>' +
    '<rect fill="#003893" x="0" y="8.15" width="150" height="4.08"/>' +
    '<rect fill="#ce1126" x="0" y="12.23" width="150" height="4.07"/>',
);

// Argentina — light blue / white / light blue with the real Sun of May centred.
const ar = svg(
  BAND,
  '<rect fill="#74acdf" x="0" y="0" width="150" height="5.44"/>' +
    '<rect fill="#ffffff" x="0" y="5.44" width="150" height="5.43"/>' +
    '<rect fill="#74acdf" x="0" y="10.87" width="150" height="5.43"/>' +
    emblem('ar'),
);

/**
 * The Union Jack in its own 2:1 construction grid. Stroke widths are the flag's
 * real ones, and the two cross widths are re-used below to size the arm the band
 * paints full-width — derive them, never re-type them, or the arm and the nested
 * flag's own arm drift apart and the join shows as a step.
 */
const UJ_GRID_W = 60;
const UJ_GRID_H = 30;
const UJ_CROSS_WHITE = 10;
const UJ_CROSS_RED = 6;
// No blue field inside the nested flag: the band already paints that exact blue
// underneath, and a second rect over it contributes nothing but two antialiased
// hairlines down the medallion's edges.
const UJ_ART =
  '<clipPath id="tlGbCounterchange"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>' +
  '<path stroke="#ffffff" stroke-width="6" d="M0,0 60,30M60,0 0,30"/>' +
  '<path stroke="#c8102e" stroke-width="4" clip-path="url(#tlGbCounterchange)" d="M0,0 60,30M60,0 0,30"/>' +
  `<path stroke="#ffffff" stroke-width="${UJ_CROSS_WHITE}" d="M30,0 v30M0,15 h60"/>` +
  `<path stroke="#c8102e" stroke-width="${UJ_CROSS_RED}" d="M30,0 v30M0,15 h60"/>`;

// United Kingdom — the Union Jack, NOT the England cross.
//
// The only nation here whose whole design is device, so the split takes some
// care. The blue field and the HORIZONTAL arm of St George's cross stretch the
// full 150 — the horizontal arm does span the real flag's full width, so nothing
// is invented — while the saltire and the vertical bar ride in a nested <svg> at
// the flag's own 2:1 and stay true, the same trick `emblem()` uses for Spain's
// arms.
//
// Sized at the band's height, that nested flag is 32.6 wide. That is not a
// chosen crop: the saltire leaves the centre at the true 2:1 diagonal, so its
// arms reach the band's top and bottom exactly BAND_H either side of centre.
// 32.6 is the widest undistorted Union Jack this rectangle holds — there is no
// larger one to draw.
const ujScale = BAND_H / UJ_GRID_H;
const ujW = round2(UJ_GRID_W * ujScale);
const armWhiteH = round2(UJ_CROSS_WHITE * ujScale);
const armRedH = round2(UJ_CROSS_RED * ujScale);
const gb = svg(
  BAND,
  `<rect fill="#012169" x="0" y="0" width="${BAND_W}" height="${BAND_H}"/>` +
    `<rect fill="#ffffff" x="0" y="${round2((BAND_H - armWhiteH) / 2)}" width="${BAND_W}" height="${armWhiteH}"/>` +
    `<rect fill="#c8102e" x="0" y="${round2((BAND_H - armRedH) / 2)}" width="${BAND_W}" height="${armRedH}"/>` +
    `<svg x="${round2((BAND_W - ujW) / 2)}" y="0" width="${ujW}" height="${BAND_H}"` +
    ` viewBox="0 0 ${UJ_GRID_W} ${UJ_GRID_H}" preserveAspectRatio="xMidYMid meet">${UJ_ART}</svg>`,
);

// Spain — red / gold / red with the real coat of arms, CENTRED on the band the
// way the masters centre theirs (Mexico's arms, the Swiss cross, Canada's leaf);
// only a canton belongs at the hoist (Chile, China, the USA), and the arms is not
// one. Stripe hexes are the vendored flag's own, so the arms sits on exactly the
// gold it was drawn against.
const es = svg(
  BAND,
  '<rect fill="#aa151b" x="0" y="0" width="150" height="4.08"/>' +
    '<rect fill="#f1bf00" x="0" y="4.08" width="150" height="8.15"/>' +
    '<rect fill="#aa151b" x="0" y="12.23" width="150" height="4.07"/>' +
    emblem('es'),
);

export const REBUILT_WIDE_FLAGS: Record<string, string> = { ar, co, cz, es, gb, lu, pl };
