import { Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';

import { useCreateScore, useUpdateScore } from 'app/api/scores';
import { SelectField, enumOptions } from 'app/components/SelectField';
import { EntityFormDialog, useEntityForm } from 'app/pages/Admin/entityForm';
import { MATCH_ROUNDS, computeOverall, type Athlete, type MatchRound, type Score } from 'app/types';
import { formatScore } from 'app/util/resultLabel';
import { roundLabel } from 'app/util/rounds';

/** Local form shape: the components and overall are edited as strings. */
interface FormState {
  athleteId: string;
  round: MatchRound;
  difficulty: string;
  combo: string;
  style: string;
  bestTrick: string;
  controlPenalty: string;
  overall: string;
  dnf: boolean;
}

const toStr = (n: number | undefined): string => (n === undefined ? '' : String(n));

const toFormState = (score?: Score): FormState => ({
  athleteId: score?.athleteId ?? '',
  round: score?.round ?? 'qualification',
  difficulty: toStr(score?.difficulty),
  combo: toStr(score?.combo),
  style: toStr(score?.style),
  bestTrick: toStr(score?.bestTrick),
  controlPenalty: toStr(score?.controlPenalty),
  overall: toStr(score?.overall),
  dnf: score?.dnf ?? false,
});

/** A finite number >= 0, or null when the field is blank/invalid. */
const parseNonNeg = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Create/edit dialog for a freestyle score. `score` undefined → create;
 * otherwise edit. `overall` is optional: left blank it is computed from the
 * five components via `computeOverall` (previewed live); a typed value is sent
 * as-is. Closes on a successful save.
 */
export const ScoreForm = ({
  compId,
  athletes,
  score,
  open,
  onClose,
}: {
  compId: string;
  athletes: Athlete[];
  score?: Score;
  open: boolean;
  onClose: () => void;
}) => {
  const { isEdit, form, setForm, updateField, submit, mutation } = useEntityForm({
    entity: score,
    initialForm: () => toFormState(score),
    create: useCreateScore(compId),
    update: useUpdateScore(compId),
    getId: (s) => s.scoreId,
    onClose,
  });

  // Best trick + control penalty are battles-only (rule F8): at qualification
  // the two inputs are hidden and forced to 0 (the server 400s a nonzero value).
  const isQuali = form.round === 'qualification';
  const components = {
    difficulty: parseNonNeg(form.difficulty),
    combo: parseNonNeg(form.combo),
    style: parseNonNeg(form.style),
    bestTrick: isQuali ? 0 : parseNonNeg(form.bestTrick),
    controlPenalty: isQuali ? 0 : parseNonNeg(form.controlPenalty),
  };
  const componentsInvalid = Object.values(components).some((n) => n === null);
  const overall = parseNonNeg(form.overall);
  const overallInvalid = form.overall.trim() !== '' && overall === null;
  const computedOverall = componentsInvalid
    ? null
    : computeOverall({
        difficulty: components.difficulty!,
        combo: components.combo!,
        style: components.style!,
        bestTrick: components.bestTrick!,
        controlPenalty: components.controlPenalty!,
      });
  const canSubmit = form.athleteId !== '' && !componentsInvalid && !overallInvalid;

  const onSubmit = () =>
    submit({
      athleteId: form.athleteId,
      round: form.round,
      difficulty: components.difficulty!,
      combo: components.combo!,
      style: components.style!,
      bestTrick: components.bestTrick!,
      controlPenalty: components.controlPenalty!,
      ...(overall !== null ? { overall } : {}),
      ...(form.dnf ? { dnf: true } : {}),
    });

  type StringField = {
    [K in keyof FormState]: FormState[K] extends string ? K : never;
  }[keyof FormState];

  const numberField = (field: StringField, label: string) => (
    <TextField
      label={label}
      type="number"
      slotProps={{ htmlInput: { min: 0, step: 'any' } }}
      value={form[field]}
      onChange={updateField(field)}
      error={parseNonNeg(form[field]) === null}
      required
    />
  );

  return (
    <EntityFormDialog
      open={open}
      onClose={onClose}
      entityName="score"
      isEdit={isEdit}
      onSubmit={onSubmit}
      mutation={mutation}
      canSubmit={canSubmit}
    >
      <SelectField
        label="Athlete"
        value={form.athleteId}
        onChange={updateField('athleteId')}
        required
        placeholder={{ value: '', label: 'Select an athlete…', disabled: true }}
        options={athletes.map((a) => ({ value: a.athleteId, label: a.name }))}
      />
      <SelectField
        label="Round"
        value={form.round}
        onChange={updateField('round')}
        required
        options={enumOptions(MATCH_ROUNDS, roundLabel)}
      />
      {numberField('difficulty', 'Difficulty')}
      {numberField('combo', 'Combo')}
      {numberField('style', 'Style')}
      {!isQuali && numberField('bestTrick', 'Best trick')}
      {!isQuali && numberField('controlPenalty', 'Control penalty')}
      <TextField
        label="Overall"
        type="number"
        slotProps={{ htmlInput: { min: 0, step: 'any' } }}
        helperText="Leave blank to compute from the components"
        value={form.overall}
        onChange={updateField('overall')}
        error={overallInvalid}
      />
      {computedOverall !== null && (
        <Typography variant="body2" color="text.secondary">
          Computed overall: {formatScore(computedOverall)}
        </Typography>
      )}
      <FormControlLabel
        control={
          <Checkbox
            checked={form.dnf}
            onChange={(e) => setForm((prev) => ({ ...prev, dnf: e.target.checked }))}
          />
        }
        label="Did not finish (DNF)"
      />
    </EntityFormDialog>
  );
};
