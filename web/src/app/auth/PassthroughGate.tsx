import { ReactNode } from 'react';

/**
 * The local-dev gate: there is no Cognito session to wait for, so render the
 * app straight through. Selected by `app/auth/gate.tsx` when LOCAL_DEV is set.
 */
export const PassthroughGate = ({ children }: { children: ReactNode }) => <>{children}</>;
