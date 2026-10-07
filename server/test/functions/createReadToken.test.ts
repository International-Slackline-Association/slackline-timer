import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from 'core/http';

const { getCompetitionMock, getReadTokenSecretMock } = vi.hoisted(() => ({
  getCompetitionMock: vi.fn(),
  getReadTokenSecretMock: vi.fn(),
}));

vi.mock('core/competitionDb', () => ({
  competitionDb: { getCompetition: getCompetitionMock },
}));
vi.mock('core/secrets', () => ({ getReadTokenSecret: getReadTokenSecretMock }));

import { main } from '@functions/createReadToken/handler';
import { verifyReadToken } from 'core/readToken';

const SECRET = 'create-read-token-test-secret-0123456789';
const COMP = 'worlds-2026';

type Event = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthContext>;

const event = {
  pathParameters: { compId: COMP },
  requestContext: { authorizer: { lambda: { role: 'admin', compId: '*' } } },
} as unknown as Event;

const invoke = async () => {
  const res = (await main(event, {} as never, () => undefined)) as {
    statusCode: number;
    body: string;
  };
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};

beforeEach(() => {
  getCompetitionMock.mockResolvedValue({
    compId: COMP,
    tokenVersion: 2,
    endDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  });
});

afterEach(() => vi.clearAllMocks());

describe('createReadToken handler', () => {
  it('mints a token that verifies against the secret', async () => {
    getReadTokenSecretMock.mockResolvedValue(SECRET);

    const res = await invoke();

    expect(res.statusCode).toBe(201);
    const verified = verifyReadToken({ token: res.body.token, secret: SECRET });
    expect(verified.ok && verified.claims).toMatchObject({ compId: COMP, tokenVersion: 2 });
  });

  it('answers 503 when the secret is unavailable or too short', async () => {
    getReadTokenSecretMock.mockResolvedValue(undefined);

    const res = await invoke();

    expect(res.statusCode).toBe(503);
    expect(res.body).not.toHaveProperty('token');
  });
});
