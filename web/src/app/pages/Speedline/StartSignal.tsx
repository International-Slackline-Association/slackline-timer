import React from 'react';
import { Box, Stack } from '@mui/material';

import { colors, overlayArt } from 'app/theme/tokens';
import { PRE_BEEP_PHASE } from 'app/hooks/useStartSignalTimer';
import { Plate } from 'app/pages/Stream/Plate';
import { refVh } from 'app/util/overlayScale';

interface Props {
  currentPhase: number;
  size?: 'small' | 'large';
}

// Race-state tokens for the two-bulb start light. Each phase is mapped to a
// pair of bulb fills (left, right):
//   0  idle — both dark/unlit (race.idle); no run is armed, so the housing sits
//      dark between zeroed clocks. It must NOT be red: red-red on air reads as an
//      error/recording indicator and collides with the abort colour language
//      (ADR 0041; "armed standby" is retired).
//   PRE_BEEP_PHASE  armed — both red (race.stop); the T-5s pre-beep cue arms the
//                   light (no numbered lights lit yet) ahead of the 2-1-GO run.
//   1  first SET tone — left amber (race.set), right dark/off
//   2  second SET tone — both amber (race.set)
//   3  GO — both green (race.go)
// Any other phase (-1, cleared) falls to idle behind the hidden housing.
const bulbColors = (phase: number): [string, string] => {
  switch (phase) {
    case PRE_BEEP_PHASE:
      return [colors.race.stop, colors.race.stop];
    case 1:
      return [colors.race.set, colors.race.idle];
    case 2:
      return [colors.race.set, colors.race.set];
    case 3:
      return [colors.race.go, colors.race.go];
    case 0:
    default:
      return [colors.race.idle, colors.race.idle];
  }
};

/**
 * The overlay/preview housing, reference px on the 1920×1080 capture frame
 * (design-system §7): a sharp `void` plate, its pad equal to the bulb gap so the
 * two bulbs sit evenly spaced in it. The edge is the shared plate stroke, emitted
 * frame-relative so it scales with the bulbs off 1080p.
 */
const HOUSING = { bulb: 60, gap: 8, pad: 8, stroke: parseFloat(overlayArt.strokeWidth) } as const;

// No `transition` on the bulbs, at either size: every phase change — GO above
// all — is a hard cut so start perception stays crisp (design-system §8).
const RaceStartSignal: React.FC<Props> = ({ currentPhase, size }) => {
  const [left, right] = bulbColors(currentPhase);
  const small = size === 'small';
  const bulbSize = small ? 30 : refVh(HOUSING.bulb);

  // Lit for the whole armed→SET→GO sequence (phases 0–3), out once it clears
  // (-1). The control's bare bulbs keep their slot — Start / Abort / Reset sit
  // under them and must not lift mid-run — but never paint idle grey after GO,
  // which would read as re-armed. The housing leaves the flow (design-system §6).
  const lit = currentPhase >= 0 && currentPhase <= 3;
  const layoutSx = {
    ...(small
      ? { display: 'flex', visibility: lit ? 'visible' : 'hidden' }
      : { display: lit ? 'flex' : 'none' }),
    alignItems: 'center',
    justifyContent: 'center',
  };

  const bulbSx = (fill: string) => ({
    width: bulbSize,
    height: bulbSize,
    borderRadius: '50%',
    backgroundColor: fill,
    // The control page's bulbs sit on the light board with no housing behind them.
    ...(small && { border: `1px solid ${colors.surface.void}` }),
  });

  const bulbs = (
    <>
      <Box data-testid="start-bulb-0" sx={bulbSx(left)} />
      <Box data-testid="start-bulb-1" sx={bulbSx(right)} />
    </>
  );

  return small ? (
    <Stack direction="row" spacing={1} sx={layoutSx}>
      {bulbs}
    </Stack>
  ) : (
    <Plate
      data-testid="start-signal-housing"
      fill={colors.surface.void}
      strokeWidth={refVh(HOUSING.stroke)}
      sx={{ ...layoutSx, gap: refVh(HOUSING.gap), p: refVh(HOUSING.pad) }}
    >
      {bulbs}
    </Plate>
  );
};

export default RaceStartSignal;
