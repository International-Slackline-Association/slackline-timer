/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  adminPreview,
  boardGeometry,
  colors,
  controlTargets,
  deskGate,
  deskMedia,
  fieldWidths,
  fonts,
  marks,
  overlayArt,
  OVERLAY_LANE,
  OVERLAY_NAME_STRIP,
} from 'app/theme/tokens';

/**
 * tokens.ts ↔ tokens.css parity. The TELEMETRY tokens have two hand-kept
 * copies: the canonical TS objects (consumed by the MUI theme) and the
 * `--tl-*` CSS custom properties in tokens.css (for non-MUI surfaces). The sync
 * is convention-only (DESIGN_SYSTEM §9), so this test guards against silent
 * drift: every `colors`/`fonts`/`overlayArt` token must have a matching CSS
 * var, and their values must agree. Fix the drift, never the test.
 *
 * Two parity shapes exist:
 *  - literal — the TS value and the :root var value must match; and
 *  - var indirection — the TS value is exactly `var(<its mapped var>)`, making
 *    the :root declaration the single canonical value (the tokens a `<body>`
 *    mode class overrides — `race.running`/`stopDim` for colour adaptation, the
 *    translucent plates for the chroma ground; see tokens.css). Drift is then
 *    impossible by construction; the var must still exist in :root.
 *
 * The CSS var naming is irregular by design (surfaces carry a `bg-` sub-prefix
 * except borders; brand/race drop their group segment), so the pairing is an
 * explicit table rather than a derived rule — that keeps it auditable and means
 * a new token is a deliberate two-line addition here, not a silent omission.
 */

// Maps each leaf path in `colors` to its tokens.css custom property.
const CSS_VAR_BY_PATH: Record<string, string> = {
  'surface.void': '--tl-bg-void',
  'surface.canvas': '--tl-bg-canvas',
  'surface.base': '--tl-bg-base',
  'surface.panel': '--tl-bg-panel',
  'surface.raised': '--tl-bg-raised',
  'surface.muted': '--tl-bg-muted',
  'surface.line': '--tl-line',
  'surface.lineStrong': '--tl-line-strong',
  'ink.hi': '--tl-ink-hi',
  'ink.mid': '--tl-ink-mid',
  'ink.low': '--tl-ink-low',
  'ink.faint': '--tl-ink-faint',
  'ink.onBrand': '--tl-ink-on-brand',
  'brand.teal': '--tl-teal',
  'brand.tealDark': '--tl-teal-dark',
  'brand.tealTint': '--tl-teal-tint',
  'brand.orange': '--tl-orange',
  'brand.orangeDark': '--tl-orange-dark',
  'race.running': '--tl-running',
  'race.runningBright': '--tl-running-bright',
  'race.runningText': '--tl-running-text',
  'race.go': '--tl-go',
  'race.goDim': '--tl-go-dim',
  'race.goText': '--tl-go-text',
  'race.set': '--tl-set',
  'race.setDim': '--tl-set-dim',
  'race.setText': '--tl-set-text',
  'race.setBright': '--tl-set-bright',
  'race.stop': '--tl-stop',
  'race.stopDim': '--tl-stop-dim',
  'race.stopBright': '--tl-stop-bright',
  'race.idle': '--tl-idle',
  'overlay.plate': '--tl-overlay-plate',
  'overlay.plateName': '--tl-overlay-plate-name',
  'overlay.plateStrip': '--tl-overlay-plate-strip',
  'overlay.plateFilled': '--tl-overlay-plate-filled',
  'overlay.stroke': '--tl-overlay-stroke',
  'overlay.nameInk': '--tl-overlay-name-ink',
  'overlay.nameInkSubordinate': '--tl-overlay-name-ink-subordinate',
  'overlay.label': '--tl-overlay-label',
  'overlay.scrim': '--tl-overlay-scrim',
  'overlay.backdrop': '--tl-overlay-backdrop',
  chromaKey: '--tl-chroma-key',
  chromaKeyGreen: '--tl-chroma-key-green',
  chromaKeyBlue: '--tl-chroma-key-blue',
};

// Non-color tokens that are also hand-kept in both files: the font stacks and
// the LAAX overlay art metrics. Same drift guard, separate table because they
// don't come from `colors`.
const CSS_VAR_BY_EXTRA_PATH: Record<string, string> = {
  'fonts.numerals': '--tl-font-numerals',
  'fonts.display': '--tl-font-display',
  'fonts.body': '--tl-font-body',
  'overlayArt.strokeWidth': '--tl-overlay-stroke-width',
  'overlayArt.headingTracking': '--tl-overlay-heading-tracking',
  'overlayArt.bannerTracking': '--tl-overlay-banner-tracking',
  'overlayArt.nameTracking': '--tl-overlay-name-tracking',
};

const extraEntries: [string, string][] = [
  ...Object.entries(fonts).map(([k, v]) => [`fonts.${k}`, v] as [string, string]),
  ...Object.entries(overlayArt).map(([k, v]) => [`overlayArt.${k}`, v] as [string, string]),
];

// Flatten the (one-level-nested) `colors` object into path → value entries.
const colorEntries: [string, string][] = Object.entries(colors).flatMap(([group, value]) =>
  typeof value === 'string'
    ? [[group, value] as [string, string]]
    : Object.entries(value).map(([k, v]) => [`${group}.${k}`, v] as [string, string]),
);

// The body of the first rule whose selector is exactly `selector`.
function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no \`${selector}\` block`);
  return css.slice(start, css.indexOf('}', start));
}

// The `--tl-*` declarations in a CSS block. Whitespace (including the newlines
// inside the multi-line rgba()) and inline comments are stripped so values
// compare on the same footing as the TS literals.
function declarations(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [, name, raw] of block.matchAll(/(--tl-[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[name] = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
  }
  return vars;
}

// vitest runs with cwd = web/, so resolve the canonical CSS off that root.
const tokensCss = readFileSync(resolve(process.cwd(), 'src/app/theme/tokens.css'), 'utf8');
// :root ONLY — the body-class override blocks redeclare vars with their
// pre-compensated values and must not shadow the canonical declarations.
const cssVars = declarations(cssBlock(tokensCss, ':root'));
const chromaOverrides = declarations(cssBlock(tokensCss, 'body.tl-chroma-ground'));
const designSystem = readFileSync(
  resolve(process.cwd(), '../doc/dev/design-system/design-system.md'),
  'utf8',
);

const normalize = (v: string) => v.replace(/\s+/g, '').toLowerCase();

describe('tokens.ts ↔ tokens.css color parity', () => {
  it('every color token is mapped to a CSS var', () => {
    const unmapped = colorEntries.map(([path]) => path).filter((path) => !CSS_VAR_BY_PATH[path]);
    expect(unmapped).toEqual([]);
  });

  it.each(colorEntries)('colors.%s matches its --tl-* var', (path, value) => {
    const varName = CSS_VAR_BY_PATH[path];
    expect(cssVars[varName], `${varName} missing from tokens.css`).toBeDefined();
    // var indirection: the TS value defers to exactly its own mapped var, so
    // the :root declaration IS the canonical value — nothing to compare.
    if (value === `var(${varName})`) return;
    expect(normalize(cssVars[varName])).toBe(normalize(value));
  });

  it.each(extraEntries)('%s matches its --tl-* var', (path, value) => {
    const varName = CSS_VAR_BY_EXTRA_PATH[path];
    expect(varName, `${path} missing from CSS_VAR_BY_EXTRA_PATH`).toBeDefined();
    expect(cssVars[varName], `${varName} missing from tokens.css`).toBeDefined();
    if (value === `var(${varName})`) return;
    expect(normalize(cssVars[varName])).toBe(normalize(value));
  });

  it('every mapped --tl-* var exists in tokens.css', () => {
    const missing = [
      ...Object.values(CSS_VAR_BY_PATH),
      ...Object.values(CSS_VAR_BY_EXTRA_PATH),
    ].filter((v) => cssVars[v] === undefined);
    expect(missing).toEqual([]);
  });

  it('no color --tl-* var is left unmapped (catches additions to tokens.css)', () => {
    const mapped = new Set([
      ...Object.values(CSS_VAR_BY_PATH),
      ...Object.values(CSS_VAR_BY_EXTRA_PATH),
    ]);
    // Color vars only: exclude font/radius/space/type families, which are
    // covered by their own token groups, not `colors`.
    const colorVarPrefixes =
      /^--tl-(bg-|line|ink-|teal|orange|running|go|set|stop|idle|overlay-|chroma-key)/;
    const unmapped = Object.keys(cssVars).filter(
      (name) => colorVarPrefixes.test(name) && !mapped.has(name),
    );
    expect(unmapped).toEqual([]);
  });
});

/**
 * Chroma-ground flatten (`body.tl-chroma-ground`, set by `applyOverlayBodyStyle`
 * on a keyed ground): each translucent white plate is overridden with the opaque
 * colour the same alpha gives over `surface.void`, so the keyer sees one fixed
 * neutral instead of white blended into the key. Pinned to the :root alpha so
 * retuning either side without the other fails here.
 */
describe('chroma-ground plate flatten', () => {
  const channels = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const ground = channels(cssVars['--tl-bg-void']);

  it('overrides exactly the three translucent plate vars', () => {
    expect(Object.keys(chromaOverrides).sort()).toEqual([
      '--tl-overlay-plate',
      '--tl-overlay-plate-name',
      '--tl-overlay-plate-strip',
    ]);
  });

  it.each(['--tl-overlay-plate', '--tl-overlay-plate-name', '--tl-overlay-plate-strip'])(
    '%s flattens to its :root white alpha over --tl-bg-void',
    (name) => {
      const alpha = Number(/^rgba\(255,255,255,([\d.]+)\)$/.exec(cssVars[name])?.[1]);
      expect(alpha).toBeGreaterThan(0);
      const expected = ground.map((c) => Math.round(c + alpha * (255 - c)));
      expect(channels(chromaOverrides[name].toLowerCase())).toEqual(expected);
    },
  );
});

/**
 * doc/dev/design-system/index.html is a self-contained visual reference with
 * its own hand-kept copy of the tokens (it cannot import tokens.css). Every
 * `--tl-*` it declares must be a tokens.css var with the same value: its :root
 * against tokens.css :root, its `.tl-chroma-ground` scope against the
 * `body.tl-chroma-ground` overrides. Page-only custom properties stay off the
 * `--tl-` namespace.
 */
describe('design-system reference page ↔ tokens.css', () => {
  const html = readFileSync(resolve(process.cwd(), '../doc/dev/design-system/index.html'), 'utf8');
  const pageRoot = declarations(cssBlock(html, ':root'));
  const pageChroma = declarations(cssBlock(html, '.tl-chroma-ground'));

  it('declares --tl-* vars only in its :root and .tl-chroma-ground blocks', () => {
    const total = [...html.matchAll(/--tl-[\w-]+\s*:/g)].length;
    expect(total).toBe(Object.keys(pageRoot).length + Object.keys(pageChroma).length);
  });

  it.each(Object.entries(pageRoot))(':root %s matches tokens.css', (name, value) => {
    expect(cssVars[name], `${name} has no tokens.css twin`).toBeDefined();
    expect(normalize(value)).toBe(normalize(cssVars[name]));
  });

  it('mirrors the chroma-ground overrides exactly', () => {
    const normalized = (vars: Record<string, string>) =>
      Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, normalize(v)]));
    expect(normalized(pageChroma)).toEqual(normalized(chromaOverrides));
  });

  // The swatch chips render from the guarded vars, so the script that paints
  // them may carry no colour of its own.
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  const swatchVars = [...script.matchAll(/'(--tl-[\w-]+)'/g)].map(([, name]) => name);

  it('paints swatches with no colour literal in its script', () => {
    expect(swatchVars.length).toBeGreaterThan(0);
    expect(script.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi) ?? []).toEqual([]);
  });

  it('names only --tl-* vars its :root or .tl-chroma-ground declares', () => {
    const undeclared = swatchVars.filter((name) => !(name in pageRoot || name in pageChroma));
    expect(undeclared).toEqual([]);
  });
});

/**
 * The desk gates have no CSS twin (a media query cannot read a custom
 * property), so their second copy is the prose: design-system §9 "Desk gates"
 * quotes both rendered queries, and a retune that skips the doc fails here.
 */
describe('desk gates', () => {
  it('renders each board’s query off the one deskGate', () => {
    expect(deskGate).toEqual({ minWidth: 1280, minHeight: 900 });
    expect(deskMedia.speedline).toBe('(min-width:1280px)');
    expect(deskMedia.freestyle).toBe('(min-width:1280px) and (min-height:900px)');
  });

  it.each(Object.entries(deskMedia))('design-system §9 quotes the %s gate', (_, query) => {
    expect(designSystem).toContain(`\`${query}\``);
  });

  it('design-system §9 names deskGate as the owner', () => {
    expect(designSystem).toMatch(/\*\*Desk gates\.\*\*[^\n]*`deskGate`/);
  });
});

/**
 * The control-chrome scales are MUI-only (no `--tl-*` twin: no non-MUI surface
 * sizes a control or a field), so their second copy is design-system §5's
 * tables. A retune that skips the doc fails here.
 */
describe('control-chrome scales', () => {
  it('holds the §6 / §9 target sizes', () => {
    expect(controlTargets).toEqual({ floor: 40, live: 44, race: 56, raceWidth: 120, chip: 32 });
  });

  it('holds the field-width scale', () => {
    expect(fieldWidths).toEqual({
      compact: 140,
      short: 160,
      field: 200,
      wide: 240,
      card: 360,
      prose: 820,
    });
  });

  it('holds the mark sizes', () => {
    expect(marks).toEqual({ dot: 10, key: 14 });
  });

  it('holds the admin preview size', () => {
    expect(adminPreview).toEqual({ cardHeight: 240 });
  });

  it.each([
    ...Object.entries(controlTargets).map(([k, v]) => ['controlTargets', k, v] as const),
    ...Object.entries(fieldWidths).map(([k, v]) => ['fieldWidths', k, v] as const),
    ...Object.entries(marks).map(([k, v]) => ['marks', k, v] as const),
    ...Object.entries(adminPreview).map(([k, v]) => ['adminPreview', k, v] as const),
  ])('design-system §5 tabulates %s.%s as %ipx', (_, key, value) => {
    expect(designSystem).toMatch(new RegExp(`\\| \`${key}\` +\\| \`${value}px\` +\\|`));
  });

  it('has no --tl-* twin to drift from', () => {
    const twins = Object.keys(cssVars).filter((name) =>
      /^--tl-(control|field|mark|admin)/.test(name),
    );
    expect(twins).toEqual([]);
  });

  it('design-system §6 Buttons cites controlTargets', () => {
    expect(designSystem).toMatch(/### Buttons[\s\S]*?`controlTargets`[\s\S]*?### Inputs/);
  });
});

/**
 * The boards' measured geometry is relocated, never retuned: the values are
 * the fold budgets freestyle-board-ux §2/§6 (and, for Speedline, design-system
 * "Board geometry") signed off, so a retune that skips the brief fails here.
 */
describe('board geometry', () => {
  const freestyleBrief = readFileSync(
    resolve(process.cwd(), '../doc/dev/design-system/freestyle-board-ux.md'),
    'utf8',
  );

  it('holds the board floors and reserves', () => {
    expect(boardGeometry).toEqual({
      deckMax: { freestyle: 800, freestyleQuali: 500, speedline: 880 },
      freestyle: {
        panelFloor: 394,
        cardFloor: 258,
        identityRow: 26,
        warmupWordRow: 30,
        footColumn: 280,
        paperMax: { battle: 1040, quali: 720 },
        statusSlot: 52,
        tallyPlate: { xs: 120, lg: 76 },
        tryField: 96,
        selectionBasis: { round: 140, gender: 110, match: 210, athlete: 170, assignment: 480 },
      },
      speedline: { startStrip: 184 },
    });
  });

  it('freestyle-board-ux §6 names boardGeometry as their home', () => {
    expect(freestyleBrief).toMatch(/## 6\. Tokens[\s\S]*?`boardGeometry`[\s\S]*?## 7\./);
  });
});

/**
 * The overlay reference-frame numbers only ever feed `refVw`/`refVh`, so they
 * have no `--tl-*` twin; their second copy is design-system §7, which names
 * every such constant and where it lives.
 */
describe('overlay reference frame', () => {
  const constants = /\*\*Reference-frame constants\.\*\*[\s\S]*?\n\n/.exec(designSystem)?.[0] ?? '';

  it('holds the timer lower-third geometry', () => {
    expect(OVERLAY_LANE).toEqual({
      inset: 112,
      gap: 16,
      nameStripHeight: 56,
      clockPlate: 320,
      clockPlatePad: 12,
    });
  });

  it('holds the name lower-third native size', () => {
    expect(OVERLAY_NAME_STRIP).toEqual({ width: 720, height: 92 });
  });

  it.each([
    'OVERLAY_TYPE_FLOOR_PX',
    'OVERLAY_WINNER_WORD_PX',
    'OVERLAY_LANE',
    'OVERLAY_NAME_STRIP',
    'VS_ART',
    'SUMMARY_ART',
    'PROFILE_ART',
  ])('design-system §7 lists %s among the reference-frame constants', (name) => {
    expect(constants).toContain(`\`${name}\``);
  });
});
