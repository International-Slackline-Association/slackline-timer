import { Chip, Link, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import type { TimeInput } from 'app/api/times';
import { LockedControl } from 'app/components/LockedControl';
import { RaceButton, blurOnClickProps } from 'app/components/RaceButton';
import { SelectField } from 'app/components/SelectField';
import { WhyLine } from 'app/components/WhyLine';
import type { LaneId, RaceRecorder } from 'app/hooks/useRaceRecorder';
import { space } from 'app/theme/tokens';
import type { Athlete } from 'app/types';
import { athleteOptions } from 'app/util/athleteOptions';
import { laneName } from 'app/util/raceNames';
import type { SpeedlineLaneState } from 'app/util/timerSnapshot';
import { DNF_SENTINEL, formatMs, isValidTimeFormat, parseTimeString } from 'app/util/time';
import { timeCorrectionHref } from 'app/util/timesLink';
import { StopwatchControl } from './StopwatchControl';

/**
 * The Times page filtered to the row a lane recorded. A new tab, never a route:
 * the board is a live timing surface, and navigating away would drop its
 * socket mid-run.
 */
const TimesPageLink = ({ input }: { input: TimeInput }) => (
  <Link
    href={timeCorrectionHref(input.round, input.athleteId)}
    target="_blank"
    rel="noopener"
    {...blurOnClickProps<HTMLAnchorElement>()}
  >
    Times page ↗
  </Link>
);

/**
 * Inline `M:SS.hh` correction for an already-saved lane time (hand timers
 * differ from the system clock). Seeds from the recorded value and commits on
 * Enter / blur via the recorder's existing update path; a no-change or DNF
 * value is left to the operator (a DNF is corrected on the Times page).
 */
const LaneTimeEdit = ({
  valueMs,
  input,
  onCommit,
}: {
  valueMs: number;
  input: TimeInput;
  onCommit: (timeMs: number) => void;
}) => {
  const [str, setStr] = useState(() => formatMs(valueMs));
  // Re-seed when the persisted value changes (a fresh save or an accepted edit).
  useEffect(() => setStr(formatMs(valueMs)), [valueMs]);

  const isDnf = valueMs === DNF_SENTINEL;
  const invalid = !isDnf && !isValidTimeFormat(str);

  const commit = (): void => {
    if (invalid) return;
    const ms = parseTimeString(str) ?? 0;
    if (ms !== valueMs) onCommit(ms);
  };

  return (
    <TextField
      label="Correct time"
      size="small"
      value={isDnf ? formatMs(DNF_SENTINEL) : str}
      disabled={isDnf}
      error={invalid}
      placeholder="M:SS.hh"
      // The format lives in the placeholder while the value is good: a helper
      // line under every lane costs ~20 px of the 720 px desk's fold budget for
      // a hint the field is already showing back. It comes out for the two
      // states that have something to SAY.
      helperText={
        isDnf ? (
          <>
            Edit a DNF on the <TimesPageLink input={input} />
          </>
        ) : invalid ? (
          'M:SS.hh'
        ) : undefined
      }
      onChange={(e) => setStr(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      sx={{ width: '100%' }}
    />
  );
};

interface Props {
  lane: LaneId;
  recorder: RaceRecorder;
  athletes: Athlete[];
  laneState: SpeedlineLaneState;
  onStop: () => void;
  /** Why this lane's Stop is inert, from the board's interlock table. */
  stopLock: string | null;
  onResume: () => void;
  /** Why this lane's Resume is inert, from the same table. */
  resumeLock: string | null;
  onFlagFs: () => void;
  /** Mark the lane DNF — the page's, not the recorder's, because a fall also
   * freezes the lane's clock and tells the room (see `dnfLane`). */
  onDnf: () => void;
}

/**
 * One lane of the Speedline desk's live column: the clock and its Stop, then
 * everything that lane's result needs — who is on it, the attempts it has left,
 * its false-start flag, and the chip that says whether the time reached the
 * server.
 *
 * The recording controls sit IN the lane rather than in a rail below the board
 * (`speedline-desk-layout`): the operator reads a stop and its save as one
 * event, and the board's two identical columns are only telling apart by what
 * stands inside them. Everything here is lane-scoped by construction — the
 * cross-lane surface (round/gender/match, Swap, the series, the false-start
 * advisory) is the recording rail's, `RaceRecorderControls`.
 *
 * The order is a fold contract (`speedline-lane-post-stop-layout-shift`):
 * everything down to and including the race pair (False start / Lane n DNF) is
 * always present or height-reserved, so a stop cannot move the pair under a
 * hand already reaching for it. What the run PRODUCES — the 2nd-FS caption, a
 * failed save's Retry, the correction field, the re-attribution — sits below
 * the pair, where the column may grow: none of it is pressed in a hurry.
 */
export const RaceLaneColumn = ({
  lane,
  recorder,
  athletes,
  laneState,
  onStop,
  stopLock,
  onResume,
  resumeLock,
  onFlagFs,
  onDnf,
}: Props) => {
  const {
    round,
    laneAthletes,
    setLaneAthlete,
    laneAttempts,
    attemptCap,
    editLaneTime,
    moveTime,
    retrySave,
    fsCounts,
    clearFs,
    laneFeedback,
    selectedGender,
    selectedMatchId,
    matches,
  } = recorder;

  const athleteName = (id?: string): string =>
    (id && athletes.find((a) => a.athleteId === id)?.name) || 'TBD';

  // The cascading option pool (ADR 0042): the
  // selected match narrows the lane to its two athletes, else gender narrows.
  const selectedMatch = matches.data?.find((m) => m.matchId === selectedMatchId);

  const feedback = laneFeedback[lane];
  const saved = feedback?.saved;
  // A save still bound to the athlete it was POSTed under after the lane was
  // re-picked (`speedline-wrong-athlete-reattribute`). The chip then names that
  // athlete rather than implying the time belongs to whoever is on the lane now.
  const boundElsewhere =
    saved !== undefined &&
    Boolean(laneAthletes[lane]) &&
    saved.input.athleteId !== laneAthletes[lane];

  const statusChip = () => {
    if (!feedback) return null;
    const value = formatMs(feedback.valueMs);
    const bound = boundElsewhere ? ` · ${athleteName(saved?.input.athleteId)}` : '';
    if (feedback.status === 'pending')
      return <Chip size="small" variant="outlined" label={`Saving ${value}…`} />;
    if (feedback.status === 'error')
      return <Chip size="small" color="error" label={`Not saved ${value}${bound}`} />;
    return <Chip size="small" color="success" label={`Saved ${value}${bound}`} />;
  };

  return (
    <Stack spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
      <StopwatchControl
        id={lane}
        laneState={laneState}
        stop={onStop}
        lock={stopLock}
        name={laneName(laneAthletes[lane], athletes)}
      />

      {/* The undo of the Stop directly under it — the operator reads the
          mis-press and its recovery as one event. Neutral, not a race tone: it
          un-does, it does not drive the race. Standing in every state (per the
          fold contract above), it carries its reason instead of vanishing:
          "Lane n is not stopped" before, "run has resolved" after — printed in
          a slot reserved while Resume is live, so the picker and the race pair
          hold still as the window opens and closes. No handset key reaches it
          — see the pad effect on the ControlPage. */}
      <LockedControl reason={resumeLock}>
        <RaceButton tone="neutral" disabled={resumeLock !== null} onClick={onResume}>
          Resume Lane {lane}
        </RaceButton>
      </LockedControl>
      <WhyLine reason={resumeLock} />

      <SelectField
        label={`Lane ${lane} athlete`}
        value={laneAthletes[lane]}
        onChange={(e) => setLaneAthlete(lane, e.target.value)}
        sx={{ width: '100%' }}
        placeholder={{ value: '', label: '— not recording —' }}
        options={athleteOptions(athletes, selectedGender, selectedMatch, laneAthletes[lane]).map(
          (a) => ({ value: a.athleteId, label: a.name }),
        )}
      />

      {/* The lane's state in one strip — attempts left, jumps flagged, whether
          the result reached the server. Three chips on their own rows cost
          ~60 px of a 720 px desk's fold budget to say three short things that
          belong together, and the operator reads them as one answer anyway. */}
      <Stack
        data-testid={`lane-${lane}-status`}
        direction="row"
        spacing={0.5}
        useFlexGap
        // One small chip tall whether or not a chip stands in it — the Saved
        // chip lands mid-run, and a row that grew to receive it would move the
        // race pair below.
        sx={{ flexWrap: 'wrap', justifyContent: 'center', minHeight: space.unit * 3 }}
      >
        {/* Rule S5: qualification is two attempts per athlete. Badge the
            used count and lock the lane at the cap (admin CRUD corrects). */}
        {round === 'qualification' && laneAthletes[lane] && (
          <Chip
            size="small"
            variant="outlined"
            color={laneAttempts[lane].capped ? 'warning' : 'default'}
            label={`${laneAttempts[lane].used}/${attemptCap} attempts`}
          />
        )}
        {fsCounts[lane] > 0 && (
          <Chip
            size="small"
            color="error"
            variant={fsCounts[lane] >= 2 ? 'filled' : 'outlined'}
            label={`FS ×${fsCounts[lane]}`}
            onDelete={() => clearFs(lane)}
          />
        )}
        {statusChip()}
      </Stack>
      {/* Per-lane false-start flag (rules S2–S4) — always armed: a jump can be
          reviewed on video after the run, so unlike Abort Start it is not
          phase-gated. A mis-tap undoes via the chip's clear. The label is spelt
          out: "FS" is the app's Freestyle shorthand everywhere else, and the
          abbreviated pair wrapped its row in the lane column besides. */}
      <RaceButton tone="dnf" onClick={onFlagFs} sx={{ whiteSpace: 'nowrap' }}>
        False start · Lane {lane}
      </RaceButton>
      <RaceButton
        tone="dnf"
        disabled={!laneAthletes[lane] || laneAttempts[lane].capped}
        onClick={onDnf}
      >
        Lane {lane} DNF
      </RaceButton>

      {fsCounts[lane] >= 2 && (
        <Typography variant="caption" color="error.dark" sx={{ textAlign: 'center' }}>
          2nd false start — attempt failed, no time recorded
        </Typography>
      )}
      {/* A POST that did not land carries its recovery: the re-send and the
          row on the Times page (a failed correction re-commits from its own
          field). Below the pair, per the fold contract: the reserved strip
          above holds one chip, not a 44 px press. */}
      {feedback?.failed && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}
        >
          <RaceButton
            tone="save"
            disabled={feedback.status === 'pending'}
            onClick={() => retrySave(lane)}
          >
            Retry save
          </RaceButton>
          <Typography variant="body2">
            <TimesPageLink input={feedback.failed.input} />
          </Typography>
        </Stack>
      )}
      {saved && (
        <LaneTimeEdit
          valueMs={feedback.valueMs}
          input={saved.input}
          onCommit={(ms) => editLaneTime(lane, ms)}
        />
      )}
      {/* The recovery for a result recorded against the wrong person: one tap,
          and explicit — a re-pick may be exploratory, so nothing moves until
          the operator says to (rejected: auto-move on pick, silent clear). */}
      {boundElsewhere && (
        <RaceButton tone="save" onClick={() => moveTime(lane)}>
          Move time to {athleteName(laneAthletes[lane])}
        </RaceButton>
      )}
    </Stack>
  );
};
