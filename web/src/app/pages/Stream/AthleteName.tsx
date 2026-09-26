import { Box, Typography } from '@mui/material';

import { type Athlete } from 'app/types';
import { colors, fonts } from 'app/theme/tokens';

/**
 * The LAAX name split — given name **bold** abutting family name **light**, both
 * in the one `fonts.display` condensed-caps family (ADR 0016). The single home of
 * the 700/300 first/last treatment: the SVO name lower-third and bracket `name`
 * plates (`sizing="fixed"`) and the stacked photo cards (`sizing="cqh"`) all
 * render through it, so the weight split lives in exactly one place.
 *
 * `accent` optionally recolours only the bold given name (e.g. `race.go` for a
 * bracket winner) so the two-weight contrast survives the recolour; the family
 * name always stays on the base ink.
 *
 * - **`fixed`** (default) — an inline `Box` strip; the caller drives flow and font
 *   size via `sx` (a horizontal name row whose size is set by its container).
 *   `noWrap` keeps a long family name on one line.
 * - **`cqh`** — the two names STACKED and centred, sized in container-query
 *   height at the card masters' cap ratio so one split serves every card box size.
 *
 * Both modes paint dark ink on an opaque white plate, so both cancel the
 * StreamLayout footage drop-shadow — it would read as a dark double-image
 * instead of flat plate text.
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
            // (= `fonts.body`) onto every Typography root, and that declaration
            // beats an ancestor's `fontFamily`. Omitting it here silently
            // rendered the LAAX name in Saira — and dragged the 300 below with
            // it, which Saira doesn't load, flattening the weight split too.
            fontFamily: fonts.display,
            // 700, not 800: Oswald's heaviest bundled face is 700, so an 800
            // request just resolves back to it (see `fonts.display`).
            fontWeight: 700,
            letterSpacing: '0.01em',
            // ≥1 so an uppercase diacritic (É/Ø/Ñ) sits inside the line box and
            // isn't shaved off by the card's overflow:hidden band on the smallest
            // profile card (overlay-typography-polish); the 700/300 weight split,
            // not leading, still reads as the given/family cue.
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
              letterSpacing: '0.01em',
              // Family : given = 1 : 1.25 (34 : 27.2cqh) — the card masters'
              // 35.62 : 44.6 cap ratio, keeping the 700/300 weight as the
              // given/family cue (ADR 0016). ≥1 leaves headroom for uppercase
              // accents (see the given line).
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
        letterSpacing: '0.01em',
        lineHeight: 0.95,
        whiteSpace: 'nowrap',
        // Dark ink on a white plate everywhere this is used (bracket name plates,
        // SVO strip): cancel the footage drop-shadow — see the JSDoc's plate rule.
        textShadow: 'none',
        ...sx,
      }}
    >
      {/* Inherit the wrapper's fontSize + display face; a default Typography is
          body1 (16px in the body font), which would shrink the name to a sliver
          in the wrong face (the name-strip "tiny name" bug). Longhands, NOT the
          `font: inherit` shorthand — that also resets the 700/300 weight split. */}
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
