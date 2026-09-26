import { Box, Stack } from '@mui/material';
import { useLocation, useParams } from 'react-router-dom';

import { useCombinedRanking, useOverallStandings, useRankings } from 'app/api/rankings';
import {
  isGender,
  isTimeRound,
  type Athlete,
  type Discipline,
  type Gender,
  type RankedAthlete,
  type TimeRound,
} from 'app/types';
import { colors, fonts, overlayArt } from 'app/theme/tokens';
import { rankLabels, serverRankLabels } from 'app/util/rankLabels';
import { standingsSourceTag } from 'app/util/rounds';
import { refVh, refVw } from 'app/util/overlayScale';
import { standingsResultLabel } from 'app/util/resultLabel';
import { Numeral } from 'app/components/Numeral';
import { RankBadge } from 'app/components/RankBadge';
import { AthleteCard } from 'app/pages/Stream/AthleteCard';
import { AthleteName } from 'app/pages/Stream/AthleteName';
import { useFitToWidth } from 'app/pages/Stream/useFitToBox';
import { FlagRow } from 'app/pages/Stream/FlagBlock';
import { Plate } from 'app/pages/Stream/Plate';
import { InvalidOverlay, StreamLayout, useReportStreamStatus } from 'app/pages/Stream/StreamLayout';
import { deriveStreamStatus } from 'app/pages/Stream/streamStatus';

/**
 * `/stream/rankings/:round/:gender?compId=&token=&variant=` — a broadcast
 * ranking overlay (top times for the round/gender) in the LAAX language: the
 * ranked field in the `variant`-selected recipe — `names` (the default:
 * display-face rank numeral left of a white plate, plates tapering by rank) or
 * `profile` (the top-4 portrait `AthleteCard` cut). Titleless, like the LAAX
 * masters. Transparent background; refreshes on `db_update`.
 *
 * The pseudo-rounds `overall` and `combined` serve the final overall standings
 * (rule G3) and the cross-discipline combined title (rule G2) through the same
 * recipes, with server-assigned ranks.
 */
export const RankingsOverlay = () => {
  const { round, gender } = useParams();
  const variant = useRankingsVariant();
  return (
    <StreamLayout>
      {({ compId, readToken, discipline }) =>
        round === 'combined' && isGender(gender) ? (
          <CombinedBody compId={compId} readToken={readToken} gender={gender} variant={variant} />
        ) : round === 'overall' && isGender(gender) ? (
          <StandingsBody
            compId={compId}
            readToken={readToken}
            gender={gender}
            discipline={discipline}
            variant={variant}
          />
        ) : isTimeRound(round) && isGender(gender) ? (
          <RankingsBody
            compId={compId}
            readToken={readToken}
            round={round}
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

export type RankingsVariant = 'names' | 'profile';

const useRankingsVariant = (): RankingsVariant => {
  const { search } = useLocation();
  return new URLSearchParams(search).get('variant') === 'profile' ? 'profile' : 'names';
};

/**
 * Reference geometry measured off the `LAAX 2026_Names top 4/8.svg` masters —
 * a provenance label, not a file in this repo; the measurement record is
 * `doc/dev/design-system/design-system.md` §7 "Rankings, name plates". Px on
 * the 1920×1080 capture frame, carried to any capture size by `refVw`/`refVh`.
 *
 * One recipe at two cuts: top-8 is top-4 uniformly scaled by `top8Scale` —
 * except `strokeWidth`, which is constant in both masters — and each row is a
 * uniform (width AND height) copy of the row above, going flat from row 5.
 */
const ART = {
  plateWidth: 828.48,
  plateHeight: 105.9,
  rowGap: 45.65,
  numeralSize: 72.68,
  // The 49.79px numeral column splits into the digit box + its gap to the plate.
  // `numeralColumn` is ONE glyph; a field is laid out at its widest label (see
  // `numeralColumnWidth`).
  numeralColumn: 35.79,
  numeralGap: 14,
  strokeWidth: 5,
  top8Scale: 626.93 / 828.48,
  taper: [1, 0.9444, 0.8953, 0.8347, 0.7779],
} as const;

const taperAt = (index: number) => ART.taper[Math.min(index, ART.taper.length - 1)];

/**
 * Freestyle results are judged points (a bare "31.0"); speed results are times
 * ("0:05.86"), self-evidently a clock. The unit rides row 1 only — enough to
 * name the column without repeating on every plate. The individual judged
 * components stay off the broadcast (overall only).
 */
const FREESTYLE_RESULT_UNIT = 'PTS';

/** The em-dash `standingsResultLabel` renders for a placement with no result yet. */
const NO_RESULT = '—';

const resultUnitAt = (discipline: Discipline | 'combined', index: number, result: string) =>
  discipline === 'freestyle' && index === 0 && result !== NO_RESULT
    ? FREESTYLE_RESULT_UNIT
    : undefined;

/**
 * The portrait-card cut, measured off the `LAAX 2026_Profile top 4.svg` master
 * (provenance label; record in design-system §7 "Rankings, profile cards"). Px
 * on the 1920×1080 capture frame. Four uniformly tapering cards share a bottom
 * edge, rank-1 at the VS panel size, and `strokeWidth` is constant across all
 * four. `unitGaps` is the measured distance from a card's right edge to the next
 * rank numeral's glyph start; `numeralGap` the residual between a numeral's
 * right edge and its card — held constant because the master's ~5–12px varies
 * with glyph width (Oswald ≠ Placard Next).
 */
const PROFILE_ART = {
  slots: [
    { width: 298.81, height: 498.02, numeralSize: 156.12 },
    { width: 254.88, height: 424.8, numeralSize: 107 },
    { width: 223.87, height: 373.11, numeralSize: 83.99 },
    { width: 196.48, height: 327.47, numeralSize: 66 },
  ],
  unitGaps: [61.25, 52.85, 39.42],
  numeralGap: 10,
  strokeWidth: 9,
} as const;

/**
 * The presentation for a single ranking (header + the `variant`-selected ranked
 * field: `names` plates or `profile` portrait cards). Exported
 * so non-`/stream` surfaces (e.g. the Cognito-gated `/freestyle/preview`
 * projector panel) can reuse the exact freestyle row rendering without
 * duplicating it. Returns `null` (paints nothing) while loading, on error, or
 * when empty, so it is safe to mount unconditionally; inside a `StreamLayout`
 * the `useReportStreamStatus` calls feed the off-air status panel (and no-op
 * elsewhere, e.g. the projector reuse).
 */
export const RankingsBody = ({
  compId,
  readToken,
  round,
  gender,
  discipline,
  variant = 'names',
}: {
  compId: string;
  readToken?: string;
  round: TimeRound;
  gender: Gender;
  discipline: Discipline;
  variant?: RankingsVariant;
}) => {
  const rankings = useRankings(compId, round, gender, { discipline, readToken });

  const isEmpty = !rankings.data || rankings.data.length === 0;
  useReportStreamStatus(deriveStreamStatus(rankings.isLoading, rankings.isError, isEmpty));

  if (rankings.isLoading || rankings.isError || isEmpty) return null;

  // The displayed result drives the equal-rank marker: rows sharing a value are
  // a tie (the server has already applied the sport tiebreaks, so an identical
  // DISPLAYED result is a genuine dead heat). Comparing the rendered string is
  // fail-safe — whatever a row shows is what decides whether it ties.
  const results = rankings.data.map((entry: RankedAthlete) =>
    standingsResultLabel(discipline, entry),
  );
  const rankNumerals = rankLabels(results);
  const rows = rankings.data.map((entry, index) => ({
    athlete: entry.athlete,
    numeral: rankNumerals[index],
    result: results[index],
    resultUnit: resultUnitAt(discipline, index, results[index]),
  }));

  return <RankedField variant={variant} rows={rows} />;
};

/**
 * The final overall standings (rule G3) through the same ranked-field recipes.
 * Numerals are the SERVER-assigned placement ranks, never `rankLabels`: a
 * standings rank is positional (a bracket outcome), so two rows with an equal
 * displayed result must not merge into an `=1` tie. A placement can predate
 * any result — that renders an em dash instead of a zero time/score.
 */
export const StandingsBody = ({
  compId,
  readToken,
  gender,
  discipline,
  variant = 'names',
}: {
  compId: string;
  readToken?: string;
  gender: Gender;
  discipline: Discipline;
  variant?: RankingsVariant;
}) => {
  const standings = useOverallStandings(compId, gender, { discipline, readToken });

  const isEmpty = !standings.data || standings.data.length === 0;
  useReportStreamStatus(deriveStreamStatus(standings.isLoading, standings.isError, isEmpty));

  if (standings.isLoading || standings.isError || isEmpty) return null;

  const rows = standings.data.map((entry, index) => {
    const result = standingsResultLabel(discipline, entry);
    return {
      athlete: entry.athlete,
      numeral: String(entry.rank),
      result,
      resultUnit: resultUnitAt(discipline, index, result),
      // The round that decided the placement — qualifies the result so a slower
      // time above a faster one reads as a bracket outcome, not a mis-sort (G3).
      sourceTag: standingsSourceTag(entry.source),
    };
  });

  return <RankedField variant={variant} rows={rows} />;
};

/**
 * The combined title (rule G2) through the same ranked-field recipes: the
 * cross-discipline average IS the displayed result (1 decimal; `.5` is the
 * norm), and the numerals are the SERVER-assigned 1224-style shared ranks with
 * `=` on repeats — never `rankLabels` over averages (a shared combined rank is
 * the server's tie call, not a display-string coincidence).
 */
export const CombinedBody = ({
  compId,
  readToken,
  gender,
  variant = 'names',
}: {
  compId: string;
  readToken?: string;
  gender: Gender;
  variant?: RankingsVariant;
}) => {
  const combined = useCombinedRanking(compId, gender, { readToken });

  const isEmpty = !combined.data || combined.data.length === 0;
  useReportStreamStatus(deriveStreamStatus(combined.isLoading, combined.isError, isEmpty));

  if (combined.isLoading || combined.isError || isEmpty) return null;

  const numerals = serverRankLabels(combined.data.map((entry) => entry.rank));
  const rows = combined.data.map((entry, index) => ({
    athlete: entry.athlete,
    numeral: numerals[index],
    result: entry.combined.toFixed(1),
  }));

  return <RankedField variant={variant} rows={rows} />;
};

/** One rendered row of a ranked field: identity, precomputed rank numeral + result. */
interface RankedRow {
  athlete: Athlete;
  numeral: string;
  result: string;
  /** Freestyle top row only: the points unit microlabel riding the result
   *  (both the names plate and the profile card). */
  resultUnit?: string;
  /** Standings only: the round that placed this row (rule G3 result context). */
  sourceTag?: string;
}

/**
 * The shared ranked-field presentation: the `variant`-selected recipe, titleless
 * like the LAAX masters.
 */
const RankedField = ({ variant, rows }: { variant: RankingsVariant; rows: RankedRow[] }) => (
  // The ranked plates sit LOWER-LEFT. Inside the flex-column StreamLayout the
  // growing column bottom-anchors the rows against the frame edge; the top
  // padding reserves headroom above a full-length (top-8) field. In a block parent (the
  // freestyle projector panel) `flexGrow` is inert and the rows sit in-flow.
  <Box
    sx={{
      width: '100%',
      flexGrow: 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      pt: 6,
    }}
  >
    {variant === 'profile' ? (
      // The Profile-top-4 cut (geometry in PROFILE_ART).
      <Stack direction="row" sx={{ alignItems: 'flex-end' }}>
        {rows.slice(0, PROFILE_ART.slots.length).map((row, index) => {
          const slot = PROFILE_ART.slots[index];
          return (
            <Stack
              key={row.athlete.athleteId}
              direction="row"
              sx={{
                alignItems: 'flex-end',
                columnGap: refVw(PROFILE_ART.numeralGap),
                ml: index > 0 ? refVw(PROFILE_ART.unitGaps[index - 1]) : 0,
              }}
            >
              <RankBadge label={row.numeral} fontSize={refVh(slot.numeralSize)} />
              <Box
                data-testid="ranking-profile-slot"
                sx={{ width: refVw(slot.width), height: refVh(slot.height) }}
              >
                <AthleteCard
                  athlete={row.athlete}
                  result={row.result}
                  resultUnit={row.resultUnit}
                  sourceTag={row.sourceTag}
                  edgeWidth={refVh(PROFILE_ART.strokeWidth)}
                />
              </Box>
            </Stack>
          );
        })}
      </Stack>
    ) : (
      <NameRows rows={rows} />
    )}
  </Box>
);

/** The `Names top 4/8` recipe caps at 8 rows — the largest cut the art defines. */
const NAMES_MAX_ROWS = 8;

/**
 * The rank numeral column for a whole field: the art's one-glyph digit box times
 * the widest label in it (a tie renders `=1`, two glyphs). Sizing it ONCE per
 * field and applying it to every row keeps the plates on a single left edge —
 * the reason the box was fixed in the first place — while the widest numeral
 * now starts inside the title-safe inset instead of overflowing leftward out of
 * it. A field with no ties is one glyph wide, i.e. the art's own geometry.
 */
const numeralColumnWidth = (rows: RankedRow[]): number =>
  ART.numeralColumn * Math.max(1, ...rows.map((row) => row.numeral.length));

/** The distinct source tags a field carries — the candidates each row's tag
 *  column reserves room for (see {@link SourceTag}). */
const fieldSourceTags = (rows: RankedRow[]): string[] => [
  ...new Set(rows.flatMap((row) => (row.sourceTag === undefined ? [] : [row.sourceTag]))),
];

/** The names-variant ranked rows (the `Names top 4/8` recipe — see `ART`). */
const NameRows = ({ rows }: { rows: RankedRow[] }) => {
  const topRows = rows.slice(0, NAMES_MAX_ROWS);
  const artScale = topRows.length <= 4 ? 1 : ART.top8Scale;
  const numeralColumn = numeralColumnWidth(topRows);
  const sourceTags = fieldSourceTags(topRows);
  return (
    <Stack sx={{ alignItems: 'flex-start', gap: refVh(ART.rowGap * artScale) }}>
      {topRows.map((row, index) => (
        <NameRow
          key={row.athlete.athleteId}
          row={row}
          artScale={artScale}
          index={index}
          numeralColumn={numeralColumn}
          sourceTags={sourceTags}
        />
      ))}
    </Stack>
  );
};

/** A single Names-recipe row: rank numeral column + the tapered white plate. */
const NameRow = ({
  row,
  artScale,
  index,
  numeralColumn,
  sourceTags,
}: {
  row: RankedRow;
  artScale: number;
  index: number;
  /** The field's shared rank-numeral column width (see {@link numeralColumnWidth}). */
  numeralColumn: number;
  /** Every source tag in the field, so each row reserves the same tag column. */
  sourceTags: string[];
}) => {
  const { slotRef, nameRef, fit } = useFitToWidth();
  const plateHeight = ART.plateHeight * artScale * taperAt(index);
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'stretch',
        height: refVh(plateHeight),
        columnGap: refVw(ART.numeralGap * artScale),
      }}
    >
      <Box
        data-testid="ranking-numeral-col"
        sx={{
          // The FIELD's digit-box width, identical on every row, so the plates
          // keep one left edge whatever a given row's label is. minWidth:0
          // defeats the flex item's min-content floor that would re-grow it.
          flex: '0 0 auto',
          width: refVw(numeralColumn * artScale),
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        <RankBadge label={row.numeral} fontSize={refVh(ART.numeralSize * artScale)} />
      </Box>
      <Plate
        data-testid="ranking-plate"
        // A ranked row is always a FILLED content plate → solid white fill
        // with near-black ink, per the two-tier rule (the bracket name-plate
        // fix). White-on-translucent-white was illegible on camera.
        fill={colors.overlay.plateFilled}
        strokeWidth={refVh(ART.strokeWidth)}
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          width: refVw(ART.plateWidth * artScale * taperAt(index)),
          color: colors.overlay.nameInk,
          // Dark ink on a white plate → cancel the inherited StreamLayout
          // footage shadow (the rank numeral outside the plate keeps it).
          textShadow: 'none',
          overflow: 'hidden',
        }}
      >
        {/* Full-height flag block flush to the plate edge — the populated
            Names treatment of the delivered masters, square like the
            SVO strip. vh width = vh height keeps it square. */}
        <FlagRow
          athlete={row.athlete}
          testId="ranking-flag-strip"
          square
          sx={{ height: '100%', flexShrink: 0 }}
          itemSx={{ height: '100%', width: refVh(plateHeight), flexShrink: 0 }}
        />
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            flex: 1,
            minWidth: 0,
            justifyContent: 'space-between',
            px: '0.4em',
            fontSize: refVh(plateHeight * 0.55),
          }}
        >
          {/* A long name shrinks to fit the plate (measured uniform down-scale,
              `useFitToWidth` — same treatment as the profile cards) instead of
              ellipsizing, so the whole name stays legible on camera. The slot
              keeps overflow:hidden as a fail-safe; the mono result is pinned
              (flexShrink:0) so it never overruns the plate edge and gets swallowed
              by Plate's overflow:hidden (rankings-name-result-clip). */}
          <Box ref={slotRef} sx={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex' }}>
            <Box
              ref={nameRef}
              data-testid="ranking-name-fit"
              sx={{
                width: 'max-content',
                maxWidth: 'none',
                transform: `scale(${fit})`,
                transformOrigin: 'left center',
              }}
            >
              <AthleteName athlete={row.athlete} />
            </Box>
          </Box>
          <Stack
            direction="row"
            sx={{ alignItems: 'baseline', columnGap: '0.5em', ml: '0.5em', flexShrink: 0 }}
          >
            {row.sourceTag !== undefined && (
              <SourceTag tag={row.sourceTag} candidates={sourceTags} />
            )}
            <Numeral fontWeight={700} fontSize="0.82em" testId="ranking-result">
              {row.result}
            </Numeral>
            {/* Points unit on the top freestyle row (see resultUnitAt) — the
                same subordinate display-caps treatment as the source tag, so
                the bare score reads as points, not a time. */}
            {row.resultUnit !== undefined && (
              <Box
                component="span"
                data-testid="ranking-result-unit"
                sx={{
                  fontFamily: fonts.display,
                  fontWeight: 500,
                  fontSize: '0.5em',
                  letterSpacing: overlayArt.headingTracking,
                  whiteSpace: 'nowrap',
                  opacity: 0.6,
                }}
              >
                {row.resultUnit}
              </Box>
            )}
          </Stack>
        </Stack>
      </Plate>
    </Stack>
  );
};

/**
 * The placing-round tag left of a standings result, in the display caps face at
 * a subordinate size/weight so the number reads as "best time from the round
 * that placed them" (rule G3).
 *
 * Content-sized, a long tag ('SMALL FINAL') stole plate width from its own row
 * only — `useFitToWidth` then shrank that row's name and the taper read
 * non-monotonic (rank 4 smaller than rank 5). So the box reserves the FIELD's
 * widest tag on every row: each `candidates` tag is laid out hidden in the same
 * grid cell as the visible one, which makes the column intrinsically the widest
 * of them with no measurement pass — every row surrenders the same width and
 * the name fit varies only with the name.
 */
const SourceTag = ({ tag, candidates }: { tag: string; candidates: string[] }) => (
  <Box
    data-testid="ranking-source-tag-col"
    sx={{
      display: 'grid',
      justifyItems: 'end',
      fontFamily: fonts.display,
      fontWeight: 500,
      fontSize: '0.5em',
      letterSpacing: overlayArt.headingTracking,
      whiteSpace: 'nowrap',
      opacity: 0.6,
    }}
  >
    {candidates.map((candidate) => (
      <Box
        key={candidate}
        component="span"
        aria-hidden
        data-testid="ranking-source-tag-sizer"
        sx={{ gridArea: '1 / 1', visibility: 'hidden' }}
      >
        {candidate}
      </Box>
    ))}
    <Box component="span" data-testid="ranking-source-tag" sx={{ gridArea: '1 / 1' }}>
      {tag}
    </Box>
  </Box>
);
