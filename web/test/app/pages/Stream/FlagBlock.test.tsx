import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FlagBlock, FlagRow } from 'app/pages/Stream/FlagBlock';

describe('FlagBlock (self-sizing overlay flag)', () => {
  it('renders nothing for an unknown country code', () => {
    const { container } = render(<FlagBlock code="ZZZ" testId="flag" />);
    expect(screen.queryByTestId('flag')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('carries the flag-icons class for a known code', () => {
    render(<FlagBlock code="USA" testId="flag" />);
    expect(screen.getByTestId('flag')).toHaveClass('fi', 'fi-us');
  });

  it('overrides the imported .fi sizing with self defaults (beats the 1.3em sliver)', () => {
    // The .fi base rule sets width:1.333333em / line-height:1em / contain. The
    // block raises specificity (&& self-selector) so its own fill defaults win,
    // otherwise every overlay flag collapses to a sliver / wrong crop.
    render(<FlagBlock code="USA" testId="flag" />);
    const style = window.getComputedStyle(screen.getByTestId('flag'));
    expect(style.width).toBe('100%');
    expect(style.height).toBe('100%');
    expect(style.lineHeight).toBe('0');
    expect(style.backgroundSize).toBe('cover');
  });

  it('square mode appends the fis class and locks a 1:1 ratio', () => {
    render(<FlagBlock code="USA" testId="flag" square />);
    const flag = screen.getByTestId('flag');
    expect(flag).toHaveClass('fis');
    expect(window.getComputedStyle(flag).aspectRatio).toBe('1/1');
  });

  it('contain mode renders the native 3:2 flag, uncropped (width off height)', () => {
    // The foot strip needs the whole flag at its native ratio, not a cover crop —
    // both overrides live inside && so they beat the imported .fi background-size.
    render(<FlagBlock code="USA" testId="flag" contain />);
    const style = window.getComputedStyle(screen.getByTestId('flag'));
    expect(style.aspectRatio).toBe('3/2');
    expect(style.backgroundSize).toBe('contain');
    expect(style.width).toBe('auto');
  });

  it('lets the caller override shape via sx without losing the box defaults', () => {
    render(<FlagBlock code="USA" testId="flag" sx={{ width: '14cqh' }} />);
    const style = window.getComputedStyle(screen.getByTestId('flag'));
    // The && defaults still apply (cover/line-height); width yields to the caller.
    expect(style.backgroundSize).toBe('cover');
    expect(style.lineHeight).toBe('0');
  });
});

describe('FlagRow (unified one/two-nation flag row)', () => {
  it('block variant renders one CSS-bg block for a single nationality', () => {
    render(<FlagRow athlete={{ country: 'CAN' }} itemTestId="block" />);
    const blocks = screen.getAllByTestId('block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveClass('fi', 'fi-ca');
  });

  it('block variant renders both nationalities and forwards square', () => {
    render(<FlagRow athlete={{ country: 'CAN', country2: 'FRA' }} itemTestId="block" square />);
    const blocks = screen.getAllByTestId('block');
    expect(blocks).toHaveLength(2);
    blocks.forEach((b) => expect(b).toHaveClass('fis'));
    expect(blocks[1]).toHaveClass('fi-fr');
  });

  it('block variant drops an unknown second nationality without a stray node', () => {
    render(<FlagRow athlete={{ country: 'USA', country2: 'ZZZ' }} itemTestId="block" />);
    expect(screen.getAllByTestId('block')).toHaveLength(1);
  });

  it('inline variant renders height-sized MUI flags for one/two nations', () => {
    const { rerender } = render(
      <FlagRow athlete={{ country: 'GER' }} variant="inline" height={14} />,
    );
    let flags = screen.getAllByRole('img');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toHaveClass('fi', 'fi-de');
    expect(flags[0]).toHaveStyle({ height: '14px' });

    rerender(
      <FlagRow athlete={{ country: 'GER', country2: 'SUI' }} variant="inline" height={14} />,
    );
    flags = screen.getAllByRole('img');
    expect(flags).toHaveLength(2);
    expect(flags[1]).toHaveClass('fi-ch');
  });

  it('defaults to the block variant', () => {
    render(<FlagRow athlete={{ country: 'USA' }} itemTestId="block" />);
    expect(screen.getByTestId('block')).toHaveStyle({ backgroundSize: 'cover' });
  });
});
