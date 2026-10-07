import { Box } from '@mui/material';

/**
 * The "?" placeholder for a slot whose competitor is not yet decided (an
 * unseeded bracket box, an unresolved VS card), so it reads as an intentional
 * "to be decided" plate rather than an empty keyed-out hole.
 *
 * An inline vector (the repo has no SVG loader) in `currentColor`, so callers
 * pick the hue. Geometry only — no font dependency, since captured overlays
 * block external hosts.
 *
 * `portrait` centres the mark in a 120×152 card-shaped viewBox; `fit="tight"`
 * crops to the ink (x 24–96, y 24–135) plus a 6-unit margin, for a host that
 * already insets the mark (the name bracket's bar).
 */
const VIEW_BOX = { portrait: '0 0 120 152', tight: '18 18 84 123' } as const;

export const UnknownAthlete = ({
  sx,
  testId,
  fit = 'portrait',
}: {
  sx?: object;
  testId?: string;
  fit?: keyof typeof VIEW_BOX;
}) => (
  <Box
    component="svg"
    data-testid={testId}
    role="img"
    aria-label="Athlete to be decided"
    viewBox={VIEW_BOX[fit]}
    fill="none"
    sx={{ display: 'block', color: 'inherit', ...sx }}
  >
    <path
      d="M33 52C33 26 87 26 87 54C87 76 60 74 60 98"
      stroke="currentColor"
      strokeWidth={17}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx={60} cy={126} r={9} fill="currentColor" />
  </Box>
);
