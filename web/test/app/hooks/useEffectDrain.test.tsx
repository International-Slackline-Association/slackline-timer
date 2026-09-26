import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useEffectDrain } from 'app/hooks/useEffectDrain';
import type { TimerEffect } from 'app/util/timerChannel';

const wsEffect: TimerEffect = {
  kind: 'ws',
  message: { type: 'reset_countdown', timerId: 1, data: { remainingMs: 5000 } },
};
const audioEffect: TimerEffect = { kind: 'audio', sound: 'long' };

const setup = (effects: TimerEffect[]) => {
  const sendWSMessage = vi.fn();
  const playAudio = vi.fn();
  const dispatch = vi.fn();
  const { rerender } = renderHook(
    ({ e }: { e: TimerEffect[] }) => useEffectDrain(e, sendWSMessage, playAudio, dispatch),
    { initialProps: { e: effects } },
  );
  return { sendWSMessage, playAudio, dispatch, rerender };
};

describe('useEffectDrain', () => {
  it('broadcasts ws effects and plays audio effects, then drains', () => {
    const { sendWSMessage, playAudio, dispatch } = setup([wsEffect, audioEffect]);

    expect(sendWSMessage).toHaveBeenCalledTimes(1);
    expect(sendWSMessage).toHaveBeenCalledWith(wsEffect.message);
    expect(playAudio).toHaveBeenCalledExactlyOnceWith('long');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'DRAIN' });
  });

  it('is a no-op on an empty queue (no send, no beep, no drain)', () => {
    const { sendWSMessage, playAudio, dispatch } = setup([]);

    expect(sendWSMessage).not.toHaveBeenCalled();
    expect(playAudio).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('re-drains when the queue reference changes', () => {
    const { sendWSMessage, dispatch, rerender } = setup([wsEffect]);
    expect(sendWSMessage).toHaveBeenCalledTimes(1);

    rerender({ e: [wsEffect, wsEffect] });
    expect(sendWSMessage).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
