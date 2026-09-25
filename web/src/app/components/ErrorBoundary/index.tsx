import { FC } from 'react';
import { FallbackProps, withErrorBoundary } from 'react-error-boundary';

import { Alert, Backdrop, Typography } from '@mui/material';
import { Stack } from '@mui/system';

function ErrorBoundyFallBack({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Backdrop
      sx={{ p: 2 }}
      open={true}
      onClick={() => {
        resetErrorBoundary();
      }}
    >
      <Alert severity="error" sx={{ alignItems: 'center' }}>
        <Stack spacing={2}>
          <Typography variant="body2">An unexpected error occured in your browser</Typography>
          <Typography variant="body2">
            <b>Error message: </b>
            {message}
          </Typography>
        </Stack>
      </Alert>
    </Backdrop>
  );
}

export function withErrorBoundry<P extends object>(Component: FC<P>) {
  return withErrorBoundary(Component, {
    FallbackComponent: ErrorBoundyFallBack,
    onError(error) {
      console.log('Error: ', error);
      if (error instanceof Error) error.message = 'React Error: ' + error.message;
    },
  });
}
