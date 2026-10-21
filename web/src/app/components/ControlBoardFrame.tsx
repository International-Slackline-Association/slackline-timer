import { Box, Stack, type StackProps } from '@mui/material';
import type { ResponsiveStyleValue } from '@mui/system';
import type { ReactNode } from 'react';

import { boardGeometry } from 'app/theme/tokens';

/**
 * The outer frame of a control board: header, desk and the compact layouts all
 * sit inside one centred box capped at the board's `boardMax` (design-system §9
 * "Responsive contract"). Under the cap nothing changes; past it the side
 * margins take the surplus, so the fixed rails stay one desk gap from the
 * capped live deck instead of drifting to the viewport edges.
 *
 * The page padding wraps the cap rather than sitting inside it, so the content
 * box holds the whole `boardMax` the desk was derived for.
 */
export const ControlBoardFrame = ({
  board,
  spacing,
  padding,
  children,
}: {
  board: keyof typeof boardGeometry.boardMax;
  spacing: StackProps['spacing'];
  padding: ResponsiveStyleValue<number>;
  children: ReactNode;
}) => (
  <Box sx={{ width: '100%', padding }}>
    <Stack
      data-testid="control-board-frame"
      spacing={spacing}
      sx={{ width: '100%', maxWidth: boardGeometry.boardMax[board], mx: 'auto' }}
    >
      {children}
    </Stack>
  </Box>
);
