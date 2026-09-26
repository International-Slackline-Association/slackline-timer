import { useState } from 'react';

import {
  Avatar,
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

import { useAthletes, useDeleteAthlete } from 'app/api/athletes';
import { CountryFlag } from 'app/components/CountryFlag';
import { DeleteConfirmDialog } from 'app/components/DeleteConfirmDialog';
import { QueryStates } from 'app/components/QueryStates';
import { SelectCompetitionGate } from 'app/components/SelectCompetitionGate';
import type { Athlete } from 'app/types';
import { genderLabel } from 'app/util/gender';
import { AthleteForm } from 'app/pages/Admin/AthleteForm';

/**
 * `/admin/athletes` — CRUD over the selected competition's athletes. Requires a
 * competition to be selected (on `/admin/competitions`). Deletes are blocked
 * server-side while Times or Matches still reference the athlete; that 409 is
 * surfaced in the confirm dialog.
 */
export const AthletesPage = () => (
  <SelectCompetitionGate title="Athletes">
    {(compId) => <AthletesManager compId={compId} />}
  </SelectCompetitionGate>
);

const AthletesManager = ({ compId }: { compId: string }) => {
  const athletes = useAthletes(compId);
  const deleteAthlete = useDeleteAthlete(compId);

  const [formTarget, setFormTarget] = useState<Athlete | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Athlete | null>(null);

  const closeDelete = () => {
    setDeleteTarget(null);
    deleteAthlete.reset();
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteAthlete.mutate(deleteTarget.athleteId, { onSuccess: closeDelete });
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Athletes</Typography>
        <Button variant="contained" onClick={() => setFormTarget('new')}>
          Add athlete
        </Button>
      </Stack>

      <QueryStates query={athletes} empty="No athletes yet — add one." />

      {athletes.data && athletes.data.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Photo</TableCell>
              <TableCell>Country</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Short name</TableCell>
              <TableCell>Gender</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {athletes.data.map((athlete) => (
              <TableRow key={athlete.athleteId}>
                <TableCell>
                  <Avatar src={athlete.photoUrl} alt={athlete.name} />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <CountryFlag code={athlete.country} showCode />
                  </Stack>
                </TableCell>
                <TableCell>{athlete.name}</TableCell>
                <TableCell>{athlete.shortName}</TableCell>
                <TableCell>{genderLabel(athlete.gender, 'subject')}</TableCell>
                <TableCell align="right">
                  <IconButton
                    aria-label={`Edit ${athlete.name}`}
                    onClick={() => setFormTarget(athlete)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${athlete.name}`}
                    onClick={() => setDeleteTarget(athlete)}
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
        <AthleteForm
          compId={compId}
          athlete={formTarget === 'new' ? undefined : formTarget}
          open
          onClose={() => setFormTarget(null)}
        />
      )}

      <DeleteConfirmDialog
        open={deleteTarget != null}
        title="Delete athlete"
        error={deleteAthlete.error}
        pending={deleteAthlete.isPending}
        onCancel={closeDelete}
        onConfirm={confirmDelete}
      >
        Delete {deleteTarget?.name}? This cannot be undone.
      </DeleteConfirmDialog>
    </Container>
  );
};
