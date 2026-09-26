import { FormControlLabel, Switch, TextField } from '@mui/material';

import { useCreateTime, useUpdateTime } from 'app/api/times';
import { SelectField, enumOptions } from 'app/components/SelectField';
import { EntityFormDialog, useEntityForm } from 'app/pages/Admin/entityForm';
import { TIME_ROUNDS, type Athlete, type Time, type TimeRound } from 'app/types';
import { roundLabel } from 'app/util/rounds';
import { DNF_SENTINEL, formatMs, isValidTimeFormat, parseTimeString } from 'app/util/time';

/** Local form shape: time is edited as a `M:SS.hh` string, DNF as a toggle. */
interface FormState {
  athleteId: string;
  round: TimeRound;
  timeStr: string;
  dnf: boolean;
}

const toFormState = (time?: Time): FormState => ({
  athleteId: time?.athleteId ?? '',
  round: time?.round ?? 'qualification',
  timeStr: time && time.timeMs !== DNF_SENTINEL ? formatMs(time.timeMs) : '',
  dnf: time?.timeMs === DNF_SENTINEL,
});

/**
 * Create/edit dialog for a recorded time. `time` undefined → manual create
 * (startTime defaults server-side); otherwise edit, carrying the existing
 * `startTime` through so a correction doesn't shift the recorded start. Closes
 * on a successful save.
 */
export const TimeForm = ({
  compId,
  athletes,
  time,
  open,
  onClose,
}: {
  compId: string;
  athletes: Athlete[];
  time?: Time;
  open: boolean;
  onClose: () => void;
}) => {
  const { isEdit, form, setForm, updateField, submit, mutation } = useEntityForm({
    entity: time,
    initialForm: () => toFormState(time),
    create: useCreateTime(compId),
    update: useUpdateTime(compId),
    getId: (t) => t.timeId,
    onClose,
  });

  const timeInvalid = !form.dnf && !isValidTimeFormat(form.timeStr);
  const canSubmit = form.athleteId !== '' && !timeInvalid;

  const onSubmit = () => {
    const timeMs = form.dnf ? DNF_SENTINEL : (parseTimeString(form.timeStr) ?? 0);
    submit({
      athleteId: form.athleteId,
      round: form.round,
      timeMs,
      ...(time?.startTime !== undefined ? { startTime: time.startTime } : {}),
    });
  };

  return (
    <EntityFormDialog
      open={open}
      onClose={onClose}
      entityName="time"
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
        options={enumOptions(TIME_ROUNDS, roundLabel)}
      />
      <TextField
        label="Time"
        helperText="Format M:SS.hh, e.g. 1:23.45"
        value={form.timeStr}
        onChange={updateField('timeStr')}
        disabled={form.dnf}
        error={timeInvalid}
        required={!form.dnf}
      />
      <FormControlLabel
        control={
          <Switch
            checked={form.dnf}
            onChange={(e) => setForm((prev) => ({ ...prev, dnf: e.target.checked }))}
          />
        }
        label="DNF (did not finish)"
      />
    </EntityFormDialog>
  );
};
