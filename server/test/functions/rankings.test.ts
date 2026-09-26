import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from 'core/http';
import type { Athlete, Score, Time } from 'core/types';

const { getCompetitionMock, listAthletesMock, listTimesMock, listScoresMock, listMatchesMock } =
  vi.hoisted(() => ({
    getCompetitionMock: vi.fn(),
    listAthletesMock: vi.fn(),
    listTimesMock: vi.fn(),
    listScoresMock: vi.fn(),
    listMatchesMock: vi.fn(),
  }));

vi.mock('core/competitionDb', () => ({
  competitionDb: {
    getCompetition: getCompetitionMock,
    listAthletes: listAthletesMock,
    listTimes: listTimesMock,
    listScores: listScoresMock,
    listMatches: listMatchesMock,
  },
}));
// No signer configured → photoUrl is omitted; we assert on the broadcast fields only.
vi.mock('core/aws/clients', () => ({ s3: {} }));

import { main } from '@functions/rankings/handler';

const COMP = 'worlds-2026';

const athlete: Athlete = {
  athleteId: 'a1',
  compId: COMP,
  firstName: 'Lea',
  lastName: 'Müller',
  name: 'Lea Müller',
  shortName: 'L. Müller',
  birthDate: '1995-04-12',
  country: 'DE',
  country2: 'CH',
  gender: 'female',
  notes: 'allergic to bees',
  photoKey: 'photos/worlds-2026/abc.png',
};

const time: Time = {
  timeId: 't1',
  compId: COMP,
  athleteId: 'a1',
  round: 'qualification',
  timeMs: 12_345,
  startTime: 1_700_000_000_000,
};

const score: Score = {
  scoreId: 's1',
  compId: COMP,
  athleteId: 'a1',
  round: 'qualification',
  difficulty: 7,
  combo: 8,
  style: 8,
  bestTrick: 9,
  controlPenalty: 1,
  overall: 31,
};

type Event = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthContext>;

const event = (
  overrides: {
    role?: AuthContext['role'];
    discipline?: string;
    round?: string;
    gender?: string;
  } = {},
): Event =>
  ({
    routeKey: 'GET /competitions/{compId}/rankings/{round}',
    pathParameters: { compId: COMP, round: overrides.round ?? 'qualification' },
    queryStringParameters: {
      ...(overrides.gender === '' ? {} : { gender: overrides.gender ?? 'female' }),
      ...(overrides.discipline ? { discipline: overrides.discipline } : {}),
    },
    requestContext: {
      authorizer: {
        lambda: {
          role: overrides.role ?? 'admin',
          compId: overrides.role === 'reader' ? COMP : '*',
        },
      },
    },
  }) as unknown as Event;

const invoke = async (e: Event) => {
  const res = (await main(e, {} as never, () => undefined)) as { statusCode: number; body: string };
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};

beforeEach(() => {
  getCompetitionMock.mockResolvedValue({ compId: COMP, endDate: '2026-12-31' });
  listAthletesMock.mockResolvedValue([athlete]);
  listTimesMock.mockResolvedValue([time]);
  listScoresMock.mockResolvedValue([score]);
  listMatchesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('rankings handler — reader PII strip', () => {
  it('returns full athlete PII to an admin (speed)', async () => {
    const res = await invoke(event({ role: 'admin' }));

    expect(res.statusCode).toBe(200);
    expect(res.body[0].athlete).toMatchObject({
      birthDate: '1995-04-12',
      notes: 'allergic to bees',
    });
  });

  it('strips birthDate and notes from a reader speed ranking, keeping broadcast fields', async () => {
    const res = await invoke(event({ role: 'reader' }));

    expect(res.statusCode).toBe(200);
    const entry = res.body[0];
    expect(entry.athlete).not.toHaveProperty('birthDate');
    expect(entry.athlete).not.toHaveProperty('notes');
    expect(entry.bestTimeMs).toBe(12_345);
    // Broadcast fields the overlays render survive.
    expect(entry.athlete).toMatchObject({
      athleteId: 'a1',
      firstName: 'Lea',
      lastName: 'Müller',
      name: 'Lea Müller',
      shortName: 'L. Müller',
      country: 'DE',
      country2: 'CH',
      gender: 'female',
      photoKey: 'photos/worlds-2026/abc.png',
    });
  });

  it('strips PII from a reader freestyle ranking', async () => {
    const res = await invoke(event({ role: 'reader', discipline: 'freestyle' }));

    expect(res.statusCode).toBe(200);
    const entry = res.body[0];
    expect(entry.athlete).not.toHaveProperty('birthDate');
    expect(entry.athlete).not.toHaveProperty('notes');
    expect(entry.overall).toBe(31);
    expect(entry.athlete).toMatchObject({ name: 'Lea Müller', country: 'DE' });
  });
});

describe('rankings handler — overall standings (round=overall)', () => {
  const fem = (athleteId: string, name: string): Athlete => ({ ...athlete, athleteId, name });
  const t = (athleteId: string, round: Time['round'], timeMs: number): Time => ({
    ...time,
    timeId: `${athleteId}-${round}`,
    athleteId,
    round,
    timeMs,
  });

  it('merges the bracket with quali on the speed plane and strips reader PII', async () => {
    listAthletesMock.mockResolvedValue([
      fem('a1', 'Lea Müller'),
      fem('a2', 'Mia Roe'),
      fem('a3', 'Zoe Poe'),
      fem('a4', 'Kim Loe'),
    ]);
    // a4 is bracket-placed with no Time at all → a resultless row.
    listTimesMock.mockResolvedValue([
      t('a1', 'qualification', 10_000),
      t('a2', 'qualification', 11_000),
      t('a3', 'qualification', 12_000),
    ]);
    listMatchesMock.mockResolvedValue([
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        gender: 'female',
        position: 1,
        athlete1Id: 'a1',
        athlete2Id: 'a4',
        winnerId: 'a1',
      },
    ]);

    const res = await invoke(event({ role: 'reader', round: 'overall' }));

    expect(res.statusCode).toBe(200);
    expect(listMatchesMock).toHaveBeenCalledWith(COMP, 'speed', 'female');
    expect(
      res.body.map((e: { rank: number; athlete: { athleteId: string }; source: string }) => [
        e.rank,
        e.athlete.athleteId,
        e.source,
      ]),
    ).toEqual([
      // a1 won the final but has no final-round Time → the row reports the
      // round its VALUE came from (quali), never the placement round.
      [1, 'a1', 'qualification'],
      // a4 has no Time anywhere → no value to attribute, so the placement round stands.
      [2, 'a4', 'final'],
      [3, 'a2', 'qualification'],
      [4, 'a3', 'qualification'],
    ]);
    // No final-round time → the winner's result falls back to quali.
    expect(res.body[0].bestTimeMs).toBe(10_000);
    expect(res.body[1]).not.toHaveProperty('bestTimeMs');
    expect(res.body[0]).not.toHaveProperty('provisional');
    expect(res.body[0].athlete).not.toHaveProperty('birthDate');
    expect(res.body[0].athlete).not.toHaveProperty('notes');
  });

  it('serves freestyle standings off matches + scores, flagging undecided pairs provisional', async () => {
    listAthletesMock.mockResolvedValue([fem('a1', 'Lea Müller'), fem('a2', 'Mia Roe')]);
    listScoresMock.mockResolvedValue([
      { ...score, scoreId: 'q1', athleteId: 'a1', round: 'qualification', overall: 31 },
      { ...score, scoreId: 'q2', athleteId: 'a2', round: 'qualification', overall: 25 },
      { ...score, scoreId: 'f2', athleteId: 'a2', round: 'final', overall: 40 },
    ]);
    listMatchesMock.mockResolvedValue([
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'freestyle',
        round: 'final',
        gender: 'female',
        position: 1,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
    ]);

    const res = await invoke(event({ round: 'overall', discipline: 'freestyle' }));

    expect(res.statusCode).toBe(200);
    expect(listMatchesMock).toHaveBeenCalledWith(COMP, 'freestyle', 'female');
    // Undecided final → both by quali order, provisional.
    expect(
      res.body.map(
        (e: {
          rank: number;
          athlete: { athleteId: string };
          provisional?: boolean;
          overall: number;
          source: string;
        }) => [e.rank, e.athlete.athleteId, e.provisional, e.overall, e.source],
      ),
    ).toEqual([
      // a1 has no final score → quali fallback, so the row reports `qualification`;
      // a2 shows its final-round score and keeps `final`.
      [1, 'a1', true, 31, 'qualification'],
      [2, 'a2', true, 40, 'final'],
    ]);
  });

  it('keeps the placement round as the source when that round holds the result', async () => {
    listAthletesMock.mockResolvedValue([fem('a1', 'Lea Müller'), fem('a2', 'Mia Roe')]);
    listTimesMock.mockResolvedValue([
      t('a1', 'qualification', 10_000),
      t('a2', 'qualification', 11_000),
      // a1 actually ran the final → the placing round owns the value.
      t('a1', 'final', 9_000),
    ]);
    listMatchesMock.mockResolvedValue([
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        gender: 'female',
        position: 1,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      },
    ]);

    const res = await invoke(event({ round: 'overall' }));

    expect(
      res.body.map((e: { source: string; bestTimeMs?: number }) => [e.source, e.bestTimeMs]),
    ).toEqual([
      ['final', 9_000],
      ['qualification', 11_000],
    ]);
  });

  it('requires a valid gender for the overall view (400)', async () => {
    const res = await invoke(event({ round: 'overall', gender: '' }));
    expect(res.statusCode).toBe(400);
  });
});

describe('rankings handler — combined ranking (round=combined)', () => {
  const fem = (athleteId: string, name: string): Athlete => ({ ...athlete, athleteId, name });
  const quali = (athleteId: string, timeMs: number): Time => ({
    ...time,
    timeId: `${athleteId}-q`,
    athleteId,
    timeMs,
  });
  const qualiScore = (athleteId: string, overall: number): Score => ({
    ...score,
    scoreId: `${athleteId}-q`,
    athleteId,
    overall,
  });
  const finalMatch = (discipline: 'speed' | 'freestyle', winnerId: string, loserId: string) => ({
    matchId: `${discipline}-final`,
    compId: COMP,
    discipline,
    round: 'final',
    gender: 'female',
    position: 1,
    athlete1Id: winnerId,
    athlete2Id: loserId,
    winnerId,
  });

  it('averages the per-discipline placements over one bare match query, intersection only', async () => {
    listAthletesMock.mockResolvedValue([
      fem('a1', 'Lea Müller'),
      fem('a2', 'Mia Roe'),
      fem('a3', 'Zoe Poe'),
    ]);
    // Speed quali: a1, a2 (a3 has no time → speed placement missing).
    listTimesMock.mockResolvedValue([quali('a1', 10_000), quali('a2', 11_000)]);
    // Freestyle quali: all three.
    listScoresMock.mockResolvedValue([
      qualiScore('a1', 20),
      qualiScore('a2', 31),
      qualiScore('a3', 25),
    ]);
    // Decided finals flip each discipline's quali order.
    listMatchesMock.mockResolvedValue([
      finalMatch('speed', 'a2', 'a1'),
      finalMatch('freestyle', 'a1', 'a2'),
    ]);

    const res = await invoke(event({ round: 'combined' }));

    expect(res.statusCode).toBe(200);
    // One bare-MATCH# query covers both disciplines, split in memory.
    expect(listMatchesMock).toHaveBeenCalledTimes(1);
    expect(listMatchesMock).toHaveBeenCalledWith(COMP);
    // a3 has no speed placement → excluded; a1/a2 both average 1.5, sharing rank 1.
    expect(
      res.body.map(
        (e: {
          rank: number;
          athlete: { athleteId: string };
          combined: number;
          speedRank: number;
          freestyleRank: number;
        }) => [e.rank, e.athlete.athleteId, e.combined, e.speedRank, e.freestyleRank],
      ),
    ).toEqual([
      [1, 'a1', 1.5, 2, 1],
      [1, 'a2', 1.5, 1, 2],
    ]);
    expect(res.body[0]).not.toHaveProperty('provisional');
    expect(res.body[0]).not.toHaveProperty('bestTimeMs');
    expect(res.body[0]).not.toHaveProperty('overall');
  });

  it('flags a row provisional when either discipline placement is provisional', async () => {
    listAthletesMock.mockResolvedValue([fem('a1', 'Lea Müller'), fem('a2', 'Mia Roe')]);
    listTimesMock.mockResolvedValue([quali('a1', 10_000), quali('a2', 11_000)]);
    listScoresMock.mockResolvedValue([qualiScore('a1', 31), qualiScore('a2', 25)]);
    // A decided speed final, an undecided freestyle final → freestyle provisional.
    listMatchesMock.mockResolvedValue([
      finalMatch('speed', 'a1', 'a2'),
      { ...finalMatch('freestyle', 'a1', 'a2'), winnerId: undefined },
    ]);

    const res = await invoke(event({ round: 'combined' }));

    expect(res.statusCode).toBe(200);
    expect(res.body.every((e: { provisional?: boolean }) => e.provisional === true)).toBe(true);
  });

  it('ignores the discipline param (the view is cross-discipline)', async () => {
    listAthletesMock.mockResolvedValue([fem('a1', 'Lea Müller')]);
    listTimesMock.mockResolvedValue([quali('a1', 10_000)]);
    listScoresMock.mockResolvedValue([qualiScore('a1', 31)]);

    const withParam = await invoke(event({ round: 'combined', discipline: 'freestyle' }));
    const without = await invoke(event({ round: 'combined' }));

    expect(withParam.statusCode).toBe(200);
    expect(withParam.body).toEqual(without.body);
  });

  it('strips reader PII from the combined ranking', async () => {
    listTimesMock.mockResolvedValue([quali('a1', 10_000)]);
    listScoresMock.mockResolvedValue([qualiScore('a1', 31)]);

    const res = await invoke(event({ role: 'reader', round: 'combined' }));

    expect(res.statusCode).toBe(200);
    expect(res.body[0].athlete).not.toHaveProperty('birthDate');
    expect(res.body[0].athlete).not.toHaveProperty('notes');
    expect(res.body[0].athlete).toMatchObject({ name: 'Lea Müller', country: 'DE' });
  });

  it('requires a valid gender for the combined view (400)', async () => {
    const res = await invoke(event({ round: 'combined', gender: '' }));
    expect(res.statusCode).toBe(400);
  });
});
