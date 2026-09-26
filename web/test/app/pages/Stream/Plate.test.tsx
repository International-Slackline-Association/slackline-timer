import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Plate } from 'app/pages/Stream/Plate';
import { colors, overlayArt } from 'app/theme/tokens';

const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('Plate', () => {
  it('fills and strokes with the overlay tokens by default', () => {
    render(
      <Plate data-testid="p" fill={colors.overlay.plateFilled}>
        hi
      </Plate>,
    );
    const style = window.getComputedStyle(screen.getByTestId('p'));
    expect(style.backgroundColor).toBe('rgb(255, 255, 255)'); // plateFilled
    expect(style.borderTopWidth).toBe(overlayArt.strokeWidth); // 6px
    expect(style.borderTopColor).toBe(rgb(colors.overlay.stroke)); // white
    expect(style.boxShadow).toBe('none');
  });

  it('omits the border when not bordered (fill-only strip)', () => {
    render(<Plate data-testid="p" bordered={false} fill={colors.overlay.plateFilled} />);
    expect(window.getComputedStyle(screen.getByTestId('p')).borderStyle).not.toBe('solid');
  });

  it('recolors the edge green and adds an outset ring for a winner', () => {
    render(<Plate data-testid="p" winner strokeWidth="9px" />);
    const style = window.getComputedStyle(screen.getByTestId('p'));
    expect(style.borderTopColor).toBe(rgb(colors.race.go));
    expect(style.boxShadow).toContain('9px');
    expect(style.boxShadow).not.toContain('inset');
  });

  it('keeps the white edge and lays a 3px inset ring for an inset winner', () => {
    render(<Plate data-testid="p" winner ring="inset" strokeWidth="5px" />);
    const style = window.getComputedStyle(screen.getByTestId('p'));
    expect(style.borderTopColor).toBe(rgb(colors.overlay.stroke)); // stays white
    expect(style.boxShadow).toContain('inset');
    expect(style.boxShadow).toContain('3px');
  });

  it('recolors the edge green with no ring for a flat winner', () => {
    render(<Plate data-testid="p" winner ring="flat" strokeWidth="6px" />);
    const style = window.getComputedStyle(screen.getByTestId('p'));
    // Green edge at the SAME width as the white edge — no widening ring, so the
    // champion never outweighs its white-edged neighbours (the dense bracket).
    expect(style.borderTopColor).toBe(rgb(colors.race.go));
    expect(style.borderTopWidth).toBe('6px');
    expect(style.boxShadow).toBe('none');
  });
});
