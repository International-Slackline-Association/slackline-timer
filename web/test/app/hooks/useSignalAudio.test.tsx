import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSignalAudio } from 'app/hooks/useSignalAudio';

// jsdom has no media pipeline (`play()` is unimplemented), so each test scripts
// the autoplay outcome on the shared prototype — the mount-time probe, the
// beeps, and the first-gesture prime all flow through it.
const notAllowed = () =>
  Promise.reject(new DOMException('play() blocked by autoplay policy', 'NotAllowedError'));

// The hook's audioElement must be rendered for react-use to populate its refs.
const Harness = () => {
  const { audioElement, playAudio, audioBlocked } = useSignalAudio();
  return (
    <div>
      {audioElement}
      <output data-testid="blocked">{String(audioBlocked)}</output>
      <button onClick={() => playAudio('short')}>beep</button>
    </div>
  );
};

const blocked = () => screen.getByTestId('blocked').textContent;
const flush = () => act(async () => {});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSignalAudio autoplay unlock', () => {
  it('flags audio as blocked when the mount-time probe is rejected', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(notAllowed);

    render(<Harness />);
    await flush();

    expect(blocked()).toBe('true');
  });

  it('stays unblocked when the probe plays (activation present / OBS autoplay)', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(<Harness />);
    await flush();

    expect(blocked()).toBe('false');
  });

  it('surfaces a rejected beep as blocked instead of letting react-use swallow it', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<Harness />);
    await flush();
    expect(blocked()).toBe('false');

    play.mockImplementation(notAllowed);
    fireEvent.click(screen.getByRole('button', { name: 'beep' }));
    await flush();

    expect(blocked()).toBe('true');
  });

  it('primes every beep element on the first gesture and clears the blocked flag', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(notAllowed);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    render(<Harness />);
    await flush();
    expect(blocked()).toBe('true');
    play.mockClear();

    // The gesture grants playback: the prime's play() starts, then the
    // immediate pause() aborts it — an AbortError still means "granted".
    play.mockImplementation(() =>
      Promise.reject(new DOMException('interrupted by pause()', 'AbortError')),
    );
    fireEvent.pointerDown(window);
    await flush();

    // One element per RaceSound: short, long, alert, alert2.
    expect(play).toHaveBeenCalledTimes(4);
    expect(pause).toHaveBeenCalledTimes(4);
    expect(blocked()).toBe('false');
  });

  it('stays blocked when the priming play is still not allowed (non-activating key)', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(notAllowed);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    render(<Harness />);
    await flush();

    fireEvent.keyDown(window);
    await flush();

    expect(blocked()).toBe('true');
  });
});
