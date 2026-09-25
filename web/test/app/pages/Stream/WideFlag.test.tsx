import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WideFlag } from 'app/pages/Stream/flags/WideFlag';
import { FLAG_EDGE_COLORS } from 'app/pages/Stream/flags/flagEdgeColors';
import {
  DELIVERED_WIDE_FLAGS,
  REBUILT_WIDE_FLAGS,
  VENDOR_EMBLEMS,
  wideFlagTier,
} from 'app/pages/Stream/flags/wide';

/** Resolve a hex to the `rgb(...)` form jsdom reports for background-color. */
const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('WideFlag', () => {
  it('renders the delivered card art (inline SVG) for a covered nation', () => {
    render(<WideFlag athlete={{ country: 'fr' }} itemTestId="flag" />);
    const block = screen.getByTestId('flag');
    expect(block).toHaveAttribute('aria-label', 'fr');
    // The bespoke art is embedded as a stretched inline SVG, not a flag-icons bg.
    expect(block.querySelector('svg')).not.toBeNull();
    expect(block.className).not.toContain('fi-');
  });

  it('renders bespoke art for Mexico (emblem downsampled, not the 1.2 MB master)', () => {
    render(<WideFlag athlete={{ country: 'mx' }} itemTestId="flag" />);
    const block = screen.getByTestId('flag');
    expect(block).toHaveAttribute('aria-label', 'mx');
    expect(block.querySelector('svg')).not.toBeNull();
    expect(block.className).not.toContain('fi-');
  });

  it('keeps every bespoke art entry small enough to inline — crests excepted', () => {
    // Guards the extractor's raster path: an emblem-heavy master (Mexico's
    // photographic coat of arms is ~1.2 MB of traced rects) must be downsampled,
    // never inlined wholesale into the bundle.
    //
    // A CREST is the deliberate exception: a nation's coat of arms is its identity
    // on air, so those entries carry the real vector artwork at full resolution
    // (`wide/emblems.ts`) and are allowed past the ceiling. Everything else —
    // stripes, cantons, constructed geometry — has no excuse to be large.
    for (const [iso, art] of Object.entries({ ...DELIVERED_WIDE_FLAGS, ...REBUILT_WIDE_FLAGS })) {
      expect(art.startsWith('<svg'), iso).toBe(true);
      if (iso in VENDOR_EMBLEMS) continue;
      expect(art.length, iso).toBeLessThan(32 * 1024);
    }
  });

  it('renders the rebuilt art for a nation the designer never delivered', () => {
    // `gb` must be the Union Jack, never the England cross — the only reason the
    // rebuilt tier carries a nation flag-icons could otherwise letterbox.
    render(<WideFlag athlete={{ country: 'gb' }} itemTestId="flag" />);
    const block = screen.getByTestId('flag');
    expect(block).toHaveAttribute('aria-label', 'gb');
    expect(block.querySelector('svg')).not.toBeNull();
    expect(block.className).not.toContain('fi-');
    // …and the saltire rides as an undistorted medallion. Stretching the whole
    // flag across the band flattens its diagonals into near-horizontal streaks.
    expect(REBUILT_WIDE_FLAGS.gb).toContain(
      'viewBox="0 0 60 30" preserveAspectRatio="xMidYMid meet"',
    );
  });

  it('draws every rebuilt band in the band rectangle, never a flag rectangle', () => {
    // The rule the delivered masters follow without stating it: the FIELD takes
    // the band's stretch, the DEVICE never does. Reaching for a flag's own
    // viewBox breaks it — `gb` shipped in `0 0 60 30`, squashed 4.6x. A device
    // that must stay true rides in a nested <svg> that opts back out of the
    // outer `preserveAspectRatio="none"` (see `emblem` in rebuilt.ts).
    for (const [iso, art] of Object.entries(REBUILT_WIDE_FLAGS)) {
      expect(art, iso).toContain('viewBox="0 0 150 16.3"');
      const inner = art.slice(art.indexOf('>') + 1);
      if (inner.includes('<svg')) {
        expect(inner, iso).toContain('preserveAspectRatio="xMidYMid meet"');
      }
    }
  });

  it('composes each real crest into its rebuilt band', () => {
    // The crests are generated out of the vendored flag-icons flags by
    // `internals/extractVendorEmblems.mjs` — a broken import or a stale
    // re-generation would silently leave the nation as bare stripes.
    for (const [iso, { art }] of Object.entries(VENDOR_EMBLEMS)) {
      expect(art.length, iso).toBeGreaterThan(1000);
      expect(REBUILT_WIDE_FLAGS[iso], iso).toContain(art);
    }
  });

  it('keeps the two tiers disjoint, and resolves delivered first', () => {
    // A nation the designer later delivers must have its rebuilt stand-in retired,
    // or the weaker art lingers behind art nobody can see. `wideFlagArt` already
    // prefers delivered, so this guards the bookkeeping, not the precedence.
    for (const iso of Object.keys(REBUILT_WIDE_FLAGS)) {
      expect(DELIVERED_WIDE_FLAGS[iso], iso).toBeUndefined();
      expect(wideFlagTier(iso), iso).toBe('rebuilt');
    }
    for (const iso of Object.keys(DELIVERED_WIDE_FLAGS)) {
      expect(wideFlagTier(iso), iso).toBe('delivered');
    }
    expect(wideFlagTier('pt')).toBeUndefined();
  });

  it('falls back to a contained flag-icons flag on its edge colour for an uncovered nation', () => {
    render(<WideFlag athlete={{ country: 'pt' }} itemTestId="flag" />);
    const block = screen.getByTestId('flag');
    // No bespoke art → the block is painted the flag's edge colour…
    expect(window.getComputedStyle(block).backgroundColor).toBe(rgb(FLAG_EDGE_COLORS.pt));
    // …and holds the real flag-icons flag rendered `contain` (undistorted).
    const flag = block.querySelector('.fi') as HTMLElement;
    expect(flag).not.toBeNull();
    expect(flag.className).toContain('fi-pt');
    expect(window.getComputedStyle(flag).backgroundSize).toBe('contain');
  });

  it('defaults the gap fill to the plate white when the edge colour is unmapped', () => {
    // `pe` is a valid flag with neither bespoke art nor an edge-colour entry.
    render(<WideFlag athlete={{ country: 'pe' }} itemTestId="flag" />);
    expect(window.getComputedStyle(screen.getByTestId('flag')).backgroundColor).toBe(
      'rgb(255, 255, 255)',
    );
  });

  it('abuts two blocks for a dual-nationality athlete', () => {
    render(<WideFlag athlete={{ country: 'fr', country2: 'mx' }} itemTestId="flag" />);
    expect(screen.getAllByTestId('flag')).toHaveLength(2);
  });

  it('renders nothing for an entirely unknown code', () => {
    const { container } = render(<WideFlag athlete={{ country: 'ZZZ' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
