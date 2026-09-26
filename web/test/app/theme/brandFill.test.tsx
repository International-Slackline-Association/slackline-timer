import { Button, Chip, ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { telemetryTheme } from 'app/theme/theme';
import { colors } from 'app/theme/tokens';

/**
 * The brand teal tier on the live path (FREESTYLE_BOARD_UX §6).
 *
 * MUI reaches for `primary.main` — the brand teal — wherever a surface asks for
 * the brand: as a contained button's fill, as a filled chip's ground, as a text
 * button's ink. All three are 2.9:1 against `contrastText`/white, so every one
 * of them shipped under the 4.5:1 its label owes. The tier that clears it is
 * `brand.tealDark` (4.61:1 on a panel), and the theme is where it belongs: the
 * score rail hand-painted it on Save alone, which is how `Set both lanes` — the
 * same button, one column over — kept the failing one.
 *
 * `contrast.test.ts` proves the pairs clear their floor and that no control page
 * hand-paints them again; this proves the controls land on them. A locked button
 * keeps the muted well instead (`lockedControls.test.tsx` renders exactly this
 * button disabled) — a lock outranks every tone.
 */
describe('the brand tier takes the §6 `tealDark` pair', () => {
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

  it('fills a contained primary button with `tealDark`, never `primary.main`', () => {
    renderThemed(<Button variant="contained">Save</Button>);

    expect(paintOf(screen.getByRole('button', { name: 'Save' }))).toEqual({
      fill: rgb(colors.brand.tealDark),
      ink: rgb(colors.ink.onBrand),
    });
  });

  it('fills a filled primary chip with `tealDark` — the header’s mode mark', () => {
    renderThemed(<Chip size="small" color="primary" label="Freestyle" />);

    expect(paintOf(screen.getByText('Freestyle').closest('.MuiChip-root')!)).toEqual({
      fill: rgb(colors.brand.tealDark),
      ink: rgb(colors.ink.onBrand),
    });
  });

  it('writes a text primary button in `tealDark` — a confirm’s safe answer', () => {
    // The confirms' safe answers (`Keep timing` / `Keep match` / `Keep series`)
    // are plain `<Button>`s, so they take MUI's default text+primary pair: teal
    // ink at 2.95:1 on the dialog's own panel.
    renderThemed(<Button>Keep timing</Button>);

    expect(paintOf(screen.getByRole('button', { name: 'Keep timing' })).ink).toBe(
      rgb(colors.brand.tealDark),
    );
  });
});
