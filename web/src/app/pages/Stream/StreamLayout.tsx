import { ReactNode, createContext, useContext, useEffect, useState } from 'react';

import { Box } from '@mui/material';
import { useLocation } from 'react-router-dom';

import { ConnectionLostBadge } from 'app/components/ConnectionLostBadge';
import { useLinkPhase } from 'app/hooks/useLinkPhase';
import { useReadToken } from 'app/hooks/useReadToken';
import { type LiveSelection } from 'app/hooks/useWebSocket';
import { isDiscipline, type Discipline } from 'app/types';
import { overlayTextShadow } from 'app/theme/tokens';
import { useStreamRefresh } from 'app/pages/Stream/useStreamRefresh';
import { refVh, refVw } from 'app/util/overlayScale';
import { applyOverlayBodyStyle, SURFACE_GROUND } from 'app/pages/Stream/overlayBg';
import { type StreamStatus } from 'app/pages/Stream/streamStatus';

/**
 * Title-safe inset: 5% of the capture frame on every edge (design-system §7
 * rule 5), frame-relative. The vertical half is exported for the 16:9 bracket
 * canvas, which sizes against the CONTENT box; the horizontal reference px for
 * the SVO cards, which land on a corner this layout does NOT own
 * (`SVO_SIDE_MARGIN`).
 */
export const STREAM_INSET_X_PX = 96;
const STREAM_INSET_X = refVw(STREAM_INSET_X_PX);
export const STREAM_INSET_Y = refVh(54);

/** The render-prop context every `/stream/*` overlay body receives. */
export interface StreamCtx {
  compId: string;
  readToken?: string;
  discipline: Discipline;
  /** The control board's live selection, or null until it pushes one. */
  selection: LiveSelection | null;
}

export { type StreamStatus } from 'app/pages/Stream/streamStatus';

const StreamStatusContext = createContext<((status: StreamStatus) => void) | null>(null);

/**
 * Report an overlay's lifecycle to the surrounding `StreamLayout`. Call from a
 * body component to fail safe: pass `loading` while a query is in flight,
 * `error` if it failed, `empty` if it resolved with no rows, and `ready` once
 * there is content to show. The layout swallows everything but `ready` visually
 * yet keeps the state observable off-air.
 */
export const useReportStreamStatus = (status: StreamStatus): void => {
  const report = useContext(StreamStatusContext);
  useEffect(() => {
    report?.(status);
  }, [report, status]);
};

/**
 * Shared shell for the HTTP-driven `/stream/*` overlays: `compId` + read token
 * from the URL, live `db_update` refresh, the `?bg=` ground (see
 * doc/dev/broadcast-overlays.md), and white text under the `overlayTextShadow`
 * halo (filled plates cancel it with `textShadow: 'none'`).
 *
 * On-air it is **fail-safe**: a loading, empty, errored or misconfigured
 * overlay paints nothing — no spinner, no broken affordance. The state is
 * exposed off-air only: `data-stream-status` on the root plus a visually-hidden
 * status line, for operators inspecting the source and the `/admin/overlays`
 * status panel.
 */
export const StreamLayout = ({
  align = 'flex-end',
  children,
}: {
  /** Vertical placement of the overlay content (lower-third by default). */
  align?: 'flex-start' | 'center' | 'flex-end';
  children: (ctx: StreamCtx) => ReactNode;
}) => {
  const { search } = useLocation();
  const readToken = useReadToken();
  const compId = useStreamCompId();
  const discipline = useStreamDiscipline();
  // A missing compId is a misconfigured URL: nothing can ever load, so the
  // overlay starts in `error`. A valid URL starts `loading` until the body reports.
  const [status, setStatus] = useState<StreamStatus>(compId ? 'loading' : 'error');

  useEffect(() => applyOverlayBodyStyle(search, SURFACE_GROUND.stream), [search]);

  return (
    <Box
      data-stream-status={status}
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: align,
        px: STREAM_INSET_X,
        py: STREAM_INSET_Y,
        color: 'common.white',
        textShadow: overlayTextShadow,
      }}
    >
      <StreamStatusMarker status={status} compId={compId} />
      {compId && (
        <StreamStatusContext.Provider value={setStatus}>
          <StreamContent compId={compId} readToken={readToken} discipline={discipline}>
            {children}
          </StreamContent>
        </StreamStatusContext.Provider>
      )}
    </Box>
  );
};

const StreamContent = ({
  compId,
  readToken,
  discipline,
  children,
}: {
  compId: string;
  readToken?: string;
  discipline: Discipline;
  children: (ctx: StreamCtx) => ReactNode;
}) => {
  const { selection, readyState } = useStreamRefresh(compId, readToken, discipline);
  const link = useLinkPhase(readyState);
  return (
    <>
      {/* Invisible on chroma grounds by design — see ConnectionLostBadge. */}
      <ConnectionLostBadge link={link} />
      {children({ compId, readToken, discipline, selection })}
    </>
  );
};

const STATUS_TEXT: Record<StreamStatus, string> = {
  loading: 'Overlay loading…',
  empty: 'No data for this overlay yet.',
  error: 'Overlay could not load — check the link, token, or competition.',
  ready: 'On air.',
};

/** The visually-hidden status line (clipped to a 1px box). */
const StreamStatusMarker = ({
  status,
  compId,
}: {
  status: StreamStatus;
  compId: string | null;
}) => (
  <Box
    component="output"
    aria-live="polite"
    data-testid="stream-status"
    data-stream-status={status}
    sx={{
      position: 'absolute',
      width: 1,
      height: 1,
      padding: 0,
      margin: -1,
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
      whiteSpace: 'nowrap',
      border: 0,
    }}
  >
    {compId ? STATUS_TEXT[status] : 'Missing compId in the overlay URL.'}
  </Box>
);

/**
 * A misconfigured overlay URL (bad round/gender). Reports `error` so the state
 * is observable off-air, and paints nothing on camera. Must be rendered inside
 * a `StreamLayout` so the status context is present.
 */
export const InvalidOverlay = () => {
  useReportStreamStatus('error');
  return null;
};

/** `compId` from the overlay URL query (kept distinct from the relay sessionId param). */
const useStreamCompId = (): string | null => {
  const { search } = useLocation();
  return new URLSearchParams(search).get('compId');
};

/**
 * Discipline from the overlay URL query (`?discipline=freestyle`); defaults to
 * `speed`. The read token is competition-scoped, so the same token serves both
 * disciplines — only this URL param differs.
 */
const useStreamDiscipline = (): Discipline => {
  const { search } = useLocation();
  const value = new URLSearchParams(search).get('discipline');
  return isDiscipline(value) ? value : 'speed';
};
