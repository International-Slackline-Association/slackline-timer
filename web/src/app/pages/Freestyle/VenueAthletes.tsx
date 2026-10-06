import { FreestyleAthleteDisplay } from './FreestyleAthleteDisplay';

// Full-screen audience-facing athlete display (/freestyle/athletes), the
// Cognito-gated venue twin of /stream/athletes-freestyle.
export const FreestyleVenueAthletes = () => <FreestyleAthleteDisplay variant="venue" />;
