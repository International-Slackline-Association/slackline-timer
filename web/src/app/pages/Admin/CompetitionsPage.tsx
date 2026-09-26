import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import GroupIcon from '@mui/icons-material/Group';

import { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import { COMPETITIONS_LIST_POLL_MS, useCompetitions } from 'app/api/competitions';
import { QueryStates } from 'app/components/QueryStates';
import { useCurrentUser } from 'app/auth/currentUser';
import { useSelectedCompetition } from 'app/state/selectedCompetition';

/**
 * `/admin/competitions` (and the app landing page) — list and select the active
 * competition. Creating one lives on its own page (`/admin/competitions/new`).
 * Once a competition is selected the operator chooses what to do with it:
 * Manage (data plane), Freestyle, or Speedline — the timers run against the
 * selected competition's id as the relay session id.
 */
export const CompetitionsPage = () => {
  // Polled, not relay-driven: this page must stay fresh with *no* competition
  // selected (see COMPETITIONS_LIST_POLL_MS for why db_update can't cover it).
  const competitions = useCompetitions({ refetchInterval: COMPETITIONS_LIST_POLL_MS });
  const { compId: selectedId, setCompId } = useSelectedCompetition();
  // A manager (non-superadmin) sees only the competitions granted to them (the
  // list is filtered server-side); creating competitions and managing the
  // manager list are superadmin-only affordances.
  const { isSuperadmin } = useCurrentUser();

  // Drop a selection the server-filtered list no longer contains (e.g. a
  // manager whose grant on the selected competition was revoked). Keeping it
  // would offer timer links whose $connect is doomed to a denied socket.
  useEffect(() => {
    if (
      selectedId &&
      competitions.data &&
      !competitions.data.some((c) => c.compId === selectedId)
    ) {
      setCompId(null);
    }
  }, [selectedId, competitions.data, setCompId]);

  const selected = competitions.data?.find((c) => c.compId === selectedId);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4">Competitions</Typography>
        {isSuperadmin && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            component={RouterLink}
            to="/admin/competitions/new"
          >
            Add competition
          </Button>
        )}
      </Stack>

      <Box component="section" sx={{ mb: 4 }}>
        <QueryStates query={competitions} empty="No competitions yet — add one to get started." />
        {competitions.data && competitions.data.length > 0 && (
          <List>
            {competitions.data.map((c) => {
              const isSelected = c.compId === selectedId;
              return (
                <ListItem
                  key={c.compId}
                  divider
                  secondaryAction={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<EditIcon />}
                        aria-label={`Edit ${c.name}`}
                        component={RouterLink}
                        to={`/admin/competitions/${encodeURIComponent(c.compId)}/edit`}
                      >
                        Edit
                      </Button>
                      {isSelected ? (
                        <Chip label="Selected" color="primary" />
                      ) : (
                        <Button
                          variant="outlined"
                          aria-label={`Select ${c.name}`}
                          onClick={() => setCompId(c.compId)}
                        >
                          Select
                        </Button>
                      )}
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={c.name}
                    secondary={`${c.compId} · ${c.startDate} → ${c.endDate}`}
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </Box>

      {selectedId && (
        <Box component="section">
          <Divider sx={{ mb: 3 }} />
          <Typography variant="h6" gutterBottom>
            {selected?.name ?? selectedId}
          </Typography>
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button variant="contained" component={RouterLink} to="/admin/athletes">
              Athletes
            </Button>
            <Button
              variant="contained"
              color="secondary"
              component={RouterLink}
              to={`/freestyle/control?sessionId=${encodeURIComponent(selectedId)}`}
              target="_blank"
              rel="noopener"
            >
              Freestyle
            </Button>
            <Button
              variant="contained"
              color="secondary"
              component={RouterLink}
              to={`/speedline/control?sessionId=${encodeURIComponent(selectedId)}`}
              target="_blank"
              rel="noopener"
            >
              Speedline
            </Button>
            {isSuperadmin && (
              <Button
                variant="outlined"
                startIcon={<GroupIcon />}
                component={RouterLink}
                to={`/admin/competitions/${encodeURIComponent(selectedId)}/managers`}
              >
                Managers
              </Button>
            )}
          </Stack>
        </Box>
      )}
    </Container>
  );
};
