import { act, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Stopwatch } from 'app/pages/Speedline/Stopwatch';
import { colors, OVERLAY_LANE } from 'app/theme/tokens';
import { refVw } from 'app/util/overlayScale';

import { px, vwPx } from '../../../util/computedUnits';

describe('Stopwatch hero time numerals', () => {
  it('renders the time in the monospace numeral face with tabular-nums', () => {
    // A finished lane renders its frozen elapsed without driving the live
    // interval.
    render(
      <Stopwatch
        isReady
        laneState={{ kind: 'finished', startTime: 0, stopTime: 83_450, elapsedMs: 83_450 }}
      />,
    );

    // MUI `sx` emits an emotion class, not an inline style, so assert the
    // resolved computed style rather than `element.style`.
    const time = screen.getByText(/^\d+:\d\d\.\d\d$/);
    const computed = window.getComputedStyle(time);
    expect(computed.fontFamily).toContain('JetBrains Mono');
    expect(computed.fontVariantNumeric).toBe('tabular-nums');
    // No text stroke: the race-state color carries the numeral.
    expect(computed.webkitTextStroke).toBe('');
    // Viewport-relative hero sizing (design-system §4) — a vw-driven clamp so
    // the numeral fills a projector screen, not a fixed MUI h3. jsdom 29's CSS
    // parser drops clamp() from computed fontSize, so assert the
    // emotion-injected rule.
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain('clamp(');
    expect(css).toContain('vw');
  });

  it('uses the contained control-variant numeral clamp on the operator column', () => {
    // The control variant keeps the numeral small enough to stay inside the
    // ControlPage's narrow column and not overflow onto the centre controls.
    render(
      <Stopwatch
        isReady
        laneState={{ kind: 'finished', startTime: 0, stopTime: 83_450, elapsedMs: 83_450 }}
        size="control"
      />,
    );
    screen.getByText(/^\d+:\d\d\.\d\d$/);
    // The contained clamp, not the full-screen two-lane projector clamp. (jsdom 29
    // drops clamp() from computed fontSize, so assert the emotion-injected rule.)
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain('clamp(1.5rem, 3.2vw, 2.75rem)');
  });

  it('replaces the tiny "(Unofficial)" marker with a legible UNOFFICIAL tag', () => {
    render(
      <Stopwatch
        isReady
        laneState={{ kind: 'finished', startTime: 0, stopTime: 83_450, elapsedMs: 83_450 }}
      />,
    );
    // Uppercase status tag (design-system label style).
    expect(screen.getByText('UNOFFICIAL')).toBeVisible();
    expect(screen.queryByText('(Unofficial)')).not.toBeInTheDocument();
  });

  it('renders an idle lane in slate (ink.hi)', () => {
    render(<Stopwatch isReady laneState={{ kind: 'idle' }} />);
    const time = screen.getByText('0:00.00');
    expect(window.getComputedStyle(time).color).toBe('rgb(51, 60, 78)');
  });

  it('carries the overlayTextShadow footage halo on the idle numeral (ADR 0041)', () => {
    // The slate idle digits are otherwise dim; keyed over dark footage they need
    // the standard protection halo (slate stack) to survive — not just running/
    // finished states.
    render(<Stopwatch isReady laneState={{ kind: 'idle' }} />);
    const shadow = window.getComputedStyle(screen.getByText('0:00.00')).textShadow;
    expect(shadow).not.toBe('');
    expect(shadow).not.toBe('none');
    // Slate halo (ink.hi = rgb(51,60,78)); normalise jsdom's rgba spacing.
    expect(shadow.replace(/\s/g, '')).toContain('rgba(51,60,78');
  });

  it('renders a finished numeral in white with the footage halo', () => {
    // The frozen finished time is the payload of the stream timer; over dark
    // footage a slate numeral vanishes, so it reads plain white + the
    // protection halo, not the recessive idle slate.
    render(
      <Stopwatch
        isReady
        laneState={{ kind: 'finished', startTime: 0, stopTime: 83_450, elapsedMs: 83_450 }}
      />,
    );
    const time = screen.getByText('1:23.45');
    expect(window.getComputedStyle(time).color).toBe('rgb(255, 255, 255)');
    const shadow = window.getComputedStyle(time).textShadow;
    expect(shadow).not.toBe('');
    expect(shadow).not.toBe('none');
    expect(shadow.replace(/\s/g, '')).toContain('rgba(51,60,78');
  });

  it('inks idle and stopped plate digits in the overlay name ink (one black per frame)', () => {
    const { unmount } = render(<Stopwatch isReady laneState={{ kind: 'idle' }} size="plate" />);
    expect(window.getComputedStyle(screen.getByText('0:00.00')).color).toBe('rgb(35, 31, 32)');
    unmount();
    render(
      <Stopwatch
        isReady
        laneState={{ kind: 'finished', startTime: 0, stopTime: 83_450, elapsedMs: 83_450 }}
        size="plate"
      />,
    );
    expect(window.getComputedStyle(screen.getByText('1:23.45')).color).toBe('rgb(35, 31, 32)');
  });

  it('keeps running plate digits in running teal', () => {
    render(
      <Stopwatch isReady laneState={{ kind: 'running', startTime: Date.now() }} size="plate" />,
    );
    expect(window.getComputedStyle(screen.getByText(/^\d+:\d\d\.\d\d$/)).color).toBe(
      colors.race.running,
    );
  });

  it('renders a running lane in running teal', () => {
    render(<Stopwatch isReady laneState={{ kind: 'running', startTime: Date.now() }} />);
    const time = screen.getByText(/^\d+:\d\d\.\d\d$/);
    // Running resolves through --tl-running (canonical #13A89E in tokens.css;
    // jsdom doesn't resolve var()).
    expect(window.getComputedStyle(time).color).toBe(colors.race.running);
  });

  describe('renders the lane state it is handed', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(2_000_000);
    });
    afterEach(() => vi.useRealTimers());

    it('paints a running lane on its first render (a late mount replays nothing)', () => {
      // No effect has run in a server render, so this is the frame a lane
      // mounting mid-race paints first.
      const html = renderToStaticMarkup(
        <Stopwatch isReady laneState={{ kind: 'running', startTime: 1_999_000 }} />,
      );
      expect(html).toContain('0:01.00');
    });

    it('ticks a resumed lane off its original start epoch', () => {
      const { rerender } = render(
        <Stopwatch
          isReady
          laneState={{
            kind: 'finished',
            startTime: 1_996_000,
            stopTime: 1_999_000,
            elapsedMs: 3_000,
          }}
        />,
      );
      expect(screen.getByText('0:03.00')).toBeInTheDocument();

      rerender(<Stopwatch isReady laneState={{ kind: 'running', startTime: 1_996_000 }} />);
      expect(screen.getByText('0:04.00')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByText('0:05.00')).toBeInTheDocument();
      expect(screen.getByText('UNOFFICIAL')).not.toBeVisible();
    });

    it('a stale tick must not unfreeze a finished lane (skew-free by construction)', () => {
      // A 50ms tick queued before the freeze can fire just after it; it must not
      // overwrite stopTime−startTime with Date.now()−startTime (ADR 0021).
      const setSpy = vi.spyOn(globalThis, 'setInterval');
      const { rerender } = render(
        <Stopwatch isReady laneState={{ kind: 'running', startTime: 2_000_000 }} />,
      );
      const tick = setSpy.mock.calls[0]?.[0] as () => void;
      expect(tick).toBeTypeOf('function');

      vi.setSystemTime(2_000_500);
      rerender(
        <Stopwatch
          isReady
          laneState={{ kind: 'finished', startTime: 2_000_000, stopTime: 2_000_030, elapsedMs: 30 }}
        />,
      );
      expect(screen.getByText('0:00.03')).toBeInTheDocument();

      act(() => {
        tick();
      });
      expect(screen.getByText('0:00.03')).toBeInTheDocument();
      setSpy.mockRestore();
    });
  });
});

describe('Stopwatch clock plate', () => {
  const plateOf = (elapsedMs: number, plateAlign?: 'left' | 'right' | 'center') => {
    const view = render(
      <Stopwatch
        isReady
        laneState={{ kind: 'finished', startTime: 0, stopTime: elapsedMs, elapsedMs }}
        size="plate"
        plateAlign={plateAlign}
      />,
    );
    return { plate: () => screen.getByTestId('stopwatch-plate'), ...view };
  };

  it('draws the shared lane clock plate width and inner padding', () => {
    const { plate } = plateOf(83_450);
    const style = window.getComputedStyle(plate());
    expect(px(style.width)).toBeCloseTo(vwPx(refVw(OVERLAY_LANE.clockPlate)), 2);
    expect(px(style.paddingLeft)).toBeCloseTo(vwPx(refVw(OVERLAY_LANE.clockPlatePad)), 2);
  });

  it('keeps one plate width when the minutes gain a digit', () => {
    const { plate, rerender } = plateOf(599_990);
    expect(screen.getByText('9:59.99')).toBeInTheDocument();
    const before = window.getComputedStyle(plate()).width;
    rerender(
      <Stopwatch
        isReady
        laneState={{ kind: 'finished', startTime: 1, stopTime: 600_001, elapsedMs: 600_000 }}
        size="plate"
      />,
    );
    expect(screen.getByText('10:00.00')).toBeInTheDocument();
    expect(window.getComputedStyle(plate()).width).toBe(before);
  });

  it.each([
    ['left', 'flex-start'],
    ['right', 'flex-end'],
    ['center', 'center'],
  ] as const)('justifies the digits to the %s lane edge', (plateAlign, justify) => {
    const { plate } = plateOf(83_450, plateAlign);
    const style = window.getComputedStyle(plate());
    expect(style.justifyContent).toBe(justify);
    expect(style.paddingLeft).toBe(style.paddingRight);
  });
});
