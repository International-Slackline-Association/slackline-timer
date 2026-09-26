import { afterEach, describe, expect, it, vi } from 'vitest';

const { getCompetitionMock, getManagerGrantMock } = vi.hoisted(() => ({
  getCompetitionMock: vi.fn(),
  getManagerGrantMock: vi.fn(),
}));
vi.mock('core/competitionDb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('core/competitionDb')>()),
  competitionDb: { getCompetition: getCompetitionMock, getManagerGrant: getManagerGrantMock },
}));

import { ConditionFailed } from 'core/competitionDb';
import {
  HttpError,
  errorResponse,
  getAuth,
  json,
  loadCompetitionOrThrow,
  parseBody,
  parseJsonBody,
  requireAdmin,
  requireCompAccess,
  requireWrite,
} from 'core/http';
import type { Validated } from 'core/validators';

const eventWith = (lambda: unknown) =>
  ({ requestContext: { authorizer: { lambda } } }) as Parameters<typeof getAuth>[0];

describe('getAuth', () => {
  it('returns a valid admin context', () => {
    expect(getAuth(eventWith({ role: 'admin', compId: '*' }))).toEqual({
      role: 'admin',
      compId: '*',
    });
  });

  it('returns a valid reader context', () => {
    expect(getAuth(eventWith({ role: 'reader', compId: 'worlds-2026' }))).toEqual({
      role: 'reader',
      compId: 'worlds-2026',
    });
  });

  it('returns a manager context keyed by sub (compId unused)', () => {
    expect(
      getAuth(eventWith({ role: 'manager', compId: '', sub: 'u-1', email: 'a@b.co' })),
    ).toEqual({ role: 'manager', compId: '', sub: 'u-1', email: 'a@b.co' });
  });

  it('rejects missing or malformed context with 403', () => {
    expect(() => getAuth({})).toThrow(HttpError);
    expect(() => getAuth(eventWith({ role: 'root', compId: '*' }))).toThrow(/authorizer/);
    expect(() => getAuth(eventWith({ role: 'reader' }))).toThrow(HttpError);
    // a manager without a sub is unidentifiable → rejected
    expect(() => getAuth(eventWith({ role: 'manager', compId: '' }))).toThrow(HttpError);
    // an admin must carry the '*' scope
    expect(() => getAuth(eventWith({ role: 'admin', compId: 'c1' }))).toThrow(HttpError);
  });
});

describe('role assertions', () => {
  afterEach(() => vi.clearAllMocks());

  it('requireAdmin lets admins through and blocks readers and managers', () => {
    expect(() => requireAdmin({ role: 'admin', compId: '*' })).not.toThrow();
    expect(() => requireAdmin({ role: 'reader', compId: 'c1' })).toThrow(HttpError);
    expect(() => requireAdmin({ role: 'manager', compId: '', sub: 'u1' })).toThrow(HttpError);
  });

  it('requireCompAccess scopes readers to their competition', async () => {
    await expect(requireCompAccess({ role: 'admin', compId: '*' }, 'any')).resolves.toBeUndefined();
    await expect(
      requireCompAccess({ role: 'reader', compId: 'c1' }, 'c1'),
    ).resolves.toBeUndefined();
    await expect(requireCompAccess({ role: 'reader', compId: 'c1' }, 'c2')).rejects.toThrow(
      /not scoped/,
    );
  });

  it('requireCompAccess admits a manager only for a competition they hold a grant on', async () => {
    getManagerGrantMock.mockResolvedValueOnce({ sub: 'u1', email: 'a@b.co' });
    await expect(
      requireCompAccess({ role: 'manager', compId: '', sub: 'u1' }, 'c1'),
    ).resolves.toBeUndefined();
    expect(getManagerGrantMock).toHaveBeenCalledWith('c1', 'u1');

    getManagerGrantMock.mockResolvedValueOnce(null);
    await expect(
      requireCompAccess({ role: 'manager', compId: '', sub: 'u1' }, 'c2'),
    ).rejects.toThrow(/no manager access/);
  });

  it('requireWrite blocks readers but allows managers and admins', () => {
    expect(() => requireWrite({ role: 'admin', compId: '*' })).not.toThrow();
    expect(() => requireWrite({ role: 'manager', compId: '', sub: 'u1' })).not.toThrow();
    expect(() => requireWrite({ role: 'reader', compId: 'c1' })).toThrow(HttpError);
  });
});

describe('parseJsonBody', () => {
  it('parses plain and base64 bodies, defaulting empty to {}', () => {
    expect(parseJsonBody({ body: '{"a":1}' })).toEqual({ a: 1 });
    expect(
      parseJsonBody({ body: Buffer.from('{"b":2}').toString('base64'), isBase64Encoded: true }),
    ).toEqual({ b: 2 });
    expect(parseJsonBody({})).toEqual({});
  });

  it('maps garbage to a 400', () => {
    try {
      parseJsonBody({ body: 'not json' });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(400);
    }
  });
});

describe('parseBody', () => {
  const okValidator = (body: unknown): Validated<{ n: number }> => ({
    ok: true,
    value: { n: (body as { n: number }).n },
  });
  const failValidator = (): Validated<{ n: number }> => ({
    ok: false,
    errors: ['n is required'],
  });

  it('returns the validated value on success', () => {
    expect(parseBody({ body: '{"n":7}' }, okValidator, 'invalid thing')).toEqual({ n: 7 });
  });

  it('throws a 400 carrying the validator errors as details', () => {
    try {
      parseBody({ body: '{}' }, failValidator, 'invalid thing');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
      expect((e as HttpError).message).toBe('invalid thing');
      expect((e as HttpError).details).toEqual(['n is required']);
    }
  });

  it('propagates the 400 from a malformed JSON body', () => {
    expect(() => parseBody({ body: 'not json' }, okValidator, 'invalid thing')).toThrow(HttpError);
  });
});

describe('responses', () => {
  it('json builds a serialized response', () => {
    expect(json(201, { id: 'x' })).toEqual({
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"id":"x"}',
    });
  });

  it('maps HttpError, ConditionFailed kinds, and unknown errors', () => {
    expect(errorResponse(new HttpError(400, 'bad', ['x']))).toMatchObject({ statusCode: 400 });
    expect(errorResponse(new ConditionFailed('not_found', 'nope'))).toMatchObject({
      statusCode: 404,
    });
    expect(errorResponse(new ConditionFailed('conflict', 'dup'))).toMatchObject({
      statusCode: 409,
    });
    expect(errorResponse(new Error('boom'))).toMatchObject({ statusCode: 500 });
  });
});

describe('loadCompetitionOrThrow', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns the competition when it exists', async () => {
    const comp = { compId: 'worlds-2026', name: 'Worlds' };
    getCompetitionMock.mockResolvedValue(comp);
    await expect(loadCompetitionOrThrow('worlds-2026')).resolves.toBe(comp);
    expect(getCompetitionMock).toHaveBeenCalledWith('worlds-2026');
  });

  it('throws a 404 HttpError for an unknown competition', async () => {
    getCompetitionMock.mockResolvedValue(null);
    await expect(loadCompetitionOrThrow('ghost')).rejects.toMatchObject({
      status: 404,
      message: 'competition ghost not found',
    });
  });
});
