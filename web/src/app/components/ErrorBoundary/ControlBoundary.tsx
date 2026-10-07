import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { Outlet, useLocation } from 'react-router-dom';

import { Alert, AlertTitle, Button, Container, Stack } from '@mui/material';

import { ErrorDetails } from './ErrorDetails';

const ControlPanelFallback = ({ error, resetErrorBoundary }: FallbackProps) => (
  <Container maxWidth="sm" sx={{ py: 6 }}>
    <Stack spacing={2}>
      <Alert severity="error" variant="outlined">
        <AlertTitle>The control panel stopped</AlertTitle>
        It hit an unexpected error. Reload the panel to restore the board: a running clock is
        recovered from another open board or from this browser's saved copy.
      </Alert>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Button variant="contained" onClick={() => resetErrorBoundary()}>
          Reload panel
        </Button>
        <ErrorDetails error={error} />
      </Stack>
    </Stack>
  </Container>
);

/**
 * Layout route for the timer consoles. Manual reset only: an operator is at the
 * panel, and an automatic remount mid-heat would re-run the open handshake
 * under their hands. The self-snapshot (ADR 0047) is flushed by the crashed
 * panel's unmount cleanup, so the remount restores from it.
 */
export const ControlBoundary = () => {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary
      resetKeys={[pathname]}
      onError={(error) => console.error('Control panel render failed', error)}
      FallbackComponent={ControlPanelFallback}
    >
      <Outlet />
    </ErrorBoundary>
  );
};
