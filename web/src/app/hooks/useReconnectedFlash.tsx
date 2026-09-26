import { useEffect, useRef, useState } from 'react';

/** How long the "reconnected" cue lingers after a self-heal before clearing. */
export const FLASH_MS = 3_000;

/**
 * Turns the recovery edge of a surfaced alarm into a brief on-screen cue.
 * `ConnectionLostBadge` marks the drop (its `lost` phase) but vanishes silently
 * the instant the link recovers, so an operator watching a projector can miss
 * the self-heal; this lights up for `FLASH_MS` on the falling edge, then clears.
 *
 * It fires only after a drop the badge actually surfaced (the phase had already
 * spent its grace), so a routine reconnect blip never strobes it, and re-arms
 * for each subsequent drop→recover cycle.
 */
export const useReconnectedFlash = (stale: boolean): boolean => {
  const [flash, setFlash] = useState(false);
  const wasStale = useRef(false);

  useEffect(() => {
    if (stale) {
      wasStale.current = true;
      return;
    }
    if (!wasStale.current) {
      return;
    }
    wasStale.current = false;
    setFlash(true);
    const timeoutId = window.setTimeout(() => setFlash(false), FLASH_MS);
    return () => window.clearTimeout(timeoutId);
  }, [stale]);

  return flash;
};
