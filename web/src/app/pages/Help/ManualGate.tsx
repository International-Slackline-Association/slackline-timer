import type { ReactNode } from 'react';

import { Alert, CircularProgress, Container, Stack, Typography } from '@mui/material';

import { useCompetitions } from 'app/api/competitions';
import { useCurrentUser } from 'app/auth/currentUser';
import { apiErrorMessage } from 'app/util/apiError';

/**
 * Gates the published manual on "signed in AND able to view a competition".
 *
 * Signing in is already handled one level up by `AuthGate`; what this adds is
 * the second half — a signed-in ISA user with no competition granted to them has
 * nothing to operate, so the manual is not for them yet. A superadmin passes
 * regardless (they can see every competition, including a brand-new install with
 * none yet).
 *
 * This is a *UX* boundary, not a security one: the manual ships inside the app
 * bundle, so it is readable by anyone who can fetch the bundle. It is operating
 * instructions for a public sport event, not a secret — the gate exists so the
 * manual reads as part of the operator tool rather than as a public page.
 */
export const ManualGate = ({ children }: { children: ReactNode }) => {
  const { isSuperadmin, loading } = useCurrentUser();
  const competitions = useCompetitions();

  if (loading || competitions.isLoading) {
    return (
      <Stack sx={{ alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (competitions.isError) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error">{apiErrorMessage(competitions.error)}</Alert>
      </Container>
    );
  }

  if (!isSuperadmin && (competitions.data?.length ?? 0) === 0) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          Manual
        </Typography>
        <Alert severity="info">
          The manual is available once you have access to a competition. Ask the event organiser to
          grant your ISA account access.
        </Alert>
      </Container>
    );
  }

  return <>{children}</>;
};
