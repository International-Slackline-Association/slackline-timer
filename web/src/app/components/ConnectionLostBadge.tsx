import { CornerBadge, useChromaSuppressed } from 'app/components/CornerBadge';
import type { LinkPhase } from 'app/hooks/useLinkPhase';
import { useReconnectedFlash } from 'app/hooks/useReconnectedFlash';

/** The alarm half of the corner's phase split — see `ConnectingBadge` for the
 * other half; between them the five phases are covered exactly once. */
const LOST_LABEL: Record<LinkPhase, string | null> = {
  open: null,
  connecting: null,
  reconnecting: null,
  unreachable: 'No signal — retrying',
  lost: 'Signal lost — reconnecting',
};

/**
 * The alarm half of the display surfaces' corner link cue (previews and
 * `/stream/*` overlays), over the phase the surface graded once
 * (`useLinkPhase`). Reconnects are unbounded (ADR 0024), so neither reading is a
 * give-up notice — they mark the on-screen data as stale until the socket
 * recovers, then flash a brief green cue on the self-heal so a
 * projector-watching operator doesn't miss the recovery moment (the badge would
 * otherwise vanish silently).
 *
 * The two alarms are different reports, and the operator's next move differs
 * with them: a link that never arrived (`unreachable`) has lost nothing and is
 * as likely to be this source's own token / compId / URL as an outage, so it
 * sends the operator to the link; a link that dropped (`lost`) was live a
 * moment ago, and waiting is the right move. Only the second one can be
 * "reconnected", so only it arms the flash — the first would otherwise greet a
 * slow first handshake with a recovery it never made.
 *
 * Two guards keep it broadcast-safe:
 * - the phase's grace period (`useStaleAfterGrace` inside `useLinkPhase`), so
 *   the routine token-refresh / keepalive reconnect blip never flashes it on
 *   air (that window belongs to `ConnectingBadge`, which the /stream/* layout
 *   deliberately does not mount);
 * - it never paints over a chroma-keyed ground (`?bg=key` or a chroma
 *   `defaultBg`) — the keyer would pass it through onto the venue screen /
 *   broadcast. On keyed rigs the state stays observable off-air via the
 *   operator surfaces (control header, `/admin/overlays`).
 */
export const ConnectionLostBadge = ({
  link,
  defaultBg = 'transparent',
}: {
  /** The surface's graded relay link (`useLinkPhase`, one grader per socket). */
  link: LinkPhase;
  /** The surface's `?bg=` fallback — chroma on projector variants. */
  defaultBg?: string;
}) => {
  const reconnected = useReconnectedFlash(link === 'lost');
  const suppressed = useChromaSuppressed(defaultBg);
  const label = LOST_LABEL[link];

  if (suppressed) {
    return null;
  }

  if (label) {
    return <CornerBadge corner="right" tone="error" label={label} testId="connection-lost" />;
  }

  if (reconnected) {
    return (
      <CornerBadge
        corner="right"
        tone="success"
        label="Reconnected"
        testId="connection-reconnected"
      />
    );
  }

  return null;
};
