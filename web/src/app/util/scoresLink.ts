import { isMatchRound, type MatchRound } from 'app/types';

/**
 * The correction link, from both ends (FREESTYLE_BOARD_UX §4.9 / B4). A saved
 * panel on the Freestyle board owns no correction path — the score POST upserts
 * on `SCORE#<round>#<athleteId>`, so the board locks and points at the Scores
 * page instead. That makes the landing the whole path: the operator arrives
 * mid-competition after ONE row, and every filter they set by hand there is
 * time spent off the slackline. The board writes the params and the page seeds
 * its filters from them; this module is where the two ends agree on the names.
 */
const SCORES_ROUTE = '/admin/scores';

/** The Scores page filtered to the one recorded score a locked panel names. */
export const scoreCorrectionHref = (round: MatchRound, athleteId: string): string => {
  const params = new URLSearchParams();
  // An unassigned player cannot be saved, so this guards the caller only — the
  // round alone still lands closer than the unfiltered table.
  if (athleteId) params.set('athlete', athleteId);
  params.set('round', round);
  return `${SCORES_ROUTE}?${params}`;
};

/** What a Scores-page URL asks for; `''` is the page's own "all" (no filter). */
export interface ScoresFilterSeed {
  athleteId: string;
  round: string;
}

/**
 * The filters a link seeds the Scores page with. A round outside the sort-key
 * vocabulary is dropped rather than applied — a stale link must not leave the
 * operator on an empty table under a picker showing nothing.
 */
export const scoresFilterSeed = (search: string): ScoresFilterSeed => {
  const params = new URLSearchParams(search);
  const round = params.get('round');
  return {
    athleteId: params.get('athlete') ?? '',
    round: isMatchRound(round) ? round : '',
  };
};
