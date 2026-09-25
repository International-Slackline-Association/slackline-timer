import { useMemo } from 'react';

import { Box, Stack, Typography } from '@mui/material';
import { useLocation, useParams } from 'react-router-dom';

import { useMatches } from 'app/api/matches';
import { useScores } from 'app/api/scores';
import { useTimes } from 'app/api/times';
import { useAthleteLookup } from 'app/hooks/useAthleteLookup';
import { type LiveSelection } from 'app/hooks/useWebSocket';
import {
  MATCH_ROUNDS,
  isGender,
  isMatchRound,
  type Athlete,
  type Discipline,
  type Gender,
  type Match,
  type MatchRound,
  type Score,
  type Time,
} from 'app/types';
import { fonts, overlayArt } from 'app/theme/tokens';
import { refVh, refVw } from 'app/util/overlayScale';
import { Competitor } from 'app/pages/Stream/Competitor';
import { InvalidOverlay, StreamLayout, useReportStreamStatus } from 'app/pages/Stream/StreamLayout';
import { streamStatusFromQueries } from 'app/pages/Stream/streamStatus';
import { VsFreestyleStatsTable, VsSpeedStatsTable } from 'app/pages/Stream/VsStatsTable';

/**
 * `/stream/vs/:round/:gender?compId=&token=&match=` — head-to-head for a single
 * matchup in the LAAX broadcast language (`LAAX 2026_vs speed.svg` /
 * `LAAX 2026_vs freestyle.svg`): two portrait photo cards (name + flag) flanking
 * a condensed Medium `VS`, each backed by an outer stats table (`VsStatsTable`)
 * whose content follows the discipline split — the speed plane's RUN 1/2/3
 * best-of-3 laps (`useTimes`, filling in live as each run is recorded), or the
 * freestyle plane's judged component breakdown + TOTAL (`useScores`, adapting the
 * columns per round). The winner's frame edge goes `race.go` green. Transparent
 * background for keying; refreshes live on `db_update`.
 *
 * This variant is **pinned to one round** (the URL `:round`). For a card that
 * follows the operator across every round of a gender/discipline, see the
 * `/stream/vs-live/:gender` sibling (`VsLiveOverlay`) — same card, live round.
 *
 * A head-to-head lower-third shows exactly ONE matchup. Precedence for which:
 * an explicit `&match=<matchId>` query param > the control board's live
 * `selection.matchId` (when it names a match in this round) > the first match
 * without a winner by bracket position. The explicit param is stable across
 * re-seeds; the live selection follows the operator (superseding the old
 * recency tiebreaker); the bracket fallback keeps a freshly-opened overlay
 * (before the board pushes anything) from going blank.
 */
export const VsOverlay = () => {
  const { round, gender } = useParams();
  const matchId = new URLSearchParams(useLocation().search).get('match') ?? undefined;
  return (
    <StreamLayout align="center">
      {({ compId, readToken, discipline, selection }) =>
        isMatchRound(round) && isGender(gender) ? (
          <VsBody
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

/**
 * The one match to show. Precedence: the explicitly-requested `matchId` >
 * the control board's live `selection.matchId` (only when it names a match in
 * this round/gender list) > the live match by bracket position (first without
 * a winner, else the first overall). Returns undefined for an empty round — or
 * for an explicit `matchId` that isn't in the list (fail-safe blank, e.g. a
 * stale link after a re-seed), which deliberately does NOT fall through to the
 * live/positional picks.
 */
export const pickMatch = (
  matches: Match[],
  matchId?: string,
  selection?: LiveSelection | null,
): Match | undefined => {
  if (matchId) return matches.find((m) => m.matchId === matchId);
  if (selection?.matchId) {
    const selected = matches.find((m) => m.matchId === selection.matchId);
    if (selected) return selected;
  }
  const byPosition = [...matches].sort((a, b) => a.position - b.position);
  return byPosition.find((m) => m.winnerId == null) ?? byPosition[0];
};

/**
 * The one match to show for the round-following `VsLiveOverlay`: track the
 * board's live selection wherever it goes within a gender+discipline, not a
 * single round. Precedence: the board's `selection.matchId` (only when the
 * selection is for THIS overlay's gender+discipline, so a male card never
 * chases a female pick) > the first still-undecided match in bracket order
 * (round order, then position) > the last match (the final). `matches` is
 * already gender+discipline-scoped by the caller, so the guard is belt-and-
 * braces; the bracket fallback keeps a freshly-opened overlay from going blank
 * before the board pushes anything.
 */
export const pickLiveMatch = (
  matches: Match[],
  selection: LiveSelection | null,
  gender: Gender,
  discipline: Discipline,
): Match | undefined => {
  if (selection?.matchId && selection.gender === gender && selection.discipline === discipline) {
    const selected = matches.find((m) => m.matchId === selection.matchId);
    if (selected) return selected;
  }
  const ordered = [...matches].sort(
    (a, b) =>
      MATCH_ROUNDS.indexOf(a.round) - MATCH_ROUNDS.indexOf(b.round) || a.position - b.position,
  );
  return ordered.find((m) => m.winnerId == null) ?? ordered[ordered.length - 1];
};

/**
 * Reference geometry measured off the `LAAX 2026_vs speed/freestyle.svg`
 * masters — provenance labels, not files in this repo; the measurement record
 * is `doc/dev/design-system/design-system.md` §7 "VS head-to-head". Px on the
 * 1920×1080 capture frame, carried to any capture size by `refVw`/`refVh`, so
 * a 1080p capture lands pixel-for-pixel on the master and nothing is pinned to
 * a fixed canvas.
 *
 * The composition is a centred row
 * `[stats table] [photo card] VS [photo card] [stats table]`; the portrait
 * panels are the `Competitor` frame itself (ADR 0029) and the gutters below are
 * asymmetric because the master's are.
 */
const ART = {
  vsGap: 176.19, // between the two photo cards, holding the VS glyph
  tableToCardLeft: 67.06, // left stats table → left card
  cardToTableRight: 61.03, // right card → right stats table
} as const;

/**
 * Which athlete renders on which side of the head-to-head. The persisted match
 * record fixes the default (`athlete1Id` left), but the operator's lane swap is
 * the on-air truth of who stands where — SVO-B and the lane names already
 * follow the board's `selection.athlete{1,2}Id`, so the VS card must too or the
 * lower-thirds disagree (ADR 0044). Honoured only when the live selection names
 * THIS match with its two athletes exactly transposed (a pure swap): anything
 * else — another match, a hand-edited athlete, a null selection — falls back to
 * the persisted order, so a stale or foreign push can never misplace a card.
 */
export const matchSideOrder = (
  match: Match,
  selection: LiveSelection | null,
): [string | undefined, string | undefined] => {
  const swapped =
    selection != null &&
    selection.matchId === match.matchId &&
    selection.athlete1Id === (match.athlete2Id ?? null) &&
    selection.athlete2Id === (match.athlete1Id ?? null);
  return swapped ? [match.athlete2Id, match.athlete1Id] : [match.athlete1Id, match.athlete2Id];
};

/** The three best-of-3 run laps for one athlete, oldest first, padded to three
 *  slots (`null` = not yet run). Times are already round-scoped by the query; an
 *  athlete sits in exactly one match per round, so the athlete id alone
 *  identifies their runs (a run explicitly tagged to a different match is
 *  excluded, belt-and-braces). The DNF sentinel rides through as a value so the
 *  table can render `DNF`. */
const runsForAthlete = (times: Time[], athleteId: string, matchId: string): (number | null)[] => {
  const laps = times
    .filter((t) => t.athleteId === athleteId && (!t.matchId || t.matchId === matchId))
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, 3)
    .map((t) => t.timeMs);
  return [0, 1, 2].map((i) => laps[i] ?? null);
};

const VsBody = ({
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
  const { athletes, byId: athleteById } = useAthleteLookup(compId, { readToken });

  const roundMatches = (matches.data ?? []).filter((m) => m.round === round);
  const match = pickMatch(roundMatches, matchId, selection);
  const status = streamStatusFromQueries([matches, athletes], match == null);
  useReportStreamStatus(status);

  if (status !== 'ready' || match == null) return null;

  return (
    <VsMatchup
      compId={compId}
      readToken={readToken}
      discipline={discipline}
      round={round}
      match={match}
      athleteById={athleteById}
      selection={selection}
    />
  );
};

/**
 * The head-to-head card for one already-resolved match — the shared render of
 * the round-pinned `VsOverlay` and the round-following `VsLiveOverlay`. Flanks
 * each competitor's photo card with a discipline-specific stats table
 * (`VsStatsTable`): on the speed plane, the athlete's RUN 1/2/3 best-of-3 laps
 * off `useTimes` (they fill in live as each run is recorded); on the freestyle
 * plane, the judged component breakdown + TOTAL off `useScores`. The result data
 * is fetched for `round` (the pinned round, or the live match's own round) via
 * the discipline split. The winner's frame goes `race.go` green.
 *
 * Side order follows the board's live lane pairing when it names this match
 * (`matchSideOrder`) — all result data is athlete-keyed, so a swap only moves
 * the cards, never the numbers.
 */
export const VsMatchup = ({
  compId,
  readToken,
  discipline,
  round,
  match,
  athleteById,
  selection = null,
}: {
  compId: string;
  readToken?: string;
  discipline: Discipline;
  round: MatchRound;
  match: Match;
  athleteById: (id?: string) => Athlete | undefined;
  selection?: LiveSelection | null;
}) => {
  const isFreestyle = discipline === 'freestyle';
  // The two result planes share the head-to-head layout; only the inactive
  // plane's query is disabled (compId=null) so freestyle never hits /times.
  const times = useTimes(isFreestyle ? null : compId, round, { readToken });
  const scores = useScores(isFreestyle ? compId : null, round, { readToken });

  const scoreByAthlete = useMemo(() => {
    const map = new Map<string, Score>();
    for (const s of scores.data ?? []) map.set(s.athleteId, s);
    return map;
  }, [scores.data]);

  const [leftId, rightId] = matchSideOrder(match, selection);
  const isWinnerLeft = match.winnerId != null && match.winnerId === leftId;
  const isWinnerRight = match.winnerId != null && match.winnerId === rightId;

  // The stats table for one side. A freestyle score maps to the breakdown entry
  // shape (null when unscored → empty boxes); speed maps to the three run laps.
  const statsTable = (side: 'left' | 'right', athleteId?: string) => {
    if (isFreestyle) {
      const score = athleteId ? scoreByAthlete.get(athleteId) : undefined;
      return (
        <VsFreestyleStatsTable
          side={side}
          round={round}
          entry={score ? { dnf: score.dnf, overall: score.overall, score } : null}
        />
      );
    }
    return (
      <VsSpeedStatsTable
        side={side}
        runs={
          athleteId
            ? runsForAthlete(times.data ?? [], athleteId, match.matchId)
            : [null, null, null]
        }
      />
    );
  };

  return (
    <Box sx={{ textAlign: 'center' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'center' }}>
        {statsTable('left', leftId)}
        <Box sx={{ width: refVw(ART.tableToCardLeft) }} />
        <Competitor
          athlete={athleteById(leftId)}
          isWinner={isWinnerLeft}
          winnerTag={isWinnerLeft}
        />
        {/* The art's inter-panel gap; the VS glyph sits centred inside it. */}
        <Box
          sx={{
            width: refVw(ART.vsGap),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography
            component="span"
            sx={{
              fontFamily: fonts.display,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: overlayArt.headingTracking,
              fontSize: refVh(109.98),
              lineHeight: 1,
            }}
          >
            VS
          </Typography>
        </Box>
        <Competitor
          athlete={athleteById(rightId)}
          isWinner={isWinnerRight}
          winnerTag={isWinnerRight}
        />
        <Box sx={{ width: refVw(ART.cardToTableRight) }} />
        {statsTable('right', rightId)}
      </Stack>
    </Box>
  );
};
