import { Box } from '@mui/material';

/**
 * The "unknown athlete" placeholder mark — a bold LAAX-broadcast question mark for
 * a slot whose competitor is not yet decided (a bracket seed that hasn't been won
 * into, a VS/SVO card for an unresolved match). It fills the portrait region of an
 * `AthleteCard` TBD slot, so an undecided box reads as an intentional "to be
 * decided" plate rather than an empty keyed-out hole.
 *
 * Drawn as an inline vector (not a `.svg` import — this repo has no SVG loader and
 * routes overlay art through components) in `currentColor`, so callers pick the
 * hue: the empty overlay plate paints it in translucent white (`overlay.stroke`
 * language), an admin/light surface can paint it in slate ink. Geometry only — no
 * font dependency, since captured overlays block external hosts.
 *
 * The glyph is a stroked hook + a filled dot at a single matched weight (round
 * caps/joins), centred in a 120×152 portrait viewBox so it scales cleanly from the
 * tiny quarter-final box up to the FINALS centre card via `preserveAspectRatio`.
 */
export const UnknownAthlete = ({ sx, testId }: { sx?: object; testId?: string }) => (
  <Box
    component="svg"
    data-testid={testId}
    role="img"
    aria-label="Athlete to be decided"
    viewBox="0 0 120 152"
    fill="none"
    sx={{ display: 'block', color: 'inherit', ...sx }}
  >
    {/* Hook + descending stem of the "?" — one open stroke. */}
    <path
      d="M33 52C33 26 87 26 87 54C87 76 60 74 60 98"
      stroke="currentColor"
      strokeWidth={17}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* The dot, at the same weight as the stroke. */}
    <circle cx={60} cy={126} r={9} fill="currentColor" />
  </Box>
);
