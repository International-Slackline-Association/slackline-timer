import { afterEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => {
  process.env.COMPETITION_TABLE = 'slackline-competition-test';
  return { sendMock: vi.fn() };
});

vi.mock('core/aws/clients', () => ({ ddb: { send: sendMock } }));

import { competitionDb } from 'core/competitionDb';
import type { Match, Score, Time } from 'core/types';

/**
 * Unit coverage for the SK-aware upserts: the attrs-vs-move dispatch and the
 * ConditionalCheckFailedException → ConditionFailed mapping (the concurrent-
 * delete race: the item vanished between the handler's read and the write).
 * The happy paths live in test/integration/competitionDb.int.test.ts.
 */

const conditionalCheckFailed = () =>
  Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });

const time: Time = {
  timeId: 't1',
  compId: 'c1',
  athleteId: 'a1',
  round: 'final',
  timeMs: 12_345,
  startTime: 1_700_000_000_000,
};

const match: Match = {
  matchId: 'm1',
  compId: 'c1',
  discipline: 'speed',
  round: 'final',
  roundName: 'Final 1',
  gender: 'male',
  position: 1,
};

const score: Score = {
  scoreId: 's1',
  compId: 'c1',
  athleteId: 'a1',
  round: 'final',
  difficulty: 8,
  combo: 7,
  style: 6,
  bestTrick: 9,
  controlPenalty: 2,
  overall: 28,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe.each([
  {
    name: 'upsertTime',
    upsertInPlace: (): Promise<void> => competitionDb.upsertTime(time, { ...time, timeMs: 99 }),
    upsertMoved: (): Promise<void> => competitionDb.upsertTime(time, { ...time, round: 'half' }),
    notFoundMessage: `time ${time.timeId} not found`,
    conflictMessage: `time ${time.timeId} move conflict`,
  },
  {
    name: 'upsertMatch',
    upsertInPlace: (): Promise<void> =>
      competitionDb.upsertMatch(match, { ...match, roundName: 'Semi' }),
    upsertMoved: (): Promise<void> =>
      competitionDb.upsertMatch(match, { ...match, gender: 'female' }),
    notFoundMessage: `match ${match.matchId} not found`,
    conflictMessage: `match ${match.matchId} move conflict`,
  },
  {
    name: 'upsertScore',
    upsertInPlace: (): Promise<void> => competitionDb.upsertScore(score, { ...score, overall: 30 }),
    upsertMoved: (): Promise<void> => competitionDb.upsertScore(score, { ...score, round: 'half' }),
    notFoundMessage: `score ${score.scoreId} not found`,
    conflictMessage: `score ${score.scoreId} move conflict`,
  },
])('competitionDb.$name', ({ upsertInPlace, upsertMoved, notFoundMessage, conflictMessage }) => {
  it('puts in place with the existence condition when the SK stands', async () => {
    sendMock.mockResolvedValueOnce({});

    await upsertInPlace();

    expect(sendMock.mock.calls[0][0].input.ConditionExpression).toBe('attribute_exists(PK)');
    expect(sendMock.mock.calls[0][0].input.TransactItems).toBeUndefined();
  });

  it('maps an in-place conditional-check failure to ConditionFailed(not_found)', async () => {
    sendMock.mockRejectedValueOnce(conditionalCheckFailed());

    await expect(upsertInPlace()).rejects.toMatchObject({
      name: 'ConditionFailed',
      kind: 'not_found',
      message: notFoundMessage,
    });
  });

  it('rewrites a changed SK as a transactional delete+put', async () => {
    sendMock.mockResolvedValueOnce({});

    await upsertMoved();

    const transactItems = sendMock.mock.calls[0][0].input.TransactItems;
    expect(transactItems).toHaveLength(2);
    expect(transactItems[0].Delete.ConditionExpression).toBe('attribute_exists(PK)');
    expect(transactItems[1].Put.ConditionExpression).toBe('attribute_not_exists(PK)');
  });

  it('maps a cancelled move transaction to ConditionFailed(conflict)', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }),
    );

    await expect(upsertMoved()).rejects.toMatchObject({
      name: 'ConditionFailed',
      kind: 'conflict',
      message: conflictMessage,
    });
  });

  it('rethrows unrelated errors untouched', async () => {
    const boom = Object.assign(new Error('throttled'), {
      name: 'ProvisionedThroughputExceededException',
    });
    sendMock.mockRejectedValueOnce(boom);

    await expect(upsertInPlace()).rejects.toBe(boom);
  });
});

describe('competitionDb manager grants (per-competition ACL)', () => {
  const grant = {
    sub: 'sub-1',
    email: 'a@b.co',
    grantedByEmail: 'admin@b.co',
    grantedBySub: 'admin-sub',
    grantedAt: 1_700_000_000_000,
  };

  it('grantManager writes the forward + reverse items in one transaction', async () => {
    sendMock.mockResolvedValueOnce({});

    await competitionDb.grantManager('c1', grant);

    const items = sendMock.mock.calls[0][0].input.TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Put.Item).toMatchObject({ PK: 'COMP#c1', SK: 'MANAGER#sub-1', sub: 'sub-1' });
    expect(items[1].Put.Item).toMatchObject({ PK: 'USER#sub-1', SK: 'COMP#c1', compId: 'c1' });
  });

  it('revokeManager deletes both items in one transaction', async () => {
    sendMock.mockResolvedValueOnce({});

    await competitionDb.revokeManager('c1', 'sub-1');

    const items = sendMock.mock.calls[0][0].input.TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Delete.Key).toEqual({ PK: 'COMP#c1', SK: 'MANAGER#sub-1' });
    expect(items[1].Delete.Key).toEqual({ PK: 'USER#sub-1', SK: 'COMP#c1' });
  });

  it('getManagerGrant returns the mapped grant, or null when absent', async () => {
    sendMock.mockResolvedValueOnce({ Item: { PK: 'COMP#c1', SK: 'MANAGER#sub-1', ...grant } });
    await expect(competitionDb.getManagerGrant('c1', 'sub-1')).resolves.toEqual(grant);

    sendMock.mockResolvedValueOnce({});
    await expect(competitionDb.getManagerGrant('c1', 'ghost')).resolves.toBeNull();
  });

  it('listManagers queries the MANAGER# prefix and sorts by email', async () => {
    sendMock.mockResolvedValueOnce({
      Items: [
        { ...grant, sub: 's2', email: 'z@b.co' },
        { ...grant, sub: 's1', email: 'a@b.co' },
      ],
    });

    const managers = await competitionDb.listManagers('c1');

    expect(sendMock.mock.calls[0][0].input.ExpressionAttributeValues).toMatchObject({
      ':pk': 'COMP#c1',
      ':prefix': 'MANAGER#',
    });
    expect(managers.map((m) => m.email)).toEqual(['a@b.co', 'z@b.co']);
  });

  it('listManagerCompIds reads the reverse USER# partition and parses compIds', async () => {
    sendMock.mockResolvedValueOnce({
      Items: [
        { PK: 'USER#sub-1', SK: 'COMP#worlds-2026' },
        { PK: 'USER#sub-1', SK: 'COMP#euros-2026' },
      ],
    });

    const compIds = await competitionDb.listManagerCompIds('sub-1');

    expect(sendMock.mock.calls[0][0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'USER#sub-1',
    });
    expect(compIds).toEqual(['worlds-2026', 'euros-2026']);
  });
});
