import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RecorderToast } from 'app/components/RecorderToast';

describe('RecorderToast', () => {
  it('ignores a clickaway — the next operator tap must not swallow the toast it raises', async () => {
    // The one-tap award fires while the save toast is still open: the same click
    // bubbles to the Snackbar's ClickAwayListener, whose 'clickaway' close would
    // clear the confirmation that click just set (surfaced by the
    // false-start-rules driver smoke). Only timeout / the X may close.
    const onClose = vi.fn();
    render(
      <RecorderToast open message="Round awarded to lane 2" severity="success" onClose={onClose} />,
    );
    // ClickAwayListener arms itself a tick after mount — flush that first, or
    // the click below is ignored and the assertion passes vacuously.
    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.click(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes via the alert close button', () => {
    const onClose = vi.fn();
    render(<RecorderToast open message="Lane 2 time saved" severity="success" onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the message and severity while open', () => {
    render(
      <RecorderToast open message="Athlete 1 score saved" severity="success" onClose={vi.fn()} />,
    );

    expect(screen.getByText('Athlete 1 score saved')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders no alert when closed', () => {
    render(<RecorderToast open={false} message="" severity="success" onClose={vi.fn()} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('anchors top-right, off the clocks and the lane buttons', () => {
    // Audit S22: bottom-centre put the confirmation over the live column of the
    // control board — a toast may never cover a clock or a lane button
    // (FREESTYLE_BOARD_UX §4.12).
    const { container } = render(
      <RecorderToast open message="Athlete 1 score saved" severity="success" onClose={vi.fn()} />,
    );

    expect(container.querySelector('.MuiSnackbar-anchorOriginTopRight')).not.toBeNull();
    expect(container.querySelector('.MuiSnackbar-anchorOriginBottomCenter')).toBeNull();
  });

  it('paints a neutral plate rather than a race-coloured fill', () => {
    // The race palette stays reserved for timer state (§6): a filled `go`-green
    // save toast beside a running lane is a second, lying state light. The
    // severity survives as the icon/border mark on a panel ground.
    render(<RecorderToast open message="Lane 2 time saved" severity="success" onClose={vi.fn()} />);

    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('MuiAlert-outlined');
    expect(alert.className).toContain('MuiAlert-colorSuccess');
    expect(alert.className).not.toContain('MuiAlert-filled');
  });
});
