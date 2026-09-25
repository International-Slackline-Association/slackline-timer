import 'app/flag-icons/css/flag-icons.min.css';

import { Box, Stack } from '@mui/material';

import { CountryFlag, toAlpha2 } from 'app/components/CountryFlag';
import { type Athlete } from 'app/types';

/**
 * A flag rendered as a CSS-background block via the flag-icons class, stretched
 * to fill its box — the overlay-card analogue of the inline-sized `CountryFlag`.
 *
 * The imported flag-icons `.fi` rule sets `width:1.333333em; line-height:1em;
 * background-size:contain`, which at equal specificity beats a plain `sx`, so a
 * naive block collapses to a ~1.3em sliver / contained crop. We therefore size
 * the block ourselves and raise specificity with the emotion `&&` self-selector
 * (doubled class → 0,2,0). ALL sizing — the defaults and the caller's `sx` —
 * must stay inside that `&&` block to beat `.fi`; the defaults come before the
 * spread so a caller can still reshape per card (e.g. pin an explicit width on
 * a square block whose `width:100%` would collapse to a sliver in a flex row).
 *
 * `square` appends the `fis` class (the 1x1 SVG asset) and locks a 1:1 ratio for
 * the genuinely-square strip blocks (the SVO lower-third). `contain`
 * renders the flag at its native 3:2 ratio, sized off its height and uncropped —
 * for the AthleteCard foot strip, where a `cover` flex block over-cropped the
 * sprite into a broken sliver. Renders nothing for an unknown
 * code so the card stays clean rather than printing the raw code.
 */
export const FlagBlock = ({
  code,
  sx,
  testId,
  square = false,
  contain = false,
}: {
  code: string;
  sx?: object;
  testId?: string;
  square?: boolean;
  contain?: boolean;
}) => {
  const alpha2 = toAlpha2(code);
  if (!alpha2) return null;
  return (
    <Box
      data-testid={testId}
      role="img"
      aria-label={code}
      className={`fi fi-${alpha2}${square ? ' fis' : ''}`}
      sx={{
        '&&': {
          width: contain ? 'auto' : '100%',
          height: '100%',
          lineHeight: 0,
          backgroundPosition: 'center',
          backgroundSize: contain ? 'contain' : 'cover',
          ...(square && { aspectRatio: '1 / 1' }),
          ...(contain && { aspectRatio: '3 / 2' }),
          ...sx,
        },
      }}
    />
  );
};

/**
 * The one-or-two-nation flag row shared by every surface — the single fold of the
 * two flag renderings (ADR 0034 §7, COMPONENT_LAYER FlagRow). It resolves the
 * athlete's primary plus optional second nationality (`country2`) off `toAlpha2`
 * and abuts them in a row; each unknown code drops out (so a stray `country2`
 * leaves no gap).
 *
 * - **`block`** (default) — the overlay CSS-background `FlagBlock`s (RankingsOverlay
 *   full-height strip, AthleteCard foot, name strips). `square`/`contain`
 *   forward to both blocks; the wrapping `Stack` (`sx`) and each block's shape
 *   (`itemSx`) stay the caller's per-art knobs. `itemTestId` tags each block (the
 *   SVO lower-third asserts one flag per nationality).
 * - **`inline`** — the MUI height-sized `CountryFlag`s of the bracket name-plate
 *   dual-nation row, spaced and centred in-line rather than stretched to fill.
 */
export const FlagRow = ({
  athlete,
  variant = 'block',
  height = 16,
  sx,
  itemSx,
  testId,
  itemTestId,
  square = false,
  contain = false,
}: {
  athlete: Pick<Athlete, 'country' | 'country2'>;
  variant?: 'block' | 'inline';
  /** `inline` flag height — a px number, or a CSS length string (e.g. `clamp(...)`)
   *  so the flag can scale responsively with the overlay (the bracket plates). */
  height?: number | string;
  sx?: object;
  itemSx?: object;
  testId?: string;
  itemTestId?: string;
  square?: boolean;
  contain?: boolean;
}) => {
  const codes = [athlete.country, athlete.country2].filter((c): c is string => Boolean(c));
  if (variant === 'inline') {
    return (
      <Stack
        data-testid={testId}
        direction="row"
        spacing={0.5}
        sx={{ alignItems: 'center', ...sx }}
      >
        {codes.map((code, i) => (
          <CountryFlag key={i} code={code} height={height} />
        ))}
      </Stack>
    );
  }
  return (
    <Stack
      data-testid={testId}
      direction="row"
      spacing={0}
      sx={{ alignItems: 'stretch', justifyContent: 'center', ...sx }}
    >
      {codes.map((code, i) => (
        <FlagBlock
          key={i}
          code={code}
          sx={itemSx}
          testId={itemTestId}
          square={square}
          contain={contain}
        />
      ))}
    </Stack>
  );
};
