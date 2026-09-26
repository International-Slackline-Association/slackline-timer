import { useEffect, useState } from 'react';
import { ReadyState } from 'react-use-websocket';

/**
 * Latches once the relay socket has reached OPEN at least since this mount.
 *
 * The companion to `useStaleAfterGrace`: that one grades how LONG the link has
 * been down, this one whether it was ever up. A socket still shaking hands and
 * a socket that dropped mid-run read identically off `readyState` alone, but
 * they are different reports to an operator — one has lost nothing yet, the
 * other has lost the preview — and every Hosted-UI redirect lands on the first.
 */
export const useHasEverOpened = (readyState: ReadyState): boolean => {
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      setEverOpened(true);
    }
  }, [readyState]);

  return everOpened;
};
