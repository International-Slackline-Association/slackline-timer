import { Box } from '@mui/material';

import { AthleteCard } from 'app/pages/Stream/AthleteCard';
import { type Athlete } from 'app/types';
import { refVh, refVw } from 'app/util/overlayScale';

// The lower-third frame's own heavier edge, not the shared 6px
// `overlayArt.strokeWidth`: at venue distance the big card needs the weight
// (design-system §7 "Deliberate deviations from the masters").
const PANEL_EDGE = refVh(10);

/**
 * The shared `AthleteCard` at the master's portrait-panel box (design-system §7
 * "VS head-to-head"), for the VS / SVO / winner / rounds-summary overlays.
 * ADR 0029: ONE frame, because a broadcast cuts across these homes within one
 * match and the card must never pop in size between them.
 */
export const Competitor = ({
  athlete,
  result,
  isWinner = false,
  isLoser = false,
  winnerTag = false,
}: {
  athlete?: Athlete;
  /** Result numeral below the name (best time / judged overall). Omit for a pure identity card. */
  result?: string;
  isWinner?: boolean;
  isLoser?: boolean;
  /** Paint the "WINNER" word above the green frame (see `AthleteCard`). */
  winnerTag?: boolean;
}) => (
  <Box sx={{ width: refVw(298.81), height: refVh(498.02) }}>
    <AthleteCard
      athlete={athlete}
      result={result}
      isWinner={isWinner}
      isLoser={isLoser}
      winnerTag={winnerTag}
      edgeWidth={PANEL_EDGE}
    />
  </Box>
);
