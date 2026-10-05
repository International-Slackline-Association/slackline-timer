import { Typography } from '@mui/material';

import { liveCaption } from 'app/theme/tokens';
import { lockReason, type Lock } from 'app/util/lockReason';

/**
 * The why-line's slot is **two** lines deep (FREESTYLE_BOARD_UX §4.12). The
 * longest reasons — `locked during best trick — Leave best trick first`,
 * `locked while Athlete n holds time — Reset Athlete n first` — wrap at the
 * 1280 px desk's lane column, and a one-line slot let them push End turn and
 * Reset down ~19 px the instant a lock appeared. Sized in `em` so it tracks the
 * row's own font size; `WhyLine.test.tsx` holds every string `lockReason` can
 * return against it.
 */
export const WHY_RESERVED_LINES = 2;
const WHY_LEADING = 1.4;

const WHY_SX = { ...liveCaption, lineHeight: WHY_LEADING, color: 'text.secondary' } as const;
const RESERVED_SX = { ...WHY_SX, minHeight: `${WHY_RESERVED_LINES * WHY_LEADING}em` } as const;

/** Holds the reserved row's height with nothing in it. */
const NBSP = ' ';

/**
 * The reserved why-line under a locked control (§4.7): the reason it cannot
 * act, on the surface rather than only in a Tooltip a gloved hand never hovers.
 * By default rendered at its full reserved depth whether or not there is a
 * lock, so nothing below it moves as one comes and goes.
 *
 * Two ways in: a control with its own interlock entry passes its `Lock`, while
 * the setup rail and the Speedline board pass the reason their own map already
 * rendered — one string for both, so a hover and the line under it cannot
 * disagree. Shared by both desks: the second board's locks are the same
 * promise in the same slot (§7's P3 sibling note).
 *
 * `reserve={false}` drops the slot: the line renders only while there is a
 * reason. The reservation protects controls in the SAME column as the press
 * that locks them (End turn / Reset under a lane's lock). The Speedline rail's
 * Swap and Void lock on Start and unlock on the last Stop/DNF — presses made on
 * a lane column or a handset — so nothing moves under a hand on the rail, and
 * the rail pays for the line only while it has one to print.
 */
export const WhyLine = ({
  reserve = true,
  ...props
}: ({ lock: Lock | null } | { reason: string | null }) & { reserve?: boolean }) => {
  const reason = 'lock' in props ? props.lock && lockReason(props.lock) : props.reason;
  if (reason === null && !reserve) return null;
  return (
    <Typography sx={reserve ? RESERVED_SX : WHY_SX} data-testid="why-line">
      {reason === null ? NBSP : `why: ${reason}`}
    </Typography>
  );
};
