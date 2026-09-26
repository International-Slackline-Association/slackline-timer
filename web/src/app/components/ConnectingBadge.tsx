import { CornerBadge, useChromaSuppressed } from 'app/components/CornerBadge';
import type { LinkPhase } from 'app/hooks/useLinkPhase';

/**
 * Which phases this half of the corner owns; `null` hands the corner to
 * `ConnectionLostBadge`, so the two records together cover the phase exactly
 * once and a sixth phase cannot ship without answering for the corner.
 */
const CONNECTING_LABEL: Record<LinkPhase, string | null> = {
  open: null,
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  unreachable: null,
  lost: null,
};

/**
 * The in-progress half of the display surfaces' corner link cue, so a broadcast
 * or projector surface is never a silent blank frame while its WS is still
 * reaching the relay. It occupies the window BEFORE `ConnectionLostBadge` takes
 * over: the two share one graded phase (the surface calls `useLinkPhase` once)
 * and partition it between them, so the corner they both sit in never carries
 * two plates and never goes quiet on a link that is down.
 *
 * A handshake and a drop are different reports (`useHasEverOpened`): the first
 * has lost nothing — every projector reload and every OBS source refresh lands
 * on it — the second has taken the preview off the air for however long it
 * lasts. Reading them as one is what an operator would report as the badge
 * saying `Connecting` over a screen that had been live all evening.
 *
 * Like `ConnectionLostBadge` it never paints over a chroma-keyed ground — the
 * keyer would pass the plate through onto air — so it is a cue for the
 * transparent broadcast/preview variant only. The amber (not red) dot marks a
 * link still in progress, distinct from the badge's failure signal.
 */
export const ConnectingBadge = ({
  link,
  defaultBg = 'transparent',
}: {
  /** The surface's graded relay link (`useLinkPhase`, one grader per socket). */
  link: LinkPhase;
  /** The surface's `?bg=` fallback — chroma on projector variants. */
  defaultBg?: string;
}) => {
  const suppressed = useChromaSuppressed(defaultBg);
  const label = CONNECTING_LABEL[link];

  if (suppressed || !label) {
    return null;
  }

  return <CornerBadge corner="right" tone="warning" label={label} testId="connecting" />;
};
