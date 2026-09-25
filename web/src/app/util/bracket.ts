import type { Match, MatchRound } from 'app/types';

/**
 * Athlete-slot identity for the playoff8 broadcast bracket: a fixed 8-athlete
 * single-elimination tree (quarter → semi → final + a bronze match). Each named
 * slot binds a match (round + 1-based order) to one athlete side; the box ids +
 * their (round, order, side) wiring are ported from timertimer's
 * `athlete_box_mappings`. The rendered geometry lives in the tree layouts below
 * (`nameTreeLayout` / `profileTreeLayout`), keyed off these same ids. Pure +
 * tested; `PlayoffBracket.tsx` renders it.
 */

/** A named slot bound to a match (round + 1-based order) and one athlete side. */
export interface BracketSlot {
  boxId: string;
  round: MatchRound;
  order: number;
  side: 'athlete1Id' | 'athlete2Id';
}

export const BRACKET_SLOTS: readonly BracketSlot[] = [
  { boxId: 'box_a_1', round: 'quarter', order: 1, side: 'athlete1Id' },
  { boxId: 'box_a_3', round: 'quarter', order: 1, side: 'athlete2Id' },
  { boxId: 'box_a_5', round: 'quarter', order: 2, side: 'athlete1Id' },
  { boxId: 'box_a_7', round: 'quarter', order: 2, side: 'athlete2Id' },
  { boxId: 'box_a_2', round: 'quarter', order: 3, side: 'athlete1Id' },
  { boxId: 'box_a_4', round: 'quarter', order: 3, side: 'athlete2Id' },
  { boxId: 'box_a_6', round: 'quarter', order: 4, side: 'athlete1Id' },
  { boxId: 'box_a_8', round: 'quarter', order: 4, side: 'athlete2Id' },
  { boxId: 'box_q_1_3', round: 'half', order: 1, side: 'athlete1Id' },
  { boxId: 'box_q_5_7', round: 'half', order: 1, side: 'athlete2Id' },
  { boxId: 'box_q_2_4', round: 'half', order: 2, side: 'athlete1Id' },
  { boxId: 'box_q_6_8', round: 'half', order: 2, side: 'athlete2Id' },
  { boxId: 'box_final_l', round: 'final', order: 1, side: 'athlete1Id' },
  { boxId: 'box_final_r', round: 'final', order: 1, side: 'athlete2Id' },
  { boxId: 'box_sfinal_l', round: 'small_final', order: 1, side: 'athlete1Id' },
  { boxId: 'box_small_r', round: 'small_final', order: 1, side: 'athlete2Id' },
];

/**
 * A right-angle elbow connector as a 7-point SVG polyline: a pair of sources at
 * `(fromX, topY)` / `(fromX, botY)` feed inward through their mid-x and merge
 * into the target at `(toX, toY)`. Shared by both tree layouts.
 */
const elbow = (
  fromX: number,
  topY: number,
  botY: number,
  toX: number,
  toY: number,
): readonly (readonly [number, number])[] => {
  const mid = (fromX + toX) / 2;
  return [
    [fromX, topY],
    [mid, topY],
    [mid, botY],
    [fromX, botY],
    [mid, botY], // re-anchor for the horizontal run into the target
    [mid, toY],
    [toX, toY],
  ];
};

export interface ResolvedSlot extends BracketSlot {
  athleteId?: string;
  isWinner: boolean;
}

/**
 * The single-direction "name" bracket layout (LAAX broadcast `Name Brackets`
 * reference): a left→right tree with no background art — section labels, name
 * plates and connector elbows are all drawn in JSX over the transparent
 * overlay. This is geometry only (percentages of a 16:9 canvas), kept separate
 * from the mirrored `BRACKET_SLOTS` art so the "profile" variant and its parity
 * tests are untouched.
 *
 * Plates are bound to resolved athletes by `boxId` (quarter/half/final reuse
 * the same ids as `BRACKET_SLOTS`); the `winner` plate has no slot — it carries
 * the final's `winnerId`.
 */
export interface NamePlate {
  /** `BRACKET_SLOTS` boxId for athlete binding, or `'winner'` for the champion plate. */
  boxId: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

export interface NameLabel {
  text: string;
  /** Center point (% of canvas). */
  xPct: number;
  yPct: number;
  /** Font size as a fraction of canvas height (cap height scale). */
  sizePct: number;
  /** −90 renders the label sideways (QUARTER FINALS). */
  rotate?: number;
}

export interface NameTreeLayout {
  plates: readonly NamePlate[];
  labels: readonly NameLabel[];
  /** Connector elbows as SVG polyline point lists (each `[ [x%,y%], … ]`). */
  connectors: readonly (readonly (readonly [number, number])[])[];
}

/**
 * One shared vertical recentre for both trees. Both arts were framed with an
 * empty top quarter (an event-logo slot that no longer exists) and captions
 * running into the bottom 1.5%, so the measured geometry hangs bottom-heavy and
 * breaks the 5% title-safe rule (design-system §7.5). This shifts the WHOLE
 * tree — boxes, label bands and connector coordinates alike — so its bounding
 * box centres on the canvas, leaving every relative percentage the art encodes
 * untouched. The admin preview and the overlay therefore stay one tree.
 */
const recentreTree = <B extends NamePlate>(tree: {
  boxes: readonly B[];
  labels: readonly NameLabel[];
  connectors: readonly (readonly (readonly [number, number])[])[];
}) => {
  // A label's painted band is its centre ± half its cap size.
  const tops = [
    ...tree.boxes.map((b) => b.topPct),
    ...tree.labels.map((l) => l.yPct - (l.sizePct * 100) / 2),
  ];
  const bottoms = [
    ...tree.boxes.map((b) => b.topPct + b.heightPct),
    ...tree.labels.map((l) => l.yPct + (l.sizePct * 100) / 2),
  ];
  const shift = 50 - (Math.min(...tops) + Math.max(...bottoms)) / 2;
  return {
    boxes: tree.boxes.map((b) => ({ ...b, topPct: b.topPct + shift })),
    labels: tree.labels.map((l) => ({ ...l, yPct: l.yPct + shift })),
    connectors: tree.connectors.map((run) => run.map(([x, y]) => [x, y + shift] as const)),
  };
};

// Geometry measured off `LAAX 2026_Name Brackets.svg` in the client-delivered
// LAAX 2026 master art (not part of this repo; the measurements are recorded in
// design-system §7 "Overlay reference geometry"), converted
// from the art's 1920×1080 frame to canvas percentages. Every plate is the same
// 390.54×49.92 bar — quarters, all FOUR semi-finalists, finals, winner and the
// small-final trio alike; pairs feed inward through white elbow connectors.
const artX = (px: number): number => (px / 1920) * 100;
const artY = (px: number): number => (px / 1080) * 100;

const PLATE_W = artX(390.54);
const PLATE_H = artY(49.92);

// Column left edges.
const Q_X = artX(106.33);
const SEMI_X = artX(561.98);
const FINAL_X = artX(1014.35);
const WIN_X = artX(1466.73);

// Each semi plate sits at its quarter pair's midpoint; a pair's two plates
// straddle that center by half the art's 68.47px center-to-center gap. Finals
// and winner are the successive pair midpoints (matches the art to <0.01%).
const SEMI_CENTERS = [artY(287.57), artY(485.7), artY(683.83), artY(881.95)] as const;
const PAIR_GAP = artY(68.47) / 2;
const qTop = (c: number) => c - PAIR_GAP;
const qBot = (c: number) => c + PAIR_GAP;
const FINAL_CENTERS = [
  (SEMI_CENTERS[0] + SEMI_CENTERS[1]) / 2,
  (SEMI_CENTERS[2] + SEMI_CENTERS[3]) / 2,
] as const;
const WIN_CENTER = (FINAL_CENTERS[0] + FINAL_CENTERS[1]) / 2;
// Small finals: a pair lower-right + the bronze plate at its midpoint.
const SMALL_CENTERS = [artY(941.15), artY(1009.62)] as const;
const SMALL_WIN_CENTER = (SMALL_CENTERS[0] + SMALL_CENTERS[1]) / 2;

const bar = (boxId: string, leftPct: number, centerYPct: number): NamePlate => ({
  boxId,
  leftPct,
  topPct: centerYPct - PLATE_H / 2,
  widthPct: PLATE_W,
  heightPct: PLATE_H,
});

/** Build the single-direction name-bracket layout (pure; percentages of 16:9). */
export const nameTreeLayout = (): NameTreeLayout => {
  const plates: NamePlate[] = [
    // Quarter finals — 4 pairs, left column
    bar('box_a_1', Q_X, qTop(SEMI_CENTERS[0])),
    bar('box_a_3', Q_X, qBot(SEMI_CENTERS[0])),
    bar('box_a_5', Q_X, qTop(SEMI_CENTERS[1])),
    bar('box_a_7', Q_X, qBot(SEMI_CENTERS[1])),
    bar('box_a_2', Q_X, qTop(SEMI_CENTERS[2])),
    bar('box_a_4', Q_X, qBot(SEMI_CENTERS[2])),
    bar('box_a_6', Q_X, qTop(SEMI_CENTERS[3])),
    bar('box_a_8', Q_X, qBot(SEMI_CENTERS[3])),
    // Semi finals — the full four-plate column the art shows
    bar('box_q_1_3', SEMI_X, SEMI_CENTERS[0]),
    bar('box_q_5_7', SEMI_X, SEMI_CENTERS[1]),
    bar('box_q_2_4', SEMI_X, SEMI_CENTERS[2]),
    bar('box_q_6_8', SEMI_X, SEMI_CENTERS[3]),
    // Finals — the two finalists
    bar('box_final_l', FINAL_X, FINAL_CENTERS[0]),
    bar('box_final_r', FINAL_X, FINAL_CENTERS[1]),
    // Winner — champion plate, right
    bar('winner', WIN_X, WIN_CENTER),
    // Small finals — pair lower-right + its (bronze) winner
    bar('box_sfinal_l', FINAL_X, SMALL_CENTERS[0]),
    bar('box_small_r', FINAL_X, SMALL_CENTERS[1]),
    bar('small_winner', WIN_X, SMALL_WIN_CENTER),
  ];

  // Label sizes are the art's font px over the 1080 frame; FINALS the largest.
  // SEMI FINALS and the rotated QUARTER FINALS center on the tree midline.
  // SMALL FINAL is singular (one match — `roundLabel` vocabulary); 3RD PLACE
  // captions the bronze advancement bar at the WINNER caption's exact offset
  // below its plate, so the two result bars read as a pair.
  const labels: NameLabel[] = [
    { text: 'QUARTER FINALS', xPct: artX(72), yPct: WIN_CENTER, sizePct: 39 / 1080, rotate: -90 },
    { text: 'SEMI FINALS', xPct: SEMI_X + PLATE_W / 2, yPct: WIN_CENTER, sizePct: 71.29 / 1080 },
    { text: 'FINALS', xPct: FINAL_X + PLATE_W / 2, yPct: artY(592), sizePct: 129.96 / 1080 },
    { text: 'WINNER', xPct: WIN_X + PLATE_W / 2, yPct: artY(651), sizePct: 55 / 1080 },
    { text: 'SMALL FINAL', xPct: FINAL_X + PLATE_W / 2, yPct: artY(885), sizePct: 44 / 1080 },
    {
      text: '3RD PLACE',
      xPct: WIN_X + PLATE_W / 2,
      yPct: SMALL_WIN_CENTER + (artY(651) - WIN_CENTER),
      sizePct: 55 / 1080,
    },
  ];

  // Elbow connectors (shared `elbow`): each quarter pair → its semi plate, each
  // semi pair → its final plate, finals → winner, small pair → bronze plate.
  const QR = Q_X + PLATE_W; // right edge of quarter bars
  const SR = SEMI_X + PLATE_W;
  const FR = FINAL_X + PLATE_W;
  const connectors: (readonly (readonly [number, number])[])[] = [
    elbow(QR, qTop(SEMI_CENTERS[0]), qBot(SEMI_CENTERS[0]), SEMI_X, SEMI_CENTERS[0]),
    elbow(QR, qTop(SEMI_CENTERS[1]), qBot(SEMI_CENTERS[1]), SEMI_X, SEMI_CENTERS[1]),
    elbow(QR, qTop(SEMI_CENTERS[2]), qBot(SEMI_CENTERS[2]), SEMI_X, SEMI_CENTERS[2]),
    elbow(QR, qTop(SEMI_CENTERS[3]), qBot(SEMI_CENTERS[3]), SEMI_X, SEMI_CENTERS[3]),
    elbow(SR, SEMI_CENTERS[0], SEMI_CENTERS[1], FINAL_X, FINAL_CENTERS[0]),
    elbow(SR, SEMI_CENTERS[2], SEMI_CENTERS[3], FINAL_X, FINAL_CENTERS[1]),
    elbow(FR, FINAL_CENTERS[0], FINAL_CENTERS[1], WIN_X, WIN_CENTER),
    elbow(FR, SMALL_CENTERS[0], SMALL_CENTERS[1], WIN_X, SMALL_WIN_CENTER),
  ];

  const centred = recentreTree({ boxes: plates, labels, connectors });
  return { plates: centred.boxes, labels: centred.labels, connectors: centred.connectors };
};

/**
 * The mirrored two-sided "profile" bracket layout (LAAX broadcast `Profile
 * Brackets` reference): quarter-final PORTRAIT photo boxes on BOTH outer edges,
 * semis inward, a large centered FINALS box, and the SMALL FINALS pair at
 * bottom-center. Drawn entirely in JSX over the transparent overlay — no
 * background art. Geometry only (percentages of a 16:9 canvas); plates bind to
 * resolved athletes by the same `boxId`s as `BRACKET_SLOTS`, and the center
 * `winner` box carries the final's champion (`resolveNameWinners`).
 */
export interface ProfileBox extends NamePlate {
  /** The center FINALS box renders larger; flagged for emphasis. */
  isFinal?: boolean;
}

export interface ProfileTreeLayout {
  boxes: readonly ProfileBox[];
  labels: readonly NameLabel[];
  connectors: readonly (readonly (readonly [number, number])[])[];
}

// Geometry measured off `LAAX 2026_Profile Brackets.svg` in the client-delivered
// LAAX 2026 master art (not part of this repo; see design-system §7) (1920×1080
// art px). Every box is a 0.6-aspect portrait rect, growing round by round:
// quarter 102.62×171.03 → semi 125.98×209.97 → finalist 157.61×262.68 → the
// centre FINALS box 216.44×360.73; the small-final pair is 117.03×195.05. Only
// the LEFT side is encoded — the art is a mirror (its right-side rects are the
// left rects rotated 180°, within ~3px), so the right side derives as 1920 − x.
const PQ_RECT = { x: 104.95, w: 102.62, h: 171.03, tops: [244.29, 435.74, 654.34, 845.79] };
const PSEMI_RECT = { x: 326.36, w: 125.98, h: 209.97, tops: [320.45, 730.6] };
const PPRE_RECT = { x: 570.83, w: 157.61, h: 262.68, top: 499.17 };
const PFINAL_RECT = { x: 851.78, w: 216.44, h: 360.73, top: 247.38 };
const PSMALL_RECT = { xL: 795.5, xR: 1007.47, w: 117.03, h: 195.05, top: 811.74 };
// Tree midline (the finalist boxes' y-centre) — the QUARTER/SEMI FINALS labels
// centre on it.
const P_MID_Y = PPRE_RECT.top + PPRE_RECT.h / 2; // 630.51

const artRect = (boxId: string, x: number, top: number, w: number, h: number): ProfileBox => ({
  boxId,
  leftPct: artX(x),
  topPct: artY(top),
  widthPct: artX(w),
  heightPct: artY(h),
});
/** Left edge of the mirrored twin of a left-side rect at `x` of width `w`. */
const mirrorX = (x: number, w: number) => 1920 - x - w;

/** Build the mirrored profile (photo-box) bracket layout (pure; % of 16:9). */
export const profileTreeLayout = (): ProfileTreeLayout => {
  const quarter = (boxId: string, tier: number, right = false) =>
    artRect(
      boxId,
      right ? mirrorX(PQ_RECT.x, PQ_RECT.w) : PQ_RECT.x,
      PQ_RECT.tops[tier],
      PQ_RECT.w,
      PQ_RECT.h,
    );
  const semi = (boxId: string, tier: number, right = false) =>
    artRect(
      boxId,
      right ? mirrorX(PSEMI_RECT.x, PSEMI_RECT.w) : PSEMI_RECT.x,
      PSEMI_RECT.tops[tier],
      PSEMI_RECT.w,
      PSEMI_RECT.h,
    );

  const boxes: ProfileBox[] = [
    // Left quarter finals (outer edge): box_a_1/3 top pair, box_a_5/7 bottom pair
    quarter('box_a_1', 0),
    quarter('box_a_3', 1),
    quarter('box_a_5', 2),
    quarter('box_a_7', 3),
    // Right quarter finals (outer edge): box_a_2/4 top pair, box_a_6/8 bottom pair
    quarter('box_a_2', 0, true),
    quarter('box_a_4', 1, true),
    quarter('box_a_6', 2, true),
    quarter('box_a_8', 3, true),
    // Semi finals, inward
    semi('box_q_1_3', 0),
    semi('box_q_5_7', 1),
    semi('box_q_2_4', 0, true),
    semi('box_q_6_8', 1, true),
    // Finalists — pre-final boxes flanking the center
    artRect('box_final_l', PPRE_RECT.x, PPRE_RECT.top, PPRE_RECT.w, PPRE_RECT.h),
    artRect(
      'box_final_r',
      mirrorX(PPRE_RECT.x, PPRE_RECT.w),
      PPRE_RECT.top,
      PPRE_RECT.w,
      PPRE_RECT.h,
    ),
    // Center FINALS box (the champion)
    {
      ...artRect('winner', PFINAL_RECT.x, PFINAL_RECT.top, PFINAL_RECT.w, PFINAL_RECT.h),
      isFinal: true,
    },
    // Small finals pair, bottom-center
    artRect('box_sfinal_l', PSMALL_RECT.xL, PSMALL_RECT.top, PSMALL_RECT.w, PSMALL_RECT.h),
    artRect('box_small_r', PSMALL_RECT.xR, PSMALL_RECT.top, PSMALL_RECT.w, PSMALL_RECT.h),
  ];

  // Label centres re-derived from the art's text baselines (Placard Medium cap
  // height ≈ 0.72em): SEMI FINALS stacks on TWO lines (the art's 0.95 line
  // spacing).
  const labels: NameLabel[] = [
    {
      text: 'QUARTER FINALS',
      xPct: artX(72.8),
      yPct: artY(P_MID_Y),
      sizePct: 34.79 / 1080,
      rotate: -90,
    },
    {
      text: 'QUARTER FINALS',
      xPct: 100 - artX(72.8),
      yPct: artY(P_MID_Y),
      sizePct: 34.79 / 1080,
      rotate: 90,
    },
    {
      text: 'SEMI\nFINALS',
      xPct: artX(PSEMI_RECT.x + PSEMI_RECT.w / 2),
      yPct: artY(P_MID_Y),
      sizePct: 68.09 / 1080,
    },
    {
      text: 'SEMI\nFINALS',
      xPct: 100 - artX(PSEMI_RECT.x + PSEMI_RECT.w / 2),
      yPct: artY(P_MID_Y),
      sizePct: 68.09 / 1080,
    },
    { text: 'FINALS', xPct: 50, yPct: artY(719.9), sizePct: 85.06 / 1080 },
    // The art wedges a two-line SMALL FINALS into the pair's 94.94px gap, but
    // Oswald runs wider than the art's Placard Next and collided with the card
    // frames (boxes paint over labels). Deviation from the master: a single
    // line under the pair — the region the tree keeps clear — at the art size,
    // singular per `roundLabel`'s "Small final" vocabulary.
    { text: 'SMALL FINAL', xPct: 50, yPct: artY(1045), sizePct: 32.32 / 1080 },
  ];

  // Connector runs, traced from the art's cls-1 polylines/lines (left side +
  // centre; the right side mirrors x). Unlike the name tree's midpoint elbows,
  // the art routes each pair through a C-shape (attached ~38px inside the
  // pair's outer edges) plus a separate stub into the next box's edge.
  const run = (...pts: (readonly [number, number])[]): readonly (readonly [number, number])[] =>
    pts.map(([x, y]) => [artX(x), artY(y)] as const);
  const leftRuns: (readonly (readonly [number, number])[])[] = [
    // Top quarter pair C-elbow + stub into the top semi
    run([207.57, 282.12], [271.96, 282.12], [271.96, 568.75], [207.57, 568.75]),
    run([271.96, 425.43], [326.36, 425.43]),
    // Bottom quarter pair C-elbow + stub into the bottom semi
    run([207.57, 692.27], [271.96, 692.27], [271.96, 978.9], [207.57, 978.9]),
    run([271.96, 835.58], [326.36, 835.58]),
    // Semi pair C-elbow + stub into the finalist box
    run([452.35, 425.43], [516.57, 425.43], [516.57, 835.58], [452.35, 835.58]),
    run([516.57, 630.51], [570.83, 630.51]),
    // Bottom semi → small-final box (the bronze feed)
    run([452.35, 909.27], [795.5, 909.27]),
  ];
  const mirror = (pts: readonly (readonly [number, number])[]) =>
    pts.map(([x, y]) => [100 - x, y] as const);
  const connectors: (readonly (readonly [number, number])[])[] = [
    ...leftRuns,
    ...leftRuns.map(mirror),
    // Finalist cross-line + the stub rising into the centre FINALS box
    run([728.44, 661.65], [1194.9, 661.65]),
    run([960, 661.65], [960, 608.11]),
    // Small-final pair join
    run([912.53, 915.09], [1007.47, 915.09]),
  ];

  return recentreTree({ boxes, labels, connectors });
};

/**
 * Bind each slot to an athlete from the matches. Matches are taken in
 * `position` order within their round (so slot `order` N → the Nth match),
 * which is robust to 0- or 1-based position numbering.
 */
export const resolveBracketSlots = (matches: Match[]): ResolvedSlot[] => {
  const byRound = new Map<MatchRound, Match[]>();
  const matchesFor = (round: MatchRound): Match[] => {
    let list = byRound.get(round);
    if (!list) {
      list = matches.filter((m) => m.round === round).sort((a, b) => a.position - b.position);
      byRound.set(round, list);
    }
    return list;
  };

  return BRACKET_SLOTS.map((slot) => {
    const match = matchesFor(slot.round)[slot.order - 1];
    const athleteId = match?.[slot.side];
    return {
      ...slot,
      athleteId,
      isWinner: match?.winnerId != null && match.winnerId === athleteId,
    };
  });
};

/**
 * The synthetic name-tree winner plates. `winner` = the final's `winnerId`
 * (the champion); `small_winner` = the small-final's `winnerId` (bronze). Both
 * undefined until the match has a recorded winner.
 */
export const resolveNameWinners = (
  matches: Match[],
): { winner?: string; small_winner?: string } => {
  const winnerOf = (round: MatchRound) =>
    matches.filter((m) => m.round === round).sort((a, b) => a.position - b.position)[0]?.winnerId ??
    undefined;
  return { winner: winnerOf('final'), small_winner: winnerOf('small_final') };
};
