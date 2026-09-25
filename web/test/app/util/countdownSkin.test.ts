import { describe, expect, it } from 'vitest';

import { colors, overlayTextShadow } from 'app/theme/tokens';
import {
  countdownSkin,
  type CountdownGround,
  type CountdownKind,
  type CountdownSize,
} from 'app/util/countdownSkin';

const WHITE = colors.ink.onBrand;

/** The skin of a ground, via a size that selects it. */
const skinOn = (ground: CountdownGround, kind: CountdownKind) => {
  const size: CountdownSize =
    ground === 'plate' ? 'plate' : ground === 'panel' ? 'control' : 'projector';
  return countdownSkin({ size, onDark: ground === 'dark', kind, held: false });
};

// Ground selection: which surface a clock paints on, from the two props that
// decide it. The plate is its own broadcast chrome and outranks `onDark`; the
// operator's panel is the two contained scales.
describe('countdownSkin ground', () => {
  const GROUNDS: [CountdownSize, boolean, CountdownGround][] = [
    ['plate', false, 'plate'],
    ['control', false, 'panel'],
    ['secondary', false, 'panel'],
    ['projector', false, 'bare'],
    ['projector', true, 'dark'],
    ['hero', true, 'dark'],
    ['heroSolo', true, 'dark'],
  ];

  it.each(GROUNDS)('%s (onDark=%s) paints on the %s ground', (size, onDark, ground) => {
    expect(countdownSkin({ size, onDark, kind: 'idle', held: false }).ground).toBe(ground);
  });
});

// FREESTYLE_BOARD_UX §6 "On-light digit tiers" + the DESIGN_SYSTEM §2 hues,
// one row per (surface × state). On dark the numeral NEVER carries the state
// hue — it stays white at 11:1 and the state rides the frame below.
describe('countdownSkin numerals', () => {
  const NUMERALS: [CountdownGround, CountdownKind, string][] = [
    ['panel', 'idle', colors.ink.hi],
    ['panel', 'running', colors.race.runningText],
    ['panel', 'onBreak', colors.race.setDim],
    ['panel', 'expired', colors.race.stopDim],
    ['plate', 'idle', colors.ink.hi],
    ['plate', 'running', colors.race.running],
    ['plate', 'onBreak', colors.race.setDim],
    ['plate', 'expired', colors.race.stopDim],
    ['bare', 'idle', colors.ink.hi],
    ['bare', 'running', colors.race.running],
    ['bare', 'onBreak', colors.race.set],
    ['bare', 'expired', colors.race.stop],
    ['dark', 'idle', WHITE],
    ['dark', 'running', WHITE],
    ['dark', 'onBreak', WHITE],
    ['dark', 'expired', WHITE],
  ];

  it.each(NUMERALS)('paints a %s %s numeral %s', (ground, kind, expected) => {
    expect(skinOn(ground, kind).numeralColor).toBe(expected);
  });

  // The halo protects text over footage; on a white plate/panel it reads as
  // grime — there the plate itself is the protection.
  it.each([
    ['dark' as const, overlayTextShadow],
    ['bare' as const, overlayTextShadow],
    ['plate' as const, 'none'],
    ['panel' as const, 'none'],
  ])('halos the %s numeral with %s', (ground, shadow) => {
    expect(skinOn(ground, 'idle').numeralShadow).toBe(shadow);
  });

  // The rows OUTSIDE the clock's chrome (held run, caption): the plate variant
  // keeps them on the bare keyed ground, so only the panel drops the halo.
  it.each([
    ['dark' as const, overlayTextShadow],
    ['bare' as const, overlayTextShadow],
    ['plate' as const, overlayTextShadow],
    ['panel' as const, 'none'],
  ])('halos the %s rows with %s', (ground, shadow) => {
    expect(skinOn(ground, 'idle').rowShadow).toBe(shadow);
  });
});

// The one caption slot: the break allowance while a break runs, the owner's
// expiry word once the budget is spent.
describe('countdownSkin caption', () => {
  const CAPTIONS: [CountdownGround, CountdownKind, string][] = [
    ['panel', 'onBreak', colors.race.setText],
    ['panel', 'expired', colors.race.stopDim],
    ['dark', 'onBreak', WHITE],
    ['dark', 'expired', colors.race.stopBright],
    ['plate', 'onBreak', WHITE],
    ['plate', 'expired', colors.race.stop],
    ['bare', 'onBreak', WHITE],
    ['bare', 'expired', colors.race.stop],
  ];

  it.each(CAPTIONS)('paints the %s %s caption %s', (ground, kind, expected) => {
    expect(skinOn(ground, kind).captionColor).toBe(expected);
  });

  // Off-break the caption row is only reserving its height (hidden), so it
  // takes the expiry hue it will wear when it speaks.
  it('holds the expiry hue while the row is only reserving its height', () => {
    expect(skinOn('panel', 'idle').captionColor).toBe(colors.race.stopDim);
    expect(skinOn('panel', 'running').captionColor).toBe(colors.race.stopDim);
  });
});

// The paused run held above the break clock, and the on-deck arrow: both are
// secondary marks, so they step down a tier — but never below readable on the
// operator's panel, where the held budget is a value he has to read.
describe('countdownSkin secondary marks', () => {
  it.each([
    ['dark' as const, colors.ink.faint],
    ['panel' as const, colors.ink.hi],
    ['plate' as const, colors.ink.low],
    ['bare' as const, colors.ink.low],
  ])('paints the %s held run %s', (ground, expected) => {
    expect(skinOn(ground, 'onBreak').heldRunColor).toBe(expected);
  });

  it.each([
    ['dark' as const, colors.race.setBright],
    ['panel' as const, colors.race.set],
    ['plate' as const, colors.race.set],
    ['bare' as const, colors.race.set],
  ])('paints the %s on-deck arrow %s', (ground, expected) => {
    expect(skinOn(ground, 'idle').nextArrowColor).toBe(expected);
  });
});

// §6 "Frame tiers on the control variant" + the §2 on-dark stroke language.
// The tier is LUMINANCE and WEIGHT, not hue: a counting clock (running/break)
// widens its LEFT/RIGHT strokes only, so nothing crowds the name row above and
// the frame reads at venue distance.
describe('countdownSkin frame', () => {
  it.each([['plate' as const], ['bare' as const]])('draws no frame on the %s ground', (ground) => {
    expect(skinOn(ground, 'running').frame).toBeNull();
  });

  const FRAME_HUES: [CountdownGround, CountdownKind, string][] = [
    ['panel', 'idle', colors.ink.mid],
    ['panel', 'running', colors.race.running],
    ['panel', 'onBreak', colors.race.setDim],
    ['panel', 'expired', colors.race.stopDim],
    ['dark', 'idle', colors.race.idle],
    ['dark', 'running', colors.race.runningBright],
    ['dark', 'onBreak', colors.race.setBright],
    ['dark', 'expired', colors.race.stopBright],
  ];

  it.each(FRAME_HUES)('strokes the %s %s frame %s', (ground, kind, expected) => {
    expect(skinOn(ground, kind).frame?.hue).toBe(expected);
  });

  it.each<[CountdownKind, boolean]>([
    ['idle', false],
    ['running', true],
    ['onBreak', true],
    ['expired', false],
  ])('widens the panel %s frame sides: %s', (kind, lit) => {
    const frame = skinOn('panel', kind).frame;
    expect(frame?.thin).toBe('2px');
    expect(frame?.wide).toBe(lit ? '10px' : '2px');
    // The horizontal footprint is CONSTANT (stroke + padding = 14): widening
    // the sides on a counting clock cannot move the card's transport (C14).
    expect(frame?.px).toBe(lit ? '4px' : '12px');
  });

  // The half-scale warm-up clock keeps the same stroke:digit ratio.
  it.each<[CountdownKind, string, string]>([
    ['idle', '2px', '7px'],
    ['running', '6px', '3px'],
  ])('scales the secondary %s frame to its numeral', (kind, side, pad) => {
    const frame = countdownSkin({ size: 'secondary', onDark: false, kind, held: false }).frame;
    expect(frame?.wide).toBe(side);
    expect(frame?.px).toBe(pad);
  });

  it.each<[CountdownKind, boolean]>([
    ['idle', false],
    ['running', true],
    ['onBreak', true],
    ['expired', false],
  ])('widens the on-dark %s frame sides in em: %s', (kind, lit) => {
    const frame = skinOn('dark', kind).frame;
    expect(frame?.thin).toBe('0.125em');
    expect(frame?.wide).toBe(lit ? '0.5em' : '0.125em');
    // Fixed inset: the sides grow outward-of-the-digits only, so the ground
    // behind them stays bare void.
    expect(frame?.px).toBe('0.15em');
  });

  // A lane that ran holds a partly-spent budget: same idle stroke, BROKEN —
  // the non-colour cue that it is not armed (§6, WCAG 1.4.1).
  it('breaks the held idle frame into a dashed stroke on the panel', () => {
    const held = countdownSkin({ size: 'control', onDark: false, kind: 'idle', held: true });
    expect(held.frame).toEqual({ ...skinOn('panel', 'idle').frame, style: 'dashed' });
  });

  // Held is a control-variant distinction (the athlete display has no armed
  // budget to spend), so the on-dark frame never breaks.
  it('keeps the on-dark frame solid even when the owner passes held', () => {
    expect(
      countdownSkin({ size: 'hero', onDark: true, kind: 'idle', held: true }).frame?.style,
    ).toBe('solid');
  });
});
