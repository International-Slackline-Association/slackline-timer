import { useEffect } from 'react';

// Guards an operator from tearing down a live timer console by accident. Timer
// state is browser-local, so closing/reloading the tab or navigating away
// mid-run loses the live clocks unless something answers for them — a peer
// panel's `state_snapshot` (ADR 0038) or this device's own stored one
// (ADR 0047), neither of which a solo panel can count on. While `active`, a
// `beforeunload` listener arms the browser's native "leave site?" prompt
// (tab close, reload, external navigation — the boards have no in-app back
// button). Inert otherwise: clearing for the next run must not nag.

const LEAVE_MESSAGE = 'A run is still in progress. Leave and lose the live timer?';

export const useRunGuard = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers require a returnValue to trigger the prompt; modern
      // ones ignore the string and show their own copy.
      e.returnValue = LEAVE_MESSAGE;
      return LEAVE_MESSAGE;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
};
