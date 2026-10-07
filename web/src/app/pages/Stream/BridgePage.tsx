import { useEffect, useRef } from 'react';

import { Box, Chip, Container, Stack, Typography } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { ReadyState } from 'react-use-websocket';

import { useReadToken } from 'app/hooks/useReadToken';
import { useStaleAfterGrace } from 'app/hooks/useStaleAfterGrace';
import { useLiveSideAthlete } from 'app/pages/Stream/useLiveSideAthlete';
import { useStreamRefresh } from 'app/pages/Stream/useStreamRefresh';
import {
  H2R_VARIABLE_MAP,
  buildH2rPosts,
  type BridgeSide,
  type BridgeSides,
} from 'app/util/h2rBridge';
import { createH2rPusher, resolveH2rTarget, type H2rPusher } from 'app/util/h2rClient';

const DEFAULT_TARGET = 'http://127.0.0.1:4001';

/**
 * `/stream/bridge?compId=&token=&h2r=` — the H2R Graphics bridge. Not an OBS
 * browser source: a tab the operator keeps open on the machine running H2R. It
 * follows the board's relay-only `updateSelection` (ADR 0014), resolves each side
 * through `useLiveSideAthlete` (the SVO-B join), and POSTs name/country/result +
 * portrait into H2R's local API (`:4001` by default; `?h2r=` takes another
 * loopback origin, see `resolveH2rTarget`). H2R is push-only — see
 * doc/dev/broadcast-overlays.md "External graphics tools".
 *
 * It paints a visible status panel (not the overlays' fail-safe blank): the
 * operator needs to confirm the bridge is connected and pushing.
 */
export const BridgePage = () => {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const compId = params.get('compId');
  const target = resolveH2rTarget(params.get('h2r') || DEFAULT_TARGET);
  const readToken = useReadToken();

  if ('error' in target) {
    return (
      <BridgeShell>
        <Typography color="error">{target.error}</Typography>
      </BridgeShell>
    );
  }
  if (!compId) {
    return (
      <BridgeShell target={target.origin}>
        <Typography color="error">Missing compId in the bridge URL.</Typography>
      </BridgeShell>
    );
  }
  return <BridgeBody compId={compId} readToken={readToken} target={target.origin} />;
};

const BridgeBody = ({
  compId,
  readToken,
  target,
}: {
  compId: string;
  readToken?: string;
  target: string;
}) => {
  const { selection, readyState } = useStreamRefresh(compId, readToken);
  const side1 = useLiveSideAthlete(compId, 1, selection, { readToken });
  const side2 = useLiveSideAthlete(compId, 2, selection, { readToken });

  const resolved = (s: typeof side1): BridgeSide | null =>
    s.athlete ? { athlete: s.athlete, result: s.result ?? '' } : null;
  const sides: BridgeSides = { 1: resolved(side1), 2: resolved(side2) };

  // The dependency key is the pushed content, so a same-selection re-render is a
  // no-op but a cleared lane, a new result or a discipline switch re-pushes.
  const key = JSON.stringify([
    sides[1]?.athlete.athleteId,
    sides[1]?.result,
    sides[2]?.athlete.athleteId,
    sides[2]?.result,
    selection?.discipline ?? null,
  ]);
  // Created in an effect rather than a memo: StrictMode's mount/cleanup/mount
  // would otherwise leave the memoised pusher disposed.
  const pusher = useRef<H2rPusher | null>(null);
  useEffect(() => {
    const p = createH2rPusher(target);
    pusher.current = p;
    return () => p.dispose();
  }, [target]);
  useEffect(() => {
    pusher.current?.push(buildH2rPosts(sides, H2R_VARIABLE_MAP, selection?.discipline));
    // `sides` is rebuilt each render; `key` captures its pushable content.
  }, [key, target]);

  return (
    <BridgeShell target={target} status={<RelayStatusChip readyState={readyState} />}>
      <Stack spacing={1.5}>
        <SideRow n={1} side={sides[1]} />
        <SideRow n={2} side={sides[2]} />
      </Stack>
    </BridgeShell>
  );
};

/**
 * Relay-link indicator for the bridge panel. Reuses `ConnectionLostBadge`'s
 * grace-delayed staleness (`useStaleAfterGrace`) so a routine keepalive / token-
 * refresh reconnect blip doesn't flap it. Rendered as an inline panel chip
 * (not the fixed corner badge): the bridge is an operator tab, never a
 * chroma-keyed capture, so the badge's chroma-suppression guard doesn't apply.
 */
const RelayStatusChip = ({ readyState }: { readyState: ReadyState }) => {
  const stale = useStaleAfterGrace(readyState);
  return stale ? (
    <Chip label="RECONNECTING" color="warning" size="small" />
  ) : (
    <Chip label="CONNECTED" color="success" size="small" />
  );
};

const SideRow = ({ n, side }: { n: 1 | 2; side: BridgeSide | null }) => (
  <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
    <Chip label={`SIDE ${n}`} size="small" />
    {side ? (
      <Typography>
        {side.athlete.name} · {side.athlete.country}
        {side.result ? ` · ${side.result}` : ''}
      </Typography>
    ) : (
      <Typography color="text.secondary">— empty —</Typography>
    )}
  </Stack>
);

const BridgeShell = ({
  target,
  status,
  children,
}: {
  target?: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <Container maxWidth="sm" sx={{ py: 4 }}>
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
      <Typography variant="h5">H2R Graphics bridge</Typography>
      {status}
    </Stack>
    {target && (
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Keep this tab open next to H2R. It pushes the control board&apos;s live selection to{' '}
        <Box component="code" sx={{ fontFamily: 'monospace' }}>
          {target}
        </Box>
        .
      </Typography>
    )}
    {children}
  </Container>
);
