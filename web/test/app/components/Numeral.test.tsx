import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Numeral } from 'app/components/Numeral';

describe('Numeral (monospace tabular figures)', () => {
  it('sets the monospace numeral face with tabular-nums', () => {
    render(<Numeral testId="n">1:23.45</Numeral>);
    const computed = window.getComputedStyle(screen.getByTestId('n'));
    expect(computed.fontFamily).toContain('JetBrains Mono');
    expect(computed.fontVariantNumeric).toBe('tabular-nums');
  });

  it('forwards the bounded typographic props (color, weight, size)', () => {
    render(
      <Numeral testId="n" color="#f04e34" fontWeight={800} fontSize="42px">
        7
      </Numeral>,
    );
    const computed = window.getComputedStyle(screen.getByTestId('n'));
    expect(computed.color).toBe('rgb(240, 78, 52)');
    expect(computed.fontWeight).toBe('800');
    expect(computed.fontSize).toBe('42px');
  });

  it('renders the requested element via component', () => {
    render(
      <Numeral testId="n" component="div">
        9
      </Numeral>,
    );
    expect(screen.getByTestId('n').tagName).toBe('DIV');
  });
});
