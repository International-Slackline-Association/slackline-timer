import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFitToBox } from 'app/pages/Stream/useFitToBox';

/** Probe harness: renders the hook's two nodes and publishes the fit it returns. */
const Probe = () => {
  const { slotRef, nameRef, fit } = useFitToBox();
  return (
    <div ref={slotRef} data-testid="slot">
      <div ref={nameRef} data-testid="name" data-fit={fit} />
    </div>
  );
};

/** Stand in for the layout jsdom never does: hand the two probe nodes a USED
 *  box (the fractional px `getComputedStyle` reports in a real browser). */
const mockUsedSizes = (sizes: Record<string, { w: number; h: number }>) => {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((
    el: Element,
    pseudo?: string | null,
  ) => {
    const size = sizes[(el as HTMLElement).dataset?.testid ?? ''];
    return size
      ? ({ width: `${size.w}px`, height: `${size.h}px` } as CSSStyleDeclaration)
      : real(el, pseudo ?? undefined);
  }) as typeof window.getComputedStyle);
};

const fitOf = () => Number(screen.getByTestId('name').dataset.fit);

afterEach(() => vi.restoreAllMocks());

describe('useFitToBox', () => {
  it('measures the fractional used box, so the scaled block never paints past the slot', () => {
    // `clientWidth`/`scrollWidth` are INTEGER-rounded: a 43.6px slot reads 44 and
    // 69.06px of content reads 69, so the fit came out ~1% too generous and the
    // block painted ~0.5px past the band's overflow:hidden edge — the residual
    // both-edge shave on the small admin bracket cards.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { value: 44, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { value: 69, configurable: true });
    mockUsedSizes({ slot: { w: 43.6, h: 24 }, name: { w: 69.06, h: 18 } });

    render(<Probe />);

    expect(fitOf()).toBeCloseTo(43.6 / 69.06, 5);
    expect(fitOf() * 69.06).toBeLessThanOrEqual(43.6);
  });

  it('falls back to the integer box when no used size is reported', () => {
    // jsdom reports no layout at all, and so may a detached node mid-mount —
    // the hook still has to produce a usable fit rather than NaN.
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      value: 100,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      value: 250,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { value: 100, configurable: true });

    render(<Probe />);

    expect(fitOf()).toBeCloseTo(0.4, 5); // the tighter axis: 100 / 250
  });
});
