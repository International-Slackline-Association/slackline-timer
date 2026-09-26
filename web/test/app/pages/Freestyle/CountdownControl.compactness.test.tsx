import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CountdownControl } from 'app/pages/Freestyle/CountdownControl';

import { px } from '../../../util/computedUnits';

vi.mock('app/hooks/useGamepads', () => ({
  useGamepads: () => ({ lastPressedGamepadButton: undefined }),
}));

describe('CountdownControl compact chrome', () => {
  it('keeps the lane card chrome compact against the desk rhythm', () => {
    render(
      <CountdownControl
        id={1}
        runningLane={null}
        bestTrickArmed={false}
        lane={{ phase: 'idle', budgetMs: 120_000, armedMs: 120_000, breaksLeft: 2 }}
        mode="quali"
        onStart={() => {}}
        onStop={() => {}}
        onReset={() => {}}
        onTakeBreak={() => {}}
        onBlocked={() => {}}
      />,
    );

    const card = window.getComputedStyle(screen.getByTestId('lane-card-1'));
    expect(px(card.paddingTop)).toBe(12);
    expect(px(card.paddingBottom)).toBe(12);
    expect(px(card.gap)).toBe(8);
  });
});
