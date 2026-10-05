import { isTimeRound, type TimeRound } from 'app/types';

/**
 * The Speedline board's correction link, from both ends — the Times-page twin
 * of `scoresLink`. A lane whose save failed, or a DNF the inline field cannot
 * edit, points at the one row it recorded; the page seeds its filters from the
 * params, so the operator lands on that row instead of the whole table.
 */
const TIMES_ROUTE = '/admin/times';

/** The Times page filtered to the athlete and round a lane recorded under. */
export const timeCorrectionHref = (round: TimeRound, athleteId: string): string => {
  const params = new URLSearchParams();
  if (athleteId) params.set('athlete', athleteId);
  params.set('round', round);
  return `${TIMES_ROUTE}?${params}`;
};

/** What a Times-page URL asks for; `''` is the page's own "all" (no filter). */
export interface TimesFilterSeed {
  athleteId: string;
  round: string;
}

/**
 * The filters a link seeds the Times page with. A round outside the Time
 * sort-key vocabulary is dropped rather than applied — a stale link must not
 * leave the operator on an empty table under a picker showing nothing.
 */
export const timesFilterSeed = (search: string): TimesFilterSeed => {
  const params = new URLSearchParams(search);
  const round = params.get('round');
  return {
    athleteId: params.get('athlete') ?? '',
    round: isTimeRound(round) ? round : '',
  };
};
