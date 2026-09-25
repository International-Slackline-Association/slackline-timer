import { Button, Dialog, DialogActions } from '@mui/material';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { behindOverlay } from './behindOverlay';

/** A board control plus the confirm that takes the screen away from it. */
const Board = ({ open }: { open: boolean }) => (
  <div>
    <button type="button">Stop Player 1</button>
    <Dialog open={open}>
      <DialogActions>
        <Button>Keep timing</Button>
      </DialogActions>
    </Dialog>
  </div>
);

describe('behindOverlay', () => {
  it('reaches a board control that an open overlay hid from the role queries', async () => {
    render(<Board open />);
    await screen.findByRole('dialog');

    // The mechanic itself, pinned: `screen` reads the accessibility tree, and the
    // open modal marked the whole board off it.
    expect(screen.queryByRole('button', { name: 'Stop Player 1' })).toBeNull();

    expect(behindOverlay().getByRole('button', { name: 'Stop Player 1' })).toBeEnabled();
  });

  it("keeps the overlay's own buttons out of scope, so a name cannot match twice", async () => {
    render(<Board open />);
    await screen.findByRole('dialog');

    expect(behindOverlay().queryByRole('button', { name: 'Keep timing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep timing' })).toBeEnabled();
  });

  it('refuses to answer with nothing open — that board is `screen`', () => {
    render(<Board open={false} />);

    expect(() => behindOverlay()).toThrow(/no open overlay/i);
    expect(screen.getByRole('button', { name: 'Stop Player 1' })).toBeEnabled();
  });
});
