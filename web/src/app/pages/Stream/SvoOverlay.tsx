import { Box } from '@mui/material';
import { useParams } from 'react-router-dom';

import { useAthletes } from 'app/api/athletes';
import { Competitor } from 'app/pages/Stream/Competitor';
import {
  InvalidOverlay,
  StreamLayout,
  STREAM_INSET_X_PX,
  useReportStreamStatus,
} from 'app/pages/Stream/StreamLayout';
import { OVERLAY_LANE } from 'app/pages/Stream/TimerLaneBlock';
import { deriveStreamStatus } from 'app/pages/Stream/streamStatus';
import { refVh, refVw } from 'app/util/overlayScale';

/**
 * Upward lift (reference px on the 1080p frame) applied to the vertically-centered
 * SVO cards so they rise over the racing-timer page's bottom-corner namestrip +
 * timer lower-thirds instead of floating at mid-screen. Shared by SVO-A and SVO-B
 * so the left/right cards stay symmetric.
 */
export const SVO_LIFT_PX = 60;

/**
 * The card's own side margin INSIDE the layout's title-safe inset. The SVO cards
 * and the `/stream/timer` lower-thirds are composited in the same bottom corner,
 * so the corner has ONE owner — `OVERLAY_LANE.inset`, the producer-facing number
 * the manual documents — and this is whatever of it the layout has not already
 * paid. Derived, not a second number: the card's outer edge lands exactly on the
 * lane plates' (it used to sit 59px further in). Shared by SVO-A and SVO-B so
 * the left/right cards stay symmetric.
 */
export const SVO_SIDE_MARGIN = refVw(OVERLAY_LANE.inset - STREAM_INSET_X_PX);

/**
 * SVO-A — `/stream/svo/:athleteId?compId=&token=` — a single-athlete identity
 * card: the full LAAX photo card (`Competitor` → `AthleteCard`: B&W portrait,
 * white arc plate, condensed-caps name, flag foot) in the 298.81×498.02 identity
 * frame, no result/winner accent. Pure identity — no round, no discipline, no
 * result/rank — so the URL needs only the athlete + the comp-scoped read token
 * (an athlete is the pair `(compId, athleteId)`; `athleteId` does not embed
 * `compId`, so `compId` is always required). For a live, board-driven card with a
 * result, see SvoLiveOverlay.
 */
export const SvoOverlay = () => {
  const { athleteId } = useParams();
  return (
    <StreamLayout align="center">
      {({ compId, readToken }) =>
        athleteId ? (
          <SvoBody compId={compId} readToken={readToken} athleteId={athleteId} />
        ) : (
          <InvalidOverlay />
        )
      }
    </StreamLayout>
  );
};

const SvoBody = ({
  compId,
  readToken,
  athleteId,
}: {
  compId: string;
  readToken?: string;
  athleteId: string;
}) => {
  const athletes = useAthletes(compId, { readToken });
  const athlete = athletes.data?.find((a) => a.athleteId === athleteId);

  useReportStreamStatus(deriveStreamStatus(athletes.isLoading, athletes.isError, athlete == null));

  if (athletes.isLoading || athletes.isError || !athlete) return null;

  return (
    <Box
      data-testid="svo-card-shell"
      sx={{
        transform: `translateY(${refVh(-SVO_LIFT_PX)})`,
        marginLeft: SVO_SIDE_MARGIN,
      }}
    >
      <Competitor athlete={athlete} />
    </Box>
  );
};
