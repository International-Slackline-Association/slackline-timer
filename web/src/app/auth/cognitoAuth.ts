import { fetchAuthSession } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';

import { TIMER_GROUP } from 'app/constants';

import type { CurrentUser } from './currentUser';

/**
 * The real (AWS) auth strategy: credentials come from the Cognito session.
 * Selected when not in local dev by `app/auth/index.ts` (credentials) and
 * `app/auth/currentUser.ts` (identity) — see those for the seam. Nothing here
 * knows about the environment flag.
 */

/**
 * `fetchAuthSession` transparently refreshes the token when it can, so this is
 * safe on mount. Null until a session is available (or if signed out) — the WS
 * hook uses that null to gate the connection.
 */
const useIdToken = (): string | null => {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAuthSession()
      .then((session) => {
        if (active) setToken(session.tokens?.idToken?.toString() ?? null);
      })
      .catch(() => {
        if (active) setToken(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return token;
};

/** WS auth: the IdToken plus whether a session exists to connect with. */
export const useCognitoAuth = (): { token: string | null; ready: boolean } => {
  const token = useIdToken();
  return { token, ready: token != null };
};

/** HTTP auth: the IdToken for the Authorization header, or null when signed out. */
export const getCognitoToken = async (): Promise<string | null> => {
  const session = await fetchAuthSession();
  return session.tokens?.idToken?.toString() ?? null;
};

/**
 * The signed-in operator's identity, read from the cached IdToken claims (the
 * same source RequireSignedIn uses). `isSuperadmin` gates the timeradmin-only
 * UI (creating competitions, managing the manager list); a plain ISA login is a
 * scoped manager. Server-side authorizers remain the real boundary.
 */
export const useCognitoCurrentUser = (): CurrentUser => {
  const [user, setUser] = useState<CurrentUser>({ loading: true, isSuperadmin: false });

  useEffect(() => {
    let active = true;
    fetchAuthSession()
      .then((session) => {
        if (!active) return;
        const payload = session.tokens?.idToken?.payload;
        if (!payload) {
          setUser({ loading: false, isSuperadmin: false });
          return;
        }
        const groups = (payload['cognito:groups'] as string[] | undefined) ?? [];
        setUser({
          loading: false,
          sub: typeof payload.sub === 'string' ? payload.sub : undefined,
          email: typeof payload.email === 'string' ? payload.email : undefined,
          isSuperadmin: groups.includes(TIMER_GROUP),
        });
      })
      .catch(() => {
        if (active) setUser({ loading: false, isSuperadmin: false });
      });
    return () => {
      active = false;
    };
  }, []);

  return user;
};
