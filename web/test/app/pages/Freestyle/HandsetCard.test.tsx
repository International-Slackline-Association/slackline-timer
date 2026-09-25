import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HandsetCard } from 'app/pages/Freestyle/HandsetCard';
import { initialBattleState } from 'app/util/battleMachine';

/** The pad seam, writable so a test can land a press between renders. */
const pad = vi.hoisted(() => ({ press: undefined as { button: number; seq: number } | undefined }));

vi.mock('app/hooks/useGamepads', () => ({
  useGamepads: () => ({ lastPressedGamepadButton: pad.press }),
}));

vi.mock('app/state/gamepadSelection', () => ({
  useGamepadSelection: () => ({ connectedPads: [] }),
}));

vi.mock('app/components/GamepadPicker', () => ({
  GamepadPicker: () => <div>picker</div>,
}));

vi.mock('app/components/BuzzerMappingDialog', () => ({
  BuzzerMappingDialog: ({ triggerLabel }: { triggerLabel: string }) => (
    <button type="button">{triggerLabel}</button>
  ),
}));

/** A fresh element each call — React bails out of re-rendering an identical one. */
const card = () => (
  <HandsetCard
    mode="battle"
    battle={initialBattleState(150_000, 2)}
    trySeries={null}
    names={{ 1: 'Athlete 1', 2: 'Athlete 2' }}
  />
);

afterEach(() => {
  pad.press = undefined;
  vi.useRealTimers();
});

describe('HandsetCard', () => {
  it('keeps only live essentials in the default card body', () => {
    render(
      <HandsetCard
        mode="battle"
        battle={initialBattleState(150_000, 2)}
        trySeries={null}
        names={{ 1: 'Athlete 1', 2: 'Athlete 2' }}
      />,
    );

    const card = screen.getByRole('region', { name: 'Handsets' });
    expect(
      within(card).getByText('no handset detected — press any button to reveal it'),
    ).toBeInTheDocument();
    expect(within(card).getByTestId('handset-readout')).toHaveTextContent('last: —');
    expect(within(card).getByRole('button', { name: 'Open handset map' })).toBeInTheDocument();
    expect(within(card).queryByText(/button map hidden until needed/i)).toBeNull();
  });

  it('ages the last press for a minute, then holds no interval at all', () => {
    // The card is mounted for the whole session, so an ago-interval that never
    // stops is a permanent 1 Hz re-render of a line nobody is still reading.
    vi.useFakeTimers();
    const { rerender } = render(card());
    expect(vi.getTimerCount()).toBe(0);

    pad.press = { button: 0, seq: 1 };
    rerender(card());
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId('handset-readout')).toHaveTextContent('(0:30 ago)');
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => vi.advanceTimersByTime(31_000));
    expect(vi.getTimerCount()).toBe(0);

    // And it stays stopped: a re-render on any other prop must not re-arm it.
    rerender(card());
    expect(vi.getTimerCount()).toBe(0);
  });
});
