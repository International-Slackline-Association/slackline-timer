import { Box, type BoxProps } from '@mui/material';

import { colors, overlayArt } from 'app/theme/tokens';

/**
 * The LAAX broadcast "plate" chrome — the stroked, filled rectangle every
 * overlay draws behind a name, portrait or ranking row — with the shared
 * winner-edge treatment folded into one place (ADR 0034). A composition
 * container: it accepts `sx`, children and Box props.
 *
 * `winner` marks the edge `race.go`; `loser` marks a decided head-to-head loser
 * `race.stop` under the same ring rule (winner wins if both are set). `ring`
 * picks one of the refs' three encodings:
 *  - `outset` (large VS / winner photo cards): recolor the border and lay a
 *    matching-width ring just outside it — the weight the big lower-third frame
 *    needs at venue distance;
 *  - `inset` (name plates): keep the white border, lay a 3px ring inside it
 *    (the art shows no outer glow on the white name bars);
 *  - `flat` (dense bracket boxes): recolor the border at the SAME width, no
 *    ring, so the champion's edge never outweighs its white-edged neighbours.
 */
export const Plate = ({
  fill,
  stroke = colors.overlay.stroke,
  strokeWidth = overlayArt.strokeWidth,
  bordered = true,
  winner = false,
  loser = false,
  ring = 'outset',
  sx,
  children,
  ...boxProps
}: {
  /** Plate background. Omit for no fill. */
  fill?: string;
  /** Border color (undecided, or every border under `ring="inset"`). */
  stroke?: string;
  /** Border width and, for `ring="outset"`, the state ring width. */
  strokeWidth?: string;
  /** Draw the border. Off for the name strip, which is a fill-only plate. */
  bordered?: boolean;
  winner?: boolean;
  loser?: boolean;
  ring?: 'outset' | 'inset' | 'flat';
} & BoxProps) => {
  const state = winner ? colors.race.go : loser ? colors.race.stop : undefined;
  const edge = state && ring !== 'inset' ? state : stroke;
  const stateRing =
    !state || ring === 'flat'
      ? 'none'
      : ring === 'inset'
        ? `0 0 0 3px ${state} inset`
        : `0 0 0 ${strokeWidth} ${state}`;
  return (
    <Box
      sx={[
        {
          backgroundColor: fill,
          // Longhand so jsdom's cssstyle resolves borderTopWidth (the overlay
          // tests read it).
          ...(bordered
            ? { borderStyle: 'solid', borderWidth: strokeWidth, borderColor: edge }
            : {}),
          boxShadow: stateRing,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...boxProps}
    >
      {children}
    </Box>
  );
};
