import { FreestyleAthleteDisplay } from 'app/pages/Freestyle/FreestyleAthleteDisplay';

// /stream/athletes-freestyle: the full-screen athlete display on a transparent
// ground. Read-token auth comes from the shared feed (`useFreestyleTimerFeed`);
// the Cognito-gated venue twin is /freestyle/athletes.
export const StreamAthletesFreestyle = () => <FreestyleAthleteDisplay variant="stream" />;
