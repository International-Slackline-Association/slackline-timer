import { Box } from '@mui/material';
import { useLocation, useParams } from 'react-router-dom';

import { useMatches } from 'app/api/matches';
import { useAthleteLookup } from 'app/hooks/useAthleteLookup';
import { isGender, type Discipline, type Gender } from 'app/types';
import { PlayoffBracket, type BracketVariant } from 'app/pages/Admin/PlayoffBracket';
import {
  InvalidOverlay,
  STREAM_INSET_Y,
  StreamLayout,
  useReportStreamStatus,
} from 'app/pages/Stream/StreamLayout';
import { streamStatusFromQueries } from 'app/pages/Stream/streamStatus';

/**
 * `/stream/brackets/:gender?compId=&token=&variant=` — the single-elimination
 * bracket as a broadcast overlay, reusing the admin `PlayoffBracket`. `variant`
 * picks the reference layout: `name` (single-direction name tree) or `profile`
 * (the mirrored photo tree, the default). Refreshes live on `db_update`.
 */
export const BracketsOverlay = () => {
  const { gender } = useParams();
  const variant = useBracketVariant();
  return (
    <StreamLayout align="center">
      {({ compId, readToken, discipline }) =>
        isGender(gender) ? (
          <BracketsBody
            compId={compId}
            readToken={readToken}
            gender={gender}
            discipline={discipline}
            variant={variant}
          />
        ) : (
          <InvalidOverlay />
        )
      }
    </StreamLayout>
  );
};

/** Bracket layout variant from the overlay URL query; anything else (incl. the
 *  retired `compact`, ADR 0041) falls back to `profile`. */
const useBracketVariant = (): BracketVariant => {
  const { search } = useLocation();
  const variant = new URLSearchParams(search).get('variant');
  return variant === 'name' ? variant : 'profile';
};

const BracketsBody = ({
  compId,
  readToken,
  gender,
  discipline,
  variant,
}: {
  compId: string;
  readToken?: string;
  gender: Gender;
  discipline: Discipline;
  variant: BracketVariant;
}) => {
  const matches = useMatches(compId, gender, { discipline, readToken });
  const { athletes, byId: athleteById } = useAthleteLookup(compId, { readToken });

  // The bracket frame is itself valid on-air content even with no matches
  // seeded (TBD slots), so anything that resolves is `ready` — only loading and
  // error paint nothing (hence `isEmpty: false`).
  const status = streamStatusFromQueries([matches, athletes], false);
  useReportStreamStatus(status);

  if (status !== 'ready') return null;

  return (
    // The tree is a 16:9 canvas, so at the full content-box WIDTH it is taller
    // than the title-safe content box and spills past the bottom inset. Cap the
    // width at what the padded height affords and centre what is left, so the
    // canvas is the largest 16:9 rectangle that fits the frame.
    <Box
      sx={{
        position: 'relative',
        width: `min(100%, calc((100vh - 2 * ${STREAM_INSET_Y}) * 16 / 9))`,
        mx: 'auto',
      }}
    >
      <PlayoffBracket
        matches={matches.data ?? []}
        athleteById={athleteById}
        transparent
        variant={variant}
      />
    </Box>
  );
};
