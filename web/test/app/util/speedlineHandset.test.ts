import { describe, expect, it } from 'vitest';

import { handsetReadout } from 'app/util/handsetReadout';
import { SPEEDLINE_BUZZER_ROWS, speedlineHandsetOutcome } from 'app/util/speedlineHandset';
import { speedlineLocks } from 'app/util/speedlineLocks';
import { speedlineLaneState } from 'app/util/timerSnapshot';

const idleBoard = (signalPhase = 0) =>
  speedlineLocks({
    connected: true,
    signalPhase,
    aborted: false,
    now: 0,
    laneState: {
      1: speedlineLaneState({ timerId: 1, startTime: null, stopTime: null }),
      2: speedlineLaneState({ timerId: 2, startTime: null, stopTime: null }),
    },
  });

const line = (button: number, ctx: Parameters<typeof speedlineHandsetOutcome>[1]) =>
  handsetReadout(button, speedlineHandsetOutcome(button, ctx));

describe('speedlineHandsetOutcome', () => {
  it('words a live key off the row the mapping sheet shows', () => {
    expect(line(0, { locks: idleBoard(), overlay: null })).toBe(
      'handset 1 · red → Start (with lights)',
    );
  });

  it('gives a dead key the board’s own sentence, not a second wording', () => {
    const locks = idleBoard();

    expect(line(5, { locks, overlay: null })).toBe(
      'handset 2 · red → locked: no start sequence to abort',
    );
    expect(line(10, { locks, overlay: null })).toBe(
      'handset 3 · red → locked: Lane 1 is not running',
    );
  });

  // The pad effect bails on `overlayOwnsBoard()` ahead of every interlock, and
  // this desk binds no answer to the pad — so the question, not the board, is
  // what a press behind it is told about.
  it('blames the standing question rather than the board behind it', () => {
    const overlay = { confirm: { dialog: 'Reset', safeAction: 'Keep timing' } };

    expect(line(0, { locks: idleBoard(), overlay })).toBe(
      'handset 1 · red → locked: answer the Reset question first',
    );
  });

  // Reset and the false-start flags answer to no lock because the handler gives
  // them none: the confirm guards Reset, and a jump may be flagged after the run.
  it('reports the unlocked keys as fired even mid-race', () => {
    const racing = speedlineLocks({
      connected: true,
      signalPhase: 0,
      aborted: false,
      now: 0,
      laneState: {
        1: speedlineLaneState({ timerId: 1, startTime: 1000, stopTime: null }),
        2: speedlineLaneState({ timerId: 2, startTime: 1000, stopTime: null }),
      },
    });

    expect(line(1, { locks: racing, overlay: null })).toBe('handset 1 · yellow → Reset');
    expect(line(11, { locks: racing, overlay: null })).toBe(
      'handset 3 · yellow → False start — lane 1',
    );
  });

  it('says so for a key this board binds nothing to', () => {
    expect(line(4, { locks: idleBoard(), overlay: null })).toBe(
      'handset 1 · blue → nothing on this board',
    );
    expect(SPEEDLINE_BUZZER_ROWS.some((r) => r.button === 4)).toBe(false);
  });
});
