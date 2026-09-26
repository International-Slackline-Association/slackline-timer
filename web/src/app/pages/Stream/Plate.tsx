import { Box, type BoxProps } from '@mui/material';

import { colors, overlayArt } from 'app/theme/tokens';

/**
 * The LAAX broadcast "plate" chrome — the stroked, filled rectangle every
 * overlay draws behind a name, portrait or ranking row — with the shared
 * winner-edge treatment folded into one place (ADR 0034 §4). A composition
 * container: it accepts `sx` and children and passes through Box props, so each
 * surface layers its own layout on top (positioned bracket boxes, flex rows,
 * container-query cards).
 *
 * `winner` marks the champion edge `race.go` green. The refs carry three ring
 * encodings, selected by `ring`:
 *  - `outset` (large VS / winner photo cards): recolor the border green and lay
 *    a matching-width ring just outside it (a bold rim on the transparent/keyed
 *    ground) — the extra weight the big lower-third frame needs at venue distance;
 *  - `inset` (name plates): keep the white border and lay a flat 3px green ring
 *    inside it (the art shows no outer glow on the white name bars);
 *  - `flat` (dense bracket boxes): recolor the border green at the SAME width as
 *    the white edge, no ring — so the champion's edge never outweighs its
 *    neighbours' white edges on the small quarter/semi boxes (the brief's flat
 *    green winner-edge rule; `outset`'s doubled rim read far too heavy there).
 */
export const Plate = ({
  fill,
  stroke = colors.overlay.stroke,
  strokeWidth = overlayArt.strokeWidth,
  bordered = true,
  winner = false,
  ring = 'outset',
  sx,
  children,
  ...boxProps
}: {
  /** Plate background. Omit for no fill. */
  fill?: string;
  /** Border color (non-winner, or the winner border under `ring="inset"`). */
  stroke?: string;
  /** Border width and, for `ring="outset"`, the winner ring width. */
  strokeWidth?: string;
  /** Draw the border. Off for the name strip, which is a fill-only plate. */
  bordered?: boolean;
  winner?: boolean;
  ring?: 'outset' | 'inset' | 'flat';
} & BoxProps) => {
  // `inset` keeps the white edge (green sits inside); `outset`/`flat` recolor the
  // edge green. Only `outset` also lays an outer ring — `flat` stops at the
  // recoloured edge so green never exceeds the white edge width.
  const edge = winner && ring !== 'inset' ? colors.race.go : stroke;
  const winnerRing =
    ring === 'inset'
      ? `0 0 0 3px ${colors.race.go} inset`
      : ring === 'flat'
        ? 'none'
        : `0 0 0 ${strokeWidth} ${colors.race.go}`;
  return (
    <Box
      sx={[
        {
          backgroundColor: fill,
          // Longhand so jsdom's cssstyle resolves borderTopWidth (the overlay
          // tests read it) and the arts' constant stroke computes cleanly.
          ...(bordered
            ? { borderStyle: 'solid', borderWidth: strokeWidth, borderColor: edge }
            : {}),
          boxShadow: winner ? winnerRing : 'none',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...boxProps}
    >
      {children}
    </Box>
  );
};
