import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import type { ReactNode } from 'react';

import { AthleteNameStrip } from 'app/pages/Stream/AthleteNameStrip';
import { type Athlete } from 'app/types';
import { refVh, refVw } from 'app/util/overlayScale';

/**
 * Shared geometry for the broadcast/preview timer lower-thirds, so the two mode
 * overlays (SpeedlineTimerDisplay + FreestyleTimerDisplay) cannot drift apart:
 *  - `inset` — the side + bottom safe inset of the lane blocks;
 *  - `gap` — the vertical gap between the name strip and the clock;
 *  - `nameStripHeight` — the compact banner height these timers use (the
 *    AthleteNameStrip default 92px is the full LAAX name lower-third).
 * Reference px on the 1920×1080 capture frame, emitted through `refVw`/`refVh`
 * below — the numbers stay the art metrics, the emissions scale a 720p or 4K
 * browser source with them.
 * Each display still OWNS its own positioning (Speedline pins each lane
 * `position: absolute` in a corner; Freestyle lays a flex band that also drives
 * warm-up / quali / best-trick / a rankings panel) and its own clock component —
 * only this per-lane column and these numbers are shared.
 */
export const OVERLAY_LANE = { inset: 112, gap: 16, nameStripHeight: 56 } as const;

/**
 * The bottom-corner inset, frame-relative. The ONE owner of that corner: the
 * SVO cards are composited over these lower-thirds, so `SvoOverlay` derives its
 * own side margin from `OVERLAY_LANE.inset` rather than carrying a second
 * number (see `SVO_SIDE_MARGIN`).
 */
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
  /** Outer-edge alignment: `left`/`right` corners, or `center` (Freestyle quali). */
  side: 'left' | 'right' | 'center';
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
        alignItems: side === 'left' ? 'flex-start' : side === 'right' ? 'flex-end' : 'center',
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
