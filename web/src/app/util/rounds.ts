import {
  type Match,
  type MatchRound,
  type StandingsSource,
  type StandingsView,
  type TimeRound,
} from 'app/types';

/**
 * Human-friendly labels for Time rounds (plus the derived standings
 * pseudo-rounds), used in the times admin and rankings. These are the per-row
 * singular forms; `server/src/core/types.ts` `roundDisplayName` keeps the
 * plural header forms ("quarter-finals") used by ranking titles — keep both in
 * mind when wording overlay copy.
 */
const ROUND_LABELS: Record<TimeRound | StandingsView, string> = {
  test: 'Test',
  training: 'Training',
  qualification: 'Qualification',
  quarter: 'Quarter-finals',
  half: 'Semi-finals',
  small_final: 'Small final',
  final: 'Final',
  overall: 'Final standings',
  combined: 'Combined',
};

/** Display label for a round; unknown values pass through unchanged. */
export const roundLabel = (round: string): string =>
  ROUND_LABELS[round as TimeRound | StandingsView] ?? round;

/**
 * The Rounds a Freestyle board mode records into — format = mode (the ADR 0036
 * respec): quali IS the qualification round, battle IS a playoff match. `test`
 * stays in both as the full-component rehearsal round (locking it out of quali
 * would leave no way to rehearse the single-lane board).
 */
const MODE_ROUNDS: Record<'quali' | 'battle', readonly MatchRound[]> = {
  quali: ['test', 'qualification'],
  battle: ['test', 'quarter', 'half', 'small_final', 'final'],
};

export const roundsForMode = (mode: 'quali' | 'battle'): readonly MatchRound[] => MODE_ROUNDS[mode];

/** The round a mode switch normalizes an out-of-mode round to. */
export const defaultRoundForMode = (mode: 'quali' | 'battle'): MatchRound =>
  mode === 'quali' ? 'qualification' : 'quarter';

/**
 * Short broadcast caps tag for the round a standings placement was decided in
 * (rule G3). Distinct from `roundLabel`'s long headers: on an overall-standings
 * row it qualifies the raw result as "best time from the placing round", so a
 * slower time above a faster one reads as a bracket outcome, not a mis-sort.
 */
const STANDINGS_SOURCE_TAGS: Record<StandingsSource, string> = {
  final: 'FINAL',
  small_final: 'SMALL FINAL',
  half: 'SF',
  quarter: 'QF',
  qualification: 'QUALI',
};

export const standingsSourceTag = (source: StandingsSource): string =>
  STANDINGS_SOURCE_TAGS[source];

/**
 * The label to show for a match: its `roundName` override when set (non-empty),
 * otherwise the standard round label. The single source of the override rule —
 * route all match display through here.
 */
export const displayRoundName = (match: Pick<Match, 'round' | 'roundName'>): string =>
  match.roundName && match.roundName.trim() !== '' ? match.roundName : roundLabel(match.round);
