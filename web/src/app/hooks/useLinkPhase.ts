import { ReadyState } from 'react-use-websocket';

import { useHasEverOpened } from 'app/hooks/useHasEverOpened';
import { useStaleAfterGrace } from 'app/hooks/useStaleAfterGrace';

/**
 * A not-OPEN socket is two different reports depending on whether the link was
 * ever up — a first handshake has lost nothing (and has no run to reassure
 * anyone about), a drop has lost the preview — crossed with the grace clock.
 * Reading them as one opened every fresh board (i.e. every Hosted-UI redirect)
 * on `Reconnecting… — clocks keep running`: a fault it had not had, in the slot
 * the operator checks before the first run.
 */
export type LinkPhase = 'open' | 'connecting' | 'unreachable' | 'reconnecting' | 'lost';

/**
 * The control boards' one link grader, over the two primitives that answer the
 * two questions (`useStaleAfterGrace` — how long has it been down;
 * `useHasEverOpened` — was it ever up).
 *
 * Called once per socket, by the socket's owner (`useControlSession`): every
 * surface that reports the link — the header's chip, the tally plate's sub-line
 * — reads the resulting phase instead of re-grading `readyState` on its own, so
 * the loudest object on the board and the slot above it cannot say different
 * things about the same link.
 */
export const useLinkPhase = (readyState: ReadyState): LinkPhase => {
  // Reconnects are unbounded (ADR 0024), so the down states need the grace
  // clock: a retry flap inside the window is a blip, past it an outage. Reading
  // `readyState` alone would call every CLOSED→CONNECTING step an outage.
  const stale = useStaleAfterGrace(readyState);
  const everOpened = useHasEverOpened(readyState);

  if (readyState === ReadyState.OPEN) return 'open';
  if (!everOpened) return stale ? 'unreachable' : 'connecting';
  return stale ? 'lost' : 'reconnecting';
};
