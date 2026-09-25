import React from 'react';
import { Box, Stack } from '@mui/material';

import { colors } from 'app/theme/tokens';
import { PRE_BEEP_PHASE } from 'app/hooks/useStartSignalTimer';

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
// Any other phase (-1 after the sequence completes) leaves the housing dark.
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

const RaceStartSignal: React.FC<Props> = ({ currentPhase, size }) => {
  const [left, right] = bulbColors(currentPhase);

  const sizeProps = size === 'small' ? { width: 30, height: 30 } : { width: 60, height: 60 };

  // Show the housing for the whole armed→SET→GO sequence (phases 0–3); hide it
  // once the sequence has been cleared (phase -1).
  const visible = currentPhase >= 0 && currentPhase <= 3;

  const bulbSx = (fill: string) => ({
    width: sizeProps.width,
    height: sizeProps.height,
    borderRadius: '50%',
    backgroundColor: fill,
    transition: 'background-color 0.5s ease',
    border: `1px solid ${colors.surface.void}`,
  });

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        display: visible ? 'flex' : 'none',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box data-testid="start-bulb-0" sx={bulbSx(left)} />
      <Box data-testid="start-bulb-1" sx={bulbSx(right)} />
    </Stack>
  );
};

export default RaceStartSignal;
