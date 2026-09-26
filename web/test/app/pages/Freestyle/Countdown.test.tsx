import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COUNTDOWN_SIZES, Countdown } from 'app/pages/Freestyle/Countdown';
import type { CountdownWSMessage } from 'app/hooks/useWebSocket';
import { colors } from 'app/theme/tokens';

import { emPx, px } from '../../../util/computedUnits';

describe('Countdown hero time numerals', () => {
  it('renders the countdown in the monospace numeral face with tabular-nums', () => {
    // A recovered lane sets remainingMs synchronously, so formattedTime renders
    // (90s → "01:30") without driving the live interval.
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        recovery={{ remainingMs: 90_000, isRunning: false }}
      />,
    );

    // MUI `sx` emits an emotion class, not an inline style, so assert the
    // resolved computed style rather than `element.style`.
    const time = screen.getByText(/^\d\d:\d\d$/);
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
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        recovery={{ remainingMs: 90_000, isRunning: false }}
        size="control"
      />,
    );
    screen.getByText('01:30');
    // The contained clamp, not the full-screen projector one. (jsdom drops
    // clamp() from computed fontSize, so assert the emotion-injected rule.)
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain(COUNTDOWN_SIZES.control.numeral);
  });

  it('renders an idle (stopped) countdown in slate (ink.hi)', () => {
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        recovery={{ remainingMs: 90_000, isRunning: false }}
      />,
    );
    expect(window.getComputedStyle(screen.getByText('01:30')).color).toBe('rgb(51, 60, 78)');
  });

  it('carries the overlayTextShadow footage halo on the idle numeral (ADR 0041)', () => {
    // The slate idle digits need the standard protection halo to survive keyed
    // over dark footage, matching the running/on-break states.
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        recovery={{ remainingMs: 90_000, isRunning: false }}
      />,
    );
    const shadow = window.getComputedStyle(screen.getByText('01:30')).textShadow;
    expect(shadow).not.toBe('');
    expect(shadow).not.toBe('none');
    // Slate halo (ink.hi = rgb(51,60,78)); normalise jsdom's rgba spacing.
    expect(shadow.replace(/\s/g, '')).toContain('rgba(51,60,78');
  });

  it('renders the hero idle clock white with the idle-grey state frame', () => {
    // On-dark (athlete display) the numeral NEVER carries the state hue — the
    // slate `void` ground caps every race hue at ~3–5:1, unreadable from far
    // in daylight. Digits stay white (ink.onBrand, 11:1) and the state rides
    // the stroked frame around the clock: idle = race.idle grey, the quiet one.
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        recovery={{ remainingMs: 90_000, isRunning: false }}
        size="hero"
      />,
    );
    const numeral = screen.getByText('01:30');
    expect(window.getComputedStyle(numeral).color).toBe('rgb(255, 255, 255)');
    const frameEl = numeral.parentElement as HTMLElement;
    const frame = window.getComputedStyle(frameEl);
    expect(frame.borderTopColor).toBe('rgb(138, 147, 157)'); // race.idle
    // idle keeps the thin frame (em-scaled to the numeral)
    expect(px(frame.borderLeftWidth)).toBeCloseTo(emPx('0.125em', frameEl), 2);
  });

  it('renders a running countdown in running teal', () => {
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        recovery={{ remainingMs: 90_000, isRunning: true }}
      />,
    );
    // Running resolves through --tl-running (canonical #13A89E in tokens.css;
    // jsdom doesn't resolve var()).
    expect(window.getComputedStyle(screen.getByText('01:30')).color).toBe(colors.race.running);
  });

  it('renders a running hero clock white inside a bright frame with wide sides', () => {
    // Distance separation is by luminance + weight: base teal and idle grey
    // are near-identical in luminance, so a counting clock's frame steps to
    // the *Bright stroke and widens its LEFT/RIGHT strokes only (top/bottom
    // stay thin so nothing crowds the name row above); idle stays thin.
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        recovery={{ remainingMs: 90_000, isRunning: true }}
        size="hero"
      />,
    );
    const numeral = screen.getByText('01:30');
    expect(window.getComputedStyle(numeral).color).toBe('rgb(255, 255, 255)');
    const frameEl = numeral.parentElement as HTMLElement;
    const frame = window.getComputedStyle(frameEl);
    expect(frame.borderTopColor).toBe('rgb(69, 229, 216)'); // race.runningBright
    expect(px(frame.borderLeftWidth)).toBeCloseTo(emPx('0.5em', frameEl), 2); // the live weight cue
    expect(px(frame.borderRightWidth)).toBeCloseTo(emPx('0.5em', frameEl), 2);
    // broadcast stroke, unchanged (em-scaled)
    expect(px(frame.borderTopWidth)).toBeCloseTo(emPx('0.125em', frameEl), 2);
  });

  it('renders a hero expiry white in the stop frame, caption in stopBright', () => {
    // A zeroed non-running recovery lands on the expired face (the
    // spent-row-counts-as-expired mapping): white 00:00 in an orange-red
    // frame; the caption is caption-weight state text on dark → the *Bright
    // text-accent tier (stopBright, 5.4:1 on void).
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        recovery={{ remainingMs: 0, isRunning: false }}
        size="hero"
        expiredLabel="TIME"
      />,
    );
    const numeral = screen.getByText('00:00');
    expect(window.getComputedStyle(numeral).color).toBe('rgb(255, 255, 255)');
    const frameEl = numeral.parentElement as HTMLElement;
    const frame = window.getComputedStyle(frameEl);
    expect(frame.borderTopColor).toBe('rgb(255, 155, 130)'); // race.stopBright
    // resolved, not live — thin frame
    expect(px(frame.borderLeftWidth)).toBeCloseTo(emPx('0.125em', frameEl), 2);
    expect(window.getComputedStyle(screen.getByText('TIME')).color).toBe('rgb(255, 155, 130)');
  });

  it('applies the on-dark treatment at projector scale via the onDark prop', () => {
    // The warm-up / best-trick heroes mount projector-scale clocks on the same
    // dark athlete-display ground — `onDark` decouples the ground from the
    // scale so their idle clocks don't paint slate-on-slate.
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={0}
        recovery={{ remainingMs: 90_000, isRunning: false }}
        onDark
      />,
    );
    const numeral = screen.getByText('01:30');
    expect(window.getComputedStyle(numeral).color).toBe('rgb(255, 255, 255)');
    const frame = window.getComputedStyle(numeral.parentElement as HTMLElement);
    expect(frame.borderTopColor).toBe('rgb(138, 147, 157)'); // race.idle
  });
});

// Controlled mode (the Speedline `Stopwatch.laneState` pattern): the control
// page's reducers own timer state and drive the clock through `display`. The
// props are a discriminated union, so a controlled clock cannot even be handed
// a message, a recovery snapshot or a socket-readiness gate — the former
// "ignores the message stream / the recovery side channel while controlled"
// tests are now type errors instead of runtime assertions.
describe('Countdown controlled display (control page, ADR 0032)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the armed budget from mount while idle (not 0:00)', () => {
    render(<Countdown mode="controlled" display={{ kind: 'idle', remainingMs: 120_000 }} />);
    expect(screen.getByText('02:00')).toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  it('re-applies an idle budget edit on change', () => {
    const { rerender } = render(
      <Countdown mode="controlled" display={{ kind: 'idle', remainingMs: 120_000 }} />,
    );
    expect(screen.getByText('02:00')).toBeInTheDocument();
    rerender(<Countdown mode="controlled" display={{ kind: 'idle', remainingMs: 90_000 }} />);
    expect(screen.getByText('01:30')).toBeInTheDocument();
  });

  it('derives a running clock from the state anchor, then ticks off it', () => {
    vi.setSystemTime(10_000);
    // Started 10s ago with a 90s budget: the display resumes at 01:20 — a
    // mid-join hydration and a local start land on the identical path.
    render(
      <Countdown
        mode="controlled"
        display={{ kind: 'running', remainingMs: 90_000, startedAt: 0 }}
      />,
    );
    expect(screen.getByText('01:20')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText('01:18')).toBeInTheDocument();
  });

  it('renders the held run, the break clock and the allowance on an onBreak state', () => {
    vi.setSystemTime(5_000);
    render(
      <Countdown
        mode="controlled"
        display={{
          kind: 'onBreak',
          heldMs: 45_000,
          breakMs: 30_000,
          breakStartedAt: 0, // 5s into the break: the clock resumes at 00:25
          breaksLeft: 1,
        }}
      />,
    );
    expect(screen.getByText('00:45')).toBeInTheDocument();
    expect(screen.getByText('00:25')).toBeInTheDocument();
    expect(screen.getByText(/1 left/i)).toBeInTheDocument();
  });

  it('renders the expiredLabel under the held 00:00 numeral on an expired state', () => {
    render(<Countdown mode="controlled" display={{ kind: 'expired' }} expiredLabel="TIME" />);
    expect(screen.getByText('TIME')).toBeInTheDocument();
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it('a state transition running → idle freezes the clock at the owned value', () => {
    vi.setSystemTime(0);
    const { rerender } = render(
      <Countdown
        mode="controlled"
        display={{ kind: 'running', remainingMs: 90_000, startedAt: 0 }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('01:20')).toBeInTheDocument();
    // The reducer stops the lane at its derived remaining; the display follows
    // the owned state, and no further tick moves it.
    rerender(<Countdown mode="controlled" display={{ kind: 'idle', remainingMs: 80_000 }} />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText('01:20')).toBeInTheDocument();
  });
});

// The operator's board is a light panel read at arm's length in daylight, not a
// composited broadcast surface: the base race hues are numeral-only tiers there
// (3.6–4.1:1), so the control variant steps to the on-light tiers of brief §6 —
// every pair pinned in test/app/theme/contrast.test.ts — and drops the footage
// halo, which reads as grime on white. The (surface × state) rows themselves
// are the skin table's (test/app/util/countdownSkin.test.ts); what these three
// pin is that the component WIRES that skin onto the numeral, the frame and the
// caption — which is what needs the DOM.
describe('Countdown control variant on-light tiers (FREESTYLE_BOARD_UX §6)', () => {
  const frameOf = (numeral: HTMLElement) =>
    window.getComputedStyle(numeral.parentElement as HTMLElement);

  it('paints running digits in the runningText tier, unhaloed', () => {
    render(
      <Countdown
        mode="controlled"
        display={{ kind: 'running', remainingMs: 90_000, startedAt: Date.now() }}
        size="control"
      />,
    );
    const numeral = screen.getByText('01:30');
    expect(window.getComputedStyle(numeral).color).toBe('rgb(11, 107, 101)'); // race.runningText
    // The footage halo would read as grime on white; jsdom reports the cleared
    // shadow as a transparent one, so assert the slate halo is gone.
    expect(window.getComputedStyle(numeral).textShadow.replace(/\s/g, '')).not.toContain(
      'rgba(51,60,78',
    );
  });

  it('paints the break numeral and its frame in the setDim tier', () => {
    render(
      <Countdown
        mode="controlled"
        display={{
          kind: 'onBreak',
          heldMs: 45_000,
          breakMs: 30_000,
          breakStartedAt: Date.now(),
          breaksLeft: 1,
        }}
        size="control"
      />,
    );
    const numeral = screen.getByText('00:30');
    expect(window.getComputedStyle(numeral).color).toBe('rgb(176, 116, 26)'); // race.setDim
    expect(frameOf(numeral).borderTopColor).toBe('rgb(176, 116, 26)');
    // The held run is a value the operator still has to read: full ink, not the
    // overlay's dimmed grey (2.9:1 on white).
    expect(window.getComputedStyle(screen.getByText('00:45')).color).toBe('rgb(51, 60, 78)');
  });

  it('paints expired digits, caption and frame in the stopDim tier', () => {
    render(
      <Countdown
        mode="controlled"
        display={{ kind: 'expired' }}
        size="control"
        expiredLabel="TIME"
      />,
    );
    const numeral = screen.getByText('00:00');
    expect(window.getComputedStyle(numeral).color).toBe(colors.race.stopDim);
    expect(window.getComputedStyle(screen.getByText('TIME')).color).toBe(colors.race.stopDim);
  });
});

// S10: the socket-readiness gate is a FEED concern. A controlled clock is
// driven by the page's own reducer, so a closed/reconnecting relay must not
// blank it — the operator's lane, warm-up and try clocks keep rendering and
// ticking with the socket down.
describe('Countdown readiness gate (feed only, S10)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides a feed clock until the socket is ready', () => {
    const { rerender } = render(
      <Countdown mode="feed" message={undefined} isReady={false} timerId={1} />,
    );
    expect(screen.getByText('00:00')).not.toBeVisible();
    rerender(<Countdown mode="feed" message={undefined} isReady timerId={1} />);
    expect(screen.getByText('00:00')).toBeVisible();
  });

  it('keeps a controlled clock visible and ticking with no socket at all', () => {
    vi.setSystemTime(0);
    render(
      <Countdown
        mode="controlled"
        display={{ kind: 'running', remainingMs: 90_000, startedAt: 0 }}
        size="control"
      />,
    );
    expect(screen.getByText('01:30')).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText('01:27')).toBeVisible();
  });
});

describe('Countdown onExpire / expiredLabel (warm-up seam)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const startMessage = (timerId: number, remainingMs: number): CountdownWSMessage => ({
    sessionId: 's',
    timerId,
    type: 'start_countdown',
    data: { remainingMs },
  });

  const stopMessage = (timerId: number, remainingMs: number): CountdownWSMessage => ({
    sessionId: 's',
    timerId,
    type: 'stop_countdown',
    data: { remainingMs },
  });

  it('fires onExpire exactly once when a running countdown crosses to zero', () => {
    const onExpire = vi.fn();
    render(
      <Countdown
        mode="feed"
        message={startMessage(0, 2_000)}
        isReady
        timerId={0}
        onExpire={onExpire}
      />,
    );

    // Two ticks bring 2_000 → 0; further ticks must not re-fire.
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not fire onExpire when stopped above zero', () => {
    const onExpire = vi.fn();
    const { rerender } = render(
      <Countdown
        mode="feed"
        message={startMessage(0, 5_000)}
        isReady
        timerId={0}
        onExpire={onExpire}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    rerender(
      <Countdown
        mode="feed"
        message={stopMessage(0, 3_000)}
        isReady
        timerId={0}
        onExpire={onExpire}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('keeps the 00:00 numeral and adds the expiredLabel caption after expiry', () => {
    render(
      <Countdown
        mode="feed"
        message={startMessage(0, 1_000)}
        isReady
        timerId={0}
        expiredLabel="WARM-UP OVER"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText('WARM-UP OVER')).toBeInTheDocument();
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });
});

describe('Countdown wall-clock anchoring (drift on a throttled tab)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // A throttled/busy tab fires the 1000ms interval late: real time advances more
  // than one second between callbacks. The clock must reflect actual elapsed
  // wall time, not a fixed prev-1000 per tick.
  it('shows real elapsed time when a tick fires late, not a fixed -1000', () => {
    vi.setSystemTime(0);
    const start: CountdownWSMessage = {
      sessionId: 's',
      timerId: 0,
      type: 'start_countdown',
      data: { remainingMs: 90_000 },
    };
    render(<Countdown mode="feed" message={start} isReady timerId={0} />);
    // Tab was backgrounded: wall time jumps ~10s but the interval gets to fire
    // only once (advanceTimersToNextTimer adds the final 1000ms ⇒ ~11s elapsed).
    // A fixed -1000 tick would show 01:29; wall-clock anchoring reflects the
    // real ~11s elapsed (90s − 11s = 79s ⇒ 01:19).
    act(() => {
      vi.setSystemTime(10_000);
      vi.advanceTimersToNextTimer();
    });
    expect(screen.getByText('01:19')).toBeInTheDocument();
  });

  it('expires the run on a single late tick that lands past zero', () => {
    const onExpire = vi.fn();
    vi.setSystemTime(0);
    const start: CountdownWSMessage = {
      sessionId: 's',
      timerId: 0,
      type: 'start_countdown',
      data: { remainingMs: 3_000 },
    };
    render(
      <Countdown
        mode="feed"
        message={start}
        isReady
        timerId={0}
        onExpire={onExpire}
        expiredLabel="OVER"
      />,
    );
    // One late tick after the budget would already have elapsed.
    act(() => {
      vi.setSystemTime(9_000);
      vi.advanceTimersToNextTimer();
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByText('OVER')).toBeInTheDocument();
  });

  it('expires the break on a single late tick that lands past zero', () => {
    const onBreakExpire = vi.fn();
    vi.setSystemTime(0);
    const startBreak: CountdownWSMessage = {
      sessionId: 's',
      timerId: 1,
      type: 'start_break',
      data: { runRemainingMs: 45_000, breakMs: 30_000, breaksLeft: 1 },
    };
    render(
      <Countdown
        mode="feed"
        message={startBreak}
        isReady
        timerId={1}
        onBreakExpire={onBreakExpire}
      />,
    );
    act(() => {
      vi.setSystemTime(40_000);
      vi.advanceTimersToNextTimer();
    });
    expect(onBreakExpire).toHaveBeenCalledTimes(1);
  });
});

// The bug this whole change fixes: `start_countdown`/`start_break` used to carry
// only a duration, so each receiver re-anchored to its own receipt time and the
// countdowns smeared across overlays (whole-second flooring amplified any
// sub-second delivery-latency spread into a full 1s on-screen difference). With
// the shared `startedAt` epoch on the wire, two receivers that process the SAME
// message at DIFFERENT receipt times must derive the SAME remaining and land on
// the SAME whole second — proving overlays converge.
describe('Countdown wire-anchor convergence (the smear regression)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('two receivers with the same start_countdown startedAt converge (same seed AND same tick)', () => {
    const start: CountdownWSMessage = {
      sessionId: 's',
      timerId: 1,
      type: 'start_countdown',
      data: { remainingMs: 90_000, startedAt: 0 },
    };
    // Receiver A processes 1.2s after the start; receiver B 0.5s later still —
    // the delivery-latency spread that used to smear them by a whole second.
    // Both anchor to the shared startedAt=0, so their FIRST paint already agrees
    // (the old receipt-anchored seed would differ across the two mounts).
    vi.setSystemTime(1_200);
    const a = render(<Countdown mode="feed" message={start} isReady timerId={1} />);
    vi.setSystemTime(1_700);
    const b = render(<Countdown mode="feed" message={start} isReady timerId={1} />);
    expect(a.container.textContent).toBe(b.container.textContent);
    // …and they stay in lockstep as their (independently phased) ticks fire.
    act(() => {
      vi.setSystemTime(5_000);
      vi.advanceTimersByTime(2_000);
    });
    expect(a.container.textContent).toBe(b.container.textContent);
    // Sanity: the numeral is a live mm:ss around 85s, not the 0:00 blank.
    expect(a.container.textContent).toMatch(/01:2\d/);
  });

  it('two receivers with the same start_break startedAt converge (same seed AND same tick)', () => {
    const startBreak: CountdownWSMessage = {
      sessionId: 's',
      timerId: 1,
      type: 'start_break',
      data: { runRemainingMs: 45_000, breakMs: 30_000, breaksLeft: 1, startedAt: 0 },
    };
    vi.setSystemTime(1_200);
    const a = render(<Countdown mode="feed" message={startBreak} isReady timerId={1} />);
    vi.setSystemTime(1_700);
    const b = render(<Countdown mode="feed" message={startBreak} isReady timerId={1} />);
    // The held run (00:45) and the break clock both anchor to the shared epoch.
    expect(a.container.textContent).toBe(b.container.textContent);
    act(() => {
      vi.setSystemTime(5_000);
      vi.advanceTimersByTime(2_000);
    });
    expect(a.container.textContent).toBe(b.container.textContent);
    // Sanity: the amber break clock is live around 25s, not blank.
    expect(a.container.textContent).toMatch(/00:2\d/);
  });

  it('falls back to receipt time when the wire carries no startedAt (pre-feature sender)', () => {
    vi.setSystemTime(0);
    const start: CountdownWSMessage = {
      sessionId: 's',
      timerId: 1,
      type: 'start_countdown',
      data: { remainingMs: 90_000 },
    };
    render(<Countdown mode="feed" message={start} isReady timerId={1} />);
    expect(screen.getByText('01:30')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText('01:27')).toBeInTheDocument();
  });
});

describe('Countdown on-break render (quali advisory break)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const startBreak = (
    timerId: number,
    runRemainingMs: number,
    breakMs: number,
    breaksLeft: number,
  ): CountdownWSMessage => ({
    sessionId: 's',
    timerId,
    type: 'start_break',
    data: { runRemainingMs, breakMs, breaksLeft },
  });

  it('shows the held run, the break clock and the "n left" badge on start_break', () => {
    render(
      <Countdown mode="feed" message={startBreak(1, 45_000, 30_000, 1)} isReady timerId={1} />,
    );
    // Held run remaining (45s) shown greyed alongside the break clock (30s).
    expect(screen.getByText('00:45')).toBeInTheDocument();
    expect(screen.getByText('00:30')).toBeInTheDocument();
    expect(screen.getByText(/1 left/i)).toBeInTheDocument();
  });

  it('ticks the break clock down on its own interval', () => {
    render(
      <Countdown mode="feed" message={startBreak(1, 45_000, 30_000, 1)} isReady timerId={1} />,
    );
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText('00:25')).toBeInTheDocument();
    // The held run does not tick during a break.
    expect(screen.getByText('00:45')).toBeInTheDocument();
  });

  it('fires onBreakExpire once when the clock hits zero', () => {
    const onBreakExpire = vi.fn();
    render(
      <Countdown
        mode="feed"
        message={startBreak(1, 45_000, 30_000, 1)}
        isReady
        timerId={1}
        onBreakExpire={onBreakExpire}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    expect(onBreakExpire).toHaveBeenCalledTimes(1);
  });

  it('recovers an on-break lane from a snapshot (held run + live break clock)', () => {
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        recovery={{
          remainingMs: 45_000,
          isRunning: false,
          onBreak: true,
          breakRemainingMs: 18_000,
          breaksLeft: 0,
        }}
      />,
    );
    expect(screen.getByText('00:45')).toBeInTheDocument();
    expect(screen.getByText('00:18')).toBeInTheDocument();
    expect(screen.getByText(/0 left/i)).toBeInTheDocument();
  });

  it('clears the break on end_break, holding the run paused', () => {
    const { rerender } = render(
      <Countdown mode="feed" message={startBreak(1, 45_000, 30_000, 1)} isReady timerId={1} />,
    );
    expect(screen.getByText('00:30')).toBeInTheDocument();
    const endBreak: CountdownWSMessage = {
      sessionId: 's',
      timerId: 1,
      type: 'end_break',
      data: { runRemainingMs: 45_000 },
    };
    rerender(<Countdown mode="feed" message={endBreak} isReady timerId={1} />);
    // Break clock gone; the held run remains, paused.
    expect(screen.queryByText('00:30')).not.toBeInTheDocument();
    expect(screen.getByText('00:45')).toBeInTheDocument();
  });

  it('cancels the break on an early start_countdown, resuming the run', () => {
    const { rerender } = render(
      <Countdown mode="feed" message={startBreak(1, 45_000, 30_000, 1)} isReady timerId={1} />,
    );
    expect(screen.getByText('00:30')).toBeInTheDocument();
    const resume: CountdownWSMessage = {
      sessionId: 's',
      timerId: 1,
      type: 'start_countdown',
      data: { remainingMs: 45_000 },
    };
    rerender(<Countdown mode="feed" message={resume} isReady timerId={1} />);
    expect(screen.queryByText('00:30')).not.toBeInTheDocument();
    expect(screen.getByText('00:45')).toBeInTheDocument();
  });

  it('reserves the break rows (mounted, hidden) while idle so the layout cannot jump', () => {
    render(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        reserveBreakRows
        reserveCaptionRow
      />,
    );
    expect(screen.getByText(/^Break/)).not.toBeVisible();
  });

  // freestyle-board-fold-budget: the held-run row and the caption row are two
  // reserves, because only quali breaks (ADR 0036) while EVERY lane reaches the
  // expiry word that shares the caption's slot. A battle board reserving the
  // held run pays a dead row out of its lane transport's fold budget.
  it('reserves the caption row without the held-run row', () => {
    const { rerender } = render(
      <Countdown mode="feed" message={undefined} isReady timerId={1} reserveCaptionRow />,
    );
    expect(screen.getByText(/^Break/)).not.toBeVisible();
    expect(screen.getAllByText('00:00')).toHaveLength(1);

    rerender(
      <Countdown
        mode="feed"
        message={undefined}
        isReady
        timerId={1}
        reserveBreakRows
        reserveCaptionRow
      />,
    );
    expect(screen.getAllByText('00:00')).toHaveLength(2);
  });

  it('reveals the reserved rows when the break starts', () => {
    render(
      <Countdown
        mode="feed"
        message={startBreak(1, 45_000, 30_000, 1)}
        isReady
        timerId={1}
        reserveBreakRows
        reserveCaptionRow
      />,
    );
    expect(screen.getByText(/1 left/i)).toBeVisible();
    expect(screen.getByText('00:45')).toBeVisible();
  });
});
