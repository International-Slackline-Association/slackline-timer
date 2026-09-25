/** Resolve an overlay's CSS background from the `?bg=` query param. Default
 *  transparent (alpha) for browser-source compositing; aliases map to the
 *  reserved chroma-key colours; anything else passes through as a raw CSS colour.
 *  See doc/dev/broadcast-overlays.md. */
const ALIASES: Record<string, string> = {
  transparent: 'transparent',
  key: 'var(--tl-chroma-key)', // magenta #FF00FF — recommended chroma
  magenta: 'var(--tl-chroma-key)',
  green: '#00B140',
  blue: '#0047BB',
  // Colour-adaptation mode: transparent ground + the measured per-rig colour
  // compensation (`KEY_COMPOSITE_CLASS` below). For rigs where the transparent
  // overlay is flattened onto a chroma ground UPSTREAM of the keyer — an H2R
  // Graphics output chain keyed at pink #EC008C — and the chain measurably
  // shifts colours on the way; the override block in tokens.css
  // pre-compensates them (currently the active-timer teal only).
  h2r: 'transparent',
};

/** `?bg=` values that flip the colour-adaptation overrides on. */
const KEY_COMPOSITE_MODES = new Set(['h2r']);

/** Body class that switches the adapted tokens (currently `--tl-running`) to
 *  their pre-compensated values (the override block in `app/theme/tokens.css`). */
export const KEY_COMPOSITE_CLASS = 'tl-key-composite';

export const resolveOverlayBackground = (search: string, fallback = 'transparent'): string => {
  const raw = new URLSearchParams(search).get('bg');
  if (raw == null || raw === '') return fallback;
  return ALIASES[raw.toLowerCase()] ?? raw; // URLSearchParams already decoded it
};

/** Whether `?bg=` selects the colour-adaptation mode (transparent ground,
 *  pre-compensated colours — the frame is keyed downstream, so treat it like
 *  a chroma ground for on-air suppression too). */
export const isKeyCompositeOverlay = (search: string): boolean =>
  KEY_COMPOSITE_MODES.has((new URLSearchParams(search).get('bg') ?? '').toLowerCase());

/**
 * Apply the `?bg=`-resolved background (and, for the colour-adaptation mode,
 * its body class) to `document.body`; returns the restore cleanup.
 * The one holder of the capture/restore dance shared by StreamLayout and the
 * timer/athlete display pages — use the `background` shorthand consistently so
 * a `transparent` resolution also clears any stale `backgroundColor`.
 */
export const applyOverlayBodyStyle = (search: string, fallback = 'transparent'): (() => void) => {
  const prev = document.body.style.background;
  document.body.style.background = resolveOverlayBackground(search, fallback);
  const keyComposite = isKeyCompositeOverlay(search);
  if (keyComposite) document.body.classList.add(KEY_COMPOSITE_CLASS);
  return () => {
    document.body.style.background = prev;
    if (keyComposite) document.body.classList.remove(KEY_COMPOSITE_CLASS);
  };
};

// The keyer erases exactly these grounds, so anything drawn over them would
// survive onto the broadcast. `#ff00ff` covers a raw magenta passed as a
// custom colour (it IS the chroma key value).
const CHROMA_GROUNDS = new Set(
  ['var(--tl-chroma-key)', '#ff00ff', ALIASES.green, ALIASES.blue].map((c) => c.toLowerCase()),
);

/** Whether a `resolveOverlayBackground` result is a chroma-keyed ground. */
export const isChromaBackground = (resolved: string): boolean =>
  CHROMA_GROUNDS.has(resolved.toLowerCase());
