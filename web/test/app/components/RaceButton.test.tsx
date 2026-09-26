import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RaceButton, blurOnClickProps, type RaceTone } from 'app/components/RaceButton';
import { telemetryTheme } from 'app/theme/theme';
import { colors } from 'app/theme/tokens';

/**
 * The live-column control contract (FREESTYLE_BOARD_UX §4.4): a mouse press on
 * a race control must never leave the focus behind, because a focused button
 * owns the next Space — and Space is the buzzer (§4.3). The wrapper answers
 * that twice over: `preventDefault` on mousedown so the press never takes
 * focus, and a blur after the click for the focus it may already have had.
 */
describe('RaceButton keeps the keyboard for the buzzer', () => {
  it('does not take focus from a mouse press', async () => {
    const user = userEvent.setup();
    render(<RaceButton>Stop</RaceButton>);

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(document.activeElement).toBe(document.body);
  });

  it('drops the focus it already held when clicked', async () => {
    const user = userEvent.setup();
    render(<RaceButton>Stop</RaceButton>);
    const button = screen.getByRole('button', { name: 'Stop' });
    button.focus();

    await user.click(button);

    expect(document.activeElement).toBe(document.body);
  });

  it('still runs the caller’s handlers', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onMouseDown = vi.fn();
    render(
      <RaceButton onClick={onClick} onMouseDown={onMouseDown}>
        Start
      </RaceButton>,
    );

    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });
});

// The same rule for live-column chrome that is not a `Button` — the Setup
// `Switch` and the mode `ToggleButtonGroup` (§4.4).
describe('blurOnClickProps', () => {
  it('wraps the caller’s handlers in the blur rule', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <button type="button" {...blurOnClickProps<HTMLButtonElement>({ onClick })}>
        Quali
      </button>,
    );
    const button = screen.getByRole('button', { name: 'Quali' });
    button.focus();

    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('RaceButton target sizes (§6, rubric C05)', () => {
  it.each([
    ['race' as const, '56px', '120px'],
    ['aux' as const, '44px', '44px'],
  ])('%s is %s tall and at least %s wide', (size, minHeight, minWidth) => {
    render(<RaceButton size={size}>Start</RaceButton>);
    const style = getComputedStyle(screen.getByRole('button', { name: 'Start' }));
    expect(style.minHeight).toBe(minHeight);
    expect(style.minWidth).toBe(minWidth);
  });
});

// The §6 pair table, at the one place the live path paints it — `contrast.test.ts`
// pins the ratios, this pins that the buttons ask for those tokens.
describe('RaceButton state colours (§6)', () => {
  // The tones resolve through the TELEMETRY palette, which the app installs in
  // `app/index.tsx` — the bare test render would read MUI's own defaults.
  const renderThemed = (ui: ReactElement) =>
    render(<ThemeProvider theme={telemetryTheme}>{ui}</ThemeProvider>);

  const rgb = (hex: string): string => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${channels.join(', ')})`;
  };

  const paintOf = (tone: RaceTone, { disabled = false } = {}) => {
    const { unmount } = renderThemed(
      <RaceButton tone={tone} disabled={disabled}>
        Start
      </RaceButton>,
    );
    const style = getComputedStyle(screen.getByRole('button', { name: 'Start' }));
    const paint = { fill: style.backgroundColor, ink: style.color, stroke: style.borderTopColor };
    unmount();
    return paint;
  };

  it('go is the `race.go` fill under `ink.hi`', () => {
    const { fill, ink } = paintOf('go');
    expect({ fill, ink }).toEqual({ fill: rgb(colors.race.go), ink: rgb(colors.ink.hi) });
  });

  it('stop carries white on the `stopDim` text tier, never on `error.main`', () => {
    const { fill, ink } = paintOf('stop');
    expect(ink).toBe(rgb(colors.ink.onBrand));
    expect(fill).not.toBe(rgb(colors.race.stop));
  });

  it('goOutline and neutral write in their own ink', () => {
    expect(paintOf('goOutline').ink).toBe(rgb(colors.race.goText));
    expect(paintOf('neutral').ink).toBe(rgb(colors.ink.mid));
  });

  // The two pairs the THEME already owns (§6 "Save contained" 4.61:1, "Outlined
  // alarm control" 5.01:1). They join the table anyway because the paint is the
  // half a call site could get right on its own: what a `variant="contained"` /
  // `color="error"` press never carried is the aux target and the blur rule.
  it('save takes the theme’s `tealDark` brand fill', () => {
    const { fill, ink } = paintOf('save');
    expect({ fill, ink }).toEqual({
      fill: rgb(colors.brand.tealDark),
      ink: rgb(colors.ink.onBrand),
    });
  });

  // `race.stopDim` defers to its CSS var (the `?bg=h2r` colour adaptation), so
  // jsdom reports it verbatim; the stroke rides MUI's own outlined vars, which
  // only a browser resolves (see `alarmTones.test.tsx`).
  it('dnf writes the alarm word in the `stopDim` text tier', () => {
    expect(paintOf('dnf').ink).toBe(colors.race.stopDim);
  });

  // §6 "Disabled race control" — one visual meaning of locked rather than six
  // washed state colours.
  it.each(['go', 'stop', 'goOutline', 'neutral', 'save', 'dnf'] as const)(
    'paints a locked %s the muted well, not a washed state colour',
    (tone) => {
      const { fill, ink } = paintOf(tone, { disabled: true });
      expect({ fill, ink }).toEqual({ fill: rgb(colors.surface.muted), ink: rgb(colors.ink.mid) });
    },
  );

  // The label alone is not enough — a live outlined neutral already paints
  // `ink.mid` ink inside an `ink.mid` stroke, so the stroke drop is what tells
  // the two states apart at a glance (rubric C06).
  it('drops a locked outlined control to the recessive `line` stroke', () => {
    expect(paintOf('neutral').stroke).toBe(rgb(colors.ink.mid));
    expect(paintOf('neutral', { disabled: true }).stroke).toBe(rgb(colors.surface.line));
  });
});
