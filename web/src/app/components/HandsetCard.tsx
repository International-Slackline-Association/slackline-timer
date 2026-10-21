import { Box, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import { BuzzerMappingDialog } from 'app/components/BuzzerMappingDialog';
import { GamepadPicker } from 'app/components/GamepadPicker';
import { useGamepads } from 'app/hooks/useGamepads';
import { useGamepadSelection } from 'app/state/gamepadSelection';
import { fieldWidths, liveCaption } from 'app/theme/tokens';
import type { BuzzerMappingRow } from 'app/util/buzzer';
import { agoLabel } from 'app/util/handsetReadout';

/** The readout re-renders once a second only to age its `(0:04 ago)` suffix. */
const AGO_TICK_MS = 1000;
/** Past this the suffix stops aging and the interval stops with it: a press a
 * minute old is proof the handset works, not a clock anyone reads — and the
 * card is always mounted, so an interval left running is a permanent one. */
const AGO_STALE_MS = 60_000;

interface Props {
  /** Dialog heading naming the board, e.g. "Speedline". */
  title: string;
  /** The board's button → action map, for the sheet behind the trigger. */
  rows: BuzzerMappingRow[];
  /**
   * What a press of `button` just did, in the card's one line. Called AT PRESS
   * TIME, from the press handler: both boards' verdicts depend on
   * an interlock table and on the overlay standing at that instant, neither of
   * which can be re-derived a render later.
   */
  describe: (button: number) => string;
  /**
   * `card` is the desk's setup column; `strip` is the same live proof in one
   * row that truncates rather than wraps, for the widths where the desk
   * columns stack and a ~220 px setup card would push the lane transport under
   * the fold. The page picks ONE — the card owns a pad listener and a
   * once-a-second ticker, so a CSS display toggle over both would double them
   * and report the press twice.
   */
  variant?: 'card' | 'strip';
}

/**
 * The handset card (freestyle-board-ux §4.14), shared by both desks — and, in
 * `strip`, the one-row form the Speedline desk falls to below its column gate.
 *
 * It is **always rendered**, even with nothing plugged in: the browser reveals
 * a Gamepad only after a press, so a card that appeared with the hardware would
 * be missing at exactly the moment the operator is looking for it. With no pad
 * it says so and says what to press.
 *
 * The inline surface keeps only the live proof — pad presence and the last
 * press readout — which is what makes the reference sheet behind the trigger
 * something the operator opens rather than something they must close: a sheet
 * owns the board while it stands (§4.8), so checking a binding through it costs
 * the very presses being checked.
 *
 * Each board words the verdicts (`describe`); nothing here decides anything.
 */
export const HandsetCard = ({ title, rows, describe, variant = 'card' }: Props) => {
  const { connectedPads } = useGamepadSelection();
  const [last, setLast] = useState<{ line: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useGamepads(({ button, at }) => {
    setLast({ line: describe(button), at });
    setNow(Date.now());
  });

  useEffect(() => {
    if (last === null || Date.now() - last.at >= AGO_STALE_MS) return;
    const id = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick - last.at >= AGO_STALE_MS) clearInterval(id);
    }, AGO_TICK_MS);
    return () => clearInterval(id);
  }, [last]);

  // The same three things in both shells — presence, the last press, the sheet —
  // so what an operator reads and presses does not change with the viewport.
  const strip = variant === 'strip';
  const readoutLine =
    last === null ? 'last: —' : `last: ${last.line} (${agoLabel(now - last.at)} ago)`;
  const readout = (
    <Typography
      variant="body2"
      component="div"
      aria-live="polite"
      data-testid="handset-readout"
      // In the strip it takes what the row leaves and clips, never wraps: a
      // second line is a row of header height, `Lane n DNF` under the 768 px
      // fold. Clipped, not lost: the sentence is the title, and still spoken.
      noWrap={strip}
      title={strip ? readoutLine : undefined}
      sx={{
        ...liveCaption,
        color: 'text.primary',
        ...(strip ? { flex: '1 1 auto', minWidth: 0 } : {}),
      }}
    >
      {readoutLine}
    </Typography>
  );
  const mappingSheet = (
    <BuzzerMappingDialog title={title} rows={rows} triggerLabel="Open handset map" />
  );

  if (strip) {
    return (
      <Paper
        component="section"
        aria-label="Handsets"
        variant="outlined"
        data-testid="handset-strip"
        // Grows into the row beside the Preview switch and may not pin a desk
        // track (design-system §9 "Responsive contract"). `py` holds a caption
        // strip to the switch's height, so only a multi-pad select adds to the
        // setup row.
        sx={{ px: 1, py: 0.25, flex: '1 1 20rem', minWidth: 0 }}
      >
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'nowrap', alignItems: 'center' }}
        >
          {connectedPads.length === 0 ? (
            // The card's own sentence, said in a row's worth of words — the
            // instruction survives (it is the state the operator is looking
            // here to resolve), the heading does not.
            <Typography
              variant="body2"
              noWrap
              sx={{ ...liveCaption, color: 'text.secondary', flexShrink: 0 }}
            >
              no handset — press any button
            </Typography>
          ) : (
            <GamepadPicker inline />
          )}
          {readout}
          {/* The press, whole: the text lines give way around it. */}
          <Box sx={{ flexShrink: 0 }}>{mappingSheet}</Box>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper
      component="section"
      aria-label="Handsets"
      variant="outlined"
      data-testid="handset-card"
      sx={{ p: 1.5, width: '100%', maxWidth: fieldWidths.card }}
    >
      <Stack spacing={0.75}>
        <Typography variant="overline" component="div" sx={{ letterSpacing: '0.1em' }}>
          Handsets
        </Typography>

        {connectedPads.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            no handset detected — press any button to reveal it
          </Typography>
        ) : (
          <GamepadPicker />
        )}

        {readout}

        {mappingSheet}
      </Stack>
    </Paper>
  );
};
