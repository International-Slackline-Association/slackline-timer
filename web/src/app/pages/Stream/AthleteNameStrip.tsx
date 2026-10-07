import { Box } from '@mui/material';

import { Numeral } from 'app/components/Numeral';
import { AthleteName } from 'app/pages/Stream/AthleteName';
import { FlagRow } from 'app/pages/Stream/FlagBlock';
import { Plate } from 'app/pages/Stream/Plate';
import { useFitToWidth } from 'app/pages/Stream/useFitToBox';
import { type Athlete } from 'app/types';
import { colors, OVERLAY_NAME_STRIP } from 'app/theme/tokens';
import { refVw } from 'app/util/overlayScale';

// The masters set the name caps at ~0.63 of the strip height (they do NOT fill
// the plate); sized off the display face's ~0.72em cap height, the whole em box
// lands under the strip height, so overflow:hidden clips only horizontally.
const CAP_HEIGHT_RATIO = 0.72;
const NAME_SIZE_FACTOR = 0.63 / CAP_HEIGHT_RATIO;

/**
 * The LAAX single-athlete **name lower-third** (measured off the client's
 * `Names_*.png` / name-strip masters, not part of this repo; see design-system
 * §7 "Athlete card & name strip"): flag(s) at the left, then the `AthleteName`
 * split, on a filled plate. Used as the timer lower-thirds' lane banner
 * (`TimerLaneBlock`) and in the admin `AthleteForm` broadcast preview.
 *
 * The flag is the flag-icons inline treatment (`FlagRow variant="inline"`), not
 * `WideFlag`: the card-foot art distorts in this taller, narrower block.
 */
export const AthleteNameStrip = ({
  athlete,
  result,
  height = `${OVERLAY_NAME_STRIP.height}px`,
  width = OVERLAY_NAME_STRIP.width,
}: {
  athlete: Athlete;
  result?: string;
  /** Strip height as a CSS length; fonts + flag + insets all derive from it.
   * The default is the native px the admin broadcast preview draws; the timer
   * lower-thirds pass a frame-relative `refVh`. */
  height?: string;
  /** Fixed strip width, or `'fit'` to hug the content up to a shrink-to-fit
   * ceiling. A number is px. */
  width?: number | 'fit' | string;
}) => {
  const { slotRef, nameRef, fit } = useFitToWidth();
  // Every metric is a fraction of the strip height, whatever unit it came in.
  const scaled = (factor: number): string => `calc(${height} * ${factor})`;
  const nameFontSize = scaled(NAME_SIZE_FACTOR);
  // Name:result size ratio ~0.7, so the numeral scales with the name.
  const resultFontSize = scaled(NAME_SIZE_FACTOR * 0.7);
  // The ref's 16.5px inset on the 92-tall strip. A length, not %, so a
  // fit-content strip doesn't resolve it against its containing block.
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
        height,
        overflow: 'hidden',
        // Flag sits flush to the left edge (ref); the name follows after the
        // inset gap, with a matching inset kept on the right.
        pr: inset,
        gap: inset,
      }}
    >
      <FlagRow
        athlete={athlete}
        variant="inline"
        height={height}
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
          <AthleteName athlete={athlete} fontSize={nameFontSize} />
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
