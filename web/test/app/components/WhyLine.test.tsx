import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WHY_RESERVED_LINES, WhyLine } from 'app/components/WhyLine';
import { lockReason, type Lock } from 'app/util/lockReason';
import { speedlineLocks } from 'app/util/speedlineLocks';

import { EVERY_HOLD } from '../../util/boardHolds';
import { px } from '../../util/computedUnits';
import { LANE_CARD_CONTENT_PX, SPEEDLINE_START_STRIP_PX } from '../../util/deskGeometry';
import {
  REQUIRED_SLACK_CHARS,
  charsPerLine,
  longestLine,
  wrappedLines,
} from '../../util/lineBudget';

/** The lane card's own line: the reserved why-slot is as wide as the card. */
const CHARS_PER_LINE = charsPerLine(LANE_CARD_CONTENT_PX);

const idle = { kind: 'idle' } as const;
const running = { kind: 'running', startTime: 1_000 } as const;
const stopped = { kind: 'finished', startTime: 1_000, stopTime: 5_000, elapsedMs: 4_000 } as const;

/** Every `Lock`, same rule, at the widest shape each one has: lane 2, the
 * `hh:mm:ss` clock face, a two-digit cap. */
const LOCKS: Record<Lock['kind'], Lock[]> = {
  hold: Object.values(EVERY_HOLD).map((hold) => ({ kind: 'hold', hold })),
  spent: [{ kind: 'spent', armedMs: 3_600_000 }],
  notRunning: [{ kind: 'notRunning', lane: 2 }],
  noBreaks: [{ kind: 'noBreaks', lane: 2 }],
  triesSpent: [{ kind: 'triesSpent', cap: 10 }],
  noTry: [{ kind: 'noTry' }],
  notArmed: [{ kind: 'notArmed' }],
};

const EVERY_LOCK = Object.values(LOCKS)
  .flat()
  .map((lock) => [lockReason(lock), lock] as const);

/** Every Speedline state that words a lock: offline (which words all three),
 * the lights, a running lane, the abort latch, the idle-lane Stop, and the
 * resting board's Abort. */
const SPEEDLINE_STATES = (
  [
    { connected: false, signalPhase: 0, aborted: false, now: 0, lanes: { 1: idle, 2: idle } },
    { connected: true, signalPhase: 2, aborted: false, now: 0, lanes: { 1: idle, 2: idle } },
    { connected: true, signalPhase: -1, aborted: true, now: 0, lanes: { 1: idle, 2: idle } },
    { connected: true, signalPhase: -1, aborted: false, now: 0, lanes: { 1: idle, 2: idle } },
    { connected: true, signalPhase: 0, aborted: false, now: 0, lanes: { 1: running, 2: idle } },
    // A resolved run: the lane Resume's own two reasons.
    {
      connected: true,
      signalPhase: -1,
      aborted: false,
      now: 1_000_000,
      lanes: { 1: stopped, 2: idle },
    },
  ] as const
).map(({ lanes, ...input }) => speedlineLocks({ ...input, laneState: lanes }));

const reasons = (lines: (string | null)[]): string[] =>
  [...new Set(lines)].filter((reason): reason is string => reason !== null);

const SPEEDLINE_REASONS = reasons(
  SPEEDLINE_STATES.flatMap((locks) => [
    locks.start,
    locks.abort,
    locks.reset,
    locks.stop[1],
    locks.stop[2],
    locks.swap,
    locks.void,
    locks.resume[1],
    locks.resume[2],
  ]),
);

/** What the race pair's one shared slot can print, in the start strip. */
const RACE_PAIR_REASONS = reasons(
  SPEEDLINE_STATES.flatMap((locks) => [locks.start, locks.abort, locks.reset]),
);

describe('WhyLine', () => {
  it('reserves the same height with and without a reason', () => {
    const { rerender } = render(<WhyLine lock={null} />);
    const empty = px(window.getComputedStyle(screen.getByTestId('why-line')).minHeight);

    rerender(<WhyLine lock={{ kind: 'hold', hold: EVERY_HOLD.bestTrick }} />);
    const locked = px(window.getComputedStyle(screen.getByTestId('why-line')).minHeight);

    expect(locked).toBe(empty);
    // Two 14 px lines at the body leading — the slot the wrap assertion below
    // measures every reason against.
    expect(empty).toBeCloseTo(14 * 1.4 * WHY_RESERVED_LINES);
  });

  // The setup rail locks off a board hold it already holds as a rendered
  // string (its Tooltip's), so it feeds that string rather than re-deriving it.
  it('takes an already-rendered reason as well as a lock', () => {
    const { rerender } = render(<WhyLine reason="locked while Athlete 1 runs" />);
    expect(screen.getByTestId('why-line').textContent).toBe('why: locked while Athlete 1 runs');

    rerender(<WhyLine reason={null} />);
    expect(screen.getByTestId('why-line').textContent).not.toMatch(/why:/);
  });

  // The Speedline rail's Swap and Void (`reserve={false}`): nothing under them
  // moves under a hand that is on them, so the slot is paid only while locked.
  it('collapses to nothing without a reason when it reserves no slot', () => {
    const { rerender } = render(<WhyLine reason={null} reserve={false} />);
    expect(screen.queryByTestId('why-line')).toBeNull();

    rerender(<WhyLine reason="locked while a lane runs" reserve={false} />);
    const line = screen.getByTestId('why-line');
    expect(line).toHaveTextContent('why: locked while a lane runs');
    // The initial value — no slot held open.
    expect(window.getComputedStyle(line).minHeight).toBe('auto');
  });

  it.each(EVERY_LOCK)('fits the reserved slot: %s', (_reason, lock) => {
    render(<WhyLine lock={lock} />);

    expect(
      wrappedLines(screen.getByTestId('why-line').textContent ?? '', CHARS_PER_LINE),
    ).toBeLessThanOrEqual(WHY_RESERVED_LINES);
  });

  it.each(EVERY_LOCK)('keeps a glyph of wrap slack: %s', (_reason, lock) => {
    render(<WhyLine lock={lock} />);

    expect(
      longestLine(screen.getByTestId('why-line').textContent ?? '', CHARS_PER_LINE),
    ).toBeLessThanOrEqual(CHARS_PER_LINE - REQUIRED_SLACK_CHARS);
  });

  // The second desk feeds the same slot its own rendered reasons (§7's P3
  // sibling note), so they are held to the same two lines.
  it.each(SPEEDLINE_REASONS)('fits the reserved slot: %s', (reason) => {
    render(<WhyLine reason={reason} />);

    expect(
      wrappedLines(screen.getByTestId('why-line').textContent ?? '', CHARS_PER_LINE),
    ).toBeLessThanOrEqual(WHY_RESERVED_LINES);
  });

  it.each(SPEEDLINE_REASONS)('keeps a glyph of wrap slack: %s', (reason) => {
    render(<WhyLine reason={reason} />);

    expect(
      longestLine(screen.getByTestId('why-line').textContent ?? '', CHARS_PER_LINE),
    ).toBeLessThanOrEqual(CHARS_PER_LINE - REQUIRED_SLACK_CHARS);
  });

  // The race pair's line sits in the start strip, not a lane card: a reason
  // that wraps to a third line there moves Reset the instant it appears.
  it.each(RACE_PAIR_REASONS)('fits the start strip in two lines: %s', (reason) => {
    render(<WhyLine reason={reason} />);

    expect(
      wrappedLines(
        screen.getByTestId('why-line').textContent ?? '',
        charsPerLine(SPEEDLINE_START_STRIP_PX),
      ),
    ).toBeLessThanOrEqual(WHY_RESERVED_LINES);
  });
});
