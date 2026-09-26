import beepShort from './beep-short.mp3';
import beepLong from './beep-long.mp3';
import beepAlert from './beep-alert.mp3';
import beepAlert2 from './beep-alert2.mp3';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudio } from 'react-use';

import type { RaceSound } from 'app/util/raceSound';

/**
 * The four race beeps — one element per `RaceSound`, so the reducers' four
 * expiry tones are four distinct files — plus the autoplay-unlock state
 * machine. Chromium rejects `play()` until the page has seen a user gesture,
 * and activation does NOT survive the cross-origin Hosted-UI redirect — so a
 * never-touched preview/projector tab would drop every beep silently
 * (react-use settles the play() promise internally for its play-lock, which
 * hides the rejection).
 * The hook therefore reports `audioBlocked` (for a muted indicator) and, while
 * blocked, unlocks on the first gesture anywhere on the page.
 */

// ~12ms of 8-bit mono silence. Playing it is inaudible but subject to the same
// autoplay policy as the beeps, so its play() outcome is the blocked/unblocked
// truth. (Seeding from `navigator.userActivation.hasBeenActive` instead would
// false-positive "blocked" in OBS browser sources, where autoplay is allowed
// without any gesture ever happening.)
const SILENT_WAV =
  'data:audio/wav;base64,UklGRoQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YWAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=';

export const useSignalAudio = () => {
  const [audio1, , controls1, ref1] = useAudio({
    src: beepShort,
  });
  const [audio2, , controls2, ref2] = useAudio({
    src: beepLong,
  });
  const [audio3, , controls3, ref3] = useAudio({
    src: beepAlert,
  });
  const [audio4, , controls4, ref4] = useAudio({
    src: beepAlert2,
  });
  const [audioBlocked, setAudioBlocked] = useState<boolean>(false);

  // Mount-time probe: learn the autoplay verdict BEFORE the first race beep
  // would be dropped. jsdom/legacy play() returns undefined — stay unblocked
  // and let a real beep's outcome correct it.
  useEffect(() => {
    const probe: Promise<void> | undefined = new Audio(SILENT_WAV).play();
    probe?.then(
      () => setAudioBlocked(false),
      () => setAudioBlocked(true),
    );
  }, []);

  // While blocked, the first gesture anywhere unlocks: play-pause-rewind each
  // element INSIDE the gesture (Safari grants per element; Chromium off the
  // gesture itself). Bypasses the react-use controls so their play-lock cannot
  // swallow a real beep fired moments later.
  useEffect(() => {
    if (!audioBlocked) {
      return;
    }
    const unlock = () => {
      for (const ref of [ref1, ref2, ref3, ref4]) {
        const el = ref.current;
        if (!el) {
          continue;
        }
        const played: Promise<void> | undefined = el.play();
        el.pause();
        el.currentTime = 0;
        // The immediate pause() aborts the granted play — an AbortError still
        // means unlocked; only NotAllowedError (e.g. a non-activating key)
        // keeps the listener armed for the next gesture.
        played?.then(
          () => setAudioBlocked(false),
          (error: unknown) =>
            setAudioBlocked(error instanceof DOMException && error.name === 'NotAllowedError'),
        );
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [audioBlocked]);

  // react-use rebuilds its `controls` object every render, so reach them through
  // a ref (an imperative handle, never domain state) and keep `playAudio`
  // identity-stable: it is a dependency of the Freestyle effect drains, which
  // would otherwise re-run on every render of the board.
  const controlsRef = useRef<Record<RaceSound, typeof controls1>>({
    short: controls1,
    long: controls2,
    alert: controls3,
    alert2: controls4,
  });
  controlsRef.current = {
    short: controls1,
    long: controls2,
    alert: controls3,
    alert2: controls4,
  };

  const playAudio = useCallback((type: RaceSound) => {
    // Observe the outcome ourselves — react-use marks the rejection handled —
    // so a blocked (or recovered) pipeline is never silent.
    const result = controlsRef.current[type].play();
    result?.then(
      () => setAudioBlocked(false),
      () => setAudioBlocked(true),
    );
  }, []);

  const audioElement = (
    <div>
      {audio1} {audio2} {audio3} {audio4}
    </div>
  );

  return { audioElement, playAudio, audioBlocked };
};
