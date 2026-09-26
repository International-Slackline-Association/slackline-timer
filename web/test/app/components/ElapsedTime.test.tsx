import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ElapsedTime } from 'app/components/ElapsedTime';
import { DNF_SENTINEL } from 'app/util/time';

describe('ElapsedTime', () => {
  it('renders the race face (M:SS.hh) by default in the numeral font', () => {
    render(<ElapsedTime ms={83_450} testId="t" />);
    const el = screen.getByTestId('t');
    expect(el).toHaveTextContent('1:23.45');
    expect(window.getComputedStyle(el).fontFamily).toContain('JetBrains Mono');
  });

  it('is DNF-aware in the race face (the sentinel renders DNF)', () => {
    render(<ElapsedTime ms={DNF_SENTINEL} testId="t" />);
    expect(screen.getByTestId('t')).toHaveTextContent('DNF');
  });

  it('renders the clock face (mm:ss) when asked, clamping negatives', () => {
    const { rerender } = render(<ElapsedTime ms={90_000} format="clock" testId="t" />);
    expect(screen.getByTestId('t')).toHaveTextContent('01:30');
    rerender(<ElapsedTime ms={-1_000} format="clock" testId="t" />);
    expect(screen.getByTestId('t')).toHaveTextContent('00:00');
  });

  it('treats null/undefined as zero in the clock face', () => {
    render(<ElapsedTime ms={null} format="clock" testId="t" />);
    expect(screen.getByTestId('t')).toHaveTextContent('00:00');
  });
});
