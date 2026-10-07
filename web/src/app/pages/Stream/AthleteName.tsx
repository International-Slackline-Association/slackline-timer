import { Box, Typography } from '@mui/material';

import { type Athlete } from 'app/types';
import { colors, fonts, overlayArt } from 'app/theme/tokens';

/**
 * The LAAX name split — given name **bold** (700) abutting family name **light**
 * (300) in `fonts.display` (ADR 0016); the one home of that treatment (name
 * strips, bracket/ranking/score-card plates, photo cards).
 *
 * `accent` recolours only the given name (e.g. a winner's `race.go`), so the
 * two-weight contrast survives; the family name stays on the base ink.
 *
 * - **`fixed`** (default) — an inline single-line span; the caller drives flow
 *   and font size via `sx`.
 * - **`cqh`** — the two names STACKED and centred, sized in container-query
 *   height at the card masters' cap ratio so one split serves every card box size.
 *
 * Both modes paint dark ink on an opaque white plate, so both cancel the
 * StreamLayout footage drop-shadow.
 */
export const AthleteName = ({
  athlete,
  accent,
  sizing = 'fixed',
  sx,
}: {
  athlete: Pick<Athlete, 'firstName' | 'lastName'>;
  accent?: string;
  sizing?: 'fixed' | 'cqh';
  /** `fixed`-mode escape hatch: the caller drives flow + font size. */
  sx?: object;
}) => {
  if (sizing === 'cqh') {
    return (
      <>
        <Typography
          noWrap
          sx={{
            width: '100%',
            textAlign: 'center',
            color: accent ?? colors.overlay.nameInk,
            textTransform: 'uppercase',
            // Declared, NOT inherited: MUI stamps `theme.typography.body1`
            // (= `fonts.body`) onto every Typography root, beating an ancestor's
            // `fontFamily` — the name falls back to Saira, which doesn't load the
            // 300 below either, flattening the weight split.
            fontFamily: fonts.display,
            // Oswald's heaviest bundled face is 700 (see `fonts.display`).
            fontWeight: 700,
            letterSpacing: overlayArt.nameTracking,
            // ≥1 so an uppercase diacritic (É/Ø/Ñ) isn't shaved off by the card's
            // overflow:hidden band on the smallest profile card.
            lineHeight: 1.1,
            fontSize: '34cqh',
            textShadow: 'none',
          }}
        >
          {athlete.firstName}
        </Typography>
        {athlete.lastName && (
          <Typography
            noWrap
            sx={{
              width: '100%',
              textAlign: 'center',
              color: colors.overlay.nameInk,
              textTransform: 'uppercase',
              fontFamily: fonts.display, // see the given line
              fontWeight: 300,
              letterSpacing: overlayArt.nameTracking,
              // Given : family = 34 : 27.2cqh = 1.25, the card masters' 44.6 :
              // 35.62 cap ratio. ≥1 for accents (see the given line).
              lineHeight: 1.1,
              fontSize: '27.2cqh',
              textShadow: 'none',
            }}
          >
            {athlete.lastName}
          </Typography>
        )}
      </>
    );
  }

  return (
    <Box
      component="span"
      sx={{
        fontFamily: fonts.display,
        textTransform: 'uppercase',
        letterSpacing: overlayArt.nameTracking,
        lineHeight: 0.95,
        whiteSpace: 'nowrap',
        textShadow: 'none',
        ...sx,
      }}
    >
      {/* Inherit the wrapper's size + face: a default Typography is body1 (16px
          in the body font). Longhands, NOT the `font: inherit` shorthand — that
          also resets the 700/300 weight split. */}
      <Typography
        component="span"
        sx={{ fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 700, color: accent }}
      >
        {athlete.firstName}
      </Typography>
      {athlete.lastName && (
        <Typography
          component="span"
          sx={{ fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 300, ml: '0.25em' }}
        >
          {athlete.lastName}
        </Typography>
      )}
    </Box>
  );
};
