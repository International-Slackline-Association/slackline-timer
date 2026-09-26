import { useParams } from 'react-router-dom';

import { useMatches } from 'app/api/matches';
import { useAthleteLookup } from 'app/hooks/useAthleteLookup';
import { type LiveSelection } from 'app/hooks/useWebSocket';
import { isGender, type Discipline, type Gender } from 'app/types';
import { InvalidOverlay, StreamLayout, useReportStreamStatus } from 'app/pages/Stream/StreamLayout';
import { streamStatusFromQueries } from 'app/pages/Stream/streamStatus';
import { VsMatchup, pickLiveMatch } from 'app/pages/Stream/VsOverlay';

/**
 * `/stream/vs-live/:gender?compId=&token=&discipline=` — the round-*following*
 * head-to-head. Same card as `/stream/vs/...` (`VsMatchup`), but pinned only to
 * a gender + discipline: it tracks whatever match the operator selects on the
 * control board across EVERY round, so one OBS source carries the live matchup
 * from the quarters through to the final without a link swap. The round comes
 * from the selected match itself (which scopes the result lookup), not the URL.
 *
 * Mirrors the SVO split (`/stream/svo/:athleteId` pinned vs
 * `/stream/svo-live/:side` board-driven): `vs` is the round-pinned card, this is
 * its board-driven sibling. Match precedence lives in `pickLiveMatch`.
 */
export const VsLiveOverlay = () => {
  const { gender } = useParams();
  return (
    <StreamLayout align="center">
      {({ compId, readToken, discipline, selection }) =>
        isGender(gender) ? (
          <VsLiveBody
            compId={compId}
            readToken={readToken}
            gender={gender}
            discipline={discipline}
            selection={selection}
          />
        ) : (
          <InvalidOverlay />
        )
      }
    </StreamLayout>
  );
};

const VsLiveBody = ({
  compId,
  readToken,
  gender,
  discipline,
  selection,
}: {
  compId: string;
  readToken?: string;
  gender: Gender;
  discipline: Discipline;
  selection: LiveSelection | null;
}) => {
  const matches = useMatches(compId, gender, { discipline, readToken });
  const { athletes, byId: athleteById } = useAthleteLookup(compId, { readToken });

  const match = pickLiveMatch(matches.data ?? [], selection, gender, discipline);
  const status = streamStatusFromQueries([matches, athletes], match == null);
  useReportStreamStatus(status);

  if (status !== 'ready' || match == null) return null;

  return (
    <VsMatchup
      compId={compId}
      readToken={readToken}
      discipline={discipline}
      round={match.round}
      match={match}
      athleteById={athleteById}
      selection={selection}
    />
  );
};
