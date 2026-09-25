import { Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import { ElapsedTime } from 'app/components/ElapsedTime';
import { colors, fonts } from 'app/theme/tokens';

/** The gutter's resting value: the changeover slot is always rendered (§4.12),
 * so the lane cards never slide sideways when a turn ends. */
const IDLE_VALUE = '—';

/**
 * The judge-facing battle changeover count-up (ADR 0036), and the gutter it
 * lives in. Battle has no break clock: when a turn ends (fall / run-zero) while
 * a next turn is still possible, the battle machine anchors `pauseStartedAt` and
 * this clock shows how long the pause has run, so the judges pace the changeover
 * themselves. Control-surface only — never relayed, not in the snapshot; the
 * next Start/Reset clears it.
 *
 * The tick derives elapsed from the anchor + wall clock (never accumulates), so
 * a throttled tab still reads real elapsed time. Word in `setText`, numeral in
 * the numeral-only `setDim` tier (§6) — "waiting".
 *
 * The caption is not always "changeover": with the partner's budget spent the
 * same athlete comes back out, so the caption and the plate's state word ride
 * one reading of that (`sameLaneAgain`) rather than each naming the gap for
 * itself.
 */
export const PauseClock = ({
  startedAt,
  goesAgain,
}: {
  startedAt: number | null;
  goesAgain: boolean;
}) => {
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <Stack spacing={0.5} sx={{ alignItems: 'center' }}>
      <Typography
        component="div"
        sx={{
          fontFamily: fonts.display,
          fontWeight: 600,
          fontSize: 14,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: startedAt === null ? 'text.secondary' : colors.race.setText,
        }}
      >
        {goesAgain ? 'Pause' : 'Changeover'}
      </Typography>
      {startedAt === null ? (
        <Typography
          component="div"
          sx={{ fontFamily: fonts.numerals, fontSize: 28, lineHeight: 1, color: 'text.secondary' }}
        >
          {IDLE_VALUE}
        </Typography>
      ) : (
        <ElapsedTime
          ms={elapsedMs}
          format="clock"
          component="div"
          fontSize="clamp(1.5rem, 3vw, 2.5rem)"
          lineHeight={1}
          fontWeight="bold"
          color={colors.race.setDim}
        />
      )}
    </Stack>
  );
};
