import { Box, Stack } from '@mui/material';

import { toAlpha2 } from 'app/components/CountryFlag';
import { FlagBlock } from 'app/pages/Stream/FlagBlock';
import { type Athlete } from 'app/types';
import { colors } from 'app/theme/tokens';
import { FLAG_EDGE_COLORS } from 'app/pages/Stream/flags/flagEdgeColors';
import { wideFlagArt } from 'app/pages/Stream/flags/wide';

/**
 * The WIDE flag treatment for the `AthleteCard` foot strip — the one site whose
 * ~10:1 band matches the art's native rectangle. `flags/wide` answers with the
 * best art it has for the nation (the designer's delivered art first, an LLM
 * reconstruction second — it owns that precedence, not us), rendered edge-to-edge
 * and stretched to fill the band (`preserveAspectRatio="none"` — the art is drawn
 * FOR that wide rectangle, so bands and emblems fill without crop).
 * Nations in neither tier fall back to the real
 * flag-icons flag rendered `contain` (whole, undistorted, centred) over a band
 * painted the flag's edge colour (`flagEdgeColors.ts`), so a letterboxed flag
 * still reads full-bleed rather than sitting in an empty gap.
 *
 * Only the card foot uses it; every other surface (RankingsOverlay, bracket
 * inline, `AthleteNameStrip`) stays on plain
 * flag-icons — in particular the name strip's ~1.6:1 block would squash the
 * stretched art, so it renders the inline treatment instead (pinned by its
 * "not the wide card-foot art" regression test). `country2` dual-nationality
 * abuts two blocks. An entirely unknown code renders nothing so the surface
 * stays clean rather than printing the raw code.
 */
export const WideFlag = ({
  athlete,
  testId,
  itemTestId,
  sx,
}: {
  athlete: Pick<Athlete, 'country' | 'country2'>;
  testId?: string;
  itemTestId?: string;
  sx?: object;
}) => {
  const codes = [athlete.country, athlete.country2].filter((c): c is string => Boolean(c));
  const alpha2s = codes.map(toAlpha2).filter((a): a is string => Boolean(a));
  if (alpha2s.length === 0) return null;
  return (
    <Stack
      data-testid={testId}
      direction="row"
      spacing={0}
      sx={{ alignItems: 'stretch', width: '100%', height: '100%', ...sx }}
    >
      {alpha2s.map((alpha2, i) => (
        <WideFlagItem key={i} alpha2={alpha2} testId={itemTestId} />
      ))}
    </Stack>
  );
};

const ITEM_SX = { flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' } as const;

const WideFlagItem = ({ alpha2, testId }: { alpha2: string; testId?: string }) => {
  const art = wideFlagArt(alpha2);
  if (art) {
    return (
      <Box
        data-testid={testId}
        role="img"
        aria-label={alpha2}
        sx={ITEM_SX}
        // Static flag art from the local `flags/wide` tables — a build-time
        // constant, never user input, so there is no injection surface.
        // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
        dangerouslySetInnerHTML={{ __html: art }}
      />
    );
  }
  // Fallback: undistorted flag centred on its edge colour (plate white if
  // unmapped, so the contained flag reads cleanly on the white foot).
  return (
    <Box
      data-testid={testId}
      sx={{
        ...ITEM_SX,
        backgroundColor: FLAG_EDGE_COLORS[alpha2] ?? colors.overlay.plateFilled,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <FlagBlock code={alpha2} contain sx={{ height: '100%' }} />
    </Box>
  );
};
