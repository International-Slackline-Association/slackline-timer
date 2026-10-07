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
import { deriveStreamStatus } from 'app/pages/Stream/streamStatus';
import { OVERLAY_LANE } from 'app/theme/tokens';
import { refVh, refVw } from 'app/util/overlayScale';

/**
 * Upward lift (reference px) for the vertically-centred SVO cards, so they rise
 * over the timer lower-thirds instead of floating at mid-screen. Shared by
 * SVO-A and SVO-B.
 */
export const SVO_LIFT_PX = 60;

/**
 * The card's side margin INSIDE the layout's title-safe inset. The SVO cards and
 * the `/stream/timer` lower-thirds share a bottom corner, so the corner has ONE
 * owner — `OVERLAY_LANE.inset`, the producer-facing number the manual documents
 * — and this is whatever of it the layout has not already paid, so the card's
 * outer edge lands exactly on the lane plates'. Shared by SVO-A and SVO-B.
 */
export const SVO_SIDE_MARGIN = refVw(OVERLAY_LANE.inset - STREAM_INSET_X_PX);

/**
 * SVO-A — `/stream/svo/:athleteId?compId=&token=` — a single-athlete identity
 * card (`Competitor`), no result/winner accent, so the URL needs only the
 * athlete + the comp-scoped read token (`athleteId` does not embed `compId`, so
 * `compId` is still required). The board-driven card with a result is
 * `SvoLiveOverlay`.
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
