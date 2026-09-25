import { FormEvent, useState } from 'react';

import {
  Alert,
  Box,
  Button,
  Container,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import { Link as RouterLink, Navigate, useParams } from 'react-router-dom';

import { useGrantManager, useManagers, useRevokeManager } from 'app/api/managers';
import { QueryStates } from 'app/components/QueryStates';
import { useCurrentUser } from 'app/auth/currentUser';
import { apiErrorMessage } from 'app/util/apiError';

/**
 * `/admin/competitions/:compId/managers` — superadmin-only: grant other ISA
 * users manager access to this competition (they then operate it with their own
 * ISA login) and revoke it. A manager is added by email; the server resolves it
 * to their Cognito identity. Non-superadmins are redirected — the real
 * enforcement is the managers Lambda (requireAdmin).
 */
export const CompetitionManagersPage = () => {
  const { compId = '' } = useParams();
  const user = useCurrentUser();
  // Don't even fetch the (superadmin-only) manager list for a non-superadmin —
  // the server would 403 it anyway, and this avoids a wasted, doomed request
  // before the redirect below takes effect.
  const managers = useManagers(user.isSuperadmin ? compId : undefined);
  const grant = useGrantManager(compId);
  const revoke = useRevokeManager(compId);
  const [email, setEmail] = useState('');

  if (!user.loading && !user.isSuperadmin) {
    return <Navigate to="/admin/competitions" replace />;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    grant.mutate(value, { onSuccess: () => setEmail('') });
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Button
        component={RouterLink}
        to="/admin/competitions"
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 2 }}
      >
        Back to competitions
      </Button>
      <Typography variant="h4" gutterBottom>
        Managers
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Grant ISA users access to operate <strong>{compId}</strong>. They sign in with their own ISA
        account and can only reach the competitions granted to them.
      </Typography>

      <Box component="form" onSubmit={onSubmit} sx={{ mb: 4 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            label="ISA account email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
          />
          <Button type="submit" variant="contained" disabled={grant.isPending} sx={{ mt: 1 }}>
            Add
          </Button>
        </Stack>
        {grant.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {apiErrorMessage(grant.error)}
          </Alert>
        )}
        {revoke.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {apiErrorMessage(revoke.error)}
          </Alert>
        )}
      </Box>

      <QueryStates query={managers} empty="No managers yet — add one by email above." />
      {managers.data && managers.data.length > 0 && (
        <List>
          {managers.data.map((m) => (
            <ListItem
              key={m.sub}
              divider
              secondaryAction={
                <Tooltip title="Revoke access">
                  <IconButton
                    edge="end"
                    aria-label={`Revoke ${m.email}`}
                    onClick={() => revoke.mutate(m.sub)}
                    disabled={revoke.isPending}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemText
                primary={m.email}
                secondary={m.grantedByEmail && `added by ${m.grantedByEmail}`}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Container>
  );
};
