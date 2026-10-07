import { LOCAL_DEV } from 'app/constants';

import { getCognitoToken, useCognitoAuth } from './cognitoAuth';
import { getLocalToken, useLocalAuth } from './localAuth';

/**
 * The credential seam between local-dev and the real Cognito/AWS auth.
 *
 * `LOCAL_DEV` is read here (and in `./gate.tsx` for the UI gate, and
 * `./currentUser.ts` for identity) and nowhere else: each binding resolves to a
 * whole strategy module at load time, so consumers (the WS hook, the API
 * client) never branch on the environment. To add a third environment, add a
 * strategy module and extend this selection — nothing downstream changes.
 *
 * Free of the gate component, so importing a token doesn't drag in the gate's
 * MUI/router dependencies. The selection is a build-time constant, so the
 * chosen hook is stable across renders (rules-of-hooks safe).
 */

/** WS credential: `{ token, ready }` — `ready` gates the socket connection. */
export const useBaseAuth = LOCAL_DEV ? useLocalAuth : useCognitoAuth;

/** HTTP credential for the Authorization header, or null when unauthenticated. */
export const getBaseToken = LOCAL_DEV ? getLocalToken : getCognitoToken;
