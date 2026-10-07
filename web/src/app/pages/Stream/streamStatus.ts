/**
 * The on-air lifecycle of an overlay. Only `ready` paints; the rest are
 * observable off-air only (see `StreamLayout`; `/admin/overlays` shows a
 * severity chip).
 */
export type StreamStatus = 'loading' | 'empty' | 'error' | 'ready';

/**
 * The single derivation of an overlay's lifecycle from a query's flags, shared
 * by every surface that reports or inspects overlay status (the `/stream/*`
 * bodies via `useReportStreamStatus`, and the `/admin/overlays` status panel).
 * Precedence is loading → error → empty → ready: an in-flight query is always
 * `loading`, a failed one `error`, a resolved-but-rowless one `empty`. Surfaces
 * whose resolved-empty state is still valid on air (e.g. an unseeded bracket)
 * simply pass `isEmpty: false`.
 */
export const deriveStreamStatus = (
  isLoading: boolean,
  isError: boolean,
  isEmpty: boolean,
): StreamStatus => (isLoading ? 'loading' : isError ? 'error' : isEmpty ? 'empty' : 'ready');

/**
 * `deriveStreamStatus` over the several queries an overlay body joins (e.g.
 * matches + athletes): loading/error if ANY constituent is. Bodies gate their
 * render on `status !== 'ready'`, so the reported status and what's on camera
 * can't drift. A pure helper, not a `QueryStates`-style component: off-`ready`
 * overlays render nothing, so there is no triad to render.
 */
export const streamStatusFromQueries = (
  queries: readonly { isLoading: boolean; isError: boolean }[],
  isEmpty: boolean,
): StreamStatus =>
  deriveStreamStatus(
    queries.some((query) => query.isLoading),
    queries.some((query) => query.isError),
    isEmpty,
  );
