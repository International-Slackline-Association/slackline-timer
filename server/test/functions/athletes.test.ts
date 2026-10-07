import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from 'core/http';
import type { Athlete } from 'core/types';
import { MAX_ATHLETES_PER_COMP } from 'core/validators';

const {
  getCompetitionMock,
  listAthletesMock,
  getAthleteMock,
  countAthletesMock,
  createAthleteMock,
  updateAthleteMock,
} = vi.hoisted(() => ({
  getCompetitionMock: vi.fn(),
  listAthletesMock: vi.fn(),
  getAthleteMock: vi.fn(),
  countAthletesMock: vi.fn(),
  createAthleteMock: vi.fn(),
  updateAthleteMock: vi.fn(),
}));

vi.mock('core/competitionDb', () => ({
  competitionDb: {
    getCompetition: getCompetitionMock,
    listAthletes: listAthletesMock,
    getAthlete: getAthleteMock,
    countAthletes: countAthletesMock,
    createAthlete: createAthleteMock,
    updateAthlete: updateAthleteMock,
  },
}));
vi.mock('core/broadcast', () => ({ publishDbUpdate: vi.fn() }));
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

const event = (
  overrides: { role?: AuthContext['role']; routeKey?: string; body?: unknown } = {},
): Event =>
  ({
    routeKey: overrides.routeKey ?? 'GET /competitions/{compId}/athletes',
    ...(overrides.body !== undefined ? { body: JSON.stringify(overrides.body) } : {}),
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
  countAthletesMock.mockResolvedValue(0);
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

describe('athletes handler — writes (ADR 0052)', () => {
  const POST = 'POST /competitions/{compId}/athletes';
  const PUT = 'PUT /competitions/{compId}/athletes/{athleteId}';
  const HASH = 'b'.repeat(64);
  const input = {
    firstName: 'Lea',
    lastName: 'Müller',
    birthDate: '1995-04-12',
    country: 'DE',
    gender: 'female',
  };
  const ownKey = `photos/${COMP}/${HASH}.jpg`;
  const legacyKey = `photos/old-comp/${HASH}.jpg`;

  it('creates below the athlete cap', async () => {
    countAthletesMock.mockResolvedValue(MAX_ATHLETES_PER_COMP - 1);
    const res = await invoke(event({ routeKey: POST, body: { ...input, photoKey: ownKey } }));
    expect(res.statusCode).toBe(201);
    expect(createAthleteMock).toHaveBeenCalledOnce();
  });

  it('409s a create at the athlete cap', async () => {
    countAthletesMock.mockResolvedValue(MAX_ATHLETES_PER_COMP);
    const res = await invoke(event({ routeKey: POST, body: input }));
    expect(res.statusCode).toBe(409);
    expect(createAthleteMock).not.toHaveBeenCalled();
  });

  it('400s a create carrying another competition’s photoKey', async () => {
    const res = await invoke(event({ routeKey: POST, body: { ...input, photoKey: legacyKey } }));
    expect(res.statusCode).toBe(400);
    expect(res.body.details).toEqual([`photoKey must be under photos/${COMP}/`]);
    expect(createAthleteMock).not.toHaveBeenCalled();
  });

  it('400s a malformed photoKey', async () => {
    const res = await invoke(
      event({ routeKey: PUT, body: { ...input, photoKey: `photos/${COMP}/abc.png` } }),
    );
    expect(res.statusCode).toBe(400);
    expect(updateAthleteMock).not.toHaveBeenCalled();
  });

  it('updates with an own-comp photoKey without reading the stored athlete', async () => {
    const res = await invoke(event({ routeKey: PUT, body: { ...input, photoKey: ownKey } }));
    expect(res.statusCode).toBe(200);
    expect(getAthleteMock).not.toHaveBeenCalled();
  });

  it('keeps a legacy foreign photoKey on update while it is unchanged', async () => {
    getAthleteMock.mockResolvedValue({ ...athlete, photoKey: legacyKey });
    const res = await invoke(event({ routeKey: PUT, body: { ...input, photoKey: legacyKey } }));
    expect(res.statusCode).toBe(200);
    expect(updateAthleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ photoKey: legacyKey }),
    );
  });

  it('400s an update that changes the photoKey to a foreign one', async () => {
    getAthleteMock.mockResolvedValue({
      ...athlete,
      photoKey: `photos/old-comp/${'c'.repeat(64)}.jpg`,
    });
    const res = await invoke(event({ routeKey: PUT, body: { ...input, photoKey: legacyKey } }));
    expect(res.statusCode).toBe(400);
    expect(updateAthleteMock).not.toHaveBeenCalled();
  });
});
