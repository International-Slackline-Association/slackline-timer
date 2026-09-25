import { ThemeProvider, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { telemetryTheme } from 'app/theme/theme';
import { colors } from 'app/theme/tokens';

/**
 * "The mode toggle's chosen key" (FREESTYLE_BOARD_UX §6) — one pair, live and
 * locked.
 *
 * MUI paints a selected `color="primary"` key in `primary.main` — the brand
 * teal, 2.72:1 on its own tinted well — which §6 confines to links and nav and
 * the live-path floor rejects outright. The pair is `ink.hi` on `lineStrong`,
 * already proven on the best-trick cap pair; the lock never had a say in which
 * option is chosen, so the live key takes the same mark and the lock is left to
 * read on the unchosen key's well and on the step between the two strokes.
 *
 * `contrast.test.ts` proves the pair clears 4.5:1; this proves the control
 * lands on it in both states, since MUI's own selected look wins wherever the
 * theme is silent.
 */
describe('the mode toggle’s chosen key (FREESTYLE_BOARD_UX §6)', () => {
  const renderThemed = (ui: ReactElement) =>
    render(<ThemeProvider theme={telemetryTheme}>{ui}</ThemeProvider>);

  const rgb = (hex: string): string => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${channels.join(', ')})`;
  };

  const paintOf = (el: Element) => {
    const style = getComputedStyle(el);
    return { fill: style.backgroundColor, ink: style.color };
  };

  const renderToggle = (disabled: boolean) =>
    renderThemed(
      <ToggleButtonGroup
        exclusive
        fullWidth
        color="primary"
        size="small"
        value="quali"
        disabled={disabled}
      >
        <ToggleButton value="quali">Quali</ToggleButton>
        <ToggleButton value="battle">Battle</ToggleButton>
      </ToggleButtonGroup>,
    );

  const CHOSEN = { fill: rgb(colors.surface.lineStrong), ink: rgb(colors.ink.hi) };

  it('paints the live chosen key `ink.hi` on `lineStrong`, never brand teal', () => {
    renderToggle(false);

    const paint = paintOf(screen.getByRole('button', { name: 'Quali' }));
    expect(paint).toEqual(CHOSEN);
    expect(paint.ink).not.toBe(rgb(colors.brand.teal));
  });

  it('leaves the live unchosen key off the chosen well, so the choice still reads', () => {
    renderToggle(false);

    expect(paintOf(screen.getByRole('button', { name: 'Battle' })).fill).not.toBe(CHOSEN.fill);
  });

  it('hands the lock the same chosen mark — a lock may not take which option is chosen', () => {
    renderToggle(true);

    expect(paintOf(screen.getByRole('button', { name: 'Quali' }))).toEqual(CHOSEN);
  });
});
