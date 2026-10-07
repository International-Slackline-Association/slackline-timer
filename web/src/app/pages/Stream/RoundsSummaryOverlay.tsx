import { useLocation, useParams } from 'react-router-dom';

import { Stack, Typography } from '@mui/material';

import { useAthletes } from 'app/api/athletes';
import { useMatches } from 'app/api/matches';
import { Numeral } from 'app/components/Numeral';
import { type LiveSelection } from 'app/hooks/useWebSocket';
import { isGender, isMatchRound, type Athlete, type Gender, type MatchRound } from 'app/types';
import { colors, fonts, overlayArt } from 'app/theme/tokens';
import { displayRoundName } from 'app/util/rounds';
import { refVh, refVw } from 'app/util/overlayScale';
import { Competitor } from 'app/pages/Stream/Competitor';
import { pickMatch, VS_ART } from 'app/pages/Stream/VsOverlay';
import { InvalidOverlay, StreamLayout, useReportStreamStatus } from 'app/pages/Stream/StreamLayout';
import { streamStatusFromQueries } from 'app/pages/Stream/streamStatus';

/** The best-of-3 composition, reference px on the 1080p frame (design-system
 *  §7): the gaps between caption, tally and cards and inside the tally, and the
 *  caption / tally-name / numeral sizes. */
const SUMMARY_ART = {
  stackGap: 24,
  tallyGap: 16,
  caption: 32,
  name: 40,
  numeral: 64,
} as const;

/**
 * `/stream/rounds-summary/:round/:gender?compId=&token=&match=` — the best-of-3
 * series story, sibling of VS/SVO/winner: a name-anchored tally ("DOE 2 – 1
 * ROE") over one identity card per athlete, the series leader's digit and card
 * edge in `race.go`. As the operator works a speed match the tally climbs
 * 1-0 → 1-1 → 2-1 on camera.
 *
 * Board-driven: the tally rides the board's `updateSelection` as
 * `selection.runWins` (ADR 0017 §4). No `Time`/`Score` fetch — the cards are
 * pure identity. The run order isn't on the wire (ADR 0017), so the digits
 * anchor to the athletes' names rather than feign a chronological sequence.
 *
 * Which match: `pickMatch`, as VS. Until at least one run resolves the overlay
 * reports `empty` and paints nothing.
 */
export const RoundsSummaryOverlay = () => {
  const { round, gender } = useParams();
  const matchId = new URLSearchParams(useLocation().search).get('match') ?? undefined;
  return (
    <StreamLayout align="center">
      {({ compId, readToken, selection }) =>
        isMatchRound(round) && isGender(gender) ? (
          <SummaryBody
            compId={compId}
            readToken={readToken}
            round={round}
            gender={gender}
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

const SummaryBody = ({
  compId,
  readToken,
  round,
  gender,
  matchId,
  selection,
}: {
  compId: string;
  readToken?: string;
  round: MatchRound;
  gender: Gender;
  matchId?: string;
  selection: LiveSelection | null;
}) => {
  const matches = useMatches(compId, gender, { discipline: 'speed', readToken });
  const athletes = useAthletes(compId, { readToken });

  const roundMatches = (matches.data ?? []).filter((m) => m.round === round);
  const match = pickMatch(roundMatches, matchId, selection);

  // `runWins` exists only on the speed arm of the union; the narrowing check also
  // keeps a freestyle board sharing the relay room out of the digits.
  const runWins = selection?.discipline === 'speed' ? selection.runWins : undefined;
  const athleteById = (id?: string | null) =>
    id ? (athletes.data ?? []).find((a) => a.athleteId === id) : undefined;
  // The series cards follow the board's lane→athlete pairing — the wire tally
  // is the lane view projected through the SAME message's athlete ids
  // (ADR 0044), so pairing each name with its digit here is consistent by
  // construction, across lane swaps too. The match's seeded athletes are only
  // the pre-push fallback (where runWins is absent and the digits render 0–0).
  const athlete1 = athleteById(selection?.athlete1Id ?? match?.athlete1Id);
  const athlete2 = athleteById(selection?.athlete2Id ?? match?.athlete2Id);

  const wins1 = runWins?.[1] ?? 0;
  const wins2 = runWins?.[2] ?? 0;
  const resolvedRuns = wins1 + wins2;

  const status = streamStatusFromQueries([matches, athletes], match == null || resolvedRuns === 0);
  useReportStreamStatus(status);

  if (status !== 'ready' || match == null) return null;

  return (
    <Stack sx={{ alignItems: 'center', rowGap: refVh(SUMMARY_ART.stackGap) }}>
      <Typography
        data-testid="rounds-summary-caption"
        sx={{
          fontFamily: fonts.display,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: overlayArt.bannerTracking,
          fontSize: refVh(SUMMARY_ART.caption),
        }}
      >
        {displayRoundName(match)} — Best of 3
      </Typography>
      <Stack
        data-testid="series-tally"
        direction="row"
        sx={{ alignItems: 'baseline', columnGap: refVw(SUMMARY_ART.tallyGap) }}
      >
        <TallyName athlete={athlete1} />
        <SeriesNumeral value={wins1} lead={wins1 > wins2} testId="series-wins-1" />
        <Numeral
          fontWeight={700}
          fontSize={refVh(SUMMARY_ART.numeral)}
          lineHeight={1}
          color={colors.overlay.label}
          testId="series-separator"
        >
          –
        </Numeral>
        <SeriesNumeral value={wins2} lead={wins2 > wins1} testId="series-wins-2" />
        <TallyName athlete={athlete2} />
      </Stack>
      {/* Half the VS card gap: the same lower-third family's spacing, and enough
          ground for the outset winner rim to clear the other card. */}
      <Stack
        data-testid="rounds-summary-cards"
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'center',
          columnGap: refVw(VS_ART.vsGap / 2),
        }}
      >
        <Competitor athlete={athlete1} isWinner={wins1 > wins2} />
        <Competitor athlete={athlete2} isWinner={wins2 > wins1} />
      </Stack>
    </Stack>
  );
};

/**
 * The condensed-caps name fragment anchoring its side of the tally — the card's
 * one-fragment rule (`shortName → lastName → firstName`, see `AthleteCard`).
 */
const TallyName = ({ athlete }: { athlete?: Athlete }) =>
  athlete ? (
    <Typography
      sx={{
        fontFamily: fonts.display,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: overlayArt.bannerTracking,
        fontSize: refVh(SUMMARY_ART.name),
        lineHeight: 1,
      }}
    >
      {athlete.shortName || athlete.lastName || athlete.firstName}
    </Typography>
  ) : null;

/** A best-of-3 score numeral; the leader's count goes `race.go` green. */
const SeriesNumeral = ({
  value,
  lead,
  testId,
}: {
  value: number;
  lead: boolean;
  testId: string;
}) => (
  <Numeral
    fontWeight={700}
    fontSize={refVh(SUMMARY_ART.numeral)}
    lineHeight={1}
    // The trailing count is overlay-label white, not an `ink.*` tone, which
    // vanishes keyed over dark footage on this transparent ground.
    color={lead ? colors.race.go : colors.overlay.label}
    testId={testId}
  >
    {value}
  </Numeral>
);
