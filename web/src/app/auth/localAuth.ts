/**
 * The local-dev auth strategy: a dummy credential the offline WS + HTTP
 * harnesses accept without Cognito. Selected when LOCAL_DEV is set by
 * `app/auth/index.ts` (credentials) and `app/auth/currentUser.ts` (identity) —
 * see those for the seam.
 *
 * NEVER reached in a production build: `vite.config.ts` refuses to build with
 * VITE_APP_LOCAL_DEV=true, and the real security boundary is the server-side
 * `$connect`/HTTP authorizers regardless.
 */

import type { CurrentUser } from './currentUser';

const DUMMY_TOKEN = 'local-dev';

/** WS auth: always "ready" with the dummy token (no session needed). */
export const useLocalAuth = (): { token: string | null; ready: boolean } => ({
  token: DUMMY_TOKEN,
  ready: true,
});

/** HTTP auth: the dummy token for the Authorization header. */
export const getLocalToken = async (): Promise<string | null> => DUMMY_TOKEN;

/**
 * Local dev has no Cognito: the offline authorizers accept `local-dev` as a
 * full operator, so the offline identity is a superadmin. This keeps the admin
 * UI (create competition, manage managers) reachable when driving the app
 * offline. The manager path itself needs real Cognito to exercise.
 */
export const useLocalCurrentUser = (): CurrentUser => ({
  loading: false,
  sub: 'local-dev',
  email: 'local@dev',
  isSuperadmin: true,
});
