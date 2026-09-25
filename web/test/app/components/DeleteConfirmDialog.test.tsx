import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from 'app/api/client';
import { DeleteConfirmDialog } from 'app/components/DeleteConfirmDialog';

const baseProps = {
  open: true,
  title: 'Delete athlete',
  error: null as unknown,
  pending: false,
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
};

describe('DeleteConfirmDialog', () => {
  it('renders the title and description, wiring confirm and cancel', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmDialog {...baseProps} onCancel={onCancel} onConfirm={onConfirm}>
        Delete Jane Doe? This cannot be undone.
      </DeleteConfirmDialog>,
    );

    expect(screen.getByText('Delete athlete')).toBeInTheDocument();
    expect(screen.getByText(/delete jane doe\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the mutation error inline', () => {
    render(
      <DeleteConfirmDialog {...baseProps} error={new ApiError(409, 'athlete has recorded times')}>
        Delete Jane Doe?
      </DeleteConfirmDialog>,
    );
    expect(screen.getByText(/athlete has recorded times/i)).toBeInTheDocument();
  });

  it('disables the delete button while pending', () => {
    render(
      <DeleteConfirmDialog {...baseProps} pending>
        Delete Jane Doe?
      </DeleteConfirmDialog>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('renders nothing when closed', () => {
    render(
      <DeleteConfirmDialog {...baseProps} open={false}>
        Delete Jane Doe?
      </DeleteConfirmDialog>,
    );
    expect(screen.queryByText('Delete athlete')).not.toBeInTheDocument();
  });
});
