import { Box } from '@mui/material';

import { fonts } from 'app/theme/tokens';

/**
 * A competition-rank numeral in the LAAX display face (Oswald 500) — the ranked
 * plate / profile-card rank marker. Renders a precomputed label from
 * `app/util/rankLabels` (which owns the tie-`=` rule); the component owns only
 * the rank's type treatment so it is identical across the ranking recipes
 * (ADR 0034 §6).
 *
 * Braid-strict leaf — no `sx`. The rank sits at bespoke per-art sizes across the
 * two ranking cuts, so `fontSize` is a prop; alignment/gap layout lives on the
 * caller's row. Uses the DISPLAY face (not `Numeral`'s monospace): the rank is a
 * heavy condensed headline mark in the art, not a tabular figure.
 */
export const RankBadge = ({ label, fontSize }: { label: string; fontSize: string | number }) => (
  <Box
    component="span"
    sx={{ fontFamily: fonts.display, fontWeight: 500, fontSize, lineHeight: 1 }}
  >
    {label}
  </Box>
);
