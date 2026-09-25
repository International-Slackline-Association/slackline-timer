import { Button, type ButtonProps, type SxProps, type Theme } from '@mui/material';
import type { MouseEvent } from 'react';

import { colors } from 'app/theme/tokens';

/** The §6 state colours a live control may paint. */
export type RaceTone = 'go' | 'goOutline' | 'stop' | 'neutral' | 'save' | 'dnf';

/** Start / Stop / Start try / End try are `race`; every other live control
 * (Take break, End turn, Re-arm, Save, DNF, Retry, Reset) is `aux`. */
export type RaceButtonSize = 'race' | 'aux';

const SIZE_SX: Record<RaceButtonSize, { minHeight: number; minWidth: number }> = {
  race: { minHeight: 56, minWidth: 120 },
  aux: { minHeight: 44, minWidth: 44 },
};

// The two hand-painted fills, as palette entries: go is `race.go` + `ink.hi`
// (4.76:1); stop is `error.dark`, the `stopDim` text tier — never `error.main`,
// which carries white at 3.59:1 (§6). `color="error"` still lands on the same
// tier wherever the theme's alarm variants reach — chips, borders, icons, and
// the `dnf` tone below. Both tones hold their resting pair through hover
// rather than dropping to the `*Dim` shade, which carries ink at 2.6:1.
// The `stop` tone is the live path's only stop fill (pinned by
// test/app/theme/contrast.test.ts): a destructive press that hand-paints the
// colour gets it without the blur rule below.
const goFillSx = {
  bgcolor: 'success.main',
  color: 'success.contrastText',
  '&:hover': { bgcolor: 'success.main', filter: 'brightness(0.94)' },
} as const;

const stopFillSx = {
  bgcolor: 'error.dark',
  color: 'error.contrastText',
  '&:hover': { bgcolor: 'error.dark', filter: 'brightness(0.92)' },
} as const;

interface ToneSkin {
  variant: 'contained' | 'outlined';
  /** Set where the THEME owns the pair, so the tone only names it. */
  color?: ButtonProps['color'];
  sx?: SxProps<Theme>;
}

// The fills sit under `:not(.Mui-disabled)` so a locked race control keeps the
// theme's muted/`ink.mid` disabled pair (§6) instead of a washed state colour.
const TONE: Record<RaceTone, ToneSkin> = {
  go: { variant: 'contained', sx: { '&:not(.Mui-disabled)': goFillSx } },
  stop: { variant: 'contained', sx: { '&:not(.Mui-disabled)': stopFillSx } },
  goOutline: {
    variant: 'outlined',
    sx: { '&:not(.Mui-disabled)': { color: colors.race.goText, borderColor: colors.race.goText } },
  },
  neutral: {
    variant: 'outlined',
    sx: { '&:not(.Mui-disabled)': { color: 'text.secondary', borderColor: 'text.secondary' } },
  },
  // Save and DNF take their pair from the theme's own variants — `tealDark` +
  // `ink.onBrand` (4.61:1) and the `stopDim` outlined alarm (5.01:1), §6 — so
  // the tone only names it. They are tones all the same, because the colour is
  // the half a call site got right on its own: the presses these replaced were
  // `size="small"` `Button`s, under the aux floor and holding the focus that
  // the next handset press needs.
  save: { variant: 'contained', color: 'primary' },
  dnf: { variant: 'outlined', color: 'error' },
};

interface Props extends Omit<ButtonProps, 'size'> {
  /** Overrides `variant`/`color`. Omit it and the wrapper is behaviour + target
   * size only — the score rail and the setup chrome keep their own skin until
   * their slice repaints them. */
  tone?: RaceTone;
  size?: RaceButtonSize;
}

/**
 * The blur rule around a caller's own mouse handlers, for the board chrome that
 * cannot be a `RaceButton` — the Setup `Switch` and mode `ToggleButtonGroup`,
 * the projector links, the score rail's field adornment.
 * `preventDefault` stops the press taking focus; the blur clears focus the
 * control may already have held.
 */
export const blurOnClickProps = <E extends HTMLElement>({
  onMouseDown,
  onClick,
}: {
  onMouseDown?: (event: MouseEvent<E>) => void;
  onClick?: (event: MouseEvent<E>) => void;
} = {}) => ({
  onMouseDown: (event: MouseEvent<E>) => {
    event.preventDefault();
    onMouseDown?.(event);
  },
  onClick: (event: MouseEvent<E>) => {
    const control = event.currentTarget;
    onClick?.(event);
    control.blur();
  },
});

/**
 * Every control in the live column (FREESTYLE_BOARD_UX §4.4). Space is the
 * buzzer and a focused button owns it (§4.3), so a mouse press on a race
 * control must leave the keyboard where it found it — otherwise clicking Stop
 * swallows the next buzzer press. The tone/size props carry the §6 contract so
 * the live path has one control vocabulary rather than per-panel `variant`
 * guesses.
 */
export const RaceButton = ({ tone, size = 'aux', sx, onMouseDown, onClick, ...rest }: Props) => {
  const { sx: toneSx, ...tonePaint }: Partial<ToneSkin> = tone === undefined ? {} : TONE[tone];
  return (
    <Button
      {...rest}
      {...tonePaint}
      {...blurOnClickProps<HTMLButtonElement>({ onMouseDown, onClick })}
      sx={[SIZE_SX[size], ...(toneSx ? [toneSx] : []), ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
};
