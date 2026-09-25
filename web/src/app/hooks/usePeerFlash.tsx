import { useEffect, useState } from 'react';

/** How long a peer-applied change stays labelled on this panel (brief §3). Long
 * enough to catch an operator's eye returning from the athletes, short enough
 * to be gone before the next turn. */
export const PEER_FLASH_MS = 2_000;

/**
 * Turns a `useControlSession` peer-event token into the brief on-screen "by
 * other panel" cue (FREESTYLE_BOARD_UX §3/§4.10, rubric C17).
 *
 * Peer panels are mirroring peers (ADR 0038): the board simply becomes true on
 * its own, which is right — and silent, which is not. This lights a surface's
 * reserved chip for `PEER_FLASH_MS` each time the token changes.
 *
 * A `null` token means "the latest peer action was not this surface's", and it
 * clears the cue: the label follows the newest peer event, so two surfaces can
 * never both claim to be the one that just changed.
 */
export const usePeerFlash = (token: number | null): boolean => {
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (token === null) {
      setFlashing(false);
      return;
    }
    setFlashing(true);
    const timeoutId = window.setTimeout(() => setFlashing(false), PEER_FLASH_MS);
    return () => window.clearTimeout(timeoutId);
  }, [token]);

  return flashing;
};
