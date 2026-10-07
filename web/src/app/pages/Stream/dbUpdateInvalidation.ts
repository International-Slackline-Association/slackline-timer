import type { QueryKey } from '@tanstack/react-query';

import { athleteKeys } from 'app/api/athletes';
import { competitionKeys } from 'app/api/competitions';
import { matchKeys } from 'app/api/matches';
import { rankingKeys } from 'app/api/rankings';
import { scoreKeys } from 'app/api/scores';
import { timeKeys } from 'app/api/times';
import type { DbUpdateWSMessage } from 'app/hooks/useWebSocket';

type DbUpdateEntity = DbUpdateWSMessage['data']['entity'];

/**
 * The query-key branches a `db_update` should invalidate, given its `entity` —
 * never a keyless `invalidateQueries()`, which re-pulls every overlay's queries
 * on each lane stop. Rankings join the athlete list and derive from
 * times/scores, so those entities also invalidate the rankings branch — and so
 * do matches, whose `winnerId`s drive the overall-standings placements (rule
 * G3); match writes are rare mid-run.
 */
export const dbUpdateQueryKeys = (compId: string, entity: DbUpdateEntity): QueryKey[] => {
  switch (entity) {
    case 'competition':
      return [competitionKeys.all];
    case 'athlete':
      return [athleteKeys.all(compId), rankingKeys.all(compId)];
    case 'time':
      return [timeKeys.all(compId), rankingKeys.all(compId)];
    case 'score':
      return [scoreKeys.all(compId), rankingKeys.all(compId)];
    case 'match':
      return [matchKeys.all(compId), rankingKeys.all(compId)];
  }
};

/**
 * Every branch any `db_update` for this competition could have invalidated —
 * the reconnect fallback. Relay delivery is at-most-once, so a `db_update`
 * lost while an overlay's socket was down would leave it stale until the next
 * unrelated write; on reopen we can't know which entity (if any) changed, so
 * all branches refresh. Still scoped — never a keyless `invalidateQueries()`.
 */
export const allDbUpdateQueryKeys = (compId: string): QueryKey[] => [
  competitionKeys.all,
  athleteKeys.all(compId),
  timeKeys.all(compId),
  scoreKeys.all(compId),
  matchKeys.all(compId),
  rankingKeys.all(compId),
];
