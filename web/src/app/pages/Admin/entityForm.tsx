import { FormEvent, ReactNode, useState } from 'react';

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
} from '@mui/material';

import { apiErrorMessage } from 'app/util/apiError';

/**
 * The shared shape of the four admin create/edit dialogs (Athlete / Match /
 * Score / Time): `useEntityForm` owns the create-vs-edit dispatch + form state,
 * `EntityFormDialog` owns the dialog chrome. The per-entity bits stay in each
 * form — fields and input-building as children/`onSubmit`, validation as
 * `canSubmit`, cross-field invariants as `normalize`, extra in-flight work
 * (photo upload) as `busy`.
 */

/** The slice of a React Query mutation the form machinery needs — structural,
 *  so tests can fake it without react-query. */
export interface FormMutation<TVars> {
  mutate: (vars: TVars, options?: { onSuccess?: () => void }) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

export type MutationStatus = Pick<FormMutation<unknown>, 'isPending' | 'isError' | 'error'>;

/**
 * Create-vs-edit form state for one entity. `entity` undefined → create mode;
 * present → edit mode (seeded via `initialForm`, saved through the update
 * mutation with `getId`). `submit` closes the dialog on success.
 */
export const useEntityForm = <TEntity, TForm, TInput>({
  entity,
  initialForm,
  create,
  update,
  getId,
  onClose,
  normalize,
}: {
  entity: TEntity | undefined;
  initialForm: () => TForm;
  create: FormMutation<TInput>;
  update: FormMutation<{ id: string; input: TInput }>;
  getId: (entity: TEntity) => string;
  onClose: () => void;
  /** Cross-field invariant re-established after every `updateField` change
   *  (e.g. MatchForm clearing a winner whose athlete slot changed). */
  normalize?: (next: TForm) => TForm;
}) => {
  const isEdit = entity != null;
  const [form, setForm] = useState<TForm>(initialForm);

  const updateField =
    (field: keyof TForm) =>
    (e: { target: { value: string } }): void =>
      setForm((prev) => {
        // The cast covers the computed-key spread; callers only wire string-valued fields.
        const next = { ...prev, [field]: e.target.value } as TForm;
        return normalize ? normalize(next) : next;
      });

  const submit = (input: TInput): void => {
    const onSuccess = () => onClose();
    if (entity != null) {
      update.mutate({ id: getId(entity), input }, { onSuccess });
    } else {
      create.mutate(input, { onSuccess });
    }
  };

  const mutation: MutationStatus = isEdit ? update : create;

  return { isEdit, form, setForm, updateField, submit, mutation };
};

/**
 * The shared dialog chrome: title from `entityName` + mode, fields as children,
 * the mutation error as a trailing alert, Cancel + Create/Save actions. Submit
 * (button or Enter) is gated on `canSubmit`; the primary button also holds
 * while the mutation is pending or the form is `busy`.
 */
export const EntityFormDialog = ({
  open,
  onClose,
  entityName,
  isEdit,
  onSubmit,
  mutation,
  canSubmit = true,
  busy = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Lowercase noun for the title, e.g. "athlete" → "New athlete" / "Edit athlete". */
  entityName: string;
  isEdit: boolean;
  /** Build the input and call the hook's `submit`; invoked only when `canSubmit`. */
  onSubmit: () => void;
  mutation: MutationStatus;
  canSubmit?: boolean;
  /** Extra in-flight work (e.g. a photo upload) that should hold the primary button. */
  busy?: boolean;
  children: ReactNode;
}) => {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit}>
        <DialogTitle>{isEdit ? `Edit ${entityName}` : `New ${entityName}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {children}
            {mutation.isError && <Alert severity="error">{apiErrorMessage(mutation.error)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Box>
            <Button
              type="submit"
              variant="contained"
              disabled={mutation.isPending || busy || !canSubmit}
            >
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </Box>
        </DialogActions>
      </form>
    </Dialog>
  );
};
