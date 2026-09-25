import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GamepadPicker } from 'app/components/GamepadPicker';

const { selectionMock, setSelectedPadId } = vi.hoisted(() => ({
  selectionMock: vi.fn(),
  setSelectedPadId: vi.fn(),
}));
vi.mock('app/state/gamepadSelection', () => ({ useGamepadSelection: selectionMock }));

const withPads = (pads: { index: number; id: string }[]) =>
  selectionMock.mockReturnValue({
    connectedPads: pads,
    selectedPadId: null,
    setSelectedPadId,
    selectedIndex: pads[0]?.index,
  });

const twoPads = [
  { index: 0, id: 'Buzz Controller A' },
  { index: 1, id: 'Buzz Controller B' },
];

describe('GamepadPicker', () => {
  beforeEach(() => {
    selectionMock.mockReset();
    setSelectedPadId.mockReset();
  });

  // The no-pad state is the handset card's own line ("press any button to
  // reveal it") — the card is what the operator is reading to resolve it, so a
  // second caption under it would only say it twice, in other words.
  it('captions the single pad and renders nothing without one', () => {
    withPads([]);
    const { container, unmount } = render(<GamepadPicker />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    withPads([twoPads[0]]);
    render(<GamepadPicker />);
    expect(screen.getByText(`Controller: ${twoPads[0].id}`)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('selects the pad the operator picks', async () => {
    const user = userEvent.setup();
    withPads(twoPads);
    render(<GamepadPicker />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Controller' }), [
      'Buzz Controller B',
    ]);

    expect(setSelectedPadId).toHaveBeenCalledWith('Buzz Controller B');
  });

  /**
   * The picker sits in the desk's left rail, where Space is the buzzer
   * (FREESTYLE_BOARD_UX §4.3): a native list never becomes a `[role=listbox]`
   * overlay that makes the whole board inert, and the picker drops the focus
   * it would otherwise keep — a focused `select` owns every Space after it.
   */
  it('keeps the keyboard for the buzzer', async () => {
    const user = userEvent.setup();
    withPads(twoPads);
    render(<GamepadPicker />);
    const picker = screen.getByRole('combobox', { name: 'Controller' });

    await user.selectOptions(picker, ['Buzz Controller B']);

    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).not.toBe(picker);
  });
});
