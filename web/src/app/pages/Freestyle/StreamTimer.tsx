import { FreestyleTimerDisplay } from './FreestyleTimerDisplay';

// Broadcast timer overlay (/stream/timer-freestyle): transparent body so OBS/H2R
// can composite the countdown over live video. Read-token auth and the ?bg=
// rules are inherited from FreestyleTimerDisplay (see its JSDoc).
export const FreestyleStreamTimer = () => <FreestyleTimerDisplay variant="broadcast" />;
