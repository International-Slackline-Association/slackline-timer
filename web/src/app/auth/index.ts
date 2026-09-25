import { LOCAL_DEV } from 'app/constants';

import { getCognitoToken, useCognitoAuth } from './cognitoAuth';
import { getLocalToken, useLocalAuth } from './localAuth';

/**
 * The credential seam between local-dev and the real Cognito/AWS auth.
 *
 * `LOCAL_DEV` is read here (and, for the UI gate, in `./gate.tsx`) and nowhere
 * else: each binding resolves to a whole strategy module at load time, so
 * consumers (the WS hook, the API client) import these and never branch on the
 * environment themselves. To add a third environment, add a strategy module and
 * extend this selection — nothing downstream changes.
 *
 * Kept free of the gate component on purpose, so importing a token here doesn't
 * drag in Amplify-UI/router. The selection is a build-time constant, so the
 * chosen hook is stable across renders (rules-of-hooks safe).
 */

/** WS credential: `{ token, ready }` — `ready` gates the socket connection. */
export const useBaseAuth = LOCAL_DEV ? useLocalAuth : useCognitoAuth;

/** HTTP credential for the Authorization header, or null when unauthenticated. */
export const getBaseToken = LOCAL_DEV ? getLocalToken : getCognitoToken;
