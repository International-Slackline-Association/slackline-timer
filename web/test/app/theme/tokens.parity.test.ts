/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { colors, fonts, overlayArt } from 'app/theme/tokens';

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
 *    the :root declaration the single canonical value (used by `race.running`
 *    so the colour-adaptation mode can override it per `<body>` class — see
 *    tokens.css). Drift is then impossible by construction; the var must
 *    still exist in :root.
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
  'overlay.label': '--tl-overlay-label',
  'overlay.scrim': '--tl-overlay-scrim',
  'overlay.backdrop': '--tl-overlay-backdrop',
  chromaKey: '--tl-chroma-key',
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

// Parse the `--tl-*` declarations out of tokens.css's :root block ONLY — the
// colour-adaptation override block redeclares vars with their pre-compensated
// values and must not shadow the canonical :root declarations here. Whitespace
// (including the newlines inside the multi-line rgba()) and trailing comments
// are stripped so values compare on the same footing as the TS literals.
function parseCssVars(css: string): Record<string, string> {
  const start = css.indexOf(':root');
  const root = css.slice(start, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const [, name, raw] of root.matchAll(/(--tl-[\w-]+)\s*:\s*([^;]+);/g)) {
    const value = raw
      .replace(/\/\*[\s\S]*?\*\//g, '') // drop inline comments
      .replace(/\s+/g, '') // collapse whitespace (incl. wrapped rgba)
      .trim();
    vars[name] = value;
  }
  return vars;
}

// vitest runs with cwd = web/, so resolve the canonical CSS off that root.
const cssVars = parseCssVars(
  readFileSync(resolve(process.cwd(), 'src/app/theme/tokens.css'), 'utf8'),
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
