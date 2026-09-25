import { Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { LaneCardTier } from 'app/util/laneCard';
import { colors, fonts } from 'app/theme/tokens';

/** The §6 on-light text tier of each card state. `ready` is the quiet one: an
 * armed lane is the board's resting state, so it takes the neutral ink the
 * why-lines use rather than a race hue nothing is doing yet. */
const TIER_INK: Record<LaneCardTier, string> = {
  ready: colors.ink.mid,
  running: colors.race.runningText,
  break: colors.race.setText,
  held: colors.race.setText,
  finished: colors.race.stopDim,
};

/**
 * Holds a reserved row's height with nothing in it (FREESTYLE_BOARD_UX §4.12):
 * every always-rendered slot on the desk — the state word, a lane's name row,
 * the changeover's `Next:` line, the best-trick line — prints this when it has
 * nothing to say, so the board never steps under the operator's hand. One
 * definition for the desk, which had grown three. `app/components/WhyLine`
 * keeps its own — it is the Speedline board's reserved line too, and a shared
 * component may not reach into a page module.
 */
export const NBSP = ' ';

const WORD_SX = {
  fontFamily: fonts.display,
  fontSize: 20,
  fontWeight: 600,
  lineHeight: 1.2,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
} as const;

/**
 * A live card's state, said in a word (FREESTYLE_BOARD_UX §6) — the redundant,
 * non-colour half of the frame tier below it, so the card survives a squint, a
 * colourblind operator and direct sunlight. Always rendered (§4.12).
 *
 * Shared by the lane cards and the best-trick panel: the try clock borrows the
 * lane tier language wholesale, and two copies of this map would eventually
 * word or colour the same state two ways.
 */
export const StateWord = ({ tier, children }: { tier: LaneCardTier; children: ReactNode }) => (
  <Typography component="div" sx={{ ...WORD_SX, color: TIER_INK[tier] }}>
    {children}
  </Typography>
);
