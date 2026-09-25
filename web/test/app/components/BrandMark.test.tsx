import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandMark, MARK_PATHS } from 'app/components/BrandMark';
import { colors } from 'app/theme/tokens';

// import.meta.url is served over http under Vite, so resolve off the vitest root.
const favicon = () => readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8');

describe('BrandMark', () => {
  it('names itself for assistive tech only when given a title', () => {
    const { rerender } = render(<BrandMark title="Slackline Timer" />);
    expect(screen.getByRole('img', { name: 'Slackline Timer' })).toBeInTheDocument();

    // Untitled uses sit beside a text wordmark, so the mark must not be announced.
    rerender(<BrandMark />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('paints each variant from the design tokens', () => {
    const massOf = (container: HTMLElement) =>
      container.querySelector(`path[d="${MARK_PATHS.rock}"]`)?.getAttribute('fill');
    // The span is an outlined polygon, so its colour is a fill, not a stroke.
    const accentOf = (container: HTMLElement) =>
      container.querySelector(`path[d="${MARK_PATHS.span}"]`)?.getAttribute('fill');

    const brand = render(<BrandMark variant="brand" />).container;
    expect(massOf(brand)).toBe(colors.ink.hi);
    expect(accentOf(brand)).toBe(colors.brand.teal);

    const inverted = render(<BrandMark variant="inverted" />).container;
    expect(massOf(inverted)).toBe(colors.ink.onBrand);
    expect(accentOf(inverted)).toBe(colors.race.runningBright);

    // Broadcast overlays composite over live video: one flat white, no accent.
    const mono = render(<BrandMark variant="mono" />).container;
    expect(massOf(mono)).toBe(colors.ink.onBrand);
    expect(accentOf(mono)).toBe(colors.ink.onBrand);
  });

  it('draws the span before the masses so they clip it flush at both corners', () => {
    // Ordering is the whole reason the line meets the rock without a gap and lands
    // on the block without lying over it — see the note on BrandMark.
    const { container } = render(<BrandMark />);
    const drawn = [...container.querySelectorAll('path[d]')].map((n) => n.getAttribute('d'));
    expect(drawn.indexOf(MARK_PATHS.span)).toBeLessThan(drawn.indexOf(MARK_PATHS.rock));
    expect(drawn.indexOf(MARK_PATHS.span)).toBeLessThan(drawn.indexOf(MARK_PATHS.block));
  });

  it('keeps public/favicon.svg on the same geometry', () => {
    // The favicon cannot import from the bundle, so its paths are a copy. This is
    // the guard that stops the two drifting.
    const svg = favicon();
    for (const d of Object.values(MARK_PATHS)) {
      expect(svg).toContain(`d="${d}"`);
    }
  });
});
