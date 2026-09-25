import { FormEvent, useEffect, useState } from 'react';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';

import { useCompetition, useUpdateCompetition } from 'app/api/competitions';
import { DEFAULT_FREESTYLE_BREAK_MS } from 'app/types';
import { apiErrorMessage } from 'app/util/apiError';

interface EditForm {
  name: string;
  startDate: string;
  endDate: string;
  /** Quali advisory break in seconds (UI unit); persisted as breakMs. */
  breakSec: string;
}

/**
 * `/admin/competitions/:compId/edit` — edit an existing competition's name,
 * dates, and the per-competition quali break (ADR 0019 §6; quali-only since
 * ADR 0036). compId is the relay sessionId / PK and is immutable, so it is shown
 * read-only.
 */
export const EditCompetitionPage = () => {
  const { compId = '' } = useParams<{ compId: string }>();
  const navigate = useNavigate();
  const competition = useCompetition(compId);
  const updateCompetition = useUpdateCompetition(compId);

  const [form, setForm] = useState<EditForm | null>(null);

  useEffect(() => {
    if (!form && competition.data) {
      const breakMs = competition.data.config?.freestyle?.breakMs ?? DEFAULT_FREESTYLE_BREAK_MS;
      setForm({
        name: competition.data.name,
        startDate: competition.data.startDate,
        endDate: competition.data.endDate,
        breakSec: String(breakMs / 1000),
      });
    }
  }, [competition.data, form]);

  const update =
    (field: keyof EditForm) =>
    (e: { target: { value: string } }): void =>
      setForm((prev) => (prev ? { ...prev, [field]: e.target.value } : prev));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const breakSec = Number(form.breakSec);
    updateCompetition.mutate(
      {
        name: form.name,
        startDate: form.startDate,
        endDate: form.endDate,
        ...(Number.isFinite(breakSec) && breakSec > 0
          ? { config: { freestyle: { breakMs: Math.round(breakSec * 1000) } } }
          : {}),
      },
      { onSuccess: () => navigate('/admin/competitions') },
    );
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
        Edit competition
      </Typography>

      {competition.isLoading && <CircularProgress />}
      {competition.isError && <Alert severity="error">{apiErrorMessage(competition.error)}</Alert>}

      {form && (
        <form onSubmit={onSubmit}>
          <Stack spacing={2}>
            <TextField
              label="Competition id"
              helperText="The live-timer session id — fixed once created."
              value={compId}
              slotProps={{ input: { readOnly: true } }}
              disabled
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
            <TextField
              label="Quali break (s)"
              type="number"
              helperText="Break between freestyle runs. Defaults to 30s."
              value={form.breakSec}
              onChange={update('breakSec')}
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
            />
            {updateCompetition.isError && (
              <Alert severity="error">{apiErrorMessage(updateCompetition.error)}</Alert>
            )}
            <Box>
              <Button type="submit" variant="contained" disabled={updateCompetition.isPending}>
                Save changes
              </Button>
            </Box>
          </Stack>
        </form>
      )}
    </Container>
  );
};
