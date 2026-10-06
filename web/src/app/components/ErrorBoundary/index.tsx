import { FC, ReactNode } from 'react';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';

import { Alert, AlertTitle, Button, Container, CssBaseline, Stack } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';

import { isChromeless } from 'app/components/AppShell';
import { telemetryTheme } from 'app/theme/theme';

import { ErrorDetails } from './ErrorDetails';
import { OverlayGround } from './OverlayBoundary';
import { useRetryLadder } from './retryLadder';

export { ControlBoundary } from './ControlBoundary';
export { OverlayBoundary } from './OverlayBoundary';

/** Wraps the whole app, router and theme included, so it reads `window.location`
 *  and brings its own theme. A display surface renders only its ground: error
 *  text must never reach a capture or a projector. */
function RootFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { pathname, search } = window.location;
  if (isChromeless(pathname)) return <OverlayGround pathname={pathname} search={search} />;
  return (
    <ThemeProvider theme={telemetryTheme}>
      <CssBaseline />
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Stack spacing={2}>
          <Alert severity="error" variant="outlined">
            <AlertTitle>Something went wrong</AlertTitle>
            An unexpected error occurred in your browser.
          </Alert>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Button variant="contained" onClick={() => resetErrorBoundary()}>
              Try again
            </Button>
            <ErrorDetails error={error} />
          </Stack>
        </Stack>
      </Container>
    </ThemeProvider>
  );
}

/** A crash outside the routes (auth gate, providers, shell) on an unattended
 *  display surface climbs the overlay retry ladder instead of staying blank. */
function RootBoundary({ children }: { children: ReactNode }) {
  const { boundaryRef, scheduleRetry } = useRetryLadder();
  const onError = (error: unknown) => {
    console.error('Unhandled render error', error);
    if (isChromeless(window.location.pathname)) scheduleRetry();
  };
  return (
    <ErrorBoundary ref={boundaryRef} FallbackComponent={RootFallback} onError={onError}>
      {children}
    </ErrorBoundary>
  );
}

export function withErrorBoundry<P extends object>(Component: FC<P>) {
  const WithRootBoundary = (props: P) => (
    <RootBoundary>
      <Component {...props} />
    </RootBoundary>
  );
  return WithRootBoundary;
}
