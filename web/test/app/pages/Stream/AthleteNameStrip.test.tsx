import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Athlete } from 'app/types';
import { AthleteNameStrip, STRIP_HEIGHT } from 'app/pages/Stream/AthleteNameStrip';
import { colors } from 'app/theme/tokens';

/** Resolve a hex token to the `rgb(...)` form jsdom reports for `color`. */
const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const athlete = (over: Partial<Athlete> = {}): Athlete => ({
  athleteId: 'a1',
  compId: 'c1',
  name: 'Amanda Montminy',
  firstName: 'Amanda',
  lastName: 'Montminy',
  birthDate: '1990-01-01',
  country: 'USA',
  gender: 'female',
  ...over,
});

describe('AthleteNameStrip (LAAX name lower-third)', () => {
  it('splits the name into a bold given name beside a light family name', () => {
    render(<AthleteNameStrip athlete={athlete()} />);

    const first = screen.getByText('Amanda');
    const last = screen.getByText('Montminy');
    expect(window.getComputedStyle(first).fontWeight).toBe('700');
    expect(window.getComputedStyle(last).fontWeight).toBe('300');
  });

  it('renders the name in the overlay name-ink colour (first-class overlay token)', () => {
    render(<AthleteNameStrip athlete={athlete()} />);
    // The colour sits on the AthleteName wrapper (the spans inherit it); that
    // wrapper is the parent of the bold given-name span.
    const nameBox = screen.getByText('Amanda').parentElement as HTMLElement;
    expect(window.getComputedStyle(nameBox).color).toBe(rgb(colors.overlay.nameInk));
  });

  it('renders the country flag at the left (no photo)', () => {
    render(<AthleteNameStrip athlete={athlete({ country: 'CAN' })} />);
    // The inline flag-icons flag keys on the normalized alpha-2 code (CAN → ca)
    // and labels itself with the raw code.
    const block = screen.getByTestId('name-strip-flag-block');
    const flag = within(block).getByRole('img', { name: 'CAN' });
    expect(flag).toHaveClass('fi-ca');
    // It is a name lower-third — no portrait photo element.
    expect(screen.queryByTestId('athlete-card-photo')).not.toBeInTheDocument();
  });

  it('renders a dual-nationality second flag', () => {
    render(<AthleteNameStrip athlete={athlete({ country: 'CAN', country2: 'FRA' })} />);
    const block = screen.getByTestId('name-strip-flag-block');
    expect(within(block).getAllByRole('img')).toHaveLength(2);
  });

  it('renders the flag with the inline flag-icons treatment (not the wide card-foot art)', () => {
    // The strip shares the bracket name plates' inline flag renderer (`FlagRow
    // variant="inline"`), NOT the stretched wide card-foot art (`WideFlag`) that
    // distorts in this block. The inline flag is height-sized to a substantial
    // share of the strip (well above the tiny default) yet fits inside it.
    render(<AthleteNameStrip athlete={athlete()} />);
    const block = screen.getByTestId('name-strip-flag-block');
    const flag = within(block).getByRole('img', { name: 'USA' });
    expect(flag).toHaveClass('fi');
    // The ref draws the flag at the FULL strip height, flush left — not a small
    // inset badge; assert it fills the strip vertically.
    const heightPx = parseFloat(window.getComputedStyle(flag).height);
    expect(heightPx).toBe(STRIP_HEIGHT);
  });

  it('sizes the name so its em box fits inside the strip (caps centred, never sheared)', () => {
    render(<AthleteNameStrip athlete={athlete()} />);
    const nameBox = screen.getByText('Amanda').parentElement as HTMLElement;
    const fontSizePx = parseFloat(window.getComputedStyle(nameBox).fontSize);
    // The LAAX ref (Names_amanda_montminy_onDark.png) sets cap-height at ~0.63 of
    // the strip, centred with margin — the caps do NOT fill the plate. With the
    // display face's ~0.72 cap-height ratio that lands the font UNDER the strip
    // height, so the whole em box fits and a single centred line can never
    // overflow the 92px overflow:hidden plate vertically (the frame-clip bug the
    // old 1.25× em overshoot caused). Still large and legible beside the flag —
    // not the old small fixed 3.4rem (~54px).
    expect(fontSizePx).toBeLessThanOrEqual(STRIP_HEIGHT);
    expect(fontSizePx).toBeGreaterThanOrEqual(STRIP_HEIGHT * 0.7);
  });

  it('leaves a short name at full size (no downscale)', () => {
    // jsdom reports 0 for both widths (no layout), so the fit stays 1.
    render(<AthleteNameStrip athlete={athlete()} />);
    expect(window.getComputedStyle(screen.getByTestId('name-strip-fit')).transform).toBe(
      'scale(1)',
    );
  });

  it('shrinks a long name to fit the fixed-width strip instead of clipping', () => {
    // jsdom has no layout — simulate a name whose natural width (600) overflows
    // the slot (300); the fit box should scale to 300/600 = 0.5.
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
    try {
      render(
        <AthleteNameStrip
          athlete={athlete({ firstName: 'Maximiliana', lastName: 'Vandenberghe' })}
        />,
      );
      expect(window.getComputedStyle(screen.getByTestId('name-strip-fit')).transform).toBe(
        'scale(0.5)',
      );
    } finally {
      clientWidth.mockRestore();
      scrollWidth.mockRestore();
    }
  });

  it('renders an optional result numeral in the monospace face', () => {
    render(<AthleteNameStrip athlete={athlete()} result="1:23.45" />);
    const result = window.getComputedStyle(screen.getByText('1:23.45'));
    expect(result.fontFamily).toContain('JetBrains Mono');
  });

  it('omits the result when none is given (pure identity)', () => {
    render(<AthleteNameStrip athlete={athlete()} />);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});
