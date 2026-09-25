import { Button, CircularProgress, Typography } from '@mui/material';
import { Stack } from '@mui/system';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { setWsAuthDenied, useWsAuthDenied } from 'app/auth/wsAuthSignal';

type Access = 'checking' | 'allowed' | 'denied';

/**
 * Gates its children on being a signed-in ISA user. Authentication is handled by
 * the surrounding AuthGate (ISA Hosted-UI redirect); this admits ANY ISA login —
 * a `timeradmin` operates every competition, any other ISA user is a scoped
 * manager who operates only the competitions granted to them (per-competition
 * ACL). Which competitions a manager may touch is enforced server-side (the HTTP
 * + WS `$connect` authorizers and the grant table), NOT here — this is UX.
 *
 * The one thing it surfaces is a *denied* connection: an IdToken read from the
 * cached session can look valid past its ~1h lifetime, and a manager can open a
 * competition they hold no grant on. In both cases the WS `$connect` authorizer
 * rejects the (re)connection; `useWS` reports it via `wsAuthSignal`, which we
 * turn into a clear message instead of a silently stuck "Closed" socket.
 */
export const RequireSignedIn = ({ children }: { children: ReactNode }) => {
  const [access, setAccess] = useState<Access>('checking');
  const wsDenied = useWsAuthDenied();
  const navigate = useNavigate();

  // Recovery path for a denied socket. Under the per-competition ACL this is a
  // routine state (e.g. a manager whose grant on the selected competition was
  // revoked), not a terminal one — so it must not dead-end on "Sign out": clear
  // the signal (nothing else can — this screen replaces the WS hook that owns
  // it) and return to the competitions list, where the stale selection is
  // dropped against the server-filtered list.
  const backToCompetitions = () => {
    setWsAuthDenied(false);
    navigate('/admin/competitions', { replace: true });
  };

  useEffect(() => {
    let active = true;
    fetchAuthSession()
      .then((session) => {
        if (active) setAccess(session.tokens?.idToken ? 'allowed' : 'denied');
      })
      .catch(() => {
        if (active) setAccess('denied');
      });
    return () => {
      active = false;
    };
  }, []);

  // Still checking, but a denied WS connection already gives a definitive
  // answer — show the message rather than spinning forever.
  if (access === 'checking' && !wsDenied) {
    return (
      <Stack sx={{ justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (access === 'denied' || wsDenied) {
    return (
      <Stack spacing={3} sx={{ justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Typography variant="h5">Not authorized</Typography>
        <Typography variant="body1" color="text.secondary">
          {wsDenied
            ? 'The timer connection was denied — your session may have expired, or your ISA account is not authorized for this competition. Sign in again, or ask an organiser to grant you access.'
            : 'You are signed out. Sign in with your ISA account to continue.'}
        </Typography>
        <Stack direction="row" spacing={2}>
          {wsDenied && (
            <Button variant="contained" onClick={backToCompetitions}>
              Go to competitions
            </Button>
          )}
          <Button variant={wsDenied ? 'outlined' : 'contained'} onClick={() => signOut()}>
            Sign out
          </Button>
        </Stack>
      </Stack>
    );
  }

  return <>{children}</>;
};
