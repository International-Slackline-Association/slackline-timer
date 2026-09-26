import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from 'core/http';
import type { Athlete } from 'core/types';

const { getCompetitionMock, listAthletesMock, getAthleteMock } = vi.hoisted(() => ({
  getCompetitionMock: vi.fn(),
  listAthletesMock: vi.fn(),
  getAthleteMock: vi.fn(),
}));

vi.mock('core/competitionDb', () => ({
  competitionDb: {
    getCompetition: getCompetitionMock,
    listAthletes: listAthletesMock,
    getAthlete: getAthleteMock,
  },
}));
// No signer configured → photoUrl is omitted; we assert on the broadcast fields only.
vi.mock('core/aws/clients', () => ({ s3: {} }));

import { main } from '@functions/athletes/handler';

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

type Event = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthContext>;

const event = (overrides: { role?: AuthContext['role']; routeKey?: string } = {}): Event =>
  ({
    routeKey: overrides.routeKey ?? 'GET /competitions/{compId}/athletes',
    pathParameters: { compId: COMP, athleteId: 'a1' },
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
  getAthleteMock.mockResolvedValue(athlete);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('athletes handler — reader PII strip', () => {
  it('returns full athlete PII to an admin', async () => {
    const res = await invoke(event({ role: 'admin' }));

    expect(res.statusCode).toBe(200);
    expect(res.body[0]).toMatchObject({ birthDate: '1995-04-12', notes: 'allergic to bees' });
  });

  it('strips birthDate and notes from a reader list, keeping broadcast fields', async () => {
    const res = await invoke(event({ role: 'reader' }));

    expect(res.statusCode).toBe(200);
    const a = res.body[0];
    expect(a).not.toHaveProperty('birthDate');
    expect(a).not.toHaveProperty('notes');
    // Broadcast fields the overlays render survive.
    expect(a).toMatchObject({
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

  it('strips PII from a single-athlete reader read', async () => {
    const res = await invoke(
      event({ role: 'reader', routeKey: 'GET /competitions/{compId}/athletes/{athleteId}' }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveProperty('birthDate');
    expect(res.body).not.toHaveProperty('notes');
    expect(res.body).toMatchObject({ name: 'Lea Müller', country: 'DE' });
  });
});
