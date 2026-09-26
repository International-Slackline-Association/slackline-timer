import { Box } from '@mui/material';

import { AthleteCard } from 'app/pages/Stream/AthleteCard';
import { type Athlete } from 'app/types';
import { refVh, refVw } from 'app/util/overlayScale';

/**
 * Sized LAAX athlete card for the VS / winner / rounds-summary overlays. Thin
 * wrapper that frames the shared `AthleteCard` art — B&W portrait, white
 * diagonal band, bold-first/light-last name, flag strip foot — at the master's
 * portrait-panel box on the 1920×1080 capture frame, derived responsively via
 * `refVw`/`refVh` (measurement record: `doc/dev/design-system/design-system.md`
 * §7 "VS head-to-head"). ADR 0029 made this the ONE `Competitor` frame: the
 * three homes are the same lower-third family a broadcast cuts across within one
 * match, so the card must never pop in size between them — and a fixed px frame
 * does not scale with the capture resolution at all.
 */
// The big lower-third portrait frame carries its own heavier edge (10px @1080p),
// NOT the shared bracket/VS stroke (`overlayArt.strokeWidth`, 6px — kept light so
// the dense bracket boxes don't clot): at venue distance the VS/winner card frame
// needs the extra weight to read. Derived responsively like the rest of the art.
const PANEL_EDGE = refVh(10);

export const Competitor = ({
  athlete,
  result,
  isWinner = false,
  winnerTag = false,
}: {
  athlete?: Athlete;
  /** Result numeral below the name (best time / judged overall). Omit for a pure identity card. */
  result?: string;
  isWinner?: boolean;
  /** Paint the "WINNER" word on the green frame (see `AthleteCard`). */
  winnerTag?: boolean;
}) => (
  <Box sx={{ width: refVw(298.81), height: refVh(498.02) }}>
    <AthleteCard
      athlete={athlete}
      result={result}
      isWinner={isWinner}
      winnerTag={winnerTag}
      edgeWidth={PANEL_EDGE}
    />
  </Box>
);
