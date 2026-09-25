import type { ReactNode } from 'react';

import { Alert, Container, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import { useSelectedCompetition } from 'app/state/selectedCompetition';

/**
 * Shared "select a competition first" gate for the admin pages: renders the
 * prompt (with the page title) until a competition is selected, then hands the
 * non-null `compId` to the render-prop child — so the page body can take a
 * plain `string` and skip the null checks.
 */
export const SelectCompetitionGate = ({
  title,
  children,
}: {
  title: string;
  children: (compId: string) => ReactNode;
}) => {
  const { compId } = useSelectedCompetition();

  if (!compId) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          {title}
        </Typography>
        <Alert severity="info">
          Select a competition first on{' '}
          <RouterLink to="/admin/competitions">Competitions</RouterLink>.
        </Alert>
      </Container>
    );
  }

  return <>{children(compId)}</>;
};
