import { describe, expect, it } from 'vitest';

import type { WSMessage } from 'app/hooks/useWebSocket';
import { SEQ_MAX_LEAD_MS, isRelayFrame } from 'app/hooks/wsFrameGuard';

const NOW = 1_800_000_000_000;
const env = { sessionId: 'comp-1', senderId: 'panel-a' };

const speedSelection = {
  discipline: 'speed',
  round: 'quarter',
  gender: 'male',
  matchId: 'm1',
  athlete1Id: 'a1',
  athlete2Id: null,
  runWins: { 1: 1, 2: 0 },
  falseStarts: { 1: 0, 2: 1 },
};

const freestyleSelection = {
  discipline: 'freestyle',
  round: 'final',
  gender: 'female',
  matchId: null,
  athlete1Id: 'a1',
  athlete2Id: 'a2',
  freestyleMode: 'battle',
  bestTrick: { cap: 3, tries: { 1: 1, 2: 0 }, turn: 2, clockRunning: false, rev: 4 },
  nextUp: 1,
  qualiNextUp: null,
};

const speedlineSnapshot = {
  isPreviewEnabled: true,
  at: NOW,
  signalPhase: 0,
  text: '',
  timers: [
    { timerId: 1, startTime: NOW - 5_000, stopTime: NOW - 1_000 },
    { timerId: 2, startTime: null, stopTime: null },
  ],
  falseStarts: { 1: 0, 2: 0 },
};

const countdownSnapshot = {
  isPreviewEnabled: false,
  timers: [
    { timerId: 0, remainingMs: 0, isRunning: false },
    {
      timerId: 1,
      remainingMs: 40_000,
      isRunning: false,
      startedAt: NOW,
      onBreak: true,
      breakRemainingMs: 20_000,
      breakStartedAt: NOW,
      breaksLeft: 1,
      armedMs: 90_000,
    },
  ],
};

/** One current-shape frame per wire type. `satisfies` keeps the table honest:
 * a union member missing here is a type error. */
const valid = {
  updatePreview: { ...env, type: 'updatePreview', data: { enabled: false } },
  updateLaneNames: {
    ...env,
    type: 'updateLaneNames',
    data: { lane1: 'A', lane2: 'B', discipline: 'freestyle' },
  },
  updateSelection: { ...env, type: 'updateSelection', data: speedSelection, seq: NOW, echo: true },
  request_state: { ...env, type: 'request_state', data: {} },
  state_snapshot: { ...env, type: 'state_snapshot', data: speedlineSnapshot },
  start: { ...env, type: 'start', data: { startTime: NOW, lanes: [1, 2] } },
  stop: { ...env, type: 'stop', data: { timerId: 1, stopTime: NOW } },
  resume: { ...env, type: 'resume', data: { timerId: 2 } },
  reset: { ...env, type: 'reset', data: {} },
  updateSignalPhase: {
    ...env,
    type: 'updateSignalPhase',
    data: { currentPhase: 1, anchorEpoch: NOW, lanes: [1] },
  },
  updateText: { ...env, type: 'updateText', data: { text: 'FALSE START' } },
  start_countdown: {
    ...env,
    type: 'start_countdown',
    timerId: 1,
    data: { remainingMs: 90_000, startedAt: NOW },
  },
  stop_countdown: { ...env, type: 'stop_countdown', timerId: 1, data: { remainingMs: 1 } },
  reset_countdown: { ...env, type: 'reset_countdown', timerId: 3, data: { remainingMs: 0 } },
  start_break: {
    ...env,
    type: 'start_break',
    timerId: 2,
    data: { runRemainingMs: 45_000, breakMs: 30_000, breaksLeft: 1, startedAt: NOW },
  },
  end_break: { ...env, type: 'end_break', timerId: 2, data: { runRemainingMs: 45_000 } },
  db_update: {
    sessionId: 'comp-1',
    type: 'db_update',
    data: { entity: 'time', action: 'created', id: 't1' },
  },
} satisfies Record<WSMessage['type'], unknown>;

/** Shapes still on the wire from older pages, mid-deploy or pre-feature. */
const legacy: [string, unknown][] = [
  [
    'selection without discipline/seq/echo',
    {
      type: 'updateSelection',
      data: { ...speedSelection, discipline: undefined, runWins: undefined },
    },
  ],
  [
    'selection without matchId',
    {
      type: 'updateSelection',
      data: { round: 'r', gender: 'male', athlete1Id: null, athlete2Id: null },
    },
  ],
  [
    'freestyle selection, best trick without rev',
    {
      ...env,
      type: 'updateSelection',
      data: {
        ...freestyleSelection,
        bestTrick: { cap: 5, tries: { 1: 0, 2: 0 }, turn: null, clockRunning: true },
      },
    },
  ],
  ['lane names without discipline', { type: 'updateLaneNames', data: { lane1: '', lane2: '' } }],
  [
    'session frame with the timerId: -1 sentinel',
    { ...env, type: 'updatePreview', timerId: -1, data: { enabled: true } },
  ],
  ['stop on the -1 sentinel', { type: 'stop', data: { timerId: -1, stopTime: NOW } }],
  [
    'speedline snapshot without at/falseStarts',
    {
      type: 'state_snapshot',
      data: { ...speedlineSnapshot, at: undefined, falseStarts: undefined },
    },
  ],
  [
    'countdown snapshot with bare rows',
    {
      type: 'state_snapshot',
      data: { isPreviewEnabled: true, timers: [{ timerId: 1, remainingMs: 1, isRunning: true }] },
    },
  ],
  [
    'start_countdown without startedAt',
    { type: 'start_countdown', timerId: 0, data: { remainingMs: 60_000 } },
  ],
  [
    'start_break without startedAt',
    { type: 'start_break', timerId: 1, data: { runRemainingMs: 1, breakMs: 1, breaksLeft: 0 } },
  ],
  ['abort echo without anchor', { type: 'updateSignalPhase', data: { currentPhase: -1 } }],
  ['request_state without data', { type: 'request_state' }],
  ['reset without data', { type: 'reset' }],
  ['no envelope at all', { type: 'updateText', data: { text: '' } }],
  ['extra keys anywhere', { ...valid.start, extra: 1, data: { ...valid.start.data, later: 'x' } }],
];

const malformed: [string, unknown][] = [
  ['the review crash frame', { type: 'updatePreview', sessionId: 'x' }],
  ['null', null],
  ['an array', [{ type: 'reset' }]],
  ['a string', 'reset'],
  ['no type', { data: {} }],
  ['unknown type', { type: 'ping', data: {} }],
  ['a prototype key as type', { type: 'constructor', data: {} }],
  ['non-string sessionId', { ...valid.reset, sessionId: 7 }],
  ['non-string senderId', { ...valid.reset, senderId: {} }],
  ['non-number timerId on the envelope', { ...valid.updatePreview, timerId: '1' }],
  ['preview flag not boolean', { type: 'updatePreview', data: { enabled: 'yes' } }],
  ['lane names missing lane2', { type: 'updateLaneNames', data: { lane1: 'A' } }],
  ['selection data null', { type: 'updateSelection', data: null }],
  ['selection without athlete ids', { type: 'updateSelection', data: { round: 'r', gender: 'm' } }],
  ['selection with a string seq', { ...valid.updateSelection, seq: '5' }],
  ['selection with echo false', { ...valid.updateSelection, echo: false }],
  [
    'selection with a malformed tally',
    { type: 'updateSelection', data: { ...speedSelection, falseStarts: { 1: 1 } } },
  ],
  [
    'selection with a malformed best trick',
    { type: 'updateSelection', data: { ...freestyleSelection, bestTrick: { cap: 3 } } },
  ],
  [
    'selection with nextUp 3',
    { type: 'updateSelection', data: { ...freestyleSelection, nextUp: 3 } },
  ],
  ['snapshot data missing', { type: 'state_snapshot' }],
  [
    'speedline snapshot with a bad row',
    {
      type: 'state_snapshot',
      data: { ...speedlineSnapshot, timers: [{ timerId: 1, startTime: 'now' }] },
    },
  ],
  [
    'speedline snapshot without text',
    { type: 'state_snapshot', data: { ...speedlineSnapshot, text: undefined } },
  ],
  [
    'countdown snapshot with timers not an array',
    { type: 'state_snapshot', data: { isPreviewEnabled: true, timers: {} } },
  ],
  [
    'countdown snapshot row without remainingMs',
    {
      type: 'state_snapshot',
      data: { isPreviewEnabled: true, timers: [{ timerId: 1, isRunning: true }] },
    },
  ],
  ['start without lanes', { type: 'start', data: { startTime: NOW } }],
  ['start with non-numeric lanes', { type: 'start', data: { startTime: NOW, lanes: ['1'] } }],
  ['stop without stopTime', { type: 'stop', data: { timerId: 1 } }],
  ['resume without timerId', { type: 'resume', data: {} }],
  ['signal phase without currentPhase', { type: 'updateSignalPhase', data: { anchorEpoch: NOW } }],
  ['text not a string', { type: 'updateText', data: { text: null } }],
  ['countdown lane frame without timerId', { type: 'start_countdown', data: { remainingMs: 1 } }],
  ['countdown lane frame without remainingMs', { type: 'stop_countdown', timerId: 1, data: {} }],
  [
    'break without breaksLeft',
    { type: 'start_break', timerId: 1, data: { runRemainingMs: 1, breakMs: 1 } },
  ],
  ['end_break without runRemainingMs', { type: 'end_break', timerId: 1, data: {} }],
  [
    'db_update for an unknown entity',
    { type: 'db_update', data: { entity: 'manager', action: 'created', id: 'x' } },
  ],
];

describe('isRelayFrame (ADR 0051)', () => {
  it.each(Object.entries(valid))('accepts a current %s frame', (_type, frame) => {
    expect(isRelayFrame(frame, NOW)).toBe(true);
  });

  it('accepts both snapshot shapes and both selection arms', () => {
    expect(isRelayFrame({ type: 'state_snapshot', data: countdownSnapshot }, NOW)).toBe(true);
    expect(isRelayFrame({ type: 'updateSelection', data: freestyleSelection }, NOW)).toBe(true);
  });

  it.each(legacy)('accepts a legacy frame: %s', (_name, frame) => {
    expect(isRelayFrame(frame, NOW)).toBe(true);
  });

  it.each(malformed)('drops a malformed frame: %s', (_name, frame) => {
    expect(isRelayFrame(frame, NOW)).toBe(false);
  });

  it('bounds the selection stamp to a day ahead of this clock', () => {
    const at = (seq: number) => ({ ...valid.updateSelection, seq });
    expect(isRelayFrame(at(NOW + SEQ_MAX_LEAD_MS), NOW)).toBe(true);
    expect(isRelayFrame(at(NOW + SEQ_MAX_LEAD_MS + 1), NOW)).toBe(false);
    // Lamport-only stamps from a panel that has not seen the room yet.
    expect(isRelayFrame(at(1), NOW)).toBe(true);
  });
});
