/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `app/` paints and measures only through tokens — `theme.palette` / `sx` keys,
 * `theme.spacing`, the `tokens.ts` scales or the `--tl-*` vars (design-system
 * §5, §9). A literal is a value the token tests never see, so it drifts silently
 * when the scale moves. `app/theme/` is where the tokens themselves are defined,
 * so it is out of scope.
 */
const APP_DIR = resolve(process.cwd(), 'src/app');
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i;
/** A quoted string that is a bare px length (`'12px'`). */
const RAW_PX = /['"]\d+px['"]/g;
const HAIRLINE = /^['"]1px['"]$/;
/** A quoted compound value that opens on a px length (`'1px solid'`, a grid track
 *  list). A media query is a breakpoint, not geometry, and opens on `(`. */
const COMPOUND_PX = /['"]\d+px\s[^'"\n]*['"]/g;
/** A template emitting px (`${n}px`). One over a `tokens.ts` scale member
 *  (`${radii.sm}px`, `${boardGeometry.freestyle.footColumn}px`) is the token
 *  itself, not a literal. */
const TEMPLATE_PX = /\$\{([^}]*)\}px/g;
const TOKEN_MEMBER =
  /^(?:(?:radii|strokes|space|deskRails|controlTargets|fieldWidths|OVERLAY_NAME_STRIP)\.\w+|boardGeometry(?:\.\w+|\[\w+\])+)$/;
/** A length computed at runtime off a measured box (`useSurrenderedWidth`, the
 *  bracket canvas), rounded for the style string: device px by construction,
 *  the same reading NUMERIC_PX gives an authored decimal. */
const SCALED_PX = /\.toFixed\(2\)$/;
/** The `?sideMargin` / `?bottomMargin` producer knobs: raw output px by
 *  contract (broadcast-overlays.md "Producer margin knobs"), so the timer
 *  displays emit them as given. */
const PRODUCER_KNOB = /^(?:sideMargin|bottomMargin)$/;
/** Per-file template expressions over a table the file owns and its own suite
 *  pins. Scoped by file and by expression so a bare `${side}px` elsewhere still
 *  counts. */
const FILE_TEMPLATE_PX: Record<string, RegExp> = {
  // The panel clock frame's strokes, from `PANEL_PX` (countdownSkin.test "frame").
  'util/countdownSkin.ts': /^(?:geometry\.\w+|side|geometry\.box - side)$/,
};
const templatePx = (source: string, file?: string): string[] =>
  [...source.matchAll(TEMPLATE_PX)]
    .map(([site, expr]) => [site, expr.trim()] as const)
    .filter(
      ([, expr]) =>
        !TOKEN_MEMBER.test(expr) &&
        !SCALED_PX.test(expr) &&
        !PRODUCER_KNOB.test(expr) &&
        !(file !== undefined && FILE_TEMPLATE_PX[file]?.test(expr)),
    )
    .map(([site]) => site);
/**
 * Numeric `sx` geometry MUI emits as raw px. `borderRadius`, `gap`, `p`, `m` are
 * theme-multiplied and not counted here (an overlay body bans them outright,
 * `THEME_SPACING`); a value <= 1 is a fraction MUI reads as a percentage; a
 * decimal is a 1080p reference-frame art measurement fed through `refVh`, never
 * `sx`. A responsive object counts each breakpoint's value. The
 * lookbehind skips a media feature (`'(min-width:1280px)'`).
 */
const NUMERIC_PX =
  /(?<![-\w])(?:width|height|minWidth|maxWidth|minHeight|maxHeight|top|right|bottom|left|inset|flexBasis)\s*:\s*(\{[^{}]*\}|\d+(?![.\d%]))/g;
const BREAKPOINT_PX = /\b(?:xs|sm|md|lg|xl)\s*:\s*(\d+)(?![.\d%])/g;
/**
 * A viewport media feature on a px length, in an `@media` key or a bare
 * `useMediaQuery` string. Viewport gates come from `theme.breakpoints` or the
 * `deskMedia` token (design-system §9 "Desk gates"); an `@container` query keys
 * on its own panel, not the viewport, and is stripped before the scan.
 */
const VIEWPORT_PX = /\((?:min|max)-(?:width|height):\s*\d+px/g;
const CONTAINER_QUERY = /@container[^'"`\n]*/g;
const viewportPx = (source: string): string[] =>
  source.replace(CONTAINER_QUERY, '').match(VIEWPORT_PX) ?? [];

/**
 * MUI theme spacing in an overlay body (`spacing={3}`, `pt: 6`): fixed device
 * px, so at a 720p or 4K capture the gap keeps its 1080p size while the plates
 * around it scale. On-air gaps go through `refVw`/`refVh` (design-system §7).
 * BridgePage and the flag helpers are not frame geometry and keep MUI spacing.
 */
const OVERLAY_BODY = /^pages\/Stream\/\w+Overlay\.tsx$/;
const THEME_SPACING =
  /\bspacing=\{(\d+(?:\.\d+)?)\}|(?<![-\w])(?:gap|rowGap|columnGap|[pm][trblxy]?)\s*:\s*(\d+)(?![.\d%])/g;
const themeSpacing = (source: string): string[] =>
  [...source.matchAll(THEME_SPACING)]
    .filter(([, prop, sx]) => Number(prop ?? sx) > 0)
    .map(([site]) => site);

/**
 * Colours that must match a physical object, not the palette: tokenising them
 * would let a palette retune drift them off the thing they depict.
 */
const REAL_WORLD_COLOUR_FILES: Record<string, string> = {
  'util/buzzer.ts': 'the Buzz! handset key colours the operator is looking at',
  'pages/Stream/flags/flagEdgeColors.ts': 'sampled edge colours of national flags',
  'pages/Stream/flags/wide/delivered.ts': "the event designer's flag art, verbatim",
  'pages/Stream/flags/wide/rebuilt.ts': 'reconstructed national flag stripes',
  'pages/Stream/flags/wide/emblems.ts': 'crest artwork generated from the vendored flag-icons',
};

/**
 * Files that may hold a `'1px'` hairline and no other px literal: a bare `1` in
 * `sx` is read as 100 %, so a one-pixel length has to be spelled as a string.
 */
const HAIRLINE_PX_FILES: Record<string, string> = {
  'pages/Freestyle/TallyPlate.tsx': "the status region's visually-hidden 1x1 box",
};

/** Prose may cite a hex; only code is scanned. Line-anchored so `/*` inside a
 *  string (an `import.meta.glob` pattern) never opens a comment. */
const stripComments = (source: string): string =>
  source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');

const code = (file: string): string => stripComments(readFileSync(join(APP_DIR, file), 'utf8'));
const hasRawColour = (file: string): boolean => RAW_COLOUR.test(code(file));
const pxLiterals = (file: string): string[] => code(file).match(RAW_PX) ?? [];
const compoundPx = (file: string): string[] => code(file).match(COMPOUND_PX) ?? [];

/** Every numeric-geometry and template px site in a file, as written. */
function rawPxSites(file: string): string[] {
  const source = code(file);
  const numeric = [...source.matchAll(NUMERIC_PX)].flatMap(([site, value]) =>
    value.startsWith('{')
      ? [...value.matchAll(BREAKPOINT_PX)].filter(([, n]) => Number(n) > 1).map(([bp]) => bp)
      : Number(value) > 1
        ? [site]
        : [],
  );
  return [...numeric, ...templatePx(source, file)];
}

/**
 * Raw-px debt frozen per file: numeric `sx` geometry plus non-token `${…}px`
 * templates. A count may hold or shrink, never grow, and a file that migrates
 * onto tokens must lower or drop its entry.
 */
const RAW_PX_DEBT: Record<string, number> = {};

const files = readdirSync(APP_DIR, { recursive: true, encoding: 'utf8' })
  .map((f) => f.split(sep).join('/'))
  .filter((f) => /\.tsx?$/.test(f) && !f.startsWith('theme/'));

describe('app/ colour', () => {
  it('carries no raw colour literal outside the real-world-colour files', () => {
    // Guards the path itself: a moved directory would otherwise read as clean.
    expect(files).toContain('components/BuzzerMappingDialog.tsx');

    const offenders = files.filter((f) => !(f in REAL_WORLD_COLOUR_FILES) && hasRawColour(f));
    expect(offenders).toEqual([]);
  });

  it('exempts only files that still hold a real-world colour', () => {
    const stale = Object.keys(REAL_WORLD_COLOUR_FILES).filter(
      (f) => !files.includes(f) || !hasRawColour(f),
    );
    expect(stale).toEqual([]);
  });
});

describe('app/ px lengths', () => {
  it('carries no quoted px literal outside the allowlisted hairlines', () => {
    const offenders = files.flatMap((f) =>
      pxLiterals(f)
        .filter((px) => !(f in HAIRLINE_PX_FILES && HAIRLINE.test(px)))
        .map((px) => `${f} ${px}`),
    );
    expect(offenders).toEqual([]);
  });

  it('exempts only files that still hold a hairline', () => {
    const stale = Object.keys(HAIRLINE_PX_FILES).filter(
      (f) => !files.includes(f) || !pxLiterals(f).some((px) => HAIRLINE.test(px)),
    );
    expect(stale).toEqual([]);
  });

  it('carries no compound value opening on a px length', () => {
    expect(files.flatMap((f) => compoundPx(f).map((px) => `${f} ${px}`))).toEqual([]);
  });

  it('flags a px viewport query and exempts a container query', () => {
    expect(viewportPx("'@media (min-width:1300px)': {")).toEqual(['(min-width:1300px']);
    expect(viewportPx("useMediaQuery('(max-height: 700px)')")).toEqual(['(max-height: 700px']);
    expect(viewportPx("const SIDE_FOOT = '@container (min-width: 920px)';")).toEqual([]);
  });

  it('flags a non-token px template and exempts token members and the producer knobs', () => {
    expect(templatePx('mx: `${foo}px`, flex: `1 1 ${basis}px`')).toEqual([
      '${foo}px',
      '${basis}px',
    ]);
    expect(templatePx('mx: `${sideMargin}px`, mb: `${bottomMargin}px`')).toEqual([]);
    expect(
      templatePx(
        '`${fieldWidths.wide}px ${boardGeometry.freestyle.footColumn}px ${boardGeometry.freestyle.selectionBasis[key]}px`',
      ),
    ).toEqual([]);
    expect(templatePx('`${sideMarginPx}px ${boardGeometry}px ${theme.x}px`')).toEqual([
      '${sideMarginPx}px',
      '${boardGeometry}px',
      '${theme.x}px',
    ]);
  });

  it('exempts a measured length rounded to two decimals, and only that', () => {
    expect(
      templatePx('`calc(${w} + ${surrendered.toFixed(2)}px)` `${((a * b) / c).toFixed(2)}px`'),
    ).toEqual([]);
    expect(templatePx('`${w.toFixed(1)}px ${w.toFixed(2) + 1}px ${height}px`')).toEqual([
      '${w.toFixed(1)}px',
      '${w.toFixed(2) + 1}px',
      '${height}px',
    ]);
  });

  it('reads the name strip native size as a token', () => {
    expect(templatePx('`${OVERLAY_NAME_STRIP.height}px`')).toEqual([]);
  });

  it('allows a file template only in its own file', () => {
    const skin = '`${geometry.thin}px ${side}px ${geometry.box - side}px`';
    expect(templatePx(skin, 'util/countdownSkin.ts')).toEqual([]);
    expect(templatePx('`${x}px ${side}px`', 'pages/Speedline/RaceLaneColumn.tsx')).toEqual([
      '${x}px',
      '${side}px',
    ]);
    expect(templatePx('`${x}px ${geometry.box + 1}px`', 'util/countdownSkin.ts')).toEqual([
      '${x}px',
      '${geometry.box + 1}px',
    ]);
  });

  it('allows file templates only where the file still emits one', () => {
    const stale = Object.entries(FILE_TEMPLATE_PX).filter(
      ([f, allowed]) =>
        !files.includes(f) ||
        ![...code(f).matchAll(TEMPLATE_PX)].some(([, expr]) => allowed.test(expr.trim())),
    );
    expect(stale.map(([f]) => f)).toEqual([]);
  });

  it('carries no px viewport query', () => {
    expect(files.flatMap((f) => viewportPx(code(f)).map((q) => `${f} ${q}`))).toEqual([]);
  });

  it('flags theme spacing and exempts frame-relative, zero and art-table values', () => {
    expect(themeSpacing('<Stack spacing={3}><Stack direction="row" spacing={1.5}>')).toEqual([
      'spacing={3}',
      'spacing={1.5}',
    ]);
    expect(themeSpacing('sx={{ pt: 6, mb: 1, gap: 2, columnGap: 4 }}')).toEqual([
      'pt: 6',
      'mb: 1',
      'gap: 2',
      'columnGap: 4',
    ]);
    expect(
      themeSpacing(
        'spacing={0} sx={{ pt: refVh(48), m: 0, rowGap: 45.65, top: 6, stackGap: 24, gap: 39.66 }}',
      ),
    ).toEqual([]);
  });

  it('carries no theme spacing in an overlay body', () => {
    const bodies = files.filter((f) => OVERLAY_BODY.test(f));
    expect(bodies).toContain('pages/Stream/RoundsSummaryOverlay.tsx');
    expect(bodies).not.toContain('pages/Stream/BridgePage.tsx');
    expect(bodies).not.toContain('pages/Stream/FlagBlock.tsx');
    expect(bodies.flatMap((f) => themeSpacing(code(f)).map((s) => `${f} ${s}`))).toEqual([]);
  });

  it('grows no file past its frozen raw-px debt', () => {
    const grown = files
      .map((f) => [f, rawPxSites(f)] as const)
      .filter(([f, sites]) => sites.length > (RAW_PX_DEBT[f] ?? 0))
      .map(([f, sites]) => `${f} ${sites.length} > ${RAW_PX_DEBT[f] ?? 0}: ${sites.join(' | ')}`);
    expect(grown).toEqual([]);
  });

  it('prunes the debt ledger as files migrate', () => {
    const stale = Object.entries(RAW_PX_DEBT)
      .filter(([f, frozen]) => !files.includes(f) || rawPxSites(f).length < frozen)
      .map(
        ([f, frozen]) => `${f} ${frozen} -> ${files.includes(f) ? rawPxSites(f).length : 'gone'}`,
      );
    expect(stale).toEqual([]);
  });
});
