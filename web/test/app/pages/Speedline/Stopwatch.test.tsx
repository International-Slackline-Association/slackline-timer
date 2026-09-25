import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Stopwatch } from 'app/pages/Speedline/Stopwatch';
import { colors } from 'app/theme/tokens';
import type { StopwatchWSMessage } from 'app/hooks/useWebSocket';

describe('Stopwatch hero time numerals', () => {
  it('renders the time in the monospace numeral face with tabular-nums', () => {
    // A recovered "finished" lane sets the frozen elapsed synchronously, so the
    // formatted time renders without driving the live interval.
    render(
      <Stopwatch
        lastJsonMessage={undefined}
        isReady
        timerId={1}
        recovery={{ kind: 'finished', startTime: 0, stopTime: 83_450, elapsedMs: 83_450 }}
      />,
    );

    // MUI `sx` emits an emotion class, not an inline style, so assert the
    // resolved computed style rather than `element.style`.
    const time = screen.getByText(/^\d+:\d\d\.\d\d$/);
    const computed = window.getComputedStyle(time);
    expect(computed.fontFamily).toContain('JetBrains Mono');
    expect(computed.fontVariantNumeric).toBe('tabular-nums');
    // Race-state color language replaces the old black fill + white stroke.
    expect(computed.webkitTextStroke).toBe('');
    // Viewport-relative hero sizing (DESIGN_SYSTEM §4) — a vw-driven clamp so the
    // numeral fills a projector screen, not a fixed MUI h3. jsdom 29's CSS parser
    // drops clamp() from computed fontSize, so assert the emotion-injected rule.
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain('clamp(');
    expect(css).toContain('vw');
  });

  it('uses the contained control-variant numeral clamp on the operator column', () => {
    // The control variant keeps the numeral small enough to stay inside the
    // ControlPage's narrow column and not overflow onto the centre controls.
    render(
      <Stopwatch
        lastJsonMessage={undefined}
        isReady
        timerId={1}
        recovery={{ kind: 'finished', startTime: 0, stopTime: 83_450, elapsedMs: 83_450 }}
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
        lastJsonMessage={undefined}
        isReady
        timerId={1}
        recovery={{ kind: 'finished', startTime: 0, stopTime: 83_450, elapsedMs: 83_450 }}
      />,
    );
    // Uppercase status tag (DESIGN_SYSTEM label style) rather than the old
    // parenthetical caption.
    expect(screen.getByText('UNOFFICIAL')).toBeVisible();
    expect(screen.queryByText('(Unofficial)')).not.toBeInTheDocument();
  });

  it('renders an idle lane in slate (ink.hi)', () => {
    render(
      <Stopwatch lastJsonMessage={undefined} isReady timerId={1} recovery={{ kind: 'idle' }} />,
    );
    const time = screen.getByText('0:00.00');
    expect(window.getComputedStyle(time).color).toBe('rgb(51, 60, 78)');
  });

  it('carries the overlayTextShadow footage halo on the idle numeral (ADR 0041)', () => {
    // The slate idle digits are otherwise dim; keyed over dark footage they need
    // the standard protection halo (slate stack) to survive — not just running/
    // finished states.
    render(
      <Stopwatch lastJsonMessage={undefined} isReady timerId={1} recovery={{ kind: 'idle' }} />,
    );
    const shadow = window.getComputedStyle(screen.getByText('0:00.00')).textShadow;
    expect(shadow).not.toBe('');
    expect(shadow).not.toBe('none');
    // Slate halo (ink.hi = rgb(51,60,78)); normalise jsdom's rgba spacing.
    expect(shadow.replace(/\s/g, '')).toContain('rgba(51,60,78');
  });

  it('renders a finished numeral in white with the footage halo', () => {
    // The frozen finished time is the payload of the stream timer; over dark
    // footage a slate numeral vanished, so it reads plain white + the protection
    // halo rather than the recessive idle slate.
    render(
      <Stopwatch
        lastJsonMessage={undefined}
        isReady
        timerId={1}
        recovery={{ kind: 'finished', startTime: 0, stopTime: 83_450, elapsedMs: 83_450 }}
      />,
    );
    const time = screen.getByText('1:23.45');
    expect(window.getComputedStyle(time).color).toBe('rgb(255, 255, 255)');
    const shadow = window.getComputedStyle(time).textShadow;
    expect(shadow).not.toBe('');
    expect(shadow).not.toBe('none');
    expect(shadow.replace(/\s/g, '')).toContain('rgba(51,60,78');
  });

  it('renders a running lane in running teal', () => {
    render(
      <Stopwatch
        lastJsonMessage={undefined}
        isReady
        timerId={1}
        recovery={{ kind: 'running', startTime: Date.now() }}
      />,
    );
    const time = screen.getByText(/^\d+:\d\d\.\d\d$/);
    // Running resolves through --tl-running (canonical #13A89E in tokens.css;
    // jsdom doesn't resolve var()).
    expect(window.getComputedStyle(time).color).toBe(colors.race.running);
  });

  it('records a sub-50ms stop (the interval has not ticked, so time is still 0)', () => {
    // A start then an immediate stop arrive in the same render batch, before the
    // 50ms tick interval has run once — so `time` is still 0 when the stop lands.
    // The lane is genuinely running, so the stop must freeze and show UNOFFICIAL,
    // not be swallowed by a `time === 0` guard.
    const start: StopwatchWSMessage = {
      sessionId: 's',
      type: 'start',
      data: { startTime: 1_000_000, lanes: [1, 2] },
    };
    const { rerender } = render(<Stopwatch lastJsonMessage={start} isReady timerId={1} />);
    // The marker row stays mounted (space reserved so the numeral never jumps)
    // but is only VISIBLE once the lane resolves.
    expect(screen.getByText('UNOFFICIAL')).not.toBeVisible();

    const stop: StopwatchWSMessage = {
      sessionId: 's',
      type: 'stop',
      data: { timerId: 1, stopTime: 1_000_030 },
    };
    rerender(<Stopwatch lastJsonMessage={stop} isReady timerId={1} />);

    // Frozen at 30ms → 0:00.03, with the resolved marker shown.
    expect(screen.getByText('0:00.03')).toBeInTheDocument();
    expect(screen.getByText('UNOFFICIAL')).toBeVisible();
  });

  it('stays dormant on a solo start that excludes this lane, clearing a prior run', () => {
    // Quali: one athlete selected, so the start lists only that lane. The other
    // lane must not tick — and a frozen time left from a previous run clears
    // back to idle (the control page resets both lanes on start).
    const finished = {
      kind: 'finished',
      startTime: 0,
      stopTime: 83_450,
      elapsedMs: 83_450,
    } as const;
    const { rerender } = render(
      <Stopwatch lastJsonMessage={undefined} isReady timerId={2} recovery={finished} />,
    );
    expect(screen.getByText('1:23.45')).toBeInTheDocument();

    const soloStart: StopwatchWSMessage = {
      sessionId: 's',
      type: 'start',
      data: { startTime: 1_000_000, lanes: [1] },
    };
    rerender(<Stopwatch lastJsonMessage={soloStart} isReady timerId={2} recovery={finished} />);

    expect(screen.getByText('0:00.00')).toBeInTheDocument();
    expect(screen.getByText('UNOFFICIAL')).not.toBeVisible();

    // A stray stop for the dormant lane stays a no-op (it never started).
    const stop: StopwatchWSMessage = {
      sessionId: 's',
      type: 'stop',
      data: { timerId: 2, stopTime: 1_005_000 },
    };
    rerender(<Stopwatch lastJsonMessage={stop} isReady timerId={2} recovery={finished} />);
    expect(screen.getByText('0:00.00')).toBeInTheDocument();
  });

  it('starts normally when the solo start lists this lane', () => {
    const soloStart: StopwatchWSMessage = {
      sessionId: 's',
      type: 'start',
      data: { startTime: 1_000_000, lanes: [2] },
    };
    const { rerender } = render(<Stopwatch lastJsonMessage={soloStart} isReady timerId={2} />);

    const stop: StopwatchWSMessage = {
      sessionId: 's',
      type: 'stop',
      data: { timerId: 2, stopTime: 1_000_030 },
    };
    rerender(<Stopwatch lastJsonMessage={stop} isReady timerId={2} />);
    expect(screen.getByText('0:00.03')).toBeInTheDocument();
    expect(screen.getByText('UNOFFICIAL')).toBeVisible();
  });

  it('ignores a stop for an idle lane (no start seen)', () => {
    // Without a preceding start the lane is not running; a stray stop message
    // must be a no-op (no frozen time, no UNOFFICIAL marker).
    const stop: StopwatchWSMessage = {
      sessionId: 's',
      type: 'stop',
      data: { timerId: 1, stopTime: 1_000_030 },
    };
    render(<Stopwatch lastJsonMessage={stop} isReady timerId={1} />);

    expect(screen.getByText('UNOFFICIAL')).not.toBeVisible();
    expect(screen.getByText('0:00.00')).toBeInTheDocument();
  });

  describe('snapshot recovery merge (preview)', () => {
    // A display that missed a live frame is re-synced only by a snapshot that is
    // demonstrably NEWER than the frame it did apply — `assertedAt` is the
    // control's own wall clock at snapshot build, comparable with the
    // control-minted `stopTime` the lane froze on.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
    });
    afterEach(() => vi.useRealTimers());

    const start: StopwatchWSMessage = {
      sessionId: 's',
      type: 'start',
      data: { startTime: 1_000_000, lanes: [1, 2] },
    };
    const stop: StopwatchWSMessage = {
      sessionId: 's',
      type: 'stop',
      data: { timerId: 1, stopTime: 1_004_000 },
    };

    /** Run lane 1 and freeze it at 4.00s, the state a missed `resume` leaves. */
    const frozenLane = () => {
      const view = render(<Stopwatch lastJsonMessage={start} isReady timerId={1} />);
      view.rerender(<Stopwatch lastJsonMessage={stop} isReady timerId={1} />);
      expect(screen.getByText('0:04.00')).toBeInTheDocument();
      return view;
    };

    it('un-freezes a lane on a snapshot stamped after the stop it applied', () => {
      const { rerender } = frozenLane();
      vi.setSystemTime(1_006_000);

      rerender(
        <Stopwatch
          lastJsonMessage={stop}
          isReady
          timerId={1}
          recovery={{ kind: 'running', startTime: 1_000_000, assertedAt: 1_005_000 }}
        />,
      );

      // Ticking again off the ORIGINAL GO epoch — the withdrawn stop is undone.
      expect(screen.getByText('0:06.00')).toBeInTheDocument();
      expect(screen.getByText('UNOFFICIAL')).not.toBeVisible();
    });

    it('leaves a frozen lane frozen on a snapshot stamped before that stop', () => {
      const { rerender } = frozenLane();

      rerender(
        <Stopwatch
          lastJsonMessage={stop}
          isReady
          timerId={1}
          recovery={{ kind: 'running', startTime: 1_000_000, assertedAt: 1_003_000 }}
        />,
      );

      expect(screen.getByText('0:04.00')).toBeInTheDocument();
      expect(screen.getByText('UNOFFICIAL')).toBeVisible();
    });

    it('leaves a frozen lane frozen on an unstamped snapshot (pre-feature sender)', () => {
      const { rerender } = frozenLane();

      rerender(
        <Stopwatch
          lastJsonMessage={stop}
          isReady
          timerId={1}
          recovery={{ kind: 'running', startTime: 1_000_000 }}
        />,
      );

      expect(screen.getByText('0:04.00')).toBeInTheDocument();
    });

    it('still freezes a running lane on a snapshot of the same run that finished', () => {
      // The HWC 2026 missed-stop rule, unchanged by the stamp: a snapshot is the
      // only way a display that never received the stop stops running forever.
      const { rerender } = render(<Stopwatch lastJsonMessage={start} isReady timerId={1} />);

      rerender(
        <Stopwatch
          lastJsonMessage={start}
          isReady
          timerId={1}
          recovery={{
            kind: 'finished',
            startTime: 1_000_000,
            stopTime: 1_004_000,
            elapsedMs: 4_000,
          }}
        />,
      );

      expect(screen.getByText('0:04.00')).toBeInTheDocument();
      expect(screen.getByText('UNOFFICIAL')).toBeVisible();
    });
  });

  it('renders from the controlled laneState prop, ignoring the loopback message', () => {
    // On the control page the Stopwatch is presentational: the page owns lane
    // state and passes it down as `laneState`. The loopback `lastJsonMessage`
    // must NOT drive it (no AWS-echo dependency), so a start message present in
    // the same render is ignored while an idle laneState keeps the lane at rest.
    const start: StopwatchWSMessage = {
      sessionId: 's',
      type: 'start',
      data: { startTime: Date.now(), lanes: [1, 2] },
    };
    const { rerender } = render(
      <Stopwatch lastJsonMessage={start} isReady timerId={1} laneState={{ kind: 'idle' }} />,
    );
    expect(screen.getByText('0:00.00')).toBeInTheDocument();
    expect(screen.getByText('UNOFFICIAL')).not.toBeVisible();

    // A new controlled finished laneState freezes the elapsed and shows UNOFFICIAL,
    // driven purely by the prop change (not a message).
    rerender(
      <Stopwatch
        lastJsonMessage={start}
        isReady
        timerId={1}
        laneState={{ kind: 'finished', startTime: 0, stopTime: 12_340, elapsedMs: 12_340 }}
      />,
    );
    expect(screen.getByText('0:12.34')).toBeInTheDocument();
    expect(screen.getByText('UNOFFICIAL')).toBeVisible();
  });

  describe('stop() freezes against a stale tick (skew-free by construction)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('a 50ms tick landing after stop() must not unfreeze the authoritative time', () => {
      // Under relay latency a 50ms tick can be queued before the stop lands and
      // fire just after stop() froze the lane. The old code cleared the interval
      // only one commit later (the [isRunning] effect), so that stale tick could
      // overwrite stopTime−startTime with Date.now()−startTime — breaking the
      // "finished lane is skew-free by construction" guarantee (ADR 0021).
      const setSpy = vi.spyOn(globalThis, 'setInterval');
      vi.setSystemTime(1_000_000);
      const start: StopwatchWSMessage = {
        sessionId: 's',
        type: 'start',
        data: { startTime: 1_000_000, lanes: [1, 2] },
      };
      const { rerender } = render(<Stopwatch lastJsonMessage={start} isReady timerId={1} />);
      // The 50ms tick callback the running lane scheduled.
      const tick = setSpy.mock.calls[0]?.[0] as () => void;
      expect(tick).toBeTypeOf('function');

      // Operator stops at +30ms: the frozen authoritative time is 0:00.03.
      vi.setSystemTime(1_000_500);
      const stop: StopwatchWSMessage = {
        sessionId: 's',
        type: 'stop',
        data: { timerId: 1, stopTime: 1_000_030 },
      };
      rerender(<Stopwatch lastJsonMessage={stop} isReady timerId={1} />);
      expect(screen.getByText('0:00.03')).toBeInTheDocument();

      // A tick queued before the stop now runs its callback body. It must NOT
      // rewrite the display to Date.now()−startTime (~0:00.50).
      act(() => {
        tick();
      });
      expect(screen.getByText('0:00.03')).toBeInTheDocument();
      expect(screen.queryByText('0:00.50')).not.toBeInTheDocument();
      setSpy.mockRestore();
    });

    it('a stale tick must not unfreeze a controlled finished laneState', () => {
      // Same race on the control page's owned-state path (applyLaneState finished).
      const setSpy = vi.spyOn(globalThis, 'setInterval');
      vi.setSystemTime(2_000_000);
      const { rerender } = render(
        <Stopwatch
          lastJsonMessage={undefined}
          isReady
          timerId={1}
          laneState={{ kind: 'running', startTime: 2_000_000 }}
        />,
      );
      const tick = setSpy.mock.calls[0]?.[0] as () => void;
      expect(tick).toBeTypeOf('function');

      vi.setSystemTime(2_000_500);
      rerender(
        <Stopwatch
          lastJsonMessage={undefined}
          isReady
          timerId={1}
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
