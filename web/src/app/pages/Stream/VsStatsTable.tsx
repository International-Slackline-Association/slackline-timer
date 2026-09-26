import { Box, Stack } from '@mui/material';

import { type MatchRound, type Score } from 'app/types';
import { colors, fonts, overlayArt } from 'app/theme/tokens';
import { refVh, refVw } from 'app/util/overlayScale';
import { formatMs } from 'app/util/time';
import { ScoreCell, type ScoreCellKind } from 'app/pages/Stream/ScoreCell';
import { freestyleCellValue, isFreestyleCellShown } from 'app/pages/Stream/freestyleScore';

/**
 * The per-athlete stats panel that flanks each `VsMatchup` photo card, a
 * transcription of the outer tables in `LAAX 2026_vs speed.svg` /
 * `LAAX 2026_vs freestyle.svg`. One table per competitor:
 *
 * - **speed** — RUN 1/2/3 best-of-3 lap times, filling in live as each run is
 *   recorded (`updates during the match`); an unrun slot stays an empty
 *   translucent box, a DNF run renders `DNF`;
 * - **freestyle** — the judged component breakdown (trick difficulty, combo,
 *   style, control penalty, best trick) plus the TOTAL, with the same per-round
 *   column rule as the score card (qualification drops the two battle-only
 *   components — `isFreestyleCellShown`).
 *
 * The composition is symmetric: values sit on the OUTER edge (toward the frame),
 * labels on the INNER edge (toward the photo), so the left table mirrors the
 * right (`side`). Geometry is the art's 1920×1080 metrics via `refVw`/`refVh`;
 * the container is the photo card's height so the flex row centres the shorter
 * speed block against the card exactly as the mock does.
 */

/** Art metrics, px on the 1920×1080 capture frame (measurement record:
 *  `doc/dev/design-system/design-system.md` §7 "VS head-to-head"). The table
 *  container matches the photo card's height so the row group centres within. */
const CARD_H = 498.02;
const TABLE_W = 400;
const CELL_STROKE = 5; // the value-box border path is ~5px on the reference

const SPEED = {
  rowH: 57,
  rowGap: 13, // 70px pitch − row height
  valW: 233.96,
  valH: 56.79,
  valueSize: 36.44,
  labelSize: 32,
} as const;

const FS = {
  rowH: 57,
  rowGap: 13,
  valW: 166.88,
  valH: 56.79,
  valueSize: 36.44,
  labelSize: 32,
  penaltyLabelSize: 25, // the art sets CONTROL PENALTY smaller so the long label fits
  totalGap: 10.59, // last component row bottom → TOTAL box top
  totalW: 194.82,
  totalH: 86.39,
  totalValueSize: 40,
  totalLabelSize: 62.61,
} as const;

type Side = 'left' | 'right';

/** The container the two disciplines share. `justifyContent center` keeps the
 *  (variable-length) body centred against the card height. */
const StatsShell = ({ side, children }: { side: Side; children: React.ReactNode }) => (
  <Box
    data-testid={`vs-stats-${side}`}
    sx={{
      width: refVw(TABLE_W),
      height: refVh(CARD_H),
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    }}
  >
    {children}
  </Box>
);

/**
 * One stat row: a full-width backing band with the value box on the outer edge
 * and the label on the inner edge (mirrored by `side`). An absent `value`
 * (`null`) leaves the box empty rather than printing a placeholder zero — the
 * same fail-safe-blank rule the VS card follows for a missing result; the cell's
 * own two-tier chrome is `ScoreCell`'s.
 */
const StatRow = ({
  side,
  rowH,
  valW,
  valH,
  valueSize,
  labelSize,
  label,
  value,
  kind,
  testId,
  strip = true,
}: {
  side: Side;
  rowH: number;
  valW: number;
  valH: number;
  valueSize: number;
  labelSize: number;
  label: string;
  value: string | null;
  kind: ScoreCellKind;
  testId: string;
  /** Draw the translucent backing band behind the row. The TOTAL row is a bare
   *  solid box in the art, so it opts out. */
  strip?: boolean;
}) => (
  <Box
    sx={{
      width: '100%',
      height: refVh(rowH),
      backgroundColor: strip ? colors.overlay.plateStrip : undefined,
      display: 'flex',
      flexDirection: side === 'left' ? 'row' : 'row-reverse',
      alignItems: 'center',
    }}
  >
    <ScoreCell
      data-testid={testId}
      value={value}
      kind={kind}
      strokeWidth={refVh(CELL_STROKE)}
      fontSize={refVh(valueSize)}
      sx={{ width: refVw(valW), height: refVh(valH), flexShrink: 0 }}
    />
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: refVw(6),
        textAlign: side === 'left' ? 'right' : 'left',
        fontFamily: fonts.display,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: overlayArt.headingTracking,
        fontSize: refVh(labelSize),
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  </Box>
);

/** Speed table: RUN 1/2/3 best-of-3 lap times. `runs` is exactly three slots
 *  (`null` = not yet run); a DNF run carries the `DNF` label via `formatMs`. */
export const VsSpeedStatsTable = ({ side, runs }: { side: Side; runs: (number | null)[] }) => (
  <StatsShell side={side}>
    <Stack sx={{ gap: refVh(SPEED.rowGap) }}>
      {[0, 1, 2].map((i) => (
        <StatRow
          key={i}
          side={side}
          rowH={SPEED.rowH}
          valW={SPEED.valW}
          valH={SPEED.valH}
          valueSize={SPEED.valueSize}
          labelSize={SPEED.labelSize}
          label={`RUN ${i + 1}`}
          value={runs[i] == null ? null : formatMs(runs[i] as number)}
          kind="component"
          testId={`vs-cell-run-${i + 1}`}
        />
      ))}
    </Stack>
  </StatsShell>
);

/** The freestyle component rows in art order (top → bottom, TOTAL rendered
 *  separately below). CONTROL PENALTY is the art's solid stop-red box and takes
 *  a smaller label; the rest are two-tier component cells (`ScoreCell`). */
const FS_ROWS = [
  { key: 'difficulty', label: 'TRICK DIFFICULTY', labelSize: FS.labelSize, kind: 'component' },
  { key: 'combo', label: 'COMBO', labelSize: FS.labelSize, kind: 'component' },
  { key: 'style', label: 'STYLE', labelSize: FS.labelSize, kind: 'component' },
  {
    key: 'controlPenalty',
    label: 'CONTROL PENALTY',
    labelSize: FS.penaltyLabelSize,
    kind: 'penalty',
  },
  { key: 'bestTrick', label: 'BEST TRICK', labelSize: FS.labelSize, kind: 'component' },
] as const;

/** Freestyle table: the judged breakdown + TOTAL. `entry` is null when the
 *  athlete has no score yet (every box stays empty); otherwise cells render the
 *  2-dp component values, or `—` across the board on a DNF (`freestyleCellValue`).
 *  Columns adapt to the round (qualification omits the two battle-only cells). */
export const VsFreestyleStatsTable = ({
  side,
  round,
  entry,
}: {
  side: Side;
  round: MatchRound;
  entry: { dnf?: boolean; overall?: number | null; score?: Score } | null;
}) => (
  <StatsShell side={side}>
    <Stack sx={{ gap: refVh(FS.rowGap) }}>
      {FS_ROWS.filter((row) => isFreestyleCellShown(row.key, round)).map((row) => (
        <StatRow
          key={row.key}
          side={side}
          rowH={FS.rowH}
          valW={FS.valW}
          valH={FS.valH}
          valueSize={FS.valueSize}
          labelSize={row.labelSize}
          label={row.label}
          value={entry ? freestyleCellValue(row.key, entry) : null}
          kind={row.kind}
          testId={`vs-cell-${row.key}`}
        />
      ))}
    </Stack>
    {/* TOTAL: the wider, taller near-black box the art anchors at the foot. */}
    <Box sx={{ mt: refVh(FS.totalGap) }}>
      <StatRow
        side={side}
        rowH={FS.totalH}
        valW={FS.totalW}
        valH={FS.totalH}
        valueSize={FS.totalValueSize}
        labelSize={FS.totalLabelSize}
        label="TOTAL"
        value={entry ? freestyleCellValue('total', entry) : null}
        kind="total"
        testId="vs-cell-total"
        strip={false}
      />
    </Box>
  </StatsShell>
);
