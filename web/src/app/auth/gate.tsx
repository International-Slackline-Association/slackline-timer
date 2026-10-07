import { LOCAL_DEV } from 'app/constants';

import { CognitoGate } from './CognitoGate';
import { PassthroughGate } from './PassthroughGate';

/**
 * The UI auth-gate seam (see `./index.ts`): the Cognito Hosted-UI gate in
 * production, a render-through gate in local dev.
 */
export const AuthGate = LOCAL_DEV ? PassthroughGate : CognitoGate;
