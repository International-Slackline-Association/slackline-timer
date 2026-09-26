import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { ddb } from './aws/clients';
import {
  ATHLETE_SK_PREFIX,
  COMP_META_SK,
  MANAGER_SK_PREFIX,
  MATCH_SK_PREFIX,
  SCORE_SK_PREFIX,
  TIME_SK_PREFIX,
  athleteSk,
  compPk,
  managerSk,
  matchSk,
  matchSkPrefix,
  matchSkPrefixForDiscipline,
  matchSkPrefixForRound,
  parseUserCompSk,
  scoreSk,
  scoreSkPrefix,
  timeSk,
  timeSkPrefix,
  userCompSk,
  userPk,
} from './keys';
import {
  athleteToItem,
  competitionToItem,
  itemToAthlete,
  itemToCompetition,
  itemToMatch,
  itemToScore,
  itemToTime,
  matchNeedsMove,
  matchToItem,
  scoreNeedsMove,
  scoreToItem,
  timeNeedsMove,
  timeToItem,
} from './mappers';
import type {
  Athlete,
  Competition,
  Discipline,
  Gender,
  Match,
  MatchRound,
  Score,
  Time,
  TimeRound,
} from './types';

/**
 * Data access for the competition table (single-table; see core/keys.ts).
 * Mirrors the style of core/db.ts (the connections table) — thin wrappers
 * around the document client; all interesting logic lives in the tested pure
 * modules (keys, mappers, rankings, validators).
 */

const COMPETITION_TABLE = (): string => process.env.COMPETITION_TABLE!;

/**
 * A per-competition manager grant (competition ACL). Keyed by the manager's
 * immutable Cognito `sub`; `email` is stored denormalized for display only.
 */
export interface ManagerGrant {
  sub: string;
  email: string;
  grantedByEmail: string;
  grantedBySub: string;
  grantedAt: number;
}

/** Sentinel error for conditional-check failures, mapped to 404/409 by handlers. */
export class ConditionFailed extends Error {
  constructor(
    public readonly kind: 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'ConditionFailed';
  }
}

const isConditionalCheckFailed = (e: unknown): boolean =>
  (e as { name?: string })?.name === 'ConditionalCheckFailedException' ||
  (e as { name?: string })?.name === 'TransactionCanceledException';

const conditionalPut = async (
  item: Record<string, unknown>,
  condition: 'attribute_exists(PK)' | 'attribute_not_exists(PK)',
  failKind: ConditionFailed['kind'],
  failMessage: string,
): Promise<void> => {
  try {
    await ddb.send(
      new PutCommand({
        TableName: COMPETITION_TABLE(),
        Item: item,
        ConditionExpression: condition,
      }),
    );
  } catch (e) {
    if (isConditionalCheckFailed(e)) throw new ConditionFailed(failKind, failMessage);
    throw e;
  }
};

/**
 * SK-changing edit as a transactional delete+put: the old row must exist, the
 * new SK must be free, all-or-nothing. Either condition failing (item vanished,
 * or target slot taken) maps to ConditionFailed('conflict', conflictMessage).
 */
const moveItem = async (
  oldKey: Record<string, unknown>,
  newItem: Record<string, unknown>,
  conflictMessage: string,
): Promise<void> => {
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: COMPETITION_TABLE(),
              Key: oldKey,
              ConditionExpression: 'attribute_exists(PK)',
            },
          },
          {
            Put: {
              TableName: COMPETITION_TABLE(),
              Item: newItem,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
  } catch (e) {
    if (isConditionalCheckFailed(e)) throw new ConditionFailed('conflict', conflictMessage);
    throw e;
  }
};

const queryByPrefix = async (compId: string, prefix: string) => {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: COMPETITION_TABLE(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': compPk(compId), ':prefix': prefix },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return items;
};

// --- Competitions -----------------------------------------------------------

const createCompetition = (comp: Competition): Promise<void> =>
  conditionalPut(
    competitionToItem({ ...comp, createdAt: Date.now() }),
    'attribute_not_exists(PK)',
    'conflict',
    `competition ${comp.compId} already exists`,
  );

const getCompetition = async (compId: string): Promise<Competition | null> => {
  const result = await ddb.send(
    new GetCommand({
      TableName: COMPETITION_TABLE(),
      Key: { PK: compPk(compId), SK: COMP_META_SK },
    }),
  );
  return result.Item ? itemToCompetition(result.Item) : null;
};

/** Admin-only and rare; competitions are few, so a filtered scan is fine. */
const listCompetitions = async (): Promise<Competition[]> => {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: COMPETITION_TABLE(),
        FilterExpression: 'SK = :meta',
        ExpressionAttributeValues: { ':meta': COMP_META_SK },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return items.map(itemToCompetition).sort((a, b) => a.startDate.localeCompare(b.startDate));
};

/**
 * Edit the non-key META attributes (name/dates/config) in place — no SK dance,
 * and `tokenVersion`/`createdAt` are left untouched. `config` is removed when
 * absent so clearing it actually clears it. Rejects an unknown compId.
 */
const updateCompetition = async (
  compId: string,
  attrs: Pick<Competition, 'name' | 'startDate' | 'endDate'> & Pick<Competition, 'config'>,
): Promise<void> => {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: COMPETITION_TABLE(),
        Key: { PK: compPk(compId), SK: COMP_META_SK },
        UpdateExpression:
          'SET #name = :name, startDate = :startDate, endDate = :endDate' +
          (attrs.config ? ', config = :config' : ' REMOVE config'),
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
          ':name': attrs.name,
          ':startDate': attrs.startDate,
          ':endDate': attrs.endDate,
          ...(attrs.config ? { ':config': attrs.config } : {}),
        },
      }),
    );
  } catch (e) {
    if (isConditionalCheckFailed(e))
      throw new ConditionFailed('not_found', `competition ${compId} not found`);
    throw e;
  }
};

/** Revoke every outstanding read token for the competition. Returns the new version. */
const bumpTokenVersion = async (compId: string): Promise<number> => {
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: COMPETITION_TABLE(),
        Key: { PK: compPk(compId), SK: COMP_META_SK },
        UpdateExpression: 'SET tokenVersion = tokenVersion + :one',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return result.Attributes!.tokenVersion as number;
  } catch (e) {
    if (isConditionalCheckFailed(e))
      throw new ConditionFailed('not_found', `competition ${compId} not found`);
    throw e;
  }
};

// --- Athletes ---------------------------------------------------------------

const createAthlete = (athlete: Athlete): Promise<void> =>
  conditionalPut(
    athleteToItem(athlete),
    'attribute_not_exists(PK)',
    'conflict',
    `athlete ${athlete.athleteId} already exists`,
  );

const updateAthlete = (athlete: Athlete): Promise<void> =>
  conditionalPut(
    athleteToItem(athlete),
    'attribute_exists(PK)',
    'not_found',
    `athlete ${athlete.athleteId} not found`,
  );

const getAthlete = async (compId: string, athleteId: string): Promise<Athlete | null> => {
  const result = await ddb.send(
    new GetCommand({
      TableName: COMPETITION_TABLE(),
      Key: { PK: compPk(compId), SK: athleteSk(athleteId) },
    }),
  );
  return result.Item ? itemToAthlete(result.Item) : null;
};

const listAthletes = async (compId: string): Promise<Athlete[]> => {
  const items = await queryByPrefix(compId, ATHLETE_SK_PREFIX);
  return items.map(itemToAthlete).sort((a, b) => a.name.localeCompare(b.name));
};

const deleteAthlete = async (compId: string, athleteId: string): Promise<void> => {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: COMPETITION_TABLE(),
        Key: { PK: compPk(compId), SK: athleteSk(athleteId) },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch (e) {
    if (isConditionalCheckFailed(e))
      throw new ConditionFailed('not_found', `athlete ${athleteId} not found`);
    throw e;
  }
};

/**
 * Does the partition hold at least one item matching `filter` under `prefix`?
 * A server-side `FilterExpression` keeps only matching items off the wire, and
 * we stop at the first page that yields one — so a referenced athlete short-
 * circuits cheaply instead of materializing the whole entity list. (`Limit`
 * bounds items *scanned* per page, not returned after the filter, so we still
 * page to the end to prove a *negative*; the win is the early exit + no
 * mapper/array churn.)
 */
const anyMatch = async (
  compId: string,
  prefix: string,
  filter: { expr: string; values: Record<string, unknown> },
): Promise<boolean> => {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: COMPETITION_TABLE(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: filter.expr,
        ExpressionAttributeValues: { ':pk': compPk(compId), ':prefix': prefix, ...filter.values },
        Limit: 200,
        ExclusiveStartKey: lastKey,
      }),
    );
    if ((page.Items?.length ?? 0) > 0) return true;
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return false;
};

/**
 * Referential integrity is on us (no FKs in DynamoDB): deleting an athlete is
 * blocked while a Time, Match or Score references them. A cheap existence check
 * (filter + early-exit per entity), not a full partition listing.
 */
const athleteHasReferences = async (
  compId: string,
  athleteId: string,
): Promise<{ times: boolean; matches: boolean; scores: boolean }> => {
  const [times, matches, scores] = await Promise.all([
    anyMatch(compId, TIME_SK_PREFIX, {
      expr: 'athleteId = :aid',
      values: { ':aid': athleteId },
    }),
    anyMatch(compId, MATCH_SK_PREFIX, {
      expr: 'athlete1Id = :aid OR athlete2Id = :aid OR winnerId = :aid',
      values: { ':aid': athleteId },
    }),
    anyMatch(compId, SCORE_SK_PREFIX, {
      expr: 'athleteId = :aid',
      values: { ':aid': athleteId },
    }),
  ]);
  return { times, matches, scores };
};

// --- Times ------------------------------------------------------------------

const createTime = (time: Time): Promise<void> =>
  conditionalPut(
    timeToItem(time),
    'attribute_not_exists(PK)',
    'conflict',
    `time ${time.timeId} already exists`,
  );

const listTimes = async (compId: string, round?: TimeRound): Promise<Time[]> => {
  const items = await queryByPrefix(compId, round ? timeSkPrefix(round) : TIME_SK_PREFIX);
  return items.map(itemToTime);
};

/**
 * The API addresses a Time by id alone; the full SK is recovered by listing the
 * partition. Accepted at current scale (one competition's worth of rows); a GSI
 * on the id is deferred until partitions are large enough to feel it.
 */
const findTimeById = async (compId: string, timeId: string): Promise<Time | null> => {
  const times = await listTimes(compId);
  return times.find((t) => t.timeId === timeId) ?? null;
};

/**
 * SK-aware update: an attribute-only edit (timeMs / startTime) puts in place;
 * a changed round/athleteId rewrites the SK as a transactional delete + put.
 */
const upsertTime = (existing: Time, next: Time): Promise<void> =>
  timeNeedsMove(existing, next)
    ? moveItem(
        {
          PK: compPk(existing.compId),
          SK: timeSk(existing.round, existing.athleteId, existing.timeId),
        },
        timeToItem(next),
        `time ${existing.timeId} move conflict`,
      )
    : conditionalPut(
        timeToItem(next),
        'attribute_exists(PK)',
        'not_found',
        `time ${next.timeId} not found`,
      );

const deleteTime = async (time: Time): Promise<void> => {
  await ddb.send(
    new DeleteCommand({
      TableName: COMPETITION_TABLE(),
      Key: { PK: compPk(time.compId), SK: timeSk(time.round, time.athleteId, time.timeId) },
    }),
  );
};

// --- Matches ----------------------------------------------------------------

const createMatch = (match: Match): Promise<void> =>
  conditionalPut(
    matchToItem(match),
    'attribute_not_exists(PK)',
    'conflict',
    `match ${match.matchId} already exists`,
  );

const listMatches = async (
  compId: string,
  discipline?: Discipline,
  gender?: Gender,
  round?: Match['round'],
): Promise<Match[]> => {
  const prefix = discipline
    ? gender
      ? round
        ? matchSkPrefixForRound(discipline, gender, round)
        : matchSkPrefix(discipline, gender)
      : matchSkPrefixForDiscipline(discipline)
    : MATCH_SK_PREFIX;
  const items = await queryByPrefix(compId, prefix);
  return items.map(itemToMatch).sort((a, b) => a.position - b.position);
};

/** Same trade-off as findTimeById: by-id lookup scans this competition partition (GSI deferred). */
const findMatchById = async (compId: string, matchId: string): Promise<Match | null> => {
  const matches = await listMatches(compId);
  return matches.find((m) => m.matchId === matchId) ?? null;
};

/** SK-aware update, like upsertTime (the SK here is discipline/gender/round). */
const upsertMatch = (existing: Match, next: Match): Promise<void> =>
  matchNeedsMove(existing, next)
    ? moveItem(
        {
          PK: compPk(existing.compId),
          SK: matchSk(existing.discipline, existing.gender, existing.round, existing.matchId),
        },
        matchToItem(next),
        `match ${existing.matchId} move conflict`,
      )
    : conditionalPut(
        matchToItem(next),
        'attribute_exists(PK)',
        'not_found',
        `match ${next.matchId} not found`,
      );

const deleteMatch = async (match: Match): Promise<void> => {
  await ddb.send(
    new DeleteCommand({
      TableName: COMPETITION_TABLE(),
      Key: {
        PK: compPk(match.compId),
        SK: matchSk(match.discipline, match.gender, match.round, match.matchId),
      },
    }),
  );
};

/**
 * Write a set of bracket matches in ONE transaction (atomic seed/advance).
 * The handler decides create-vs-overwrite and enforces the conflict/force
 * semantics in code (it must read existing slots to compare athletes), so the
 * Puts here are unconditional — either all the bracket rows land or none do.
 * Well within the 25-item TransactWriteItems cap (seed 4, advance ≤ 3).
 */
const writeBracketMatches = async (matches: Match[]): Promise<void> => {
  if (matches.length === 0) return;
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: matches.map((match) => ({
        Put: {
          TableName: COMPETITION_TABLE(),
          Item: matchToItem(match),
        },
      })),
    }),
  );
};

// --- Scores -----------------------------------------------------------------

const createScore = (score: Score): Promise<void> =>
  conditionalPut(
    scoreToItem(score),
    'attribute_not_exists(PK)',
    'conflict',
    `score for athlete ${score.athleteId} in round ${score.round} already exists`,
  );

const listScores = async (compId: string, round?: MatchRound): Promise<Score[]> => {
  const items = await queryByPrefix(compId, round ? scoreSkPrefix(round) : SCORE_SK_PREFIX);
  return items.map(itemToScore);
};

/** Same trade-off as findTimeById: by-id lookup scans this competition partition (GSI deferred). */
const findScoreById = async (compId: string, scoreId: string): Promise<Score | null> => {
  const scores = await listScores(compId);
  return scores.find((s) => s.scoreId === scoreId) ?? null;
};

/**
 * Direct by-key read — the SK is fully determined by (round, athleteId), the
 * Score's identity. Lets the POST upsert reuse an existing record's scoreId
 * (ADR 0010/0013) without scanning.
 */
const getScore = async (
  compId: string,
  round: MatchRound,
  athleteId: string,
): Promise<Score | null> => {
  const result = await ddb.send(
    new GetCommand({
      TableName: COMPETITION_TABLE(),
      Key: { PK: compPk(compId), SK: scoreSk(round, athleteId) },
    }),
  );
  return result.Item ? itemToScore(result.Item) : null;
};

/** SK-aware update, like upsertTime (the SK here is round/athleteId). */
const upsertScore = (existing: Score, next: Score): Promise<void> =>
  scoreNeedsMove(existing, next)
    ? moveItem(
        {
          PK: compPk(existing.compId),
          SK: scoreSk(existing.round, existing.athleteId),
        },
        scoreToItem(next),
        `score ${existing.scoreId} move conflict`,
      )
    : conditionalPut(
        scoreToItem(next),
        'attribute_exists(PK)',
        'not_found',
        `score ${next.scoreId} not found`,
      );

const deleteScore = async (score: Score): Promise<void> => {
  await ddb.send(
    new DeleteCommand({
      TableName: COMPETITION_TABLE(),
      Key: { PK: compPk(score.compId), SK: scoreSk(score.round, score.athleteId) },
    }),
  );
};

// --- Manager grants (per-competition ACL) -----------------------------------

/**
 * Grant a user manager access to a competition. Writes the forward
 * (COMP#/MANAGER#) and reverse (USER#/COMP#) items in one transaction so the two
 * lookup directions never drift. Idempotent: re-granting overwrites the record.
 */
const grantManager = async (compId: string, grant: ManagerGrant): Promise<void> => {
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: COMPETITION_TABLE(),
            Item: { PK: compPk(compId), SK: managerSk(grant.sub), compId, ...grant },
          },
        },
        {
          Put: {
            TableName: COMPETITION_TABLE(),
            Item: { PK: userPk(grant.sub), SK: userCompSk(compId), compId, sub: grant.sub },
          },
        },
      ],
    }),
  );
};

/** Revoke a user's manager access; removes both grant items. Idempotent. */
const revokeManager = async (compId: string, sub: string): Promise<void> => {
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: COMPETITION_TABLE(),
            Key: { PK: compPk(compId), SK: managerSk(sub) },
          },
        },
        {
          Delete: {
            TableName: COMPETITION_TABLE(),
            Key: { PK: userPk(sub), SK: userCompSk(compId) },
          },
        },
      ],
    }),
  );
};

/** The authorization check: does this user hold a manager grant on this comp? */
const getManagerGrant = async (compId: string, sub: string): Promise<ManagerGrant | null> => {
  const result = await ddb.send(
    new GetCommand({
      TableName: COMPETITION_TABLE(),
      Key: { PK: compPk(compId), SK: managerSk(sub) },
    }),
  );
  return result.Item ? itemToManagerGrant(result.Item) : null;
};

const listManagers = async (compId: string): Promise<ManagerGrant[]> => {
  const items = await queryByPrefix(compId, MANAGER_SK_PREFIX);
  return items.map(itemToManagerGrant).sort((a, b) => a.email.localeCompare(b.email));
};

/** List the compIds a manager has been granted (drives their filtered comp list). */
const listManagerCompIds = async (sub: string): Promise<string[]> => {
  const compIds: string[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: COMPETITION_TABLE(),
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': userPk(sub) },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const parsed = parseUserCompSk(item.SK as string);
      if (parsed) compIds.push(parsed.compId);
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return compIds;
};

const itemToManagerGrant = (item: Record<string, unknown>): ManagerGrant => ({
  sub: item.sub as string,
  email: item.email as string,
  grantedByEmail: item.grantedByEmail as string,
  grantedBySub: item.grantedBySub as string,
  grantedAt: item.grantedAt as number,
});

export const competitionDb = {
  createCompetition,
  getCompetition,
  listCompetitions,
  updateCompetition,
  bumpTokenVersion,
  createAthlete,
  updateAthlete,
  getAthlete,
  listAthletes,
  deleteAthlete,
  athleteHasReferences,
  createTime,
  listTimes,
  findTimeById,
  upsertTime,
  deleteTime,
  createMatch,
  listMatches,
  findMatchById,
  upsertMatch,
  deleteMatch,
  writeBracketMatches,
  createScore,
  listScores,
  findScoreById,
  getScore,
  upsertScore,
  deleteScore,
  grantManager,
  revokeManager,
  getManagerGrant,
  listManagers,
  listManagerCompIds,
};
