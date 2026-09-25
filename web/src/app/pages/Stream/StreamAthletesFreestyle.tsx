import { FreestyleAthleteDisplay } from 'app/pages/Freestyle/FreestyleAthleteDisplay';

// Broadcast athlete display (/stream/athletes-freestyle): transparent body so
// OBS/H2R composites the full-screen quali/battle athlete display over live
// video. Read-token auth is inherited because the shared feed calls
// useReadToken()+useWS, and /stream/athletes-freestyle URLs carry ?token= (the
// Cognito gate bypasses /stream/* with a token). The Cognito-gated venue twin
// is /freestyle/athletes.
export const StreamAthletesFreestyle = () => <FreestyleAthleteDisplay variant="stream" />;
