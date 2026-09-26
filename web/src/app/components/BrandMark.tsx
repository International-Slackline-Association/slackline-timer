import { colors } from 'app/theme/tokens';

/**
 * The Slackline Timer brand mark: a rock lip and a building roof with a loaded
 * slackline strung between them and the race clock hanging underneath.
 *
 * Three things about the drawing are load-bearing and easy to undo by accident:
 *
 * 1. **The span is a V, not an arc.** A near-taut line carrying a load bends *at*
 *    the load. Smoothing it into a curve turns the mark into a hammock.
 * 2. **The span is an outlined polygon, not a stroke.** A stroke's butt cap is always
 *    perpendicular to the line, so it can only sit flush against a mass edge that
 *    happens to be perpendicular too — every stroked version left a sliver of white
 *    at the rock or a flap of teal over the block. Outlining it makes both ends
 *    explicit edges, and each is pinned to a corner:
 *      · left  — the upper edge passes through the rock's lip corner (27,18) and the
 *                end edge lies along the undercut, 7.0 units down its 12.0 length.
 *      · right — the upper edge passes through the block's roof corner (76,33) and
 *                the end edge lies on the block's left edge, x=76.
 *    Both are exact by construction. Burying an end past its corner does not work on
 *    either side: at the rock the tail escapes above the lip (the wedge there is only
 *    ~42° wide, so a 7-unit band would need to start 10+ units back), and at the
 *    block the span rises, so anything past the corner clears the roof.
 *    The polygon is still drawn FIRST; the V's bottom miter (49.08,48.97) then falls
 *    under the crown and never shows.
 *    Regenerate by outlining a 7-wide centreline through (50,45) whose two segments
 *    are angled so each upper edge meets its pinned corner.
 * 3. **The rock face reverses twice.** A convex bulge at y=50 (above the dial's
 *    reach) and a concave scoop at y=74 (where the dial comes nearest) hold a
 *    roughly even 6–8 unit gap down the dial's left side. A single straight face
 *    converges on the dial and reads as clipped rather than drawn.
 *
 * Geometry is exported because `public/favicon.svg` carries the same paths;
 * `BrandMark.test.tsx` fails if the two drift apart.
 */

/** Square viewBox the paths below are drawn in. The mark bleeds to all four edges. */
export const MARK_VIEW_BOX = '0 0 100 100';

/** Path data, shared with the static favicon. Keep in sync via the parity test. */
export const MARK_PATHS = {
  /** Loaded slackline, outlined: lip corner → V → roof corner → back along the underside. */
  span: 'M27 18 L50.92 41.03 L76 33 L76 40.35 L49.08 48.97 L21.75 22.66 Z',
  /** Rock: lip, undercut, convex bulge, concave scoop, out to the bottom edge. */
  rock: 'M0 18 L27 18 L18 26 L28 50 L19 74 L34 100 L0 100 Z',
  /** Block plus two windows knocked out — one enclosed, one running off the frame. */
  block: 'M76 33 H100 V100 H76 Z M92 41 h10 v10 h-10 Z M82 59 h9 v9 h-9 Z',
  /** Seconds hand, long and thin so it reads as a hand rather than a slash. */
  hand: 'M50 73 L61.2 62.9',
} as const;

/**
 * Colour pairs per surface. The mass carries the silhouette, the accent carries
 * the webbing and the seconds hand — the hand takes the accent both because it
 * rhymes with the line and because it stays separate from the ring at small sizes.
 */
const VARIANTS = {
  /** Light surfaces: slate mass, ISA teal accent. */
  brand: { mass: colors.ink.hi, accent: colors.brand.teal },
  /** The slate `void` ground — the accent steps up to the Bright tier for contrast. */
  inverted: { mass: colors.ink.onBrand, accent: colors.race.runningBright },
  /** Broadcast overlays and the chroma-keyed projector output: flat white only. */
  mono: { mass: colors.ink.onBrand, accent: colors.ink.onBrand },
} as const;

export type BrandMarkVariant = keyof typeof VARIANTS;

interface BrandMarkProps {
  /** Rendered edge length; the mark is square. */
  size?: number | string;
  variant?: BrandMarkVariant;
  /**
   * Accessible name. Omit on decorative uses (a lockup that already carries the
   * wordmark as text) and the mark is hidden from assistive tech instead.
   */
  title?: string;
}

export const BrandMark = ({ size = 32, variant = 'brand', title }: BrandMarkProps) => {
  const { mass, accent } = VARIANTS[variant];

  return (
    <svg
      viewBox={MARK_VIEW_BOX}
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      {/* Span first, so the masses cover its V-miter and both pinned corners. */}
      <path d={MARK_PATHS.span} fill={accent} />
      <path d={MARK_PATHS.rock} fill={mass} />
      <path d={MARK_PATHS.block} fill={mass} fillRule="evenodd" />
      <rect x={46} y={45} width={8} height={10} rx={2} fill={mass} />
      <circle cx={50} cy={73} r={18} fill="none" stroke={mass} strokeWidth={7} />
      <path d={MARK_PATHS.hand} fill="none" stroke={accent} strokeWidth={5} strokeLinecap="round" />
      <circle cx={50} cy={73} r={3.2} fill={accent} />
    </svg>
  );
};
