/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlayoffBracket } from 'app/pages/Admin/PlayoffBracket';
import { STREAM_INSET_X_PX } from 'app/pages/Stream/StreamLayout';
import type { Athlete, Match } from 'app/types';
import { colors, overlayArt, OVERLAY_TYPE_FLOOR_PX } from 'app/theme/tokens';

/** Resolve a hex token to the `rgb(...)` form jsdom reports for a color. */
const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const athlete = (id: string, first: string, last: string): Athlete => ({
  athleteId: id,
  compId: 'c1',
  name: `${first} ${last}`,
  firstName: first,
  lastName: last,
  birthDate: '1990-01-01',
  country: 'CHE',
  gender: 'male',
});

const finalMatch = (over: Partial<Match> = {}): Match => ({
  matchId: 'f1',
  compId: 'c1',
  discipline: 'speed',
  round: 'final',
  roundName: 'Final',
  gender: 'male',
  position: 1,
  athlete1Id: 'a1',
  athlete2Id: 'a2',
  ...over,
});

const byId = (as: Athlete[]) => (id?: string) => as.find((a) => a.athleteId === id);

describe('PlayoffBracket champion green ring', () => {
  const athletes = [athlete('a1', 'Jane', 'Doe'), athlete('a2', 'John', 'Roe')];

  for (const variant of ['profile', 'name'] as const) {
    describe(`${variant} variant`, () => {
      it('carries no green ring while the final is undecided (TBD champion)', () => {
        render(
          <PlayoffBracket
            variant={variant}
            matches={[finalMatch({ winnerId: undefined })]}
            athleteById={byId(athletes)}
          />,
        );
        const slot = screen.getByTestId('slot-winner');
        // The name variant puts the testid on the Plate itself; the profile
        // variant wraps the AthleteCard's Plate — either way the ring is the
        // Plate's boxShadow.
        const plate = variant === 'name' ? slot : (slot.firstElementChild as HTMLElement);
        expect(window.getComputedStyle(plate).boxShadow).toBe('none');
      });

      it('marks the champion race.go green once a final winnerId exists', () => {
        render(
          <PlayoffBracket
            variant={variant}
            matches={[finalMatch({ winnerId: 'a1' })]}
            athleteById={byId(athletes)}
          />,
        );
        const slot = screen.getByTestId('slot-winner');
        const plate = variant === 'name' ? slot : (slot.firstElementChild as HTMLElement);
        const style = window.getComputedStyle(plate);
        if (variant === 'name') {
          // Name plates: white border kept, a flat 3px green ring laid inside it.
          const shadow = style.boxShadow.toLowerCase();
          expect(shadow).not.toBe('none');
          expect(shadow).toContain(colors.race.go.toLowerCase());
        } else {
          // Profile boxes: the edge itself recolors green at the same width as the
          // white edges (flat — no widening ring), so it never outweighs its
          // neighbours on the small quarter/semi boxes.
          expect(style.boxShadow).toBe('none');
          expect(style.borderTopColor).toBe(rgb(colors.race.go));
          // Green edge width equals the shared white edge width (not doubled).
          expect(style.borderTopWidth).toBe(overlayArt.strokeWidth);
        }
      });
    });
  }

  it('accents a name-plate winner in goDim, not race.go (contrast on the white fill)', () => {
    // `race.go` is the EDGE colour and only ~2.3:1 as ink on the solid white
    // plate; the given name takes the dimmed green, the same call AthleteCard
    // already makes. The plate's inset ring stays race.go (asserted above).
    render(
      <PlayoffBracket
        variant="name"
        matches={[finalMatch({ winnerId: 'a1' })]}
        athleteById={byId(athletes)}
      />,
    );
    const given = within(screen.getByTestId('slot-box_final_l')).getByText('Jane');
    expect(window.getComputedStyle(given).color).toBe(rgb(colors.race.goDim));
  });

  it('keeps per-match advancing-slot greens (final winner’s own box) untouched', () => {
    // The advancing finalist box (box_final_l) still lights green off
    // resolveBracketSlots even though the champion box is now gated.
    render(
      <PlayoffBracket
        variant="name"
        matches={[finalMatch({ winnerId: 'a1' })]}
        athleteById={byId(athletes)}
      />,
    );
    const winnerSlot = within(screen.getByTestId('slot-box_final_l'));
    expect(winnerSlot.getByText('Jane')).toBeInTheDocument();
  });
});

/** The emotion-injected rules for the current render — `cqh` sizes never reach
 *  `getComputedStyle` in jsdom (no container-query engine), so the declaration
 *  itself is what a container-sized metric can be pinned by. */
const injectedCss = () =>
  [...document.querySelectorAll('style')].map((s) => s.textContent).join('');

describe('NameBracket plate type scale', () => {
  const athletes = [athlete('a1', 'Jane', 'Doe'), athlete('a2', 'John', 'Roe')];

  it('sizes the plate name off the plate box, not a device-px clamp', () => {
    render(<PlayoffBracket variant="name" matches={[finalMatch()]} athleteById={byId(athletes)} />);
    const css = injectedCss();
    // Each plate is its OWN size container, so 55cqh is 55% of the bar height —
    // the ranking plates' cap ratio, and resolution-independent (a 4K capture
    // scales, where the old clamp() kept a 24px cap).
    // The canvas has always been a size container; each PLATE becoming one is
    // the change, so a single declaration is not enough to pin it.
    expect(css.match(/container-type:size/g)?.length ?? 0).toBeGreaterThan(1);
    expect(css).toContain('font-size:55cqh');
    expect(css).not.toContain('clamp(10px');
  });

  it('shrinks a long name to fit the plate instead of clipping it mid-letter', () => {
    const long = athlete('a1', 'Maximilian', 'Von Hohenzollern-Sigmaringen');
    render(
      <PlayoffBracket
        variant="name"
        matches={[finalMatch()]}
        athleteById={byId([long, athletes[1]])}
      />,
    );
    const plate = screen.getByTestId('slot-box_final_l');
    // The measured wrapper is the shrink-to-fit seam (`useFitToWidth`); jsdom
    // does no layout so the fit stays 1, but the transform must be wired.
    const fitted = within(plate).getByTestId('name-plate-fit');
    expect(window.getComputedStyle(fitted).transform).toContain('scale(');
    expect(within(fitted).getByText('Von Hohenzollern-Sigmaringen')).toBeInTheDocument();
  });

  it('leaves no device-px clamp in the bracket source', () => {
    // The whole point of the item: NameBracket was the last plate family sized
    // in px clamps, so it alone stopped scaling with the capture frame.
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/pages/Admin/PlayoffBracket.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/clamp\(\s*[\d.]+px/);
  });
});

describe('PlayoffBracket type floor (keyed to the canvas, not the viewport)', () => {
  /** The bracket canvas width when the overlay is captured at 1920x1080: the
   *  title-safe content box, which the 16:9 canvas exactly fills. */
  const CAPTURE_CANVAS_W = 1920 - 2 * STREAM_INSET_X_PX;

  /** jsdom lays nothing out: hand the canvas a measured width (the hook reads
   *  `clientWidth` once ResizeObserver exists) and read back the floor it sets. */
  const floorAt = (canvasWidth: number): number => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      value: canvasWidth,
      configurable: true,
    });
    render(<PlayoffBracket matches={[]} athleteById={() => undefined} />);
    const canvas = screen.getByTestId('playoff-bracket');
    return parseFloat(canvas.style.getPropertyValue('--overlay-type-floor'));
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('lands on the full broadcast floor at the capture canvas (on-air unchanged)', () => {
    expect(floorAt(CAPTURE_CANVAS_W)).toBeCloseTo(OVERLAY_TYPE_FLOOR_PX, 1);
  });

  it('scales the floor down with the smaller /admin/matches preview canvas', () => {
    // `Container maxWidth="lg"` caps that canvas at ~1152px at EVERY window
    // width, so a viewport-keyed floor handed a 1080p-tall admin window the full
    // 20px and the ~2:1 quarter-card size spread the broadcast never shows.
    const admin = floorAt(1152);
    expect(admin).toBeLessThan(OVERLAY_TYPE_FLOOR_PX);
    expect(admin).toBeCloseTo((OVERLAY_TYPE_FLOOR_PX * 1152) / CAPTURE_CANVAS_W, 1);
  });
});
