import type { Match } from 'app/types';
import { roundLabel } from 'app/util/rounds';

/** Match option label: "Final #1 — Alice vs Bob" (round + position + assigned athletes). */
export const matchLabel = (match: Match, athleteName: (id?: string) => string): string =>
  `${roundLabel(match.round)} #${match.position} — ${athleteName(match.athlete1Id)} vs ${athleteName(
    match.athlete2Id,
  )}`;
