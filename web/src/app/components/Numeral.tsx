import { Typography } from '@mui/material';
import type { ElementType, ReactNode } from 'react';

import { fonts } from 'app/theme/tokens';

/**
 * The one place a number is set in the monospace numeral face with
 * `tabular-nums` — the non-negotiable fixed-width-digit rule (design-system §4)
 * that keeps a ticking clock / rank / score from jittering as its digits change
 * (ADR 0034 §6). No lint enforces its use.
 *
 * Braid-strict leaf — no `sx`/`style`/`className`. The locked-down half (the
 * numeral face + tabular-nums) can never be opted out of; only the bounded set
 * of typographic props below vary, and any LAYOUT (margin/position/width) lives
 * on a wrapping container, not here.
 */
export const Numeral = ({
  children,
  color,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
  textShadow,
  component = 'span',
  testId,
}: {
  children: ReactNode;
  color?: string;
  fontSize?: string | number;
  fontWeight?: number | string;
  lineHeight?: number | string;
  letterSpacing?: string;
  textShadow?: string;
  component?: ElementType;
  testId?: string;
}) => (
  <Typography
    component={component}
    data-testid={testId}
    sx={{
      fontFamily: fonts.numerals,
      fontVariantNumeric: 'tabular-nums',
      color,
      fontSize,
      fontWeight,
      lineHeight,
      letterSpacing,
      textShadow,
    }}
  >
    {children}
  </Typography>
);
