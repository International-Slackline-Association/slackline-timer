import { LOCAL_DEV } from 'app/constants';

import { CognitoGate } from './CognitoGate';
import { PassthroughGate } from './PassthroughGate';

/**
 * The UI auth-gate seam. Like the credential seam in `./index.ts`, `LOCAL_DEV`
 * is read once here to pick a whole component: the Cognito Hosted-UI gate in
 * production, a render-through gate in local dev. Consumers import `AuthGate`
 * and never branch on the environment.
 *
 * Separate from `./index.ts` so importing a token doesn't pull in the gate's
 * Amplify-UI/router dependencies.
 */
export const AuthGate = LOCAL_DEV ? PassthroughGate : CognitoGate;
