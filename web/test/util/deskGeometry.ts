/**
 * The desk arithmetic a lane card's geometry is held against (FREESTYLE_BOARD_UX
 * §2/§6), plus the two things a jsdom suite needs before it can render the desk
 * at all. jsdom does no layout, so anything that depends on the column a card
 * renders in is asserted against this model rather than a measurement — kept in
 * one place so the why-line's wrap budget and the transport row's width reserve
 * cannot drift apart.
 *
 * The model is no longer arithmetic on trust: `ControlPage.test`'s desk branch
 * solves the *rendered* track lists against it (`solveTracks`), so a change to
 * `DESK_SX` or the run deck reds this file rather than quietly outdating it.
 */

/** `ControlPage`'s desk breakpoint — the width `useMediaQuery` is asked about. */
export const DESK_MIN_PX = 1280;

/** …and the height, the second half of the gate (fsux-desk-fold-budget, raised
 * by `freestyle-board-fold-budget`): a 1280x800 screen is wide enough for the
 * three columns and ~80 px too short to hold them — the battle desk's last
 * control measures 879 — so anything shorter takes the tab layout. */
export const DESK_MIN_HEIGHT_PX = 900;

/** A viewport on the desk side of the gate — the 1440x900 laptop of the
 * responsive contract, expressed in the two numbers the media query reads. */
export const DESK_HEIGHT_PX = 900;

/** The whole desk query, as `ControlPage` authors it. */
export const DESK_MEDIA = `(min-width:${DESK_MIN_PX}px) and (min-height:${DESK_MIN_HEIGHT_PX}px)`;

/** A width on the tabbed side of it. jsdom's own default (1024) is already
 * below the breakpoint, but a suite that means the compact branch says so. */
export const COMPACT_PX = 1024;

/** …and its height: the 1024x768 tablet of the responsive contract. */
export const COMPACT_HEIGHT_PX = 768;

/** Wide enough for the desk, too short to hold it — the viewport the height
 * half of the gate exists for. */
export const SHORT_DESK_HEIGHT_PX = 720;

/** The 16:10 laptop that sits between the two: past the width gate, past the
 * OLD height gate, and still ~80 px short of the desk it used to take. */
export const TALLISH_DESK_HEIGHT_PX = 800;

/** The page Stack's side padding at `sm` and up (`padding: { xs: 1, sm: 2 }`). */
export const PAGE_PADDING_PX = 16;

/** `DESK_SX`'s `gap: 2`, between each pair of desk columns. */
export const DESK_GAP_PX = 16;

/** The battle deck's `gap: 0.75`, between each pair of deck tracks. */
export const DECK_GAP_PX = 6;

/** `DESK_SX`'s two fixed rails: setup left, score right. */
export const SETUP_RAIL_PX = 248;
export const SCORE_RAIL_PX = 360;

/** A line inside the score rail: the rail less the panel's `p: 2` inset, both
 * sides, and its hairline. The rail's two athlete panels declare
 * `flex: 1 1 220px`, so at this width they stack and each one gets the lot. */
export const SCORE_RAIL_CONTENT_PX = SCORE_RAIL_PX - 2 * 16 - 2;

/** The live column of the narrowest three-column desk (1280 px): the viewport
 * less the page padding, the two fixed rails and the two desk gaps. */
export const LIVE_COLUMN_PX =
  DESK_MIN_PX - 2 * PAGE_PADDING_PX - 2 * DESK_GAP_PX - SETUP_RAIL_PX - SCORE_RAIL_PX;

/** A lane column there: the battle deck's `5fr | 2fr | 5fr` grid, less its two
 * gaps, at 5/12 each — floored, since a fraction of a pixel renders no glyph.
 * `ControlPage.test` holds the rendered deck to it, so the model fails with the
 * layout rather than after it. */
export const LANE_COLUMN_PX = Math.floor(((LIVE_COLUMN_PX - 2 * DECK_GAP_PX) * 5) / 12);

/** What the card's *content* is measured against: the column less the panel's
 * own hairline, both sides. The card is a `panel` Paper (§6), and at this width
 * its inset is what the column can spare above the race pair — nothing — so the
 * hairline is the whole difference. */
export const LANE_CARD_CONTENT_PX = LANE_COLUMN_PX - 2;

/**
 * Pin which layout branch a suite renders. jsdom ships **no** `window.matchMedia`
 * here, so MUI's `useMediaQuery` falls back to its `false` default and every
 * page test would take `CompactBoardLayout` whatever the viewport said. The stub
 * answers `min-`/`max-` bounds on BOTH axes off the pinned viewport — the desk
 * gate reads width and height — and is inert (no listeners fire), because a
 * suite pins its viewport once per render rather than resizing mid-test.
 *
 * The height defaults to the contract's 1440x900 laptop, so a suite that only
 * means "the desk width" gets the desk.
 */
export const pinLayoutWidth = (width: number, height: number = DESK_HEIGHT_PX): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => {
      const bound = (axis: 'width' | 'height', edge: 'min' | 'max'): number | null => {
        const found = new RegExp(String.raw`${edge}-${axis}:\s*(\d+)px`).exec(query);
        return found ? Number(found[1]) : null;
      };
      const within = (value: number, axis: 'width' | 'height'): boolean => {
        const min = bound(axis, 'min');
        const max = bound(axis, 'max');
        return (min === null || value >= min) && (max === null || value <= max);
      };
      const matches = within(width, 'width') && within(height, 'height');
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    },
  });
};

/**
 * What an element is declared to be inside a given `@media` block (the desk
 * gate by default). jsdom parses emotion's media blocks into the CSSOM but
 * never *applies* them — `getComputedStyle` reports the base rule at any
 * viewport — so a breakpoint's declarations are read off the rule the element
 * actually carries.
 */
export const deskMediaValue = (element: Element, property: string, media = DESK_MEDIA): string => {
  const wanted = media.replace(/\s+/g, '');
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      const block = rule as CSSMediaRule;
      if (block.media?.mediaText?.replace(/\s+/g, '') !== wanted) continue;
      for (const inner of Array.from(block.cssRules)) {
        const styleRule = inner as CSSStyleRule;
        if (styleRule.selectorText && element.matches(styleRule.selectorText)) {
          const value = styleRule.style.getPropertyValue(property);
          if (value) return value;
        }
      }
    }
  }
  throw new Error(`deskMediaValue(): no ${media} rule declares ${property} for this element.`);
};

type Track = { px: number } | { minPx: number; fr: number };

/** One `grid-template-columns` token: `248px`, `5fr`, `minmax(88px, 2fr)`. */
const parseTrack = (token: string): Track => {
  const minmax = /^minmax\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/.exec(token);
  const [minPart, sizePart] = minmax ? [minmax[1], minmax[2]] : ['0px', token];
  const fr = /^([\d.]+)fr$/.exec(sizePart);
  if (!fr) return { px: Number.parseFloat(sizePart) };
  return { minPx: Number.parseFloat(minPart) || 0, fr: Number.parseFloat(fr[1]) };
};

/** Split a track list on top-level whitespace, keeping `minmax(…)` whole. */
const splitTracks = (columns: string): string[] => {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of columns.trim()) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
};

/**
 * Resolve an authored `grid-template-columns` against the box it renders in —
 * the layout jsdom will not do. Fixed tracks take their width, the rest split
 * what is left by their `fr` weight, and a `minmax` floor that would be
 * undercut is pinned first and the remainder re-split (CSS's own order).
 */
export const solveTracks = (columns: string, gapPx: number, containerPx: number): number[] => {
  const tracks = splitTracks(columns).map(parseTrack);
  const widths = tracks.map((track) => ('px' in track ? track.px : null));
  let free = containerPx - gapPx * (tracks.length - 1);
  tracks.forEach((track, index) => {
    if ('px' in track) free -= widths[index] as number;
  });

  for (;;) {
    const open = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track, index }) => !('px' in track) && widths[index] === null);
    if (open.length === 0) return widths as number[];
    const totalFr = open.reduce((sum, { track }) => sum + (track as { fr: number }).fr, 0);
    const undercut = open.find(({ track }) => {
      const { minPx, fr } = track as { minPx: number; fr: number };
      return (free * fr) / totalFr < minPx;
    });
    if (!undercut) {
      open.forEach(({ track, index }) => {
        widths[index] = (free * (track as { fr: number }).fr) / totalFr;
      });
      return widths as number[];
    }
    const pinned = (undercut.track as { minPx: number }).minPx;
    widths[undercut.index] = pinned;
    free -= pinned;
  }
};
