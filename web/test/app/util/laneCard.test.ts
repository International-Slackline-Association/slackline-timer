import { describe, expect, it } from 'vitest';

import type { LaneState } from 'app/util/battleMachine';
import { laneCardState, type LaneCardState } from 'app/util/laneCard';

const ARMED = 150_000;

const idle = (budgetMs: number): LaneState => ({
  phase: 'idle',
  budgetMs,
  armedMs: ARMED,
  breaksLeft: 2,
});

// The §3 state → card rows: one word per reducer state, so a squint at 25 %
// scale names the lane's state and a lane that RAN never reads like one that
// did not (the S02 finding).
const ROWS: [label: string, lane: LaneState, expected: LaneCardState][] = [
  ['pristine idle', idle(ARMED), { tier: 'ready', word: 'READY' }],
  [
    'idle below its armed budget (a turn was taken off it)',
    idle(134_000),
    { tier: 'held', word: 'TURN TAKEN · 02:14 held' },
  ],
  [
    'running',
    { phase: 'running', budgetMs: ARMED, armedMs: ARMED, startedAt: 0, breaksLeft: 2 },
    { tier: 'running', word: 'RUNNING' },
  ],
  [
    'on the quali advisory break',
    {
      phase: 'onBreak',
      budgetMs: 134_000,
      armedMs: ARMED,
      breakMs: 30_000,
      breakStartedAt: 0,
      breaksLeft: 1,
    },
    { tier: 'break', word: 'BREAK · 1 LEFT' },
  ],
  [
    'spent',
    { phase: 'finished', armedMs: ARMED, breaksLeft: 0 },
    { tier: 'finished', word: 'FINISHED' },
  ],
];

describe('laneCardState (FREESTYLE_BOARD_UX §3/§6)', () => {
  it.each(ROWS)('reads %s', (_label, lane, expected) => {
    expect(laneCardState(lane)).toEqual(expected);
  });

  it('separates a held lane from a pristine one at the same phase', () => {
    // Both lanes are `idle`; only `armedMs` says one of them ran. The whole
    // point of the tier — the card frame and word diverge from here.
    expect(laneCardState(idle(ARMED)).tier).toBe('ready');
    expect(laneCardState(idle(ARMED - 1)).tier).toBe('held');
  });
});
