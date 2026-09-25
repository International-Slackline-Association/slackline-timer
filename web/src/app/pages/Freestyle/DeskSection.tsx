import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import { radii } from 'app/theme/tokens';
import { stepCaption, stepName, type BoardStep } from 'app/util/boardStep';

/** The marker gutter, held on every caption whether or not it carries the rule:
 * a mark that reflows the line it marks is read as a layout change, not a cue. */
const RULE_SX = {
  width: '4px',
  flexShrink: 0,
  alignSelf: 'stretch',
  borderRadius: `${radii.sm}px`,
} as const;

/**
 * One numbered section of the Freestyle chronology (FREESTYLE_BOARD_UX §2).
 *
 * The caption is the only thing that marks where the operator is, and it marks
 * it three ways — weight, ink and the gutter rule. Ink alone was a ~2:1
 * grey-on-grey swap that vanished at the 25 % scale a desk is scanned at, and a
 * mark carried by colour alone is no mark (WCAG 1.4.1). Emphasis only: nothing
 * folds and no section moves between board states (C14), so a section the operator has
 * learned to find stays exactly where it was learned.
 *
 * The accessible name is the step's name alone (`stepName`), not the caption:
 * the number under it renumbers with the mode — quali has no best-trick step —
 * and a name that moves is no name at all. `aria-current` carries the same mark
 * as the rule for a reader that cannot see it.
 */
export const DeskSection = ({
  step,
  current,
  mode,
  showCaption = true,
  children,
}: {
  step: BoardStep;
  current: BoardStep;
  mode: FreestyleMode;
  /**
   * Print the numbered caption. The desk always does — it is the only mark of
   * where the operator is across seven sections shown at once. The tab layout
   * shows ONE section and names it on the tab that opened it, so the caption is
   * the same word twice for ~26 px of fold budget (`freestyle-compact-run-tab-fold`).
   * The section keeps its landmark name and `aria-current` either way.
   */
  showCaption?: boolean;
  children: ReactNode;
}) => {
  const isCurrent = step === current;
  return (
    <Box
      component="section"
      aria-label={stepName(step)}
      aria-current={isCurrent ? 'step' : undefined}
      sx={{ width: '100%' }}
    >
      {showCaption && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'stretch' }}>
          <Box
            aria-hidden
            data-testid="step-rule"
            sx={{ ...RULE_SX, bgcolor: isCurrent ? 'text.primary' : 'transparent' }}
          />
          <Typography
            variant="overline"
            component="div"
            sx={{
              color: isCurrent ? 'text.primary' : 'text.secondary',
              fontWeight: isCurrent ? 700 : 400,
              letterSpacing: '0.1em',
              lineHeight: 1.5,
            }}
          >
            {stepCaption(step, mode)}
          </Typography>
        </Stack>
      )}
      {children}
    </Box>
  );
};
