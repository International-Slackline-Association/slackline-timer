import { Typography } from '@mui/material';
import { Stack } from '@mui/system';
import { LockedControl } from 'app/components/LockedControl';
import { RaceButton } from 'app/components/RaceButton';
import { WhyLine } from 'app/components/WhyLine';
import type { SpeedlineLaneState } from 'app/util/timerSnapshot';
import { Stopwatch } from './Stopwatch';

interface Props {
  id: number;
  /**
   * The control page owns lane timer state and drives this column through it
   * (ADR 0027): the numeral renders from `laneState` and the Stop button is
   * enabled only while the lane is running — no dependency on the relay echo.
   */
  laneState: SpeedlineLaneState;
  isReady: boolean;
  stop(): void;
  /** Why this lane's Stop is inert, from the page's interlock table
   * (`app/util/speedlineLocks`), or null while it is live. */
  lock: string | null;
  /** Assigned athlete's display name for this lane, shown under the column heading. */
  name?: string;
}

export const StopwatchControl = (props: Props) => {
  return (
    <Stack
      direction="column"
      spacing={1}
      sx={{
        alignItems: 'center',
      }}
    >
      {/* The lane number names the column; the athlete on it is what the
          operator actually reads, so the numeral stays the smaller of the two
          headings — and the 720 px desk has no fold budget for a display-size
          word above a display-size clock. */}
      <Typography variant="h5">Lane {props.id}</Typography>
      {props.name && (
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
          {props.name}
        </Typography>
      )}
      <Stopwatch
        lastJsonMessage={undefined}
        isReady={props.isReady}
        timerId={props.id}
        laneState={props.laneState}
        size="control"
      />
      {/* The live-path control contract (FREESTYLE_BOARD_UX §6): the contained
          stop tier lights only while this lane runs, the disabled tier holds it
          otherwise, and the why-line under it says which (§4.7). The per-lane
          accessible name disambiguates the board's two identical columns — for
          a screen reader, and for a test that would otherwise address a lane by
          DOM position. The lock's words ride the wrapper as the button's
          accessible DESCRIPTION, so a reader is given the same sentence the
          why-line prints under it. */}
      <LockedControl reason={props.lock}>
        <RaceButton
          tone="stop"
          size="race"
          aria-label={`Stop Lane ${props.id}`}
          onClick={props.stop}
          disabled={props.lock !== null}
        >
          Stop
        </RaceButton>
      </LockedControl>
      <WhyLine reason={props.lock} />
    </Stack>
  );
};
