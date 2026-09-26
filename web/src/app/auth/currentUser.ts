import { LOCAL_DEV } from 'app/constants';

import { useCognitoCurrentUser } from './cognitoAuth';
import { useLocalCurrentUser } from './localAuth';

/**
 * The signed-in operator's identity, resolved through the same LOCAL_DEV seam as
 * the credentials (`./index.ts`). `isSuperadmin` (Cognito `timeradmin` group)
 * distinguishes a full admin from a scoped manager; the rest is display/audit.
 * Consumers gate *UI affordances* on this — the server-side authorizers +
 * per-competition grant checks are the actual security boundary.
 */
export interface CurrentUser {
  /** True until the session/claims have been read. */
  loading: boolean;
  sub?: string;
  email?: string;
  /** In the Cognito timer group → may create competitions and manage managers. */
  isSuperadmin: boolean;
}

export const useCurrentUser = LOCAL_DEV ? useLocalCurrentUser : useCognitoCurrentUser;
