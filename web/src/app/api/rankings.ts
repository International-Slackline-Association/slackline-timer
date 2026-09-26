import { useQuery } from '@tanstack/react-query';

import { apiFetch } from 'app/api/client';
import type {
  CombinedEntry,
  Discipline,
  Gender,
  RankedAthlete,
  StandingsEntry,
  TimeRound,
} from 'app/types';

/**
 * Read-only: the server joins a round's times against the athlete list and
 * ranks by best (minimum) time, DNF sorting last by its sentinel value (see
 * server/src/core/rankings.ts). For the freestyle discipline the server ranks
 * by the judged `overall` instead.
 */

export const rankingKeys = {
  all: (compId: string) => ['rankings', compId] as const,
  view: (
    compId: string,
    round: TimeRound,
    gender: Gender,
    allTimes: boolean,
    discipline?: Discipline,
  ) =>
    [
      ...rankingKeys.all(compId),
      round,
      gender,
      allTimes ? 'all' : 'best',
      discipline ?? 'all',
    ] as const,
  standings: (compId: string, gender: Gender, discipline?: Discipline) =>
    [...rankingKeys.all(compId), 'overall', gender, discipline ?? 'speed'] as const,
  combined: (compId: string, gender: Gender) =>
    [...rankingKeys.all(compId), 'combined', gender] as const,
};

export const useRankings = (
  compId: string | null,
  round: TimeRound,
  gender: Gender,
  opts: { allTimes?: boolean; discipline?: Discipline; readToken?: string } = {},
) => {
  const allTimes = opts.allTimes ?? false;
  return useQuery({
    queryKey: rankingKeys.view(compId ?? '', round, gender, allTimes, opts.discipline),
    enabled: compId != null,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ gender });
      if (allTimes) params.set('allTimes', 'true');
      if (opts.discipline) params.set('discipline', opts.discipline);
      return apiFetch<RankedAthlete[]>(`/competitions/${compId}/rankings/${round}?${params}`, {
        signal,
        readToken: opts.readToken,
      });
    },
  });
};

/**
 * Final overall standings (rule G3): the `overall` pseudo-round merging bracket
 * outcomes with the qualification ranking (see server/src/core/standings.ts).
 * Keyed under `rankingKeys.all` so the shared db_update invalidation (times,
 * scores, athletes — and matches, whose winners drive the placements) covers it.
 */
export const useOverallStandings = (
  compId: string | null,
  gender: Gender,
  opts: { discipline?: Discipline; readToken?: string } = {},
) =>
  useQuery({
    queryKey: rankingKeys.standings(compId ?? '', gender, opts.discipline),
    enabled: compId != null,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ gender });
      if (opts.discipline) params.set('discipline', opts.discipline);
      return apiFetch<StandingsEntry[]>(`/competitions/${compId}/rankings/overall?${params}`, {
        signal,
        readToken: opts.readToken,
      });
    },
  });

/**
 * The combined title (rule G2): the `combined` pseudo-round averaging an
 * athlete's speed and freestyle overall placements (see
 * server/src/core/standings.ts). Cross-discipline by definition, so there is
 * no discipline option; keyed under `rankingKeys.all` for the same shared
 * invalidation coverage as the standings.
 */
export const useCombinedRanking = (
  compId: string | null,
  gender: Gender,
  opts: { readToken?: string } = {},
) =>
  useQuery({
    queryKey: rankingKeys.combined(compId ?? '', gender),
    enabled: compId != null,
    queryFn: ({ signal }) =>
      apiFetch<CombinedEntry[]>(`/competitions/${compId}/rankings/combined?gender=${gender}`, {
        signal,
        readToken: opts.readToken,
      }),
  });
