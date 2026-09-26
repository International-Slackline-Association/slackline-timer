/**
 * DynamoDB single-table key builders for the competition data plane.
 *
 * Layout (PK = competition, SK prefix = entity):
 *   Athlete  PK=COMP#<compId>  SK=ATHLETE#<athleteId>
 *   Time     PK=COMP#<compId>  SK=TIME#<round>#<athleteId>#<timeId>
 *   Match    PK=COMP#<compId>  SK=MATCH#<discipline>#<gender>#<round>#<matchId>
 *   Score    PK=COMP#<compId>  SK=SCORE#<round>#<athleteId>
 *   Manager  PK=COMP#<compId>  SK=MANAGER#<sub>   (+ reverse USER#<sub> / COMP#<compId>)
 *
 * The SK prefixes let us `begins_with` query all times in a round or all matches
 * for a discipline without a GSI. See doc/dev/architecture.md ("Data model").
 */

export const compPk = (compId: string): string => `COMP#${compId}`;

/** SK of the competition metadata item (name, dates, tokenVersion). */
export const COMP_META_SK = 'META';

export const athleteSk = (athleteId: string): string => `ATHLETE#${athleteId}`;

export const ATHLETE_SK_PREFIX = 'ATHLETE#';

export const timeSk = (round: string, athleteId: string, timeId: string): string =>
  `TIME#${round}#${athleteId}#${timeId}`;

export const timeSkPrefix = (round: string): string => `TIME#${round}#`;

/** Prefix matching every Time in the competition regardless of round. */
export const TIME_SK_PREFIX = 'TIME#';

export const matchSk = (
  discipline: string,
  gender: string,
  round: string,
  matchId: string,
): string => `MATCH#${discipline}#${gender}#${round}#${matchId}`;

/** Prefix matching every Match in one discipline (the bracket for that discipline). */
export const matchSkPrefixForDiscipline = (discipline: string): string => `MATCH#${discipline}#`;

export const matchSkPrefix = (discipline: string, gender: string): string =>
  `MATCH#${discipline}#${gender}#`;

export const matchSkPrefixForRound = (discipline: string, gender: string, round: string): string =>
  `MATCH#${discipline}#${gender}#${round}#`;

/** Prefix matching every Match in the competition regardless of discipline. */
export const MATCH_SK_PREFIX = 'MATCH#';

export const scoreSk = (round: string, athleteId: string): string => `SCORE#${round}#${athleteId}`;

/**
 * Manager-grant records (per-competition ACL). Two items per grant give both
 * lookup directions without a GSI:
 *   Forward  PK=COMP#<compId>  SK=MANAGER#<sub>   — list a comp's managers, check access
 *   Reverse  PK=USER#<sub>     SK=COMP#<compId>   — list a manager's competitions
 * The `sub` is the caller's immutable Cognito subject (grant identity).
 */
export const managerSk = (sub: string): string => `MANAGER#${sub}`;

/** Prefix matching every manager grant on a competition. */
export const MANAGER_SK_PREFIX = 'MANAGER#';

export const userPk = (sub: string): string => `USER#${sub}`;

export const userCompSk = (compId: string): string => `COMP#${compId}`;

export const parseUserCompSk = (sk: string): { compId: string } | null => {
  const parts = sk.split('#');
  if (parts.length !== 2 || parts[0] !== 'COMP') return null;
  return { compId: parts[1] };
};

export const scoreSkPrefix = (round: string): string => `SCORE#${round}#`;

/** Prefix matching every Score in the competition regardless of round. */
export const SCORE_SK_PREFIX = 'SCORE#';

export interface ParsedTimeSk {
  round: string;
  athleteId: string;
  timeId: string;
}

export const parseTimeSk = (sk: string): ParsedTimeSk | null => {
  const parts = sk.split('#');
  if (parts.length !== 4 || parts[0] !== 'TIME') return null;
  const [, round, athleteId, timeId] = parts;
  return { round, athleteId, timeId };
};

export interface ParsedMatchSk {
  discipline: string;
  gender: string;
  round: string;
  matchId: string;
}

export const parseMatchSk = (sk: string): ParsedMatchSk | null => {
  const parts = sk.split('#');
  if (parts.length !== 5 || parts[0] !== 'MATCH') return null;
  const [, discipline, gender, round, matchId] = parts;
  return { discipline, gender, round, matchId };
};

export interface ParsedScoreSk {
  round: string;
  athleteId: string;
}

export const parseScoreSk = (sk: string): ParsedScoreSk | null => {
  const parts = sk.split('#');
  if (parts.length !== 3 || parts[0] !== 'SCORE') return null;
  const [, round, athleteId] = parts;
  return { round, athleteId };
};

export const parseAthleteSk = (sk: string): { athleteId: string } | null => {
  const parts = sk.split('#');
  if (parts.length !== 2 || parts[0] !== 'ATHLETE') return null;
  return { athleteId: parts[1] };
};
