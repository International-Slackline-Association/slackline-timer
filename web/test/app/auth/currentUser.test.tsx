import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchAuthSession } = vi.hoisted(() => ({ fetchAuthSession: vi.fn() }));
vi.mock('aws-amplify/auth', () => ({ fetchAuthSession }));

import { useCognitoCurrentUser } from 'app/auth/cognitoAuth';

const sessionWith = (payload: Record<string, unknown>) => ({
  tokens: { idToken: { payload } },
});

afterEach(() => fetchAuthSession.mockReset());

describe('useCognitoCurrentUser', () => {
  it('flags a timeradmin as superadmin and exposes sub/email', async () => {
    fetchAuthSession.mockResolvedValue(
      sessionWith({ sub: 'u-1', email: 'a@b.co', 'cognito:groups': ['timeradmin'] }),
    );

    const { result } = renderHook(() => useCognitoCurrentUser());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ sub: 'u-1', email: 'a@b.co', isSuperadmin: true });
  });

  it('treats an ISA user without the group as a non-superadmin (a manager)', async () => {
    fetchAuthSession.mockResolvedValue(sessionWith({ sub: 'u-2', email: 'm@b.co' }));

    const { result } = renderHook(() => useCognitoCurrentUser());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ sub: 'u-2', email: 'm@b.co', isSuperadmin: false });
  });

  it('resolves to a non-superadmin on a signed-out / failed session', async () => {
    fetchAuthSession.mockRejectedValue(new Error('signed out'));

    const { result } = renderHook(() => useCognitoCurrentUser());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isSuperadmin).toBe(false);
    expect(result.current.sub).toBeUndefined();
  });
});
