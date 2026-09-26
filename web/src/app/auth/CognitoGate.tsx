import { Button, CircularProgress, Typography } from '@mui/material';
import { Stack } from '@mui/system';
import { getCurrentUser, signInWithRedirect } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { ReactNode, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { BrandMark } from 'app/components/BrandMark';
import { RequireSignedIn } from 'app/components/RequireSignedIn';

type AuthStatus = 'checking' | 'signedIn' | 'signedOut';

/**
 * Read-only OBS/H2R overlays live under `/stream/*` and carry an event read
 * token in the URL — they can't do an interactive Cognito sign-in, so the gate
 * is bypassed for them. The real security boundary stays server-side: the HTTP
 * API and WS `$connect` authorizers verify the read token on every request.
 *
 * (This is a route-based runtime decision, not an environment one — it stays a
 * normal conditional. The local-dev bypass is handled one level up by the
 * `app/auth` seam swapping this whole component for `PassthroughGate`.)
 */
const isStreamOverlay = (pathname: string, search: string): boolean =>
  pathname.startsWith('/stream/') && new URLSearchParams(search).has('token');

/**
 * Signs the operator in through the shared ISA Cognito Hosted UI — whichever
 * domain `Amplify.configure` was given in main.tsx — then admits any signed-in
 * ISA user via RequireSignedIn (per-competition scope is enforced server-side).
 *
 * Cognito only redirects back to the registered redirect URI (the app origin),
 * so the pre-redirect deep link (path + query, e.g. the control page with its
 * sessionId) is carried through OAuth `customState` and restored afterwards.
 */
export const CognitoGate = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const navigate = useNavigate();
  const location = useLocation();
  const streamOverlay = isStreamOverlay(location.pathname, location.search);

  useEffect(() => {
    if (streamOverlay) {
      return;
    }

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signedIn':
          setStatus('signedIn');
          break;
        case 'signedOut':
        case 'signInWithRedirect_failure':
          setStatus('signedOut');
          break;
        case 'customOAuthState':
          navigate(payload.data, { replace: true });
          break;
      }
    });

    getCurrentUser()
      .then(() => setStatus('signedIn'))
      .catch(() => {
        // Returning from the Hosted UI the URL carries ?code=&state= and
        // Amplify is still exchanging the code — wait for the `signedIn` Hub
        // event instead of flashing the sign-in screen.
        const params = new URLSearchParams(window.location.search);
        if (!params.has('code')) {
          setStatus('signedOut');
        }
      });

    return unsubscribe;
  }, [navigate, streamOverlay]);

  if (streamOverlay) {
    return <>{children}</>;
  }

  if (status === 'checking') {
    return (
      <Stack sx={{ justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (status === 'signedOut') {
    return (
      <Stack spacing={3} sx={{ justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        {/* Decorative — the heading below carries the name. */}
        <BrandMark size={88} />
        <Typography variant="h4">Slackline Timer</Typography>
        <Typography variant="body1" color="text.secondary">
          Operators sign in with their ISA account.
        </Typography>
        <Button
          variant="contained"
          size="large"
          onClick={() =>
            signInWithRedirect({
              customState: window.location.pathname + window.location.search,
            })
          }
        >
          Sign in with ISA
        </Button>
      </Stack>
    );
  }

  return <RequireSignedIn>{children}</RequireSignedIn>;
};
