import { type BoxProps } from '@mui/material';

import { Numeral } from 'app/components/Numeral';
import { colors } from 'app/theme/tokens';
import { Plate } from 'app/pages/Stream/Plate';

/**
 * One result value box of the LAAX tables — the VS stat rows
 * (`VsStatsTable`) and the freestyle score card (`ScoreCardOverlay`). The two
 * surfaces draw the same cells from the same arts, so the chrome lives here or
 * they drift (the card carried a 28%-alpha CONTROL PENALTY wash while the VS
 * table drew it solid).
 *
 * `kind` picks the art's cell language, and a `component` cell follows the
 * two-tier rule (design-system §3) on its OWN fill state: a cell holding a value
 * is a filled plate — opaque white with near-black numerals and no footage
 * shadow — while an empty slot keeps the art's translucent white-stroked box.
 * White digits on 35% white read pale over bright footage, exactly the wash-out
 * the ranking/bracket name plates were already fixed for.
 *
 * `penalty` and `total` are unconditional: the art gives them a saturated
 * ground (stop red / near-black) that already carries white numerals, so they
 * do not switch tiers. Layout — width, height, gaps — stays with the caller.
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
        <Numeral fontWeight={700} fontSize={fontSize}>
          {value}
        </Numeral>
      )}
    </Plate>
  );
};
