import { Box, Stack } from '@mui/material';
import { useParams } from 'react-router-dom';

import { useRankings } from 'app/api/rankings';
import { isGender, isMatchRound, type Athlete, type Gender, type MatchRound } from 'app/types';
import { colors, fonts, overlayArt } from 'app/theme/tokens';
import { rankLabels } from 'app/util/rankLabels';
import { freestyleResultLabel } from 'app/util/resultLabel';
import { refVh, refVw } from 'app/util/overlayScale';
import { RankBadge } from 'app/components/RankBadge';
import { AthleteName } from 'app/pages/Stream/AthleteName';
import { FlagRow } from 'app/pages/Stream/FlagBlock';
import { Plate } from 'app/pages/Stream/Plate';
import { ScoreCell, type ScoreCellKind } from 'app/pages/Stream/ScoreCell';
import {
  QUALIFICATION_HIDDEN,
  freestyleCellValue,
  type FreestyleCellKey,
} from 'app/pages/Stream/freestyleScore';
import { InvalidOverlay, StreamLayout, useReportStreamStatus } from 'app/pages/Stream/StreamLayout';
import { deriveStreamStatus } from 'app/pages/Stream/streamStatus';
import { useFitToWidth } from 'app/pages/Stream/useFitToBox';

/**
 * `/stream/scorecard/:round/:gender?compId=&token=` — the freestyle judged
 * score card (`LAAX 2026_freestyle_scoreCard.svg`): the round's ranked field
 * with the full component breakdown — TOTAL, TRICK DIFFICULTY, COMBO, STYLE,
 * CONTROL PENALTY, BEST TRICK — one row per scored athlete. Inherently
 * freestyle (there is nothing to break down on the speed plane), so the fetch
 * pins `discipline=freestyle` regardless of the URL's `?discipline=`. Built for
 * the battle rounds (quarter / half / small final / final); any match round is
 * accepted and the field caps at the art's 8 rows. Titleless, transparent
 * background; refreshes on `db_update`.
 *
 * The **qualification** round is judged without a control penalty or best trick,
 * so its card drops those two columns and spreads the freed width across the
 * surviving component boxes (see {@link layoutColumns}); every other round keeps
 * the full six-column art.
 */
export const ScoreCardOverlay = () => {
  const { round, gender } = useParams();
  return (
    <StreamLayout>
      {({ compId, readToken }) =>
        isMatchRound(round) && isGender(gender) ? (
          <ScoreCardBody compId={compId} readToken={readToken} round={round} gender={gender} />
        ) : (
          <InvalidOverlay />
        )
      }
    </StreamLayout>
  );
};

/**
 * Reference geometry measured off the `LAAX 2026_freestyle_scoreCard.svg`
 * master — a provenance label, not a file in this repo; the measurement record
 * is `doc/dev/design-system/design-system.md` §7 "Freestyle score card". Px on
 * the 1920×1080 capture frame, carried to any capture size by `refVw`/`refVh`.
 */
const ART = {
  rowHeight: 56.79,
  rowGap: 32.18, // 88.97 pitch − the row height
  strokeWidth: 5,
  rankSize: 50.1,
  // The 34.32px between the rank glyph start (x 83.63) and the plate (x 117.95),
  // split digit-box + gap like the rankings recipe. `rankColumn` is ONE glyph;
  // a field is laid out at its widest label (see `rankColumnWidth`) so every
  // plate keeps the same left edge and no numeral escapes the title-safe inset.
  rankColumn: 20.32,
  rankGap: 14,
  nameWidth: 444.26,
  valueSize: 36.44, // Montserrat-Bold in the art → the house numeral face
  headerSize: 40,
  totalHeaderSize: 70.07,
  headerGap: 14.4, // last header baseline (280.63) → first row top (295.06)
  maxRows: 8,
} as const;

/**
 * The value columns in art order. `gap` is the measured distance from the
 * previous box's right edge — the master's inter-column gaps are deliberately
 * irregular, so each column carries its own; `kind` selects the shared cell chrome (`ScoreCell`)
 * — the solid near-black TOTAL box, the two-tier component boxes, and the solid
 * CONTROL PENALTY box. The art washes that penalty box at ~28% alpha; it is
 * drawn solid here, as the VS table already does, so the white digits sit on a
 * saturated ground over bright footage (one penalty language, two surfaces).
 */
const COLUMNS = [
  { key: 'total', header: ['TOTAL'], gap: 39.66, width: 194.82, kind: 'total' },
  {
    key: 'difficulty',
    header: ['TRICK', 'DIFFICULTY'],
    gap: 28.36,
    width: 166.88,
    kind: 'component',
  },
  { key: 'combo', header: ['COMBO'], gap: 42.63, width: 166.88, kind: 'component' },
  { key: 'style', header: ['STYLE'], gap: 41.72, width: 166.88, kind: 'component' },
  {
    key: 'controlPenalty',
    header: ['CONTROL', 'PENALTY'],
    gap: 34.95,
    width: 166.88,
    kind: 'penalty',
  },
  { key: 'bestTrick', header: ['BEST', 'TRICK'], gap: 35.89, width: 166.88, kind: 'component' },
] as const;

// The displayed column keys ARE the shared freestyle cell keys — the master's
// six columns cover every cell — so the layout speaks `freestyleScore`'s
// vocabulary directly.
type ColumnKey = FreestyleCellKey;

/** A displayed column: the master's spec with a mutable `gap` so a reduced-
 *  column round can be re-spaced (see {@link layoutColumns}). */
type DisplayColumn = {
  key: ColumnKey;
  header: readonly string[];
  gap: number;
  width: number;
  kind: ScoreCellKind;
};

/**
 * The columns to render for a round, with gaps adapted to fill the frame. Every
 * round but qualification gets the full six-column art unchanged. Qualification
 * drops the hidden columns and pushes the freed horizontal width into the gaps
 * *between* the surviving component boxes — the TOTAL box stays anchored to the
 * name plate and the last box's right edge lands exactly where the full card's
 * did, so box and numeral sizes stay identical across both card variants.
 */
const layoutColumns = (round: MatchRound): DisplayColumn[] => {
  const shown: DisplayColumn[] = COLUMNS.filter(
    (column) => round !== 'qualification' || !QUALIFICATION_HIDDEN.includes(column.key),
  ).map((column) => ({ ...column }));
  if (shown.length === COLUMNS.length) return shown;

  const span = (columns: readonly DisplayColumn[]) =>
    columns.reduce((sum, column) => sum + column.gap + column.width, 0);
  const extra = (span(COLUMNS) - span(shown)) / (shown.length - 1);
  return shown.map((column, index) =>
    index === 0 ? column : { ...column, gap: column.gap + extra },
  );
};

/**
 * The rank column for a whole field: the art's one-glyph box times the widest
 * label in it (a tie renders `=N`, two glyphs). One width for every row keeps
 * the name plates on a single left edge, and the field's widest numeral starts
 * inside the title-safe inset instead of overflowing leftward out of the box.
 */
const rankColumnWidth = (numerals: string[]): number =>
  ART.rankColumn * Math.max(1, ...numerals.map((numeral) => numeral.length));

const ScoreCardBody = ({
  compId,
  readToken,
  round,
  gender,
}: {
  compId: string;
  readToken?: string;
  round: MatchRound;
  gender: Gender;
}) => {
  const rankings = useRankings(compId, round, gender, { discipline: 'freestyle', readToken });

  const isEmpty = !rankings.data || rankings.data.length === 0;
  useReportStreamStatus(deriveStreamStatus(rankings.isLoading, rankings.isError, isEmpty));

  if (rankings.isLoading || rankings.isError || isEmpty) return null;

  const field = rankings.data.slice(0, ART.maxRows);
  // Rows sharing a displayed total tie (`=N`) — the same fail-safe displayed-
  // string rule as the ranking plates.
  const numerals = rankLabels(field.map((entry) => freestyleResultLabel(entry)));
  const rankColumn = rankColumnWidth(numerals);
  const columns = layoutColumns(round);

  return (
    <Box sx={{ width: '100%' }}>
      <HeaderRow columns={columns} rankColumn={rankColumn} />
      <Stack sx={{ gap: refVh(ART.rowGap) }}>
        {field.map((entry, index) => (
          <Stack
            key={entry.athlete.athleteId}
            direction="row"
            sx={{ alignItems: 'stretch', height: refVh(ART.rowHeight) }}
          >
            <Box
              data-testid="scorecard-rank-col"
              sx={{
                flex: '0 0 auto',
                width: refVw(rankColumn),
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                mr: refVw(ART.rankGap),
              }}
            >
              <RankBadge label={numerals[index]} fontSize={refVh(ART.rankSize)} />
            </Box>
            <NamePlate entry={entry} />
            {columns.map((column) => (
              <ScoreCell
                key={column.key}
                data-testid={`scorecard-cell-${column.key}`}
                value={freestyleCellValue(column.key, entry)}
                kind={column.kind}
                strokeWidth={refVh(ART.strokeWidth)}
                fontSize={refVh(ART.valueSize)}
                sx={{ ml: refVw(column.gap), width: refVw(column.width) }}
              />
            ))}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
};

/** The column headers, bottom-aligned over their value boxes like the master
 *  (TOTAL at display scale, the rest 40px, two-line where the art stacks). Takes
 *  the same adapted columns as the rows so the headers track the reduced-column
 *  spacing. */
const HeaderRow = ({ columns, rankColumn }: { columns: DisplayColumn[]; rankColumn: number }) => (
  <Stack
    direction="row"
    sx={{
      alignItems: 'flex-end',
      mb: refVh(ART.headerGap),
      fontFamily: fonts.display,
      fontWeight: 500,
      letterSpacing: overlayArt.headingTracking,
      lineHeight: 1.025,
    }}
  >
    {/* The rank column + name plate carry no header in the art — a spacer keeps
        the header boxes on the value-column grid. */}
    <Box
      data-testid="scorecard-header-spacer"
      sx={{ width: refVw(rankColumn + ART.rankGap + ART.nameWidth), flexShrink: 0 }}
    />
    {columns.map((column) => (
      <Box
        key={column.key}
        sx={{
          ml: refVw(column.gap),
          width: refVw(column.width),
          flexShrink: 0,
          textAlign: 'center',
          fontSize: refVh(column.key === 'total' ? ART.totalHeaderSize : ART.headerSize),
        }}
      >
        {column.header.map((line) => (
          <Box key={line} component="span" sx={{ display: 'block' }}>
            {line}
          </Box>
        ))}
      </Box>
    ))}
  </Stack>
);

/** The populated name plate: solid white + near-black ink per the two-tier rule
 *  (the art's translucent boxes are the EMPTY placeholder state), with the
 *  square flag strip and shrink-to-fit name of the ranking recipe. */
const NamePlate = ({ entry }: { entry: { athlete: Athlete } }) => {
  const { slotRef, nameRef, fit } = useFitToWidth();
  return (
    <Plate
      data-testid="scorecard-name-plate"
      fill={colors.overlay.plateFilled}
      strokeWidth={refVh(ART.strokeWidth)}
      sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        width: refVw(ART.nameWidth),
        color: colors.overlay.nameInk,
        // Dark ink on a white plate → cancel the inherited footage shadow.
        textShadow: 'none',
        overflow: 'hidden',
      }}
    >
      <FlagRow
        athlete={entry.athlete}
        testId="scorecard-flag-strip"
        square
        sx={{ height: '100%', flexShrink: 0 }}
        itemSx={{ height: '100%', width: refVh(ART.rowHeight), flexShrink: 0 }}
      />
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
          px: '0.4em',
          fontSize: refVh(ART.rowHeight * 0.55),
        }}
      >
        <Box ref={slotRef} sx={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex' }}>
          <Box
            ref={nameRef}
            data-testid="scorecard-name-fit"
            sx={{
              width: 'max-content',
              maxWidth: 'none',
              transform: `scale(${fit})`,
              transformOrigin: 'left center',
            }}
          >
            <AthleteName athlete={entry.athlete} />
          </Box>
        </Box>
      </Box>
    </Plate>
  );
};
