import { SpeedlineTimerDisplay } from './SpeedlineTimerDisplay';

// Broadcast timer overlay (/stream/timer): transparent body so OBS/H2R can
// composite the timer over live video. Read-token auth is inherited because
// SpeedlineTimerDisplay calls useReadToken()+useWS, and /stream/timer URLs
// carry ?token= (the Cognito gate bypasses /stream/* with a token).
export const SpeedlineStreamTimer = () => <SpeedlineTimerDisplay variant="broadcast" />;
