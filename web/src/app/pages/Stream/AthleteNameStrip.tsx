import { Box } from '@mui/material';

import { Numeral } from 'app/components/Numeral';
import { AthleteName } from 'app/pages/Stream/AthleteName';
import { FlagRow } from 'app/pages/Stream/FlagBlock';
import { Plate } from 'app/pages/Stream/Plate';
import { useFitToWidth } from 'app/pages/Stream/useFitToBox';
import { type Athlete } from 'app/types';
import { colors } from 'app/theme/tokens';
import { refVw } from 'app/util/overlayScale';

/**
 * The LAAX single-athlete **name lower-third** (measured off the `Names_*.png`
 * and name-strip masters — provenance labels for the client-delivered LAAX 2026
 * art, not files in this repo; the measurement record is
 * `doc/dev/design-system/design-system.md` §7 "Athlete card & name strip"):
 * a horizontal strip — the national flag(s) at the left, then
 * the name split bold-first / light-last (`AthleteName`). No photo. The SVO
 * overlays now render the full photo card (`Competitor`); this strip lives on in
 * the admin `AthleteForm` broadcast preview.
 *
 * Drawn as a filled overlay plate (`overlay.plateFilled` + `overlay.nameInk`) so
 * the caps stay legible over any footage. An optional `result` (best time /
 * judged overall) renders in the monospace face at the strip's right.
 */
export const STRIP_HEIGHT = 92;

// The flag uses the flag-icons **inline** treatment (`FlagRow variant="inline"`),
// the same renderer as the bracket name plates — NOT the wide card-foot art
// (`WideFlag`), which is drawn for the `AthleteCard` portrait foot and distorts
// when stretched into this taller, narrower block. Sized to the FULL strip height
// and flush to the left edge to match the delivered name-strip master; a
// `country2` dual-nationality athlete abuts a second flag.

// The display face's cap-height is ~0.72 of the em; the LAAX reference composite
// sets the name caps at ~0.63 of the strip
// height, centred with margin — the caps do NOT fill the plate. Size the font off
// that cap-height target so the whole em box lands under the strip height: a
// single centred line then sits fully inside the plate and the strip's
// overflow:hidden clips only horizontally (long family names), never shearing the
// caps off the frame bottom the way the old 1.25× em overshoot did.
const CAP_HEIGHT_RATIO = 0.72;
const NAME_SIZE_FACTOR = 0.63 / CAP_HEIGHT_RATIO;

export const AthleteNameStrip = ({
  athlete,
  result,
  height = STRIP_HEIGHT,
  width = 720,
}: {
  athlete: Athlete;
  result?: string;
  /** Strip height; fonts + flag + insets all derive from it. A number is px
   * (default = the 92px LAAX ref, as the admin broadcast preview draws it); a
   * CSS length lets the caller pick the unit — the timer lower-thirds pass a
   * frame-relative `refVh` so the banner scales with the capture. */
  height?: number | string;
  /** Fixed strip width, or `'fit'` to hug the content (the timertimer
   * scoreboard treatment) up to a shrink-to-fit ceiling. Same unit rule as
   * `height`. */
  width?: number | 'fit' | string;
}) => {
  const { slotRef, nameRef, fit } = useFitToWidth();
  // Every metric below is a fraction of the strip height, so one number drives
  // the whole strip whatever unit the caller authored it in (the `calc` house
  // pattern — Countdown's name tier does the same off its size token).
  const strip = typeof height === 'number' ? `${height}px` : height;
  const scaled = (factor: number): string => `calc(${strip} * ${factor})`;
  const nameFontSize = scaled(NAME_SIZE_FACTOR);
  // Keep the g2 name:result size ratio (~0.7) so the numeral scales with the name.
  const resultFontSize = scaled(NAME_SIZE_FACTOR * 0.7);
  // The ref's ~2.3%-of-canvas inset (16.5px on the 720 strip), scaled off the
  // height so a compact strip keeps the proportion. A length, not %, so a
  // fit-content strip doesn't resolve the inset against its containing block.
  const inset = scaled(0.18);
  return (
    <Plate
      bordered={false}
      fill={colors.overlay.plateFilled}
      sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        // The `fit` ceiling is an on-air metric (only the timer lower-thirds hug
        // their content), so it rides the capture frame like the rest of the set.
        ...(width === 'fit' ? { width: 'fit-content', maxWidth: refVw(640) } : { width }),
        height: strip,
        overflow: 'hidden',
        // Flag sits flush to the left edge (ref); the name follows after the
        // inset gap, with a matching inset kept on the right.
        pr: inset,
        gap: inset,
      }}
    >
      {/* National flag(s) at the left — the flag-icons inline treatment shared with
          the bracket name plates (`FlagRow variant="inline"`); a `country2`
          dual-nationality athlete abuts a second flag. */}
      <FlagRow
        athlete={athlete}
        variant="inline"
        height={strip}
        testId="name-strip-flag-block"
        sx={{ flexShrink: 0 }}
      />

      {/* Name slot: the flex:1 measured box clips the overflow; the inner box is
          scaled down by `fit` (transform-origin left) so a long name shrinks to
          fit rather than clipping at the strip edge. */}
      <Box
        ref={slotRef}
        sx={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center' }}
      >
        <Box
          ref={nameRef}
          data-testid="name-strip-fit"
          sx={{
            flexShrink: 0,
            whiteSpace: 'nowrap',
            transform: `scale(${fit})`,
            transformOrigin: 'left center',
          }}
        >
          <AthleteName
            athlete={athlete}
            sx={{
              color: colors.overlay.nameInk,
              fontSize: nameFontSize,
              // Em box (not a taller line box) drives placement, so the fitted caps
              // centre inside the plate via the row's alignItems:center.
              lineHeight: 1,
            }}
          />
        </Box>
      </Box>
      {result !== undefined && (
        // Flat on the white strip — no inherited footage shadow.
        <Box sx={{ ml: '0.5em', flexShrink: 0 }}>
          <Numeral
            fontWeight={700}
            fontSize={resultFontSize}
            color={colors.overlay.nameInk}
            textShadow="none"
          >
            {result}
          </Numeral>
        </Box>
      )}
    </Plate>
  );
};
