import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import type { ReactNode } from 'react';

import { AthleteNameStrip } from 'app/pages/Stream/AthleteNameStrip';
import { OVERLAY_LANE } from 'app/theme/tokens';
import { type Athlete } from 'app/types';
import { refVh, refVw } from 'app/util/overlayScale';

/** A lane column's outer edge: a bottom corner, or `center` (Freestyle quali). */
export type LaneSide = 'left' | 'right' | 'center';

/** Flex alignment that pushes a lane's content to its outer edge. */
export const laneEdge = (side: LaneSide) =>
  side === 'left' ? 'flex-start' : side === 'right' ? 'flex-end' : 'center';

/** The white time plate both clocks draw (`OVERLAY_LANE.clockPlate`), frame-relative. */
export const CLOCK_PLATE_WIDTH = refVw(OVERLAY_LANE.clockPlate);

/** The plate's inner padding either side of the digits, so a lane-justified
 *  time sits the same distance off its outer edge on both lanes. */
export const CLOCK_PLATE_PX = refVw(OVERLAY_LANE.clockPlatePad);

/** The bottom-corner inset, frame-relative; the SVO cards composited over it
 *  derive their margin from the same `OVERLAY_LANE.inset` (`SVO_SIDE_MARGIN`). */
export const CORNER_INSET_X = refVw(OVERLAY_LANE.inset);
export const CORNER_INSET_Y = refVh(OVERLAY_LANE.inset);

/** The lane banner height, frame-relative — also the warm-up label's (WarmupBand). */
export const LANE_NAME_STRIP_HEIGHT = refVh(OVERLAY_LANE.nameStripHeight);

/**
 * One lane's lower-third column: an optional `header` row, the flag+name banner
 * (AthleteNameStrip, rendered once an athlete is assigned) and the clock passed
 * as `children`, stacked with the shared gap and aligned to the lane's outer
 * edge. Shared by both timer overlays — Speedline passes a Stopwatch (or its
 * false-start badge) as children, Freestyle a Countdown (and its BEST TRICK
 * label as `header`). Positioning and bottom-baseline anchoring stay with the
 * caller via `sx`; this component is purely the stacked column.
 */
export const TimerLaneBlock = ({
  side,
  athlete,
  header,
  children,
  sx,
  testId,
}: {
  side: LaneSide;
  /** When set, the flag+name banner renders above the clock. */
  athlete?: Athlete;
  /** Optional row above the name strip (Freestyle's BEST TRICK label). */
  header?: ReactNode;
  /** The clock — or, on Speedline, the false-start badge — below the banner. */
  children: ReactNode;
  /** Caller-owned positioning (absolute corner, flex-band member, …). */
  sx?: SxProps<Theme>;
  testId?: string;
}) => (
  <Box
    data-testid={testId}
    sx={[
      {
        display: 'flex',
        flexDirection: 'column',
        alignItems: laneEdge(side),
        gap: refVh(OVERLAY_LANE.gap),
      },
      ...(Array.isArray(sx) ? sx : [sx]),
    ]}
  >
    {header}
    {athlete && <AthleteNameStrip athlete={athlete} height={LANE_NAME_STRIP_HEIGHT} width="fit" />}
    {children}
  </Box>
);
