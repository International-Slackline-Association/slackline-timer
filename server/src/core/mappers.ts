import { COMP_META_SK, athleteSk, compPk, matchSk, scoreSk, timeSk } from './keys';
import { fullName, splitName } from './types';
import type { Athlete, Competition, Match, Score, Time } from './types';

/**
 * Pure DynamoDB item ↔ entity mappers for the competition table.
 * Key parts (round, gender, athleteId, …) are duplicated as plain attributes
 * so items stay self-describing and reads don't have to re-parse SKs.
 */

type Item = Record<string, unknown>;

const compact = <T extends Item>(obj: T): T => {
  const out: Item = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
};

export const competitionToItem = (c: Competition & { createdAt: number }): Item =>
  compact({ PK: compPk(c.compId), SK: COMP_META_SK, ...c });

export const itemToCompetition = (item: Item): Competition =>
  compact({
    compId: item.compId as string,
    name: item.name as string,
    startDate: item.startDate as string,
    endDate: item.endDate as string,
    tokenVersion: item.tokenVersion as number,
    config: item.config as Competition['config'] | undefined,
  });

export const athleteToItem = (a: Athlete): Item =>
  compact({ PK: compPk(a.compId), SK: athleteSk(a.athleteId), ...a });

export const itemToAthlete = (item: Item): Athlete => {
  // Records authored before the name split (ADR 0016) carry only `name`; derive
  // firstName/lastName so old rows self-heal on read without a backfill.
  // Computed unconditionally: gating it on `firstName === undefined` while the
  // reads below use `??` left a hole for a row holding an explicit DynamoDB NULL
  // — the gate said "present", `??` said "absent", and the fallback dereferenced
  // nothing, 500-ing the whole athlete list off one legacy row. `splitName` is
  // pure and cheap, so paying for it always is cheaper than the asymmetry.
  const split = splitName((item.name as string) ?? '');
  const firstName = (item.firstName as string | undefined) ?? split.firstName;
  const lastName = (item.lastName as string | undefined) ?? split.lastName;
  return compact({
    athleteId: item.athleteId as string,
    compId: item.compId as string,
    firstName,
    lastName,
    name: (item.name as string | undefined) ?? fullName(firstName, lastName),
    shortName: item.shortName as string | undefined,
    birthDate: item.birthDate as string,
    country: item.country as string,
    country2: item.country2 as string | undefined,
    gender: item.gender as Athlete['gender'],
    notes: item.notes as string | undefined,
    photoKey: item.photoKey as string | undefined,
  });
};

export const timeToItem = (t: Time): Item =>
  compact({ PK: compPk(t.compId), SK: timeSk(t.round, t.athleteId, t.timeId), ...t });

export const itemToTime = (item: Item): Time =>
  compact({
    timeId: item.timeId as string,
    compId: item.compId as string,
    athleteId: item.athleteId as string,
    round: item.round as Time['round'],
    timeMs: item.timeMs as number,
    startTime: item.startTime as number,
    matchId: item.matchId as string | undefined,
  });

export const matchToItem = (m: Match): Item =>
  compact({ PK: compPk(m.compId), SK: matchSk(m.discipline, m.gender, m.round, m.matchId), ...m });

export const itemToMatch = (item: Item): Match =>
  compact({
    matchId: item.matchId as string,
    compId: item.compId as string,
    discipline: item.discipline as Match['discipline'],
    round: item.round as Match['round'],
    roundName: item.roundName as string | undefined,
    gender: item.gender as Match['gender'],
    position: item.position as number,
    athlete1Id: item.athlete1Id as string | undefined,
    athlete2Id: item.athlete2Id as string | undefined,
    winnerId: item.winnerId as string | undefined,
  });

export const scoreToItem = (s: Score): Item =>
  compact({ PK: compPk(s.compId), SK: scoreSk(s.round, s.athleteId), ...s });

export const itemToScore = (item: Item): Score =>
  compact({
    scoreId: item.scoreId as string,
    compId: item.compId as string,
    athleteId: item.athleteId as string,
    round: item.round as Score['round'],
    difficulty: item.difficulty as number,
    combo: item.combo as number,
    style: item.style as number,
    bestTrick: item.bestTrick as number,
    controlPenalty: item.controlPenalty as number,
    overall: item.overall as number,
    ...(item.dnf === true ? { dnf: true } : {}),
    matchId: item.matchId as string | undefined,
  });

/**
 * SK fields are immutable in DynamoDB — editing them means delete + put in a
 * transaction. These decide which path an update takes.
 */
export const timeNeedsMove = (current: Time, next: Pick<Time, 'round' | 'athleteId'>): boolean =>
  current.round !== next.round || current.athleteId !== next.athleteId;

export const matchNeedsMove = (
  current: Match,
  next: Pick<Match, 'discipline' | 'round' | 'gender'>,
): boolean =>
  current.discipline !== next.discipline ||
  current.round !== next.round ||
  current.gender !== next.gender;

export const scoreNeedsMove = (current: Score, next: Pick<Score, 'round' | 'athleteId'>): boolean =>
  current.round !== next.round || current.athleteId !== next.athleteId;
