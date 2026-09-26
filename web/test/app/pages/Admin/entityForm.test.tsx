import { TextField } from '@mui/material';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EntityFormDialog, useEntityForm, type FormMutation } from 'app/pages/Admin/entityForm';

interface Widget {
  widgetId: string;
  label: string;
}

interface WidgetInput {
  label: string;
}

interface WidgetForm {
  label: string;
  linked: string;
}

/** A `FormMutation` fake whose `mutate` immediately reports success. */
const fakeMutation = <TVars,>(
  overrides: Partial<FormMutation<TVars>> = {},
): FormMutation<TVars> => ({
  mutate: vi.fn((_vars: TVars, options?: { onSuccess?: () => void }) => options?.onSuccess?.()),
  isPending: false,
  isError: false,
  error: null,
  ...overrides,
});

const Harness = ({
  widget,
  create,
  update,
  onClose = () => {},
  canSubmit,
  busy,
  normalize,
}: {
  widget?: Widget;
  create: FormMutation<WidgetInput>;
  update: FormMutation<{ id: string; input: WidgetInput }>;
  onClose?: () => void;
  canSubmit?: boolean;
  busy?: boolean;
  normalize?: (next: WidgetForm) => WidgetForm;
}) => {
  const { isEdit, form, updateField, submit, mutation } = useEntityForm({
    entity: widget,
    initialForm: (): WidgetForm => ({ label: widget?.label ?? '', linked: '' }),
    create,
    update,
    getId: (w) => w.widgetId,
    onClose,
    normalize,
  });
  return (
    <EntityFormDialog
      open
      onClose={onClose}
      entityName="widget"
      isEdit={isEdit}
      onSubmit={() => submit({ label: form.label })}
      mutation={mutation}
      canSubmit={canSubmit}
      busy={busy}
    >
      <TextField label="Label" value={form.label} onChange={updateField('label')} />
      <TextField label="Linked" value={form.linked} onChange={updateField('linked')} />
    </EntityFormDialog>
  );
};

describe('useEntityForm + EntityFormDialog', () => {
  it('create mode: titles the dialog "New …", submits via the create mutation, closes on success', () => {
    const create = fakeMutation<WidgetInput>();
    const update = fakeMutation<{ id: string; input: WidgetInput }>();
    const onClose = vi.fn();
    render(<Harness create={create} update={update} onClose={onClose} />);

    expect(screen.getByText('New widget')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^label/i), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(create.mutate).toHaveBeenCalledWith({ label: 'Alpha' }, expect.anything());
    expect(update.mutate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('edit mode: titles the dialog "Edit …", seeds the form, submits via the update mutation with the id', () => {
    const create = fakeMutation<WidgetInput>();
    const update = fakeMutation<{ id: string; input: WidgetInput }>();
    render(
      <Harness widget={{ widgetId: 'w1', label: 'Existing' }} create={create} update={update} />,
    );

    expect(screen.getByText('Edit widget')).toBeInTheDocument();
    expect(screen.getByLabelText(/^label/i)).toHaveValue('Existing');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(update.mutate).toHaveBeenCalledWith(
      { id: 'w1', input: { label: 'Existing' } },
      expect.anything(),
    );
    expect(create.mutate).not.toHaveBeenCalled();
  });

  it('blocks submit and disables the primary button while canSubmit is false', () => {
    const create = fakeMutation<WidgetInput>();
    render(<Harness create={create} update={fakeMutation()} canSubmit={false} />);

    const button = screen.getByRole('button', { name: 'Create' });
    expect(button).toBeDisabled();
    // An Enter-key submit bypasses the disabled button — the guard must hold there too.
    fireEvent.submit(button.closest('form')!);
    expect(create.mutate).not.toHaveBeenCalled();
  });

  it('disables the primary button while the mutation is pending or the form is busy', () => {
    const { unmount } = render(
      <Harness create={fakeMutation<WidgetInput>({ isPending: true })} update={fakeMutation()} />,
    );
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    unmount();

    render(<Harness create={fakeMutation<WidgetInput>()} update={fakeMutation()} busy />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('surfaces the mutation error through apiErrorMessage', () => {
    render(
      <Harness
        create={fakeMutation<WidgetInput>({ isError: true, error: new Error('boom') })}
        update={fakeMutation()}
      />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('runs the normalize hook after every field change', () => {
    // Mirror of MatchForm's winner-clearing: `linked` may only echo `label`.
    const normalize = (next: WidgetForm): WidgetForm =>
      next.linked && next.linked !== next.label ? { ...next, linked: '' } : next;
    render(<Harness create={fakeMutation()} update={fakeMutation()} normalize={normalize} />);

    fireEvent.change(screen.getByLabelText(/^label/i), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText(/^linked/i), { target: { value: 'a' } });
    expect(screen.getByLabelText(/^linked/i)).toHaveValue('a');

    fireEvent.change(screen.getByLabelText(/^label/i), { target: { value: 'b' } });
    expect(screen.getByLabelText(/^linked/i)).toHaveValue('');
  });
});
