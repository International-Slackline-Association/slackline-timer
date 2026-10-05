import { colors } from 'app/theme/tokens';

/** Resolve an overlay's CSS background from the `?bg=` query param. Default
 *  transparent (alpha) for browser-source compositing; aliases map to the
 *  reserved chroma-key colours; anything else passes through as a raw CSS colour.
 *  See doc/dev/broadcast-overlays.md. */
const ALIASES: Record<string, string> = {
  transparent: 'transparent',
  key: 'var(--tl-chroma-key)', // the magenta `chromaKey` — recommended chroma
  magenta: 'var(--tl-chroma-key)',
  green: colors.chromaKeyGreen,
  blue: colors.chromaKeyBlue,
  // Colour-adaptation mode: transparent ground + the measured per-rig colour
  // compensation (`KEY_COMPOSITE_CLASS` below). For rigs where the transparent
  // overlay is flattened onto a chroma ground UPSTREAM of the keyer — an H2R
  // Graphics output chain keyed at its own pink — and the chain measurably
  // shifts colours on the way; the override block in tokens.css
  // pre-compensates them (currently the active-timer teal only).
  h2r: 'transparent',
};

/** `?bg=` values that flip the colour-adaptation overrides on. */
const KEY_COMPOSITE_MODES = new Set(['h2r']);

/** Body class that switches the adapted tokens (currently `--tl-running`) to
 *  their pre-compensated values (the override block in `app/theme/tokens.css`). */
export const KEY_COMPOSITE_CLASS = 'tl-key-composite';

/** Body class that flattens the translucent white plates to opaque neutrals on
 *  a chroma ground (rationale + values at the override block in
 *  `app/theme/tokens.css`). */
export const CHROMA_GROUND_CLASS = 'tl-chroma-ground';

export const resolveOverlayBackground = (search: string, fallback = 'transparent'): string => {
  const raw = new URLSearchParams(search).get('bg');
  if (raw == null || raw === '') return fallback;
  return ALIASES[raw.toLowerCase()] ?? raw; // URLSearchParams already decoded it
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
 * or chroma ground) to `document.body`; returns the restore cleanup.
 * The one holder of the capture/restore dance shared by StreamLayout and the
 * timer/athlete display pages — use the `background` shorthand consistently so
 * a `transparent` resolution also clears any stale `backgroundColor`.
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
