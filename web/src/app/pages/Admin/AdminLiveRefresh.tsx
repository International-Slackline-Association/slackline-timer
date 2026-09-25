import { Outlet } from 'react-router-dom';

import { useStreamRefresh } from 'app/pages/Stream/useStreamRefresh';
import { useSelectedCompetition } from 'app/state/selectedCompetition';

/**
 * Split out so the hooks only run — and the relay socket only opens — while a
 * competition is selected (`useWS` cannot be conditionally skipped).
 */
const DbUpdateSubscription = ({ compId }: { compId: string }) => {
  useStreamRefresh(compId);
  return null;
};

/**
 * Pathless layout route over `/admin/*`: joins the selected competition's relay
 * room and invalidates the matching React Query branches on every `db_update`,
 * so an operator watching (say) standings sees writes made from *another*
 * session without a remount — the same live refresh the `/stream/*` overlays
 * get from `useStreamRefresh` (whose reconnect catch-up invalidation rides
 * along; its `updateSelection` tracking is simply unused here).
 */
export const AdminLiveRefresh = () => {
  const { compId } = useSelectedCompetition();
  return (
    <>
      {compId !== null && <DbUpdateSubscription compId={compId} />}
      <Outlet />
    </>
  );
};
