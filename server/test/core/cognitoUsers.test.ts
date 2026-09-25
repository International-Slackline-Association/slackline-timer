import { afterEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class {
    send = sendMock;
  },
  ListUsersCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { resolveUserByEmail } from 'core/cognitoUsers';

const userWith = (email: string, sub: string) => ({
  Attributes: [
    { Name: 'sub', Value: sub },
    { Name: 'email', Value: email },
  ],
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.IS_OFFLINE;
});

describe('resolveUserByEmail', () => {
  it('short-circuits offline with a deterministic fake sub (no AWS call)', async () => {
    process.env.IS_OFFLINE = 'true';

    await expect(resolveUserByEmail('pool-1', 'Rider@ISA.org')).resolves.toEqual({
      sub: 'offline-rider@isa.org',
      email: 'Rider@ISA.org',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses to guess between multiple users when none matches exactly', async () => {
    sendMock.mockResolvedValueOnce({
      Users: [userWith('other1@isa.org', 'sub-1'), userWith('other2@isa.org', 'sub-2')],
    });

    await expect(resolveUserByEmail('pool-1', 'rider@isa.org')).resolves.toBeNull();
  });

  it('refuses an ambiguous duplicate email (two exact matches)', async () => {
    sendMock.mockResolvedValueOnce({
      Users: [userWith('rider@isa.org', 'sub-1'), userWith('rider@isa.org', 'sub-2')],
    });

    await expect(resolveUserByEmail('pool-1', 'rider@isa.org')).resolves.toBeNull();
  });

  it('refuses a lookup that only fuzzy-matches (quote-stripped input finds a different address)', async () => {
    // The stripped filter finds bob@isa.org, but the requested address was
    // bo"b@isa.org — not the same account, so no grant.
    sendMock.mockResolvedValueOnce({ Users: [userWith('bob@isa.org', 'sub-9')] });

    await expect(resolveUserByEmail('pool-1', 'bo"b@isa.org')).resolves.toBeNull();
  });

  it('filters by exact email and returns the resolved sub', async () => {
    sendMock.mockResolvedValueOnce({ Users: [userWith('rider@isa.org', 'sub-9')] });

    await expect(resolveUserByEmail('pool-1', 'rider@isa.org')).resolves.toEqual({
      sub: 'sub-9',
      email: 'rider@isa.org',
    });
    expect(sendMock.mock.calls[0][0].input).toMatchObject({
      UserPoolId: 'pool-1',
      Filter: 'email = "rider@isa.org"',
    });
  });

  it('matches case-insensitively on the returned attribute', async () => {
    sendMock.mockResolvedValueOnce({ Users: [userWith('Rider@ISA.org', 'sub-9')] });

    await expect(resolveUserByEmail('pool-1', 'rider@isa.org')).resolves.toMatchObject({
      sub: 'sub-9',
    });
  });

  it('returns null when no user matches', async () => {
    sendMock.mockResolvedValueOnce({ Users: [] });

    await expect(resolveUserByEmail('pool-1', 'ghost@isa.org')).resolves.toBeNull();
  });

  it('strips quotes from the email to keep the filter intact', async () => {
    sendMock.mockResolvedValueOnce({ Users: [] });

    await resolveUserByEmail('pool-1', 'a"b@isa.org');

    expect(sendMock.mock.calls[0][0].input.Filter).toBe('email = "ab@isa.org"');
  });
});
