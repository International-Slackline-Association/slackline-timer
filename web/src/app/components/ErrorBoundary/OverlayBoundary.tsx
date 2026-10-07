import { useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Outlet, useLocation } from 'react-router-dom';

import { applyOverlayBodyStyle, routeGround } from 'app/pages/Stream/overlayBg';

import { useRetryLadder } from './retryLadder';

/** Holds the `?bg=` ground while the crashed surface is unmounted: its own
 *  cleanup restored the themed body colour, which would key as solid on air. */
export const OverlayGround = ({ pathname, search }: { pathname: string; search: string }) => {
  const ground = routeGround(pathname);
  useEffect(() => applyOverlayBodyStyle(search, ground), [search, ground]);
  return null;
};

/**
 * Layout route for the unattended display surfaces (OBS sources, projectors): a
 * render crash blanks the surface to its ground — never error text on air — and
 * retries on its own, since nobody is at the capture machine to reload it.
 */
export const OverlayBoundary = () => {
  const { pathname, search } = useLocation();
  const { boundaryRef, scheduleRetry, resetLadder } = useRetryLadder();

  const onError = (error: unknown) => {
    console.error('Overlay render failed; retrying', error);
    scheduleRetry();
  };

  const onReset = ({ reason }: { reason: 'imperative-api' | 'keys' }) => {
    if (reason === 'keys') resetLadder();
  };

  return (
    <ErrorBoundary
      ref={boundaryRef}
      resetKeys={[pathname + search]}
      onError={onError}
      onReset={onReset}
      fallbackRender={() => <OverlayGround pathname={pathname} search={search} />}
    >
      <Outlet />
    </ErrorBoundary>
  );
};
