import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GamepadPicker } from 'app/components/GamepadPicker';
import { fieldWidths } from 'app/theme/tokens';

import { px } from '../../util/computedUnits';

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
   * (freestyle-board-ux §4.3): a native list never becomes a `[role=listbox]`
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
  // The Speedline setup strip: one row beside the press readout, at a tablet's
  // width. The pad id is the browser's whole descriptor string, so inline it
  // is a phrase that truncates, and the select keeps the compact floor.
  it('shortens to a phrase inline, the whole id in the title', () => {
    const longId = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
    withPads([{ index: 0, id: longId }]);
    const { unmount } = render(<GamepadPicker inline />);
    const caption = screen.getByText(`Controller: ${longId}`);
    const style = window.getComputedStyle(caption);
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.textOverflow).toBe('ellipsis');
    // A fixed phrase (jsdom reports the `ch` cap in px): the readout beside it
    // is what gives way.
    expect(px(style.maxWidth)).toBeGreaterThan(0);
    expect(style.flexShrink).toBe('0');
    expect(caption).toHaveAttribute('title', longId);
    unmount();

    withPads(twoPads);
    render(<GamepadPicker inline />);
    const field = screen
      .getByRole('combobox', { name: 'Controller' })
      .closest('.MuiFormControl-root') as HTMLElement;
    expect(window.getComputedStyle(field).minWidth).toBe(`${fieldWidths.compact}px`);
    expect(window.getComputedStyle(field).maxWidth).toBe(`${fieldWidths.compact}px`);
  });
});
