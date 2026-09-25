/**
 * How a countdown clock paints — one table, four grounds (FREESTYLE_BOARD_UX §6
 * "Tokens, type, sizes" + the DESIGN_SYSTEM §2 race-state language).
 *
 * The same `Countdown` mounts on four surfaces that owe four different colour
 * contracts, and the derivation used to be six nested ternary chains inside the
 * component, one per mark (numeral, halo, held run, caption, arrow, frame) —
 * every chain re-deciding the ground from `size`/`onDark` on its own. Here the
 * ground is decided ONCE and each surface is a literal row of the brief's table,
 * so a contrast pair can be read (and tested) where it is defined:
 *
 *  - `dark` — the athlete display's slate `void`, or a composite over footage.
 *    The numeral NEVER carries the state hue: every race hue loses too much
 *    contrast on void (base ~3–4:1, the *Bright tier tops out at 5.4:1 for red)
 *    to read across a venue in daylight. Digits stay white (`ink.onBrand`,
 *    11:1 — the ceiling) and the STATE moves to the stroked frame (§7 rule 6,
 *    "white is the contrast workhorse, state colours are accents").
 *  - `panel` — the operator's board, a light panel read at arm's length in
 *    daylight: the §6 on-light tiers (the base hues are numeral-only at
 *    3.6–4.1:1, under the 4.5:1 floor the board owes) and no footage halo,
 *    which reads as grime on white.
 *  - `plate` — the broadcast lower-third's own solid white plate: on-light hues
 *    inside it, while the rows outside it (name, held run, caption) stay on the
 *    bare keyed ground and keep the §7 protection halo.
 *  - `bare` — a keyed/projector surface with no chrome: the base hues read as
 *    text there, haloed.
 *
 * Pure and table-tested (`test/app/util/countdownSkin.test.ts`); the component
 * keeps the geometry (SIZES, layout) and applies what this returns.
 */

import { colors, overlayTextShadow } from 'app/theme/tokens';
import type { CountdownDisplayState } from 'app/util/timerChannel';

export type CountdownKind = CountdownDisplayState['kind'];

/** Render scale — per-variant rationale on `Countdown`'s `SIZES`. */
export type CountdownSize = 'projector' | 'control' | 'secondary' | 'hero' | 'heroSolo' | 'plate';

/** The surface a clock paints on, and so the colour contract it owes. */
export type CountdownGround = 'plate' | 'panel' | 'dark' | 'bare';

/** The state frame around the numeral, resolved for this state. */
export interface CountdownFrame {
  /** Stroke colour — the state's tier for this ground. */
  hue: string;
  /** Broken for a lane that holds a partly-spent budget (see `held`). */
  style: 'solid' | 'dashed';
  /** Top/bottom stroke width (a CSS length): the base broadcast stroke. */
  thin: string;
  /** Left/right stroke width — `thin`, or the live weight cue while counting. */
  wide: string;
  /** Horizontal padding inside the stroke. */
  px: string;
}

export interface CountdownSkin {
  ground: CountdownGround;
  numeralColor: string;
  /** Footage-protection halo on the numeral, or `none` on a light chrome. */
  numeralShadow: string;
  /** The paused run held above the break clock. */
  heldRunColor: string;
  /** The halo for the rows OUTSIDE the clock's chrome (held run, caption). */
  rowShadow: string;
  /** The one caption slot: the break allowance, else the expiry word. */
  captionColor: string;
  /** The on-deck arrow before the name (ADR 0037). */
  nextArrowColor: string;
  /** The state frame, or `null` where the surface draws none. */
  frame: CountdownFrame | null;
}

interface SurfaceSkin {
  numeral: Record<CountdownKind, string>;
  /** The caption speaks in exactly two states; off-break it holds the expiry
   * hue it will wear, since the row is only reserving its height. */
  caption: { onBreak: string; expired: string };
  heldRun: string;
  numeralShadow: string;
  rowShadow: string;
  nextArrow: string;
}

const WHITE = colors.ink.onBrand;

const SURFACES: Record<CountdownGround, SurfaceSkin> = {
  dark: {
    numeral: { idle: WHITE, running: WHITE, onBreak: WHITE, expired: WHITE },
    caption: { onBreak: WHITE, expired: colors.race.stopBright },
    // Idle/held greys step to ink.faint — ink.hi is byte-identical to void.
    heldRun: colors.ink.faint,
    numeralShadow: overlayTextShadow,
    rowShadow: overlayTextShadow,
    nextArrow: colors.race.setBright,
  },
  panel: {
    numeral: {
      idle: colors.ink.hi,
      running: colors.race.runningText,
      onBreak: colors.race.setDim,
      expired: colors.race.stopDim,
    },
    caption: { onBreak: colors.race.setText, expired: colors.race.stopDim },
    // The held run is a value the operator still has to read: full ink, not the
    // overlay's dimmed grey (2.9:1 on white).
    heldRun: colors.ink.hi,
    numeralShadow: 'none',
    rowShadow: 'none',
    nextArrow: colors.race.set,
  },
  plate: {
    numeral: {
      idle: colors.ink.hi,
      running: colors.race.running,
      onBreak: colors.race.setDim,
      expired: colors.race.stopDim,
    },
    caption: { onBreak: WHITE, expired: colors.race.stop },
    heldRun: colors.ink.low,
    numeralShadow: 'none',
    // The plate wraps the TIME only; every other row sits outside it.
    rowShadow: overlayTextShadow,
    nextArrow: colors.race.set,
  },
  bare: {
    numeral: {
      idle: colors.ink.hi,
      running: colors.race.running,
      onBreak: colors.race.set,
      expired: colors.race.stop,
    },
    caption: { onBreak: WHITE, expired: colors.race.stop },
    heldRun: colors.ink.low,
    numeralShadow: overlayTextShadow,
    rowShadow: overlayTextShadow,
    nextArrow: colors.race.set,
  },
};

/** The frame's stroke per ground: *Bright accents on the display's void, the
 * §6 on-light strokes on the operator's panel. */
const DARK_FRAME: Record<CountdownKind, string> = {
  idle: colors.race.idle,
  running: colors.race.runningBright,
  onBreak: colors.race.setBright,
  expired: colors.race.stopBright,
};

const PANEL_FRAME: Record<CountdownKind, string> = {
  idle: colors.ink.mid,
  running: colors.race.running,
  onBreak: colors.race.setDim,
  expired: colors.race.stopDim,
};

// The on-dark frame is em-scaled to the huge numeral; the sides only grow
// outward of the digits, so the ground behind them stays bare void.
const DARK_PX = { thin: '0.125em', wide: '0.5em', inset: '0.15em' } as const;

// The on-panel frames' px geometry, per scale. `box` is the constant horizontal
// footprint — each state's stroke plus its padding — so widening the sides on a
// counting clock cannot move the card's transport a pixel (rubric C14). Fixed
// px, not the em of the onDark variant: these numerals clamp with the viewport
// and a hairline frame at the small end would vanish. `secondary` scales the
// weight with the numeral so the half-size clock keeps the same stroke:digit
// ratio.
const PANEL_PX = {
  control: { thin: 2, wide: 10, box: 14 },
  secondary: { thin: 2, wide: 6, box: 9 },
} as const;

/**
 * Which surface this clock paints on. The plate is its own broadcast chrome and
 * outranks `onDark`; the two contained scales are the operator's panel.
 */
export const countdownGround = (size: CountdownSize, onDark: boolean): CountdownGround =>
  size === 'plate'
    ? 'plate'
    : onDark
      ? 'dark'
      : size === 'control' || size === 'secondary'
        ? 'panel'
        : 'bare';

const frameOf = (
  ground: CountdownGround,
  size: CountdownSize,
  kind: CountdownKind,
  held: boolean,
): CountdownFrame | null => {
  // The tiers separate by LUMINANCE and WEIGHT, not hue: at venue distance
  // colour discrimination collapses (base teal #13A89E and idle grey #8A939D
  // are 0.31 vs 0.29 in luminance and read alike from far). So a COUNTING
  // clock widens its LEFT/RIGHT strokes — a shape cue that survives distance —
  // while top/bottom keep the thin stroke and nothing is painted near the name
  // row above (a glow was tried and rejected: it bled into the name).
  const lit = kind === 'running' || kind === 'onBreak';
  switch (ground) {
    // The white plate IS the chrome, and a keyed surface carries none: on both,
    // the state rides the numeral instead.
    case 'plate':
    case 'bare':
      return null;
    case 'dark':
      return {
        hue: DARK_FRAME[kind],
        // `held` is a control-variant distinction — the display has no armed
        // budget to spend.
        style: 'solid',
        thin: DARK_PX.thin,
        wide: lit ? DARK_PX.wide : DARK_PX.thin,
        px: DARK_PX.inset,
      };
    case 'panel': {
      const geometry = PANEL_PX[size === 'secondary' ? 'secondary' : 'control'];
      const side = lit ? geometry.wide : geometry.thin;
      return {
        hue: PANEL_FRAME[kind],
        // A lane that ran holds a partly-spent budget: same idle stroke,
        // broken — the non-colour cue that it is not armed (§6, WCAG 1.4.1).
        style: held ? 'dashed' : 'solid',
        thin: `${geometry.thin}px`,
        wide: `${side}px`,
        px: `${geometry.box - side}px`,
      };
    }
  }
};

export const countdownSkin = ({
  size,
  onDark,
  kind,
  held,
}: {
  size: CountdownSize;
  onDark: boolean;
  kind: CountdownKind;
  /** The owner holds a partly-spent budget: this clock is idle because a turn
   * was taken off it, not because it is armed (§6, audit S02). */
  held: boolean;
}): CountdownSkin => {
  const ground = countdownGround(size, onDark);
  const surface = SURFACES[ground];
  return {
    ground,
    numeralColor: surface.numeral[kind],
    numeralShadow: surface.numeralShadow,
    heldRunColor: surface.heldRun,
    rowShadow: surface.rowShadow,
    captionColor: kind === 'onBreak' ? surface.caption.onBreak : surface.caption.expired,
    nextArrowColor: surface.nextArrow,
    frame: frameOf(ground, size, kind, held),
  };
};
