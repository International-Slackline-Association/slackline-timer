/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { STATE_STRIPE } from 'app/pages/Freestyle/TallyPlate';
import { colors } from 'app/theme/tokens';

/**
 * Live-path contrast, pinned pair by pair.
 *
 * The Freestyle board brief (`doc/dev/design-system/freestyle-board-ux.md` §6)
 * names every fill/foreground pair the live path paints and the floor it owes:
 * **4.5:1** for text under 24 px, **3:1** for numerals/words at ≥24 px and for
 * non-text strokes (WCAG 2.x 1.4.3 / 1.4.11). The pairs land here *before* the
 * slices that paint them, so a later round cannot introduce a failing
 * combination unnoticed — the audit finding S04 was four such pairs shipping
 * unmeasured.
 *
 * Ratios are computed from the tokens themselves, so retuning a token either
 * keeps the contract or fails here. Fix the token, never the floor.
 */

// tokens.css :root is the canonical value for the two tokens that defer to a
// CSS var (`race.running`, `race.stopDim` — the colour-adaptation override, see
// tokens.css); resolve them the same way the parity test does.
const CSS = readFileSync(resolve(process.cwd(), 'src/app/theme/tokens.css'), 'utf8');
const ROOT = CSS.slice(CSS.indexOf(':root'), CSS.indexOf('}', CSS.indexOf(':root')));

function hex(token: string): string {
  const varName = /^var\((--[\w-]+)\)$/.exec(token)?.[1];
  if (!varName) return token;
  const declared = new RegExp(`${varName}\\s*:\\s*([^;]+);`).exec(ROOT)?.[1].trim();
  if (!declared) throw new Error(`${varName} is not declared in tokens.css :root`);
  return declared;
}

function luminance(token: string): number {
  const rgb = hex(token).replace('#', '');
  const channels = [0, 2, 4]
    .map((i) => parseInt(rgb.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const { surface, ink, brand, race } = colors;

// Brief §6, "Every live-path pair, named" — plus the per-ground rows of the new
// `*Text` tier table. `min` is the WCAG floor the row owes, not its measured
// ratio.
const PAIRS: [surface: string, ground: string, foreground: string, min: number][] = [
  // Plate verbs and the race buttons that mirror them
  ['plate STOP / END TRY; Stop button', race.stopDim, ink.onBrand, 4.5],
  ['plate START / START TRY / RESUME; Start contained', race.go, ink.hi, 4.5],
  ['plate TAKE BREAK', race.set, ink.hi, 4.5],
  ['plate no-op / awaiting board state', surface.panel, ink.hi, 4.5],
  ['Start outlined (not the ADVANCE target)', surface.panel, race.goText, 4.5],
  ['Save contained; the header’s filled mode chip', brand.tealDark, ink.onBrand, 4.5],
  [
    'a confirm’s safe answer — text-primary ink on the dialog panel',
    surface.panel,
    brand.tealDark,
    4.5,
  ],
  // Lane cards: state words are text, ticking numerals are ≥24 px
  ['running digits + the RUNNING word', surface.panel, race.runningText, 4.5],
  ['break / pause count-up numeral (≥24 px)', surface.panel, race.setDim, 3],
  ['BREAK / CHANGEOVER / TURN TAKEN words', surface.panel, race.setText, 4.5],
  ['expired digits + the FINISHED · TIME word', surface.panel, race.stopDim, 4.5],
  ['idle / held digits', surface.panel, ink.hi, 4.5],
  // Frame strokes (non-text; the running frame is the documented exception below)
  ['idle / held frame stroke', surface.panel, ink.mid, 3],
  ['break frame stroke', surface.panel, race.setDim, 3],
  ['expired frame stroke', surface.panel, race.stopDim, 3],
  // Chips and the chrome around the live column
  ['SAVED n / Recording chips', race.go, ink.hi, 4.5],
  ['NOT SAVED / WARM-UP OVER chips', race.stopDim, ink.onBrand, 4.5],
  ['Reconnecting… chip', race.set, ink.hi, 4.5],
  ['locked (disabled) race control label', surface.muted, ink.mid, 4.5],
  ['mode toggle / cap pair — the chosen key, live and locked', surface.lineStrong, ink.hi, 4.5],
  ['why-lines, keycaps, sub-lines on a panel', surface.panel, ink.mid, 4.5],
  ['why-lines, keycaps, sub-lines on the canvas', surface.canvas, ink.mid, 4.5],
  // The `*Text` tier owes its floor on both light grounds
  ['runningText on the canvas', surface.canvas, race.runningText, 4.5],
  ['goText on the canvas', surface.canvas, race.goText, 4.5],
  ['setText on the canvas', surface.canvas, race.setText, 4.5],
  ['stopDim — stop’s own text tier — on the canvas', surface.canvas, race.stopDim, 4.5],
  // Numeral-only tiers: ≥24 px only, which is why the words above take `*Text`
  ['goDim winner numeral on the canvas', surface.canvas, race.goDim, 3],
  ['setDim break numeral on the canvas', surface.canvas, race.setDim, 3],
];

describe('live-path contrast (FREESTYLE_BOARD_UX §6)', () => {
  it.each(PAIRS)('%s clears its floor', (_surface, ground, foreground, min) => {
    expect(ratio(ground, foreground)).toBeGreaterThanOrEqual(min);
  });

  it('the running frame stroke is the one deliberate sub-3:1 mark', () => {
    // A 14 px-wide teal stroke is a luminance/shape signal, not an information
    // carrier: WCAG 1.4.1/1.4.11 are satisfied by the RUNNING word and the
    // `runningText` digits inside it, so the word is what this test pins.
    expect(ratio(surface.panel, race.running)).toBeLessThan(3);
    expect(ratio(surface.panel, race.runningText)).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The plate's state channel paints one tier table over FOUR fills (go, stop,
   * set, panel), so its ground is a `panel` keyline of its own rather than
   * whichever fill the next press happens to wear — a `stopDim` stripe on the
   * stop fill is 1.18:1, invisible exactly when a lane is running. Grounded on
   * `panel`, the table is the §6 stroke language it borrows, and every tier
   * owes the 3:1 non-text floor: the stripe is a mark, and the operator reads
   * it at 25 % scale where the state word beside it is long gone.
   */
  it.each(Object.entries(STATE_STRIPE))(
    'the %s state stripe clears 3:1 on its keyline',
    (_tier, stripe) => {
      expect(ratio(surface.panel, stripe)).toBeGreaterThanOrEqual(3);
    },
  );

  it('the locked outlined stroke separates from the live stroke it replaces', () => {
    // The locked pair is a well, so its own stroke is deliberately quiet:
    // `line` on `muted` is 1.11:1, and WCAG 1.4.11 exempts inactive components
    // from the 3:1 non-text floor. What has to hold is the *step* between the
    // two strokes — a live outlined neutral draws `ink.mid` — because that is
    // the mark telling locked from live at 25% scale.
    expect(ratio(ink.mid, surface.line)).toBeGreaterThanOrEqual(3);
    expect(ratio(surface.muted, surface.line)).toBeLessThan(3);
  });

  it('white on `stop` fails, which is why no live control paints one', () => {
    expect(ratio(race.stop, ink.onBrand)).toBeLessThan(4.5);
  });

  it('brand teal fails as fill and as ink, which is why the tier is `tealDark`', () => {
    // The three surfaces MUI hands the brand to unasked — a contained fill, a
    // filled chip's ground, a text button's ink — all measure 2.9:1. `tealDark`
    // clears the floor on a panel (4.61) but NOT on the canvas (4.29), which is
    // why the header's board-format chip leaves the family for `chosenKey`
    // rather than darkening inside it.
    expect(ratio(brand.teal, ink.onBrand)).toBeLessThan(4.5);
    expect(ratio(surface.panel, brand.teal)).toBeLessThan(4.5);
    expect(ratio(surface.canvas, brand.tealDark)).toBeLessThan(4.5);
  });
});

/**
 * The rule behind the row above: a stop fill on the live path paints the
 * `stopDim` text tier (5.39:1 with white), never MUI's `error.main`
 * (`race.stop`, 3.59:1 either way round). `error` keeps its palette entry — the
 * theme's alarm variants resolve it to the same tier for chips and outlined
 * controls (`test/app/theme/alarmTones.test.tsx`), so what these guards forbid
 * is a hand-painted one.
 */
const CONTROL_PAGE_DIRS = ['src/app/pages/Freestyle', 'src/app/pages/Speedline'];

// Slices each JSX opening tag out of a source file. `>` inside a prop
// expression (`onClick={() => …}`) is skipped by tracking brace depth, which is
// all this guard needs — it reads literal string props, nothing structural.
function openingTags(src: string): string[] {
  const tags: string[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<' || !/[A-Za-z]/.test(src[i + 1] ?? '')) continue;
    let depth = 0;
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      else if (src[j] === '>' && depth === 0) {
        tags.push(src.slice(i, j + 1));
        i = j;
        break;
      }
    }
  }
  return tags;
}

// The shared chrome both consoles mount. Scanning the page dirs alone let a
// live confirm and the status header keep `error.main`, because they live in
// `components/` — the guards are about what the operator sees on the board, not
// about which folder it is written in.
const CONTROL_CHROME_FILES = [
  'src/app/components/SelectionChangeConfirmDialog.tsx',
  'src/app/components/ControlStatusHeader.tsx',
];

const CONTROL_PAGE_FILES = [
  ...CONTROL_PAGE_DIRS.flatMap((dir) =>
    readdirSync(resolve(process.cwd(), dir))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => `${dir}/${name}`),
  ),
  ...CONTROL_CHROME_FILES,
];

const sourceOf = (file: string): string => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('no live control paints a contained `error.main`', () => {
  it.each(CONTROL_PAGE_FILES)('%s', (file) => {
    const offenders = openingTags(sourceOf(file)).filter(
      (tag) => tag.includes('color="error"') && tag.includes('variant="contained"'),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * The same rule's other half: on a *control*, the `stopDim` fill has exactly one
 * owner — `RaceButton`'s `stop` tone. Hand-painting it gets the pair right and
 * the keyboard wrong: the tone is what carries the ≥44 px target and the blur
 * rule (§4.4/§6), and a stop control that keeps focus swallows the next buzzer
 * press. Both spellings render the same colour, so only the source tells them
 * apart. Non-controls (the plate, a status chip) paint `error.dark` freely —
 * they own no press. `destructiveFillSx` was the theme helper this rule retired.
 */
/**
 * The rule's third half, from the board's eyes-on pass: an alarm that paints as
 * INK is a word, not a mark. `color="error"` on a `Typography` resolves to
 * `error.main` — 3.34:1 on the canvas — and no theme rule can lift it, because
 * the tone is the whole style. The advisory strip's own words take `error.dark`
 * (`stopDim`, 5.01:1); chips and buttons get theirs from the theme's alarm
 * variants (pinned in `test/app/theme/alarmTones.test.tsx`).
 */
describe('no live-path text writes in `error.main`', () => {
  it.each(CONTROL_PAGE_FILES)('%s', (file) => {
    const offenders = openingTags(sourceOf(file)).filter(
      (tag) => tag.startsWith('<Typography') && tag.includes('color="error"'),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * And the rule's last half, on the wrapper that exists to end it: a
 * `RaceButton` states its state as a **tone**, never a `color=`. The palette
 * entry a hand-painted `color` resolves to is the theme's, not §6's — the
 * Speedline false-start pair read `error` and got `error.main`'s outline where
 * the `dnf` tone names the `stopDim` pair the board measures at 5.01:1 — and a
 * call site that paints its own state is a second control vocabulary whatever
 * it resolves to. `variant` is deliberately not covered: emphasis is the call
 * site's (`fsux-setup-emphasis-tier` still owes one of those).
 */
describe('a live control names its state in a tone, not a `color`', () => {
  it.each(CONTROL_PAGE_FILES)('%s', (file) => {
    const offenders = openingTags(sourceOf(file)).filter(
      (tag) => tag.startsWith('<RaceButton') && /\scolor="/.test(tag),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * The brand fill's own owner: the theme's contained-primary variant, which
 * paints `tealDark` + `ink.onBrand` for every Save-shaped button on the board
 * (pinned in `test/app/theme/brandFill.test.tsx`). Hand-painting `primary.dark`
 * on one page is how the pair got fixed on Save while `Set both lanes` kept
 * white on `primary.main` at 2.9:1 — the failing default is invisible at the
 * call site, so the guard is against writing the fix there.
 */
describe('the brand fill reaches a control only through the theme', () => {
  it.each(CONTROL_PAGE_FILES)('%s', (file) => {
    expect(sourceOf(file)).not.toContain('primary.dark');
  });
});

/**
 * The rule the guards around it serve: on the live path a press that carries a
 * STATE takes it from a `RaceButton` tone, never from a raw `Button`'s `color`.
 * Colour alone would not be worth a guard — the theme's variants resolve
 * `primary`/`error` to the §6 pairs either way, which is exactly why the
 * hand-painted `Lane n DNF` looked right while sitting at `size="small"` under
 * the 44 px floor. The tone is what carries the target and the blur rule, and a
 * console control that keeps focus swallows the next handset press (§4.4).
 * Colourless chrome (Swap, Reset series, a field adornment) names no state, so
 * it carries no tone — it still takes the wrapper for the target and the blur
 * rule, which is the half a colourless press was missing when this rule was
 * written about colour alone.
 */
describe('a state-coloured press on the live path is a `RaceButton` tone', () => {
  it.each(CONTROL_PAGE_FILES)('%s', (file) => {
    const offenders = openingTags(sourceOf(file)).filter(
      (tag) => tag.startsWith('<Button') && /color="(error|primary|success|warning)"/.test(tag),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the stop fill reaches a control only through `RaceButton`', () => {
  it.each(CONTROL_PAGE_FILES)('%s', (file) => {
    const src = sourceOf(file);
    expect(src).not.toContain('destructiveFillSx');
    expect(
      openingTags(src).filter((tag) => tag.startsWith('<Button') && tag.includes('error.dark')),
    ).toEqual([]);
  });
});
