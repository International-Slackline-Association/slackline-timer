import { useMemo, useState } from 'react';

import {
  Button,
  Container,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

import { useDeleteTime, useTimes } from 'app/api/times';
import { DeleteConfirmDialog } from 'app/components/DeleteConfirmDialog';
import { QueryStates } from 'app/components/QueryStates';
import { SelectCompetitionGate } from 'app/components/SelectCompetitionGate';
import { SelectField, enumOptions } from 'app/components/SelectField';
import { useAthleteLookup } from 'app/hooks/useAthleteLookup';
import { GENDERS, TIME_ROUNDS, type Athlete, type Time } from 'app/types';
import { genderLabel } from 'app/util/gender';
import { roundLabel } from 'app/util/rounds';
import { formatMs } from 'app/util/time';
import { TimeForm } from 'app/pages/Admin/TimeForm';

/**
 * `/admin/times` — list / correct / delete recorded times for the selected
 * competition. Times are normally created by the timer console; this page is
 * the manual fallback and correction surface. Filterable by athlete, round,
 * and gender (joined from the athlete); ordered fastest-first (the DNF
 * sentinel sorts last by construction).
 */
export const TimesPage = () => (
  <SelectCompetitionGate title="Times">
    {(compId) => <TimesManager compId={compId} />}
  </SelectCompetitionGate>
);

const ALL = '';

const TimesManager = ({ compId }: { compId: string }) => {
  const times = useTimes(compId);
  const { athletes, byId, athleteName, athleteGender } = useAthleteLookup(compId);
  const deleteTime = useDeleteTime(compId);

  const [formTarget, setFormTarget] = useState<Time | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Time | null>(null);
  const [athleteFilter, setAthleteFilter] = useState<string>(ALL);
  const [roundFilter, setRoundFilter] = useState<string>(ALL);
  const [genderFilter, setGenderFilter] = useState<string>(ALL);

  const rows = useMemo(() => {
    const all = times.data ?? [];
    return all
      .filter(
        (t) =>
          (athleteFilter === ALL || t.athleteId === athleteFilter) &&
          (roundFilter === ALL || t.round === roundFilter) &&
          (genderFilter === ALL || byId(t.athleteId)?.gender === genderFilter),
      )
      .slice()
      .sort((a, b) => a.timeMs - b.timeMs);
  }, [times.data, athleteFilter, roundFilter, genderFilter, byId]);

  const closeDelete = () => {
    setDeleteTarget(null);
    deleteTime.reset();
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteTime.mutate(deleteTarget.timeId, { onSuccess: closeDelete });
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Times</Typography>
        <Button variant="contained" onClick={() => setFormTarget('new')}>
          Add time
        </Button>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <SelectField
          label="Filter by athlete"
          value={athleteFilter}
          onChange={(e) => setAthleteFilter(e.target.value)}
          sx={{ minWidth: 200 }}
          placeholder={{ value: ALL, label: 'All athletes' }}
          options={(athletes.data ?? []).map((a: Athlete) => ({
            value: a.athleteId,
            label: a.name,
          }))}
        />
        <SelectField
          label="Filter by round"
          value={roundFilter}
          onChange={(e) => setRoundFilter(e.target.value)}
          sx={{ minWidth: 200 }}
          placeholder={{ value: ALL, label: 'All rounds' }}
          options={enumOptions(TIME_ROUNDS, roundLabel)}
        />
        <SelectField
          label="Filter by gender"
          value={genderFilter}
          onChange={(e) => setGenderFilter(e.target.value)}
          sx={{ minWidth: 200 }}
          placeholder={{ value: ALL, label: 'All genders' }}
          options={enumOptions(GENDERS, (g) => genderLabel(g, 'subject'))}
        />
      </Stack>

      <QueryStates query={times} alsoLoading={athletes.isLoading} empty="No times recorded yet." />
      {times.data && times.data.length > 0 && rows.length === 0 && (
        <Typography color="text.secondary">No times match the current filters.</Typography>
      )}

      {rows.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Athlete</TableCell>
              <TableCell>Gender</TableCell>
              <TableCell>Round</TableCell>
              <TableCell align="right">Time</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((time) => (
              <TableRow key={time.timeId}>
                <TableCell>{athleteName(time.athleteId)}</TableCell>
                <TableCell>{athleteGender(time.athleteId)}</TableCell>
                <TableCell>{roundLabel(time.round)}</TableCell>
                <TableCell align="right">{formatMs(time.timeMs)}</TableCell>
                <TableCell align="right">
                  <IconButton
                    aria-label={`Edit time for ${athleteName(time.athleteId)}`}
                    onClick={() => setFormTarget(time)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete time for ${athleteName(time.athleteId)}`}
                    onClick={() => setDeleteTarget(time)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {formTarget && (
        <TimeForm
          compId={compId}
          athletes={athletes.data ?? []}
          time={formTarget === 'new' ? undefined : formTarget}
          open
          onClose={() => setFormTarget(null)}
        />
      )}

      <DeleteConfirmDialog
        open={deleteTarget != null}
        title="Delete time"
        error={deleteTime.error}
        pending={deleteTime.isPending}
        onCancel={closeDelete}
        onConfirm={confirmDelete}
      >
        Delete the {deleteTarget ? roundLabel(deleteTarget.round) : ''} time for{' '}
        {deleteTarget ? athleteName(deleteTarget.athleteId) : ''}? This cannot be undone.
      </DeleteConfirmDialog>
    </Container>
  );
};
