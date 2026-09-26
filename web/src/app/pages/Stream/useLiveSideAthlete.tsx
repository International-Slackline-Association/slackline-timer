import { useAthletes } from 'app/api/athletes';
import { useScores } from 'app/api/scores';
import { useTimes } from 'app/api/times';
import { type LiveSelection } from 'app/hooks/useWebSocket';
import { type MatchRound, type Athlete, type TimeRound } from 'app/types';
import { bestTimeMs, freestyleResultLabel } from 'app/util/resultLabel';
import { formatMs } from 'app/util/time';

/** A board side resolved to its athlete + the round result for the live discipline. */
export interface LiveSideAthlete {
  athlete: Athlete | undefined;
  /** Best time (speed) or judged overall / DNF (freestyle); undefined until resolved. */
  result: string | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Resolve one control-board side (`selection.athlete{side}Id`) to the display
 * fields the SVO card and the H2R bridge both need: the `Athlete` record and the
 * result for the board's current round/discipline. Only the active plane's query
 * runs, and only once the board has named an athlete on this side — a null
 * selection / empty side fetches nothing. Shared by `SvoLiveOverlay` and the
 * `/stream/bridge` page so the WS-selection → athlete → result join lives once.
 */
export const useLiveSideAthlete = (
  compId: string,
  side: 1 | 2,
  selection: LiveSelection | null,
  opts: { readToken?: string } = {},
): LiveSideAthlete => {
  const { readToken } = opts;
  const athleteId = side === 1 ? selection?.athlete1Id : selection?.athlete2Id;
  const isFreestyle = selection?.discipline === 'freestyle';
  const round = selection?.round;

  const athletes = useAthletes(athleteId ? compId : null, { readToken });
  const times = useTimes(
    !isFreestyle && athleteId ? compId : null,
    round as TimeRound | undefined,
    { readToken },
  );
  const scores = useScores(
    isFreestyle && athleteId ? compId : null,
    round as MatchRound | undefined,
    { readToken },
  );

  const athlete = athletes.data?.find((a) => a.athleteId === athleteId);

  let result: string | undefined;
  if (athleteId) {
    if (isFreestyle) {
      const score = (scores.data ?? []).find((s) => s.athleteId === athleteId);
      if (score) result = freestyleResultLabel(score);
    } else {
      const best = bestTimeMs((times.data ?? []).filter((t) => t.athleteId === athleteId));
      if (best !== undefined) result = formatMs(best);
    }
  }

  const active = isFreestyle ? scores : times;
  return {
    athlete,
    result,
    isLoading: athletes.isLoading || (Boolean(athleteId) && active.isLoading),
    isError: athletes.isError || active.isError,
  };
};
