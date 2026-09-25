import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BuzzerMappingDialog } from 'app/components/BuzzerMappingDialog';
import { HANDSET_COLOUR_NOTE } from 'app/util/buzzer';

const { selectionMock } = vi.hoisted(() => ({ selectionMock: vi.fn() }));
vi.mock('app/state/gamepadSelection', () => ({ useGamepadSelection: selectionMock }));

const withPads = (pads: { index: number; id: string }[]) =>
  selectionMock.mockReturnValue({
    connectedPads: pads,
    selectedPadId: null,
    setSelectedPadId: vi.fn(),
    selectedIndex: pads[0]?.index,
  });

const rows = [
  { button: 0, action: 'Start (with lights)' },
  { button: 11, action: 'False start — lane 1' },
];

describe('BuzzerMappingDialog', () => {
  beforeEach(() => selectionMock.mockReset());

  it('keeps the trigger visible even with no Buzz controller connected', () => {
    withPads([{ index: 0, id: 'Xbox 360 Controller' }]);
    render(<BuzzerMappingDialog title="Speedline" rows={rows} />);

    expect(screen.getByRole('button', { name: /Buzzer buttons/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens manually with the mapping even before a Buzz controller is connected', async () => {
    const user = userEvent.setup();
    withPads([{ index: 0, id: 'Xbox 360 Controller' }]);
    render(<BuzzerMappingDialog title="Freestyle" rows={rows} />);

    await user.click(screen.getByRole('button', { name: /Buzzer buttons/ }));

    expect(screen.getByText('Buzzer buttons — Freestyle')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Use this reference to check the button map before the event; it stays available even before a Buzz! buzzer is connected.',
      ),
    ).toBeInTheDocument();
  });

  // It opens only when asked (owner call, 2026-09-19): a sheet owns the board
  // while it stands, so popping itself on a Buzz! connect made the buzzers inert
  // at the very moment the operator plugged them in to test them.
  it('opens nothing by itself when a Buzz connects', () => {
    withPads([{ index: 0, id: 'Sony Buzz' }]);
    render(<BuzzerMappingDialog title="Speedline" rows={rows} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the page-specific mapping once opened', async () => {
    const user = userEvent.setup();
    withPads([{ index: 0, id: 'Sony Buzz' }]);
    render(<BuzzerMappingDialog title="Speedline" rows={rows} />);
    await user.click(screen.getByRole('button', { name: /Buzzer buttons/ }));

    expect(screen.getByText('Buzzer buttons — Speedline')).toBeInTheDocument();
    // Derived handset + colour, plus the page-specific action text.
    expect(screen.getByText('Start (with lights)')).toBeInTheDocument();
    expect(screen.getByText('False start — lane 1')).toBeInTheDocument();
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Yellow')).toBeInTheDocument();
  });

  // C15: the sheet is a colour reference, so it owes the one pair where the
  // hardware's colour and the screen's disagree — the Freestyle handset card
  // says it too, from the same constant.
  it('states the handset↔screen colour divergence', async () => {
    const user = userEvent.setup();
    withPads([{ index: 0, id: 'Sony Buzz' }]);
    render(<BuzzerMappingDialog title="Speedline" rows={rows} />);
    await user.click(screen.getByRole('button', { name: /Buzzer buttons/ }));

    expect(screen.getByText(HANDSET_COLOUR_NOTE)).toBeInTheDocument();
  });

  it('can be dismissed and reopened from the chip', async () => {
    const user = userEvent.setup();
    withPads([{ index: 0, id: 'Sony Buzz' }]);
    render(<BuzzerMappingDialog title="Speedline" rows={rows} />);

    await user.click(screen.getByRole('button', { name: /Buzzer buttons/ }));
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitForElementToBeRemoved(() => screen.queryByText('Buzzer buttons — Speedline'));

    await user.click(screen.getByRole('button', { name: /Buzzer buttons/ }));
    expect(screen.getByText('Buzzer buttons — Speedline')).toBeInTheDocument();
  });
});

/**
 * The reference sheet lives beside the handset card, where Space is the buzzer
 * (FREESTYLE_BOARD_UX §4.3): a mouse press that opens it must leave the
 * keyboard where it found it, or MUI hands focus back to the trigger on close
 * and the trigger owns every buzzer press after it.
 */
describe('BuzzerMappingDialog keeps the keyboard for the buzzer', () => {
  beforeEach(() => selectionMock.mockReset());

  const dismiss = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitForElementToBeRemoved(() => screen.queryByText('Buzzer buttons — Freestyle'));
  };

  it('hands the keyboard back to the board once the sheet closes', async () => {
    const user = userEvent.setup();
    withPads([{ index: 0, id: 'Sony Buzz' }]);
    render(<BuzzerMappingDialog title="Freestyle" rows={rows} />);

    await user.click(screen.getByRole('button', { name: /Buzzer buttons/ }));
    await dismiss(user);

    expect(document.activeElement).toBe(document.body);
  });
});
