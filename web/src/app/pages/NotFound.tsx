import { Button, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

/**
 * The `*` catch-all — an explicit, recoverable 404. The wildcard must not fall
 * through to the competitions list, or a mistyped/stale URL looks like the home
 * page instead of an error.
 */
export const NotFound = () => (
  <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
    <Typography variant="h2" component="p" sx={{ color: 'text.secondary', fontWeight: 700 }}>
      404
    </Typography>
    <Typography variant="h5" gutterBottom>
      Page not found
    </Typography>
    <Typography color="text.secondary" sx={{ mb: 3 }}>
      The page you’re looking for doesn’t exist.
    </Typography>
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'center' }}>
      <Button variant="contained" component={RouterLink} to="/admin/competitions">
        Go to Competitions
      </Button>
    </Stack>
  </Container>
);
