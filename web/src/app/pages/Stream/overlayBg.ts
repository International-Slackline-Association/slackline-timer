import { colors } from 'app/theme/tokens';

/** `?bg=` aliases → the reserved chroma-key colours (doc/dev/broadcast-overlays.md). */
const ALIASES: Record<string, string> = {
  transparent: 'transparent',
  key: 'var(--tl-chroma-key)', // the magenta `chromaKey` — recommended chroma
  magenta: 'var(--tl-chroma-key)',
  green: colors.chromaKeyGreen,
  blue: colors.chromaKeyBlue,
  // Colour-adaptation mode: transparent ground + `KEY_COMPOSITE_CLASS`, for rigs
  // that flatten the overlay onto a chroma ground UPSTREAM of the keyer (an H2R
  // output chain keyed at its own pink) and shift colours on the way
  // (doc/dev/broadcast-overlays.md "The colour-adaptation mode").
  h2r: 'transparent',
};

/**
 * Each display surface's ground when `?bg=` is absent: the projector keys on the
 * magenta chroma, the venue screen sits on the void, OBS sources composite on
 * alpha. The pages pick theirs by `variant`; `displaySurface` picks the same
 * entry by route for the error boundaries, which render with the page gone.
 */
export const SURFACE_GROUND = {
  projector: colors.chromaKey,
  venue: colors.surface.void,
  broadcast: 'transparent',
  stream: 'transparent',
} as const;

export type DisplaySurface = keyof typeof SURFACE_GROUND;

/** The display surface a route renders, or null for an operator page. */
export const displaySurface = (pathname: string): DisplaySurface | null => {
  if (pathname.startsWith('/stream/')) return 'stream';
  if (pathname.endsWith('/preview')) return 'projector';
  if (pathname === '/freestyle/athletes') return 'venue';
  return null;
};

/** The ground a route paints when `?bg=` is absent (alpha off the display routes). */
export const routeGround = (pathname: string): string =>
  SURFACE_GROUND[displaySurface(pathname) ?? 'stream'];

/** `?bg=` values that flip the colour-adaptation overrides on. */
const KEY_COMPOSITE_MODES = new Set(['h2r']);

/** Body class that switches the adapted tokens (currently `--tl-running`) to
 *  their pre-compensated values (the override block in `app/theme/tokens.css`). */
export const KEY_COMPOSITE_CLASS = 'tl-key-composite';

/** Body class that flattens the translucent white plates to opaque neutrals on
 *  a chroma ground (rationale + values at the override block in
 *  `app/theme/tokens.css`). */
export const CHROMA_GROUND_CLASS = 'tl-chroma-ground';

// A `?bg=` link is shareable, so only plain colours reach `body.style.background`:
// `url(`/`image-set(` would make the overlay fetch a third-party URL and `var(`
// reads arbitrary tokens. A regex, not `CSS.supports` (absent in jsdom).
const PLAIN_COLOUR =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\([\d\s.,%/+-]+\)|[a-z]+)$/i;

/** An overlay's CSS background from `?bg=`: an alias, a plain colour
 *  (`PLAIN_COLOUR`), else `fallback` (transparent for browser-source alpha). */
export const resolveOverlayBackground = (search: string, fallback = 'transparent'): string => {
  const raw = new URLSearchParams(search).get('bg');
  if (raw == null || raw === '') return fallback;
  return ALIASES[raw.toLowerCase()] ?? (PLAIN_COLOUR.test(raw) ? raw : fallback);
};

// The keyer erases exactly these grounds, so anything drawn over them would
// survive onto the broadcast. The raw `chromaKey` value covers a magenta passed
// as a custom colour.
const CHROMA_GROUNDS = new Set(
  [ALIASES.key, colors.chromaKey, ALIASES.green, ALIASES.blue].map((c) => c.toLowerCase()),
);

/** Whether a `resolveOverlayBackground` result is a chroma-keyed ground. */
export const isChromaBackground = (resolved: string): boolean =>
  CHROMA_GROUNDS.has(resolved.toLowerCase());

/** Whether `?bg=` selects the colour-adaptation mode (transparent ground,
 *  pre-compensated colours — the frame is keyed downstream, so treat it like
 *  a chroma ground for on-air suppression too). */
export const isKeyCompositeOverlay = (search: string): boolean =>
  KEY_COMPOSITE_MODES.has((new URLSearchParams(search).get('bg') ?? '').toLowerCase());

/**
 * Apply the `?bg=`-resolved background and its mode class (colour adaptation
 * or chroma ground) to `document.body`; returns the restore cleanup. Uses the
 * `background` shorthand so a `transparent` resolution also clears any stale
 * `backgroundColor`.
 */
export const applyOverlayBodyStyle = (search: string, fallback = 'transparent'): (() => void) => {
  const prev = document.body.style.background;
  const resolved = resolveOverlayBackground(search, fallback);
  document.body.style.background = resolved;
  const modeClass = isKeyCompositeOverlay(search)
    ? KEY_COMPOSITE_CLASS
    : isChromaBackground(resolved)
      ? CHROMA_GROUND_CLASS
      : undefined;
  if (modeClass) document.body.classList.add(modeClass);
  return () => {
    document.body.style.background = prev;
    if (modeClass) document.body.classList.remove(modeClass);
  };
};
