import { Tooltip } from '@mui/material';
import { cloneElement, type ReactElement } from 'react';

import { lockReason, type Lock } from 'app/util/lockReason';

/**
 * A race control and the reason it is inert (FREESTYLE_BOARD_UX §4.7). A
 * disabled MUI button fires no pointer events, so the hover target is a wrapper
 * span — rendered whether or not there is a lock, so nothing moves under the
 * operator's hand when one comes and goes. `describeChild` puts the words on
 * that span as the accessible *description*, leaving the button's own name
 * ("Start Athlete 1") to address it.
 *
 * The same words go onto the CONTROL as its own `title`, which is where they
 * have to be to reach a reader: the span is only the mouse's target, and a
 * description hung on it is never announced for the button the operator is
 * focused on. The control's name comes from its content, so `title` lands as
 * its description and nothing else. The reserved on-card why-line lands with
 * the lane card (`fsux-lane-card`).
 *
 * Two ways in, exactly as `WhyLine` takes them: a control with its own
 * interlock entry passes its `Lock`, while the Speedline board passes the
 * reason its own map already rendered — so the hover, the printed line and the
 * accessible description are one string on both desks.
 */
export const LockedControl = ({
  children,
  ...props
}: ({ lock: Lock | null } | { reason: string | null }) & {
  children: ReactElement<{ title?: string }>;
}) => {
  const reason = 'lock' in props ? props.lock && lockReason(props.lock) : props.reason;
  return (
    <Tooltip title={reason ?? ''} describeChild>
      <span>
        {/* The one thing a wrapper cannot do from outside its child: the words
            have to be ON the control to be announced for it, and every call
            site passing its own `title` beside the lock would be the second
            copy this component exists to prevent. */}
        {/* eslint-disable-next-line @eslint-react/no-clone-element */}
        {reason === null ? children : cloneElement(children, { title: reason })}
      </span>
    </Tooltip>
  );
};
