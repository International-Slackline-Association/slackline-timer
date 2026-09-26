import { Button, TextField, ThemeProvider, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { telemetryTheme } from 'app/theme/theme';
import { colors } from 'app/theme/tokens';

/**
 * "Locked is a muted well, in every tone" (FREESTYLE_BOARD_UX §6) — pinned on
 * what the theme actually paints, not on the tokens it names.
 *
 * `contrast.test.ts` proves the locked pair clears 4.5:1; this proves the
 * controls land on it. The two are separate guards because MUI supplies a
 * disabled look of its own for every control family — `action.disabled`
 * (rgba(0,0,0,0.26), 1.8:1 on a panel), `action.disabledBackground`
 * (rgba(0,0,0,0.12), which drops the §6 row to 4.36:1) and `text.disabled`
 * (1.6:1 on the muted well) — and it wins wherever the theme is silent. §2
 * requires the opposite: setup controls "lock grey in place", readable.
 */
describe('locked controls take the §6 muted well', () => {
  const renderThemed = (ui: ReactElement) =>
    render(<ThemeProvider theme={telemetryTheme}>{ui}</ThemeProvider>);

  const rgb = (hex: string): string => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${channels.join(', ')})`;
  };

  const paintOf = (el: Element) => {
    const style = getComputedStyle(el);
    return {
      fill: style.backgroundColor,
      ink: style.color,
      stroke: style.borderTopColor,
    };
  };

  const LOCKED = { fill: rgb(colors.surface.muted), ink: rgb(colors.ink.mid) };

  it('gives a locked contained button the well, not MUI’s disabled ground', () => {
    renderThemed(
      <Button variant="contained" disabled>
        Set both lanes
      </Button>,
    );

    const { fill, ink } = paintOf(screen.getByRole('button', { name: 'Set both lanes' }));
    expect({ fill, ink }).toEqual(LOCKED);
  });

  // The mode toggle locks whenever the board holds destroyable state (§4.5), so
  // it spends most of a heat disabled — and it is where the operator reads which
  // mode the board is in.
  describe('the locked mode toggle', () => {
    const renderToggle = () =>
      renderThemed(
        <ToggleButtonGroup exclusive fullWidth color="primary" size="small" value="quali" disabled>
          <ToggleButton value="quali">Quali</ToggleButton>
          <ToggleButton value="battle">Battle</ToggleButton>
        </ToggleButtonGroup>,
      );

    it('drops the unchosen key to the locked pair', () => {
      renderToggle();

      const { fill, ink } = paintOf(screen.getByRole('button', { name: 'Battle' }));
      expect({ fill, ink }).toEqual(LOCKED);
    });

    // Which mode is live has to survive the lock, so it is the one mark the
    // lock does not change — `chosenKey.test.tsx` owns that equality; here it
    // only has to clear the locked well beside it, or the choice reads as gone.
    it('keeps the chosen key legible, and off the locked well', () => {
      renderToggle();

      const { fill, ink } = paintOf(screen.getByRole('button', { name: 'Quali' }));
      expect(ink).toBe(rgb(colors.ink.hi));
      expect(fill).toBe(rgb(colors.surface.lineStrong));
      expect(fill).not.toBe(LOCKED.fill);
    });

    it('drops both keys to the recessive stroke', () => {
      renderToggle();

      for (const name of ['Quali', 'Battle']) {
        expect(paintOf(screen.getByRole('button', { name })).stroke).toBe(rgb(colors.surface.line));
      }
    });
  });

  // The run/warm-up budgets lock while a lane runs, and the operator reads them
  // back in exactly that state to know what the next arm will hand out.
  describe('a locked budget field', () => {
    const renderField = () =>
      renderThemed(
        <TextField
          label="Run (s)"
          size="small"
          type="number"
          value={120}
          disabled
          helperText="locked while Athlete 1 runs"
          onChange={() => {}}
        />,
      );

    it('keeps its value readable on the well', () => {
      renderField();

      const input = screen.getByLabelText('Run (s)');
      const style = getComputedStyle(input);
      expect(style.color).toBe(rgb(colors.ink.mid));
      // Safari reads the WebKit fill, not `color`.
      expect(style.getPropertyValue('-webkit-text-fill-color')).toBe(rgb(colors.ink.mid));
    });

    it('keeps its label and why-line at the sub-line tier', () => {
      const { container } = renderField();

      for (const selector of ['label', '.MuiFormHelperText-root']) {
        expect(getComputedStyle(container.querySelector(selector)!).color).toBe(
          rgb(colors.ink.mid),
        );
      }
    });

    it('drops its outline to the recessive stroke', () => {
      const { container } = renderField();

      const outline = container.querySelector('.MuiOutlinedInput-notchedOutline')!;
      expect(getComputedStyle(outline).borderTopColor).toBe(rgb(colors.surface.line));
    });
  });
});
