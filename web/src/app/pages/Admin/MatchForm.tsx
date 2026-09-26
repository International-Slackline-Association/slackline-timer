import { Stack, TextField } from '@mui/material';

import { useCreateMatch, useUpdateMatch } from 'app/api/matches';
import { SelectField, enumOptions } from 'app/components/SelectField';
import { EntityFormDialog, useEntityForm } from 'app/pages/Admin/entityForm';
import {
  DISCIPLINE,
  GENDERS,
  MATCH_ROUNDS,
  type Athlete,
  type Discipline,
  type Gender,
  type Match,
  type MatchRound,
} from 'app/types';
import { genderLabel } from 'app/util/gender';
import { roundLabel } from 'app/util/rounds';

/** Local form shape: position + the optional slots are always-present strings. */
interface FormState {
  discipline: Discipline;
  round: MatchRound;
  roundName: string;
  gender: Gender;
  position: string;
  athlete1Id: string;
  athlete2Id: string;
  winnerId: string;
}

const toFormState = (match?: Match, discipline: Discipline = 'speed'): FormState => ({
  discipline: match?.discipline ?? discipline,
  round: match?.round ?? 'quarter',
  roundName: match?.roundName ?? '',
  gender: match?.gender ?? 'male',
  position: String(match?.position ?? 0),
  athlete1Id: match?.athlete1Id ?? '',
  athlete2Id: match?.athlete2Id ?? '',
  winnerId: match?.winnerId ?? '',
});

/** Keep the winner valid: clear it when its slot is emptied or the slots change. */
const clearOrphanedWinner = (next: FormState): FormState =>
  next.winnerId && next.winnerId !== next.athlete1Id && next.winnerId !== next.athlete2Id
    ? { ...next, winnerId: '' }
    : next;

const disciplineLabel = (discipline: Discipline) =>
  discipline === 'speed' ? 'Speed' : 'Freestyle';

/**
 * Create/edit dialog for a match. `match` undefined → create; otherwise edit
 * (changing gender/round triggers a server-side transactional move). Athlete
 * slots offer the competition's athletes of the match's gender; the winner is
 * constrained to whichever of the two slots are filled. Closes on save.
 */
export const MatchForm = ({
  compId,
  athletes,
  match,
  discipline,
  open,
  onClose,
}: {
  compId: string;
  athletes: Athlete[];
  match?: Match;
  /** Default discipline for a new match (the page's selected discipline). */
  discipline: Discipline;
  open: boolean;
  onClose: () => void;
}) => {
  const { isEdit, form, updateField, submit, mutation } = useEntityForm({
    entity: match,
    initialForm: () => toFormState(match, discipline),
    create: useCreateMatch(compId),
    update: useUpdateMatch(compId),
    getId: (m) => m.matchId,
    onClose,
    normalize: clearOrphanedWinner,
  });

  const positionInvalid = !Number.isInteger(Number.parseInt(form.position, 10));
  const canSubmit = !positionInvalid;

  const eligible = athletes.filter((a) => a.gender === form.gender);
  const winnerOptions = [form.athlete1Id, form.athlete2Id]
    .filter(Boolean)
    .map((id) => athletes.find((a) => a.athleteId === id))
    .filter((a): a is Athlete => a != null);

  const onSubmit = () =>
    submit({
      discipline: form.discipline,
      round: form.round,
      ...(form.roundName.trim() ? { roundName: form.roundName.trim() } : {}),
      gender: form.gender,
      position: Number.parseInt(form.position, 10),
      ...(form.athlete1Id ? { athlete1Id: form.athlete1Id } : {}),
      ...(form.athlete2Id ? { athlete2Id: form.athlete2Id } : {}),
      ...(form.winnerId ? { winnerId: form.winnerId } : {}),
    });

  const athleteSelect = (field: 'athlete1Id' | 'athlete2Id', label: string) => (
    <SelectField
      label={label}
      value={form[field]}
      onChange={updateField(field)}
      sx={{ flex: 1 }}
      placeholder={{ value: '', label: '— TBD —' }}
      options={eligible.map((a) => ({ value: a.athleteId, label: a.name }))}
    />
  );

  return (
    <EntityFormDialog
      open={open}
      onClose={onClose}
      entityName="match"
      isEdit={isEdit}
      onSubmit={onSubmit}
      mutation={mutation}
      canSubmit={canSubmit}
    >
      <Stack direction="row" spacing={2}>
        <SelectField
          label="Discipline"
          value={form.discipline}
          onChange={updateField('discipline')}
          sx={{ flex: 1 }}
          options={enumOptions(DISCIPLINE, disciplineLabel)}
        />
        <SelectField
          label="Round"
          value={form.round}
          onChange={updateField('round')}
          sx={{ flex: 1 }}
          options={enumOptions(MATCH_ROUNDS, roundLabel)}
        />
        <SelectField
          label="Gender"
          value={form.gender}
          onChange={updateField('gender')}
          sx={{ flex: 1 }}
          options={enumOptions(GENDERS, genderLabel)}
        />
      </Stack>
      <Stack direction="row" spacing={2}>
        <TextField
          label="Round name (optional)"
          helperText="Override the round label, e.g. Final 1"
          value={form.roundName}
          onChange={updateField('roundName')}
          sx={{ flex: 2 }}
        />
        <TextField
          label="Position"
          type="number"
          value={form.position}
          onChange={updateField('position')}
          error={positionInvalid}
          sx={{ flex: 1 }}
        />
      </Stack>
      <Stack direction="row" spacing={2}>
        {athleteSelect('athlete1Id', 'Athlete 1')}
        {athleteSelect('athlete2Id', 'Athlete 2')}
      </Stack>
      <SelectField
        label="Winner"
        value={form.winnerId}
        onChange={updateField('winnerId')}
        disabled={winnerOptions.length === 0}
        placeholder={{ value: '', label: '— undecided —' }}
        options={winnerOptions.map((a) => ({ value: a.athleteId, label: a.name }))}
      />
    </EntityFormDialog>
  );
};
