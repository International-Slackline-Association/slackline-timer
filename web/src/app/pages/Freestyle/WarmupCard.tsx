import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

import { RaceButton } from 'app/components/RaceButton';
import type { WarmupChannel } from 'app/hooks/useWarmupChannel';
import type { WarmupCardTier } from 'app/util/warmupChannel';
import { formatClock } from 'app/util/time';
import { colors, fonts } from 'app/theme/tokens';
import { Countdown } from './Countdown';

/** The §6 on-light text tier of each card state. `armed` is the quiet one — a
 * warm-up waiting to be started is the board's resting state, so it takes the
 * neutral ink rather than a race hue nothing is doing yet; `held` takes the
 * lane cards' own held ink, because it is the same fact. `over` is not here:
 * it is the one state that has somewhere to be, so it renders as the filled
 * `stopDim` chip the §6 table names. */
const TIER_INK: Record<Exclude<WarmupCardTier, 'over'>, string> = {
  armed: colors.ink.mid,
  running: colors.race.runningText,
  held: colors.race.setText,
};

const WORD_SX = {
  fontFamily: fonts.display,
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.2,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
} as const;

/** The one reserved row the transport and the expiry re-arm share (§4.12): a
 * 44 px control swaps for a 44 px control, so the warm-up running out moves
 * nothing on the board (audit S19). */
const SLOT_SX = { minHeight: 44, alignItems: 'center', justifyContent: 'center' } as const;

interface Props {
  /** The page's warm-up channel — derived state + stable actions, the one
   * owner (ADR 0032). The card stores nothing of its own. */
  warmup: WarmupChannel;
}

/**
 * The warm-up card (FREESTYLE_BOARD_UX §3/§6). Warm-up is the only clock on the
 * board that is not a competition result, so it reads at the `secondary`
 * half-scale beside the lane clocks rather than as a fourth equal peer
 * (audit S27) — same on-light hues, same frame tiers, half the numeral.
 *
 * It is presentational: `warmupCardState` supplies the always-rendered state
 * word, the embedded `Countdown` runs controlled off `warmup.display`, and the
 * transport dispatches into the channel's reducer. The board's warm-up used to
 * COLLAPSE to a chip on expiry — a whole card's worth of layout shift at the
 * exact moment the operator reaches for the next press. Now the transport slot
 * simply swaps its three buttons for the one that re-arms, in place.
 */
export const WarmupCard = ({ warmup }: Props) => {
  const card = warmup.card;
  const spent = card.tier === 'over';
  // Used, and holding what is left: the clock is idle again, so only the
  // distance to the default says so (§6 — dashed frame, and the word above).
  const held = card.tier === 'held';
  const rearmLabel = `Re-arm ${formatClock(warmup.defaultSeconds * 1000)}`;

  return (
    <Paper variant="outlined" sx={{ p: 2, width: '100%', maxWidth: 360 }}>
      <Stack direction="column" spacing={1} sx={{ alignItems: 'center' }}>
        {/* The state, said in a word (§6) — the redundant, non-colour half of
            the clock's frame tier, so the card survives a squint and direct
            sunlight. Reserved height, so ARMED → RUNNING → STOPPED →
            WARM-UP OVER never nudges the clock under it. */}
        <Box sx={{ minHeight: 30, display: 'flex', alignItems: 'center' }}>
          {spent ? (
            <Chip
              size="small"
              label={card.word}
              sx={{
                bgcolor: colors.race.stopDim,
                color: colors.ink.onBrand,
                fontFamily: fonts.display,
                fontWeight: 600,
                letterSpacing: '0.06em',
              }}
            />
          ) : (
            <Typography component="div" sx={{ ...WORD_SX, color: TIER_INK[card.tier] }}>
              {card.word}
            </Typography>
          )}
        </Box>
        {/* No `expiredLabel`: the word above already says WARM-UP OVER, and a
            caption row that only exists once the clock is spent would move the
            transport the moment it appeared. */}
        {/* No `onExpire`: the crossing is the machine's (`useWarmupExpiry`),
            not this clock's — the card renders the channel and dispatches
            nothing the operator did not press. */}
        <Countdown mode="controlled" display={warmup.display} size="secondary" held={held} />
        <Stack direction="row" spacing={1.5} sx={SLOT_SX}>
          {spent ? (
            // The re-arm IS the Reset event — labelled with the window it arms
            // so the operator reads what the next pair gets without leaving the
            // card.
            <RaceButton
              tone="goOutline"
              startIcon={<RestartAltIcon />}
              aria-label="Re-arm warm-up"
              onClick={warmup.reset}
            >
              {rearmLabel}
            </RaceButton>
          ) : (
            <>
              {/* Only an armed (idle) clock starts — a spent one re-arms first,
                  never a zero-length broadcast. A held one resumes what is
                  left, which is why the transport stands through `held`
                  rather than collapsing the way expiry does. */}
              <RaceButton
                tone="goOutline"
                aria-label="Start warm-up"
                onClick={warmup.start}
                disabled={warmup.display.kind !== 'idle'}
              >
                Start
              </RaceButton>
              <RaceButton
                tone="stop"
                aria-label="Stop warm-up"
                onClick={warmup.stop}
                disabled={!warmup.running}
              >
                Stop
              </RaceButton>
              {/* Held, this press throws away the rest of a window in use, so it
                  says which one it arms instead — the expiry wording, in the
                  slot it already occupies. The icon steps aside for the value:
                  three controls plus a time do not fit the 248 px rail. */}
              <RaceButton
                tone="neutral"
                startIcon={held ? undefined : <RestartAltIcon />}
                aria-label={held ? 'Re-arm warm-up' : 'Reset warm-up'}
                onClick={warmup.reset}
                disabled={warmup.running}
              >
                {held ? rearmLabel : 'Reset'}
              </RaceButton>
            </>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
};
