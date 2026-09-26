import { Box, Typography } from '@mui/material';
import { useLocation } from 'react-router-dom';

import {
  isChromaBackground,
  isKeyCompositeOverlay,
  resolveOverlayBackground,
} from 'app/pages/Stream/overlayBg';
import { colors, fonts } from 'app/theme/tokens';

/**
 * The shared corner status-cue chrome for the display surfaces — a fixed
 * top-corner pill (slate scrim + white border), a pulsing status dot, and a
 * condensed-caps label. One primitive behind ConnectingBadge /
 * ConnectionLostBadge / AudioMutedBadge (ADR 0034 §4); each caller owns its own
 * visibility guard and passes the copy, corner and dot tone.
 */
export const CornerBadge = ({
  corner,
  tone,
  label,
  testId,
}: {
  corner: 'left' | 'right';
  /** Dot hue: amber for an in-progress / armed cue, red for a failure, green for a recovery. */
  tone: 'warning' | 'error' | 'success';
  label: string;
  testId: string;
}) => (
  <Box
    data-testid={testId}
    role="status"
    sx={{
      position: 'fixed',
      top: 16,
      [corner]: 16,
      zIndex: 2000,
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      px: 1.5,
      py: 0.5,
      border: '2px solid',
      borderColor: 'common.white',
      borderRadius: 1,
      bgcolor: colors.overlay.scrim,
    }}
  >
    <Box
      aria-hidden
      sx={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        bgcolor: `${tone}.main`,
        '@keyframes cornerBadgePulse': {
          '0%, 100%': { opacity: 0.4 },
          '50%': { opacity: 1 },
        },
        animation: 'cornerBadgePulse 1.2s infinite',
      }}
    />
    <Typography
      sx={{
        color: 'common.white',
        fontFamily: fonts.display,
        fontWeight: 600,
        fontSize: '0.875rem',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        lineHeight: 1,
      }}
    >
      {label}
    </Typography>
  </Box>
);

/**
 * The chroma-suppression guard shared by the relay-driven corner badges
 * (Connecting / ConnectionLost): a badge must never paint over a chroma-keyed
 * ground, or the keyer would pass it through onto air. Resolves the surface's
 * effective background from `?bg=` (falling back to `defaultBg`) and reports
 * whether it is a keyed ground. The key-composite mode (`?bg=h2r`) counts too:
 * its ground is transparent here, but the frame is flattened onto a chroma
 * ground and keyed downstream, so a badge would hit air all the same.
 * AudioMutedBadge deliberately opts out (its cue must survive even on the
 * keyed projector rig).
 */
export const useChromaSuppressed = (defaultBg: string): boolean => {
  const { search } = useLocation();
  return (
    isKeyCompositeOverlay(search) || isChromaBackground(resolveOverlayBackground(search, defaultBg))
  );
};
