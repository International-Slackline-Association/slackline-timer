import { useLocation, useParams } from 'react-router-dom';

import { Stack, Typography } from '@mui/material';

import { useAthletes } from 'app/api/athletes';
import { useMatches } from 'app/api/matches';
import { type LiveSelection } from 'app/hooks/useWebSocket';
import { isGender, isMatchRound, type Discipline, type Gender, type MatchRound } from 'app/types';
import { colors, fonts } from 'app/theme/tokens';
import { refVh } from 'app/util/overlayScale';
import { Competitor } from 'app/pages/Stream/Competitor';
import { pickMatch } from 'app/pages/Stream/VsOverlay';
import { InvalidOverlay, StreamLayout, useReportStreamStatus } from 'app/pages/Stream/StreamLayout';
import { streamStatusFromQueries } from 'app/pages/Stream/streamStatus';

/**
 * `/stream/winner/:round/:gender?compId=&token=&match=` — the match-result
 * lower-third, sibling of VS/SVO. It shows the **decided** match's winner from
 * control-board data: one large LAAX portrait card (the shared `AthleteCard`,
 * winner-styled `race.go` edge) under a WINNER banner.
 *
 * The winner is `Match.winnerId` — the single resolved output of both the
 * single-run path (ADR 0013) and best-of-3 (ADR 0017: `winnerId` is PUT only
 * once a lane takes 2 run-wins). So this overlay needs no series-tally on the
 * wire — it consumes the same persisted field VS already reads, keyed by the
 * board's live match. The running-series story (1-0 → 1-1 → …) is the sibling
 * `RoundsSummaryOverlay`'s job, not this one.
 *
 * Which match: the same precedence as VS — explicit `&match=` > the board's live
 * `selection.matchId` (when it names a match in this round) > the first
 * winner-less match by bracket position. Fail-safe: until that match has a
 * `winnerId`, the overlay reports `empty` and paints nothing — correct on-air
 * behaviour while a series is still live (no winner until it's decided).
 */
export const WinnerOverlay = () => {
  const { round, gender } = useParams();
  const matchId = new URLSearchParams(useLocation().search).get('match') ?? undefined;
  return (
    <StreamLayout align="center">
      {({ compId, readToken, discipline, selection }) =>
        isMatchRound(round) && isGender(gender) ? (
          <WinnerBody
            compId={compId}
            readToken={readToken}
            round={round}
            gender={gender}
            discipline={discipline}
            matchId={matchId}
            selection={selection}
          />
        ) : (
          <InvalidOverlay />
        )
      }
    </StreamLayout>
  );
};

const WinnerBody = ({
  compId,
  readToken,
  round,
  gender,
  discipline,
  matchId,
  selection,
}: {
  compId: string;
  readToken?: string;
  round: MatchRound;
  gender: Gender;
  discipline: Discipline;
  matchId?: string;
  selection: LiveSelection | null;
}) => {
  const matches = useMatches(compId, gender, { discipline, readToken });
  const athletes = useAthletes(compId, { readToken });

  const roundMatches = (matches.data ?? []).filter((m) => m.round === round);
  const match = pickMatch(roundMatches, matchId, selection);
  const winner = match?.winnerId
    ? (athletes.data ?? []).find((a) => a.athleteId === match.winnerId)
    : undefined;

  const status = streamStatusFromQueries([matches, athletes], winner == null);
  useReportStreamStatus(status);

  if (status !== 'ready' || match == null || winner == null) return null;

  return (
    <Stack spacing={3} sx={{ alignItems: 'center' }}>
      <Typography
        sx={{
          fontFamily: fonts.display,
          // 700, not 800: Oswald's heaviest bundled face is 700, so an 800
          // request just resolves back to it (see `fonts.display`).
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontSize: refVh(40),
          color: colors.race.go,
          lineHeight: 1,
        }}
      >
        Winner
      </Typography>
      <Competitor athlete={winner} isWinner />
    </Stack>
  );
};
