import { type BoxProps } from '@mui/material';

import { Numeral } from 'app/components/Numeral';
import { colors } from 'app/theme/tokens';
import { Plate } from 'app/pages/Stream/Plate';
import { resultInk } from 'app/util/resultLabel';

/**
 * One result value box of the LAAX tables — the VS stat rows (`VsStatsTable`)
 * and the freestyle score card (`ScoreCardOverlay`) — so the two surfaces can't
 * drift.
 *
 * A `component` cell follows the two-tier rule (design-system §3) on its OWN
 * fill state: holding a value it is a filled plate (opaque white, near-black
 * numerals, no footage shadow); empty, it keeps the art's translucent
 * white-stroked box. White digits on 35% white read pale over bright footage.
 *
 * `penalty` and `total` sit on a saturated ground (stop red / near-black) that
 * carries white numerals, so they never switch tiers. The penalty box is solid
 * where the art washes it at ~28% (design-system §7 "Deliberate deviations").
 * Layout — width, height, gaps — stays with the caller.
 */
export type ScoreCellKind = 'component' | 'penalty' | 'total';

export const ScoreCell = ({
  value,
  kind,
  strokeWidth,
  fontSize,
  sx,
  ...boxProps
}: {
  /** The displayed value, or `null` for a slot with no result yet. */
  value: string | null;
  kind: ScoreCellKind;
  strokeWidth: string;
  fontSize: string;
} & BoxProps) => {
  const filled = kind === 'component' && value !== null;
  return (
    <Plate
      fill={
        kind === 'penalty'
          ? colors.race.stop
          : kind === 'total'
            ? colors.overlay.nameInk
            : filled
              ? colors.overlay.plateFilled
              : colors.overlay.plateName
      }
      // Only the art's component boxes are stroked; the penalty and TOTAL boxes
      // are frameless solids. A filled component keeps its stroke (invisible on
      // white, but the box stays on the grid when the tier flips).
      bordered={kind === 'component'}
      strokeWidth={strokeWidth}
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...(filled ? { color: colors.overlay.nameInk, textShadow: 'none' } : {}),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...boxProps}
    >
      {value !== null && (
        <Numeral
          fontWeight={700}
          fontSize={fontSize}
          color={filled ? resultInk(value, colors.overlay.nameInk) : undefined}
        >
          {value}
        </Numeral>
      )}
    </Plate>
  );
};
