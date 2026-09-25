import { Button, Chip, ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { telemetryTheme } from 'app/theme/theme';
import { colors } from 'app/theme/tokens';

/**
 * The alarm tones outside a contained fill (FREESTYLE_BOARD_UX §6).
 *
 * `fsux-race-tokens` moved every stop **fill** onto `stopDim` and left
 * `error.main` / `warning.main` standing wherever the tone paints as ink — the
 * "it is a mark, not a text pair" reading. The board's eyes-on pass
 * (`fsux-followup-race-tokens-3`) measured what that leaves on screen: a filled
 * `Not recording` chip at 3.59:1 beside the darkened `Recording` chip it shares
 * a row with, an outlined `DNF` / `FS Lane n` label at 3.34:1 on the canvas, and
 * an outlined `warning` chip at 1.94:1 — all of them words, all under the 4.5:1
 * floor their size owes.
 *
 * The tier is what changes, never the hue: an alarm that paints ink takes the
 * `*Text` tier of its state (`stopDim` / `setText`), exactly as the state words
 * in the lane cards do. Pinned here rather than per call site because MUI
 * resolves `color="error"` from the palette wherever the theme is silent, so
 * the next chip added to the header inherits the answer.
 *
 * `contrast.test.ts` proves the tiers clear their floors; this proves the
 * controls land on them.
 */
describe('alarm tones outside a fill take their §6 text tier', () => {
  const renderThemed = (ui: ReactElement) =>
    render(<ThemeProvider theme={telemetryTheme}>{ui}</ThemeProvider>);

  const rgb = (hex: string): string => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${channels.join(', ')})`;
  };

  const paintOf = (el: Element) => {
    const style = getComputedStyle(el);
    return { fill: style.backgroundColor, ink: style.color, stroke: style.borderTopColor };
  };

  // `race.stopDim` defers to its CSS var (the `?bg=h2r` colour adaptation), so
  // the theme carries the var through and jsdom reports it verbatim.
  const STOP_DIM = colors.race.stopDim;

  it('fills an error chip with `stopDim`, never `error.main`', () => {
    renderThemed(<Chip color="error" label="Not recording (no athletes selected)" />);

    const chip = screen.getByText('Not recording (no athletes selected)').parentElement!;
    const { fill, ink } = paintOf(chip);
    expect(fill).toBe(STOP_DIM);
    expect(ink).toBe(rgb(colors.ink.onBrand));
  });

  // The stroke follows the ink through the same rule, but MUI paints a button
  // border off its own `--variant-outlined*` vars, which jsdom reports
  // unresolved — the browser is where that half is read (the driver's
  // `race-ink-probe` measured 5.01:1 on the canvas for both).
  it('writes an outlined error control in `stopDim` ink', () => {
    renderThemed(
      <Button variant="outlined" color="error">
        DNF
      </Button>,
    );

    expect(paintOf(screen.getByRole('button', { name: 'DNF' })).ink).toBe(STOP_DIM);
  });

  it('writes an outlined warning chip in the `setText` tier', () => {
    renderThemed(<Chip variant="outlined" color="warning" label="2/2 attempts" />);

    const { ink, stroke } = paintOf(screen.getByText('2/2 attempts').parentElement!);
    expect(ink).toBe(rgb(colors.race.setText));
    expect(stroke).toBe(rgb(colors.race.setText));
  });

  // The locked pair outranks every tone (§6, "Locked is a muted well"): the new
  // rules sit at one class of specificity so `.Mui-disabled` still wins.
  it('leaves a locked error control on the muted well', () => {
    renderThemed(
      <Button variant="outlined" color="error" disabled>
        DNF
      </Button>,
    );

    const { fill, ink } = paintOf(screen.getByRole('button', { name: 'DNF' }));
    expect({ fill, ink }).toEqual({
      fill: rgb(colors.surface.muted),
      ink: rgb(colors.ink.mid),
    });
  });
});
