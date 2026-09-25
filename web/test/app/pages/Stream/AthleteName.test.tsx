import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Athlete } from 'app/types';
import { AthleteName } from 'app/pages/Stream/AthleteName';
import { colors, fonts } from 'app/theme/tokens';

/** Resolve a hex token to the `rgb(...)` form jsdom reports for `color`. */
const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const person: Pick<Athlete, 'firstName' | 'lastName'> = {
  firstName: 'Amanda',
  lastName: 'Montminy',
};

describe('AthleteName (the LAAX bold-first / light-last split)', () => {
  // Regression fence. The `cqh` branch declared no `fontFamily`, so MUI's
  // `theme.typography.body1` won and both names rendered in `fonts.body` (Saira)
  // instead of the condensed display face — invisible to every weight/colour
  // assertion above, and it also silently voided the 300, which Saira omits.
  // `fixed` was already safe (`fontFamily: 'inherit'`); pin both so neither drifts.
  it.each(['fixed', 'cqh'] as const)('renders %s mode in the display face', (sizing) => {
    render(
      <div style={{ fontFamily: fonts.display }}>
        <AthleteName athlete={person} sizing={sizing} />
      </div>,
    );
    for (const part of ['Amanda', 'Montminy']) {
      expect(window.getComputedStyle(screen.getByText(part)).fontFamily).toContain('Oswald');
    }
  });

  it('splits into a bold given name over a light family name in both sizing modes', () => {
    // 700, not 800: Oswald ships no 800, so an 800 declaration would silently
    // resolve to the 700 face — pin the weight that actually exists.
    const { unmount } = render(<AthleteName athlete={person} />);
    expect(window.getComputedStyle(screen.getByText('Amanda')).fontWeight).toBe('700');
    expect(window.getComputedStyle(screen.getByText('Montminy')).fontWeight).toBe('300');
    unmount();

    render(<AthleteName athlete={person} sizing="cqh" />);
    expect(window.getComputedStyle(screen.getByText('Amanda')).fontWeight).toBe('700');
    expect(window.getComputedStyle(screen.getByText('Montminy')).fontWeight).toBe('300');
  });

  it('fixed sizing (default) does not clamp the name to the body1 rem — it inherits the caller size', () => {
    render(<AthleteName athlete={person} />);
    // The spans declare `font-size: inherit` so the caller's fontSize + the
    // wrapper's display face flow through. A default body1 span would impose its
    // fixed `rem` size in the body font — the name-strip "tiny name" bug. jsdom
    // leaves the unresolved `inherit` as its 'medium' initial, so assert the RULE
    // (no imposed rem, no cqh) rather than a resolved px value.
    const given = window.getComputedStyle(screen.getByText('Amanda'));
    expect(given.fontSize).not.toMatch(/rem$/);
    expect(given.fontSize).not.toContain('cqh');
  });

  it('cqh sizing defaults to the AthleteCard cap-height ratio (34cqh over 27.2cqh)', () => {
    render(<AthleteName athlete={person} sizing="cqh" />);
    expect(window.getComputedStyle(screen.getByText('Amanda')).fontSize).toBe('34cqh');
    expect(window.getComputedStyle(screen.getByText('Montminy')).fontSize).toBe('27.2cqh');
  });

  it('cqh sizing leaves accent headroom (line-height ≥ 1) so uppercase diacritics are not clipped', () => {
    // The smallest profile card clipped uppercase accents (É) with the former
    // 0.95/1 line-height under an overflow:hidden band (overlay-typography-polish).
    render(<AthleteName athlete={person} sizing="cqh" />);
    expect(window.getComputedStyle(screen.getByText('Amanda')).lineHeight).toBe('1.1');
    expect(window.getComputedStyle(screen.getByText('Montminy')).lineHeight).toBe('1.1');
  });

  it('accent recolours only the bold given name, leaving the family name on the base ink', () => {
    render(<AthleteName athlete={person} sizing="cqh" accent={colors.race.go} />);
    expect(window.getComputedStyle(screen.getByText('Amanda')).color).toBe(rgb(colors.race.go));
    expect(window.getComputedStyle(screen.getByText('Montminy')).color).toBe(
      rgb(colors.overlay.nameInk),
    );
  });

  it('omits the family span entirely when the athlete has no last name', () => {
    render(<AthleteName athlete={{ firstName: 'Prince', lastName: '' }} sizing="cqh" />);
    expect(screen.getByText('Prince')).toBeInTheDocument();
    // The bold given name is the only text node — no empty light span rides along.
    expect(screen.getAllByText(/\w/)).toHaveLength(1);
  });
});
