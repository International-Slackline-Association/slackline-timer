import { Box } from '@mui/material';
import { useParams } from 'react-router-dom';

import { type LiveSelection } from 'app/hooks/useWebSocket';
import { Competitor } from 'app/pages/Stream/Competitor';
import { InvalidOverlay, StreamLayout, useReportStreamStatus } from 'app/pages/Stream/StreamLayout';
import { SVO_LIFT_PX, SVO_SIDE_MARGIN } from 'app/pages/Stream/SvoOverlay';
import { deriveStreamStatus } from 'app/pages/Stream/streamStatus';
import { useLiveSideAthlete } from 'app/pages/Stream/useLiveSideAthlete';
import { refVh } from 'app/util/overlayScale';

/**
 * SVO-B — `/stream/svo-live/:side?compId=&token=&discipline=` — the same full
 * photo card as SVO-A (`Competitor` → `AthleteCard`) but board-driven. `:side` ∈
 * {1,2} picks which lane/player the card tracks; the athlete is the board's live
 * `selection.athlete{side}Id`. Unlike SVO-A it also shows the discipline result
 * for the board's current round (freestyle → judged `Score.overall` to one
 * decimal / DNF; speed → best time).
 * The result plane follows `selection.discipline`, which `StreamLayout` now
 * guarantees equals this overlay's URL `&discipline=` — it drops the other
 * board's selection (useStreamRefresh), so a freestyle card never shows the
 * speed board's athlete when both disciplines run on one comp.
 *
 * Fail-safe: a null selection or an empty side renders nothing (transparent) —
 * a freshly-opened card simply waits for the board's first push.
 */
export const SvoLiveOverlay = () => {
  const { side } = useParams();
  return (
    <StreamLayout align="center">
      {({ compId, readToken, selection }) =>
        side === '1' || side === '2' ? (
          <SvoLiveBody
            compId={compId}
            readToken={readToken}
            side={side === '2' ? 2 : 1}
            selection={selection}
          />
        ) : (
          <InvalidOverlay />
        )
      }
    </StreamLayout>
  );
};

const SvoLiveBody = ({
  compId,
  readToken,
  side,
  selection,
}: {
  compId: string;
  readToken?: string;
  side: 1 | 2;
  selection: LiveSelection | null;
}) => {
  const { athlete, result, isLoading, isError } = useLiveSideAthlete(compId, side, selection, {
    readToken,
  });
  useReportStreamStatus(deriveStreamStatus(isLoading, isError, athlete == null));

  if (isLoading || isError || !athlete) return null;

  return (
    <Box
      data-testid="svo-live-card-shell"
      sx={{
        alignSelf: side === 2 ? 'flex-end' : 'flex-start',
        marginLeft: side === 1 ? SVO_SIDE_MARGIN : 0,
        marginRight: side === 2 ? SVO_SIDE_MARGIN : 0,
        transform: `translateY(${refVh(-SVO_LIFT_PX)})`,
      }}
    >
      <Competitor athlete={athlete} result={result} />
    </Box>
  );
};
