import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BoardConfirmDialog } from 'app/components/BoardConfirmDialog';
import { advanceBlocked, advanceOverlay } from 'app/hooks/useAdvanceInput';

const props = {
  open: true,
  titleId: 'reset-confirm-title-2',
  title: 'Reset Athlete 2?',
  body: <>Athlete 2 holds 0:42 — resetting re-arms to 1:30.</>,
  confirmLabel: 'Reset Athlete 2',
  safeAnswer: 'Keep timing',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

const dialog = () => screen.getByRole('dialog');

describe('BoardConfirmDialog', () => {
  it('names the question by the title the caller composed', () => {
    render(<BoardConfirmDialog {...props} />);

    expect(dialog()).toHaveAttribute('aria-labelledby', 'reset-confirm-title-2');
    expect(within(dialog()).getByText('Reset Athlete 2?')).toBeVisible();
    expect(
      within(dialog()).getByText('Athlete 2 holds 0:42 — resetting re-arms to 1:30.'),
    ).toBeVisible();
  });

  it('carries the press out on the destructive answer', async () => {
    const onConfirm = vi.fn();
    render(<BoardConfirmDialog {...props} onConfirm={onConfirm} />);

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Reset Athlete 2' }));

    expect(onConfirm).toHaveBeenCalled();
  });

  it('autofocuses the safe answer and keeps the question standing behind it', async () => {
    const onCancel = vi.fn();
    render(<BoardConfirmDialog {...props} onCancel={onCancel} />);

    const safe = within(dialog()).getByRole('button', { name: 'Keep timing' });
    expect(document.activeElement).toBe(safe);

    await userEvent.click(safe);
    expect(onCancel).toHaveBeenCalled();
  });

  // §4.8/§4.14: a press behind the question answers it safely, and the handset
  // readout names it — off the destructive button's own words, so the control
  // the readout sends the operator to is the one on screen.
  it('registers the question with the advance seam under the destructive label', () => {
    render(<BoardConfirmDialog {...props} />);

    expect(advanceOverlay()?.confirm).toEqual({
      dialog: 'Reset Athlete 2',
      safeAction: 'Keep timing',
    });
    expect(document.activeElement?.textContent).toBe('Keep timing');
  });

  it('answers an ADVANCE press behind it with the safe answer', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<BoardConfirmDialog {...props} onCancel={onCancel} onConfirm={onConfirm} />);

    const safeClose = advanceBlocked();
    expect(safeClose).not.toBeNull();
    act(() => safeClose?.());

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('registers nothing while it is closed', async () => {
    const { rerender } = render(<BoardConfirmDialog {...props} />);
    expect(advanceOverlay()).not.toBeNull();

    rerender(<BoardConfirmDialog {...props} open={false} />);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(advanceOverlay()).toBeNull();
  });

  // The two lane-side questions read their payload, and drop it as the question
  // closes: the shell renders whatever body it is handed, `null` included.
  it('renders no body when it is handed none', () => {
    render(<BoardConfirmDialog {...props} body={null} />);

    expect(within(dialog()).getByText('Reset Athlete 2?')).toBeVisible();
    expect(dialog().querySelector('.MuiDialogContent-root')).toBeNull();
  });
});
