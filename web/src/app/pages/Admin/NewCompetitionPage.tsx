import { FormEvent, useState } from 'react';

import { Alert, Box, Button, Container, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Link as RouterLink, useNavigate } from 'react-router-dom';

import { useCreateCompetition, type CompetitionInput } from 'app/api/competitions';
import { useSelectedCompetition } from 'app/state/selectedCompetition';
import { apiErrorMessage } from 'app/util/apiError';

const EMPTY_FORM: CompetitionInput = { compId: '', name: '', startDate: '', endDate: '' };

/**
 * `/admin/competitions/new` — create a competition on its own page (kept off the
 * main listing page). On success the new competition becomes the selected one
 * and we return to the list.
 */
export const NewCompetitionPage = () => {
  const navigate = useNavigate();
  const createCompetition = useCreateCompetition();
  const { setCompId } = useSelectedCompetition();
  const [form, setForm] = useState<CompetitionInput>(EMPTY_FORM);

  const update =
    (field: keyof CompetitionInput) =>
    (e: { target: { value: string } }): void =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    createCompetition.mutate(form, {
      onSuccess: (created) => {
        setCompId(created.compId);
        navigate('/admin/competitions');
      },
    });
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
        New competition
      </Typography>
      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          <TextField
            label="Competition id"
            helperText="Used in URLs and as the live-timer session id (letters, digits, _ or -)."
            value={form.compId}
            onChange={update('compId')}
            required
          />
          <TextField label="Name" value={form.name} onChange={update('name')} required />
          <TextField
            label="Start date"
            type="date"
            value={form.startDate}
            onChange={update('startDate')}
            slotProps={{ inputLabel: { shrink: true } }}
            required
          />
          <TextField
            label="End date"
            type="date"
            value={form.endDate}
            onChange={update('endDate')}
            slotProps={{ inputLabel: { shrink: true } }}
            required
          />
          {createCompetition.isError && (
            <Alert severity="error">{apiErrorMessage(createCompetition.error)}</Alert>
          )}
          <Box>
            <Button type="submit" variant="contained" disabled={createCompetition.isPending}>
              Create competition
            </Button>
          </Box>
        </Stack>
      </form>
    </Container>
  );
};
