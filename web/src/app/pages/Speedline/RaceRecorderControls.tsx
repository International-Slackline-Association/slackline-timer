import { Alert, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useState } from 'react';

import { BoardConfirmDialog } from 'app/components/BoardConfirmDialog';
import { MatchWinnerLine } from 'app/components/MatchWinnerLine';
import { RaceButton } from 'app/components/RaceButton';
import { SelectField } from 'app/components/SelectField';
import { SelectionChangeConfirmDialog } from 'app/components/SelectionChangeConfirmDialog';
import { WhyLine } from 'app/components/WhyLine';
import type { RaceRecorder } from 'app/hooks/useRaceRecorder';
import { GENDERS, TIME_ROUNDS, type Athlete } from 'app/types';
import { apiErrorMessage } from 'app/util/apiError';
import { genderLabel } from 'app/util/gender';
import { matchLabel } from 'app/util/matchLabel';
import { roundLabel } from 'app/util/rounds';
import { formatMs } from 'app/util/time';

/**
 * The desk's recording rail: everything about a run that is not lane-scoped —
 * which round, gender and match is being recorded, which side each athlete is
 * on, how the best-of-3 stands, what the false-start rules advise, and whether
 * a write reached the server.
 *
 * The per-lane half (athlete, attempts, false-start flag, saved chip, time
 * correction, DNF) lives in the lane columns of the live path itself
 * (`RaceLaneColumn`), where a stop and its save read as one event.
 *
 * Selecting nothing keeps the timer purely visual (training/warm-up) —
 * recording is opt-in per lane.
 */
export const RaceRecorderControls = ({
  recorder,
  athletes,
  swapLock = null,
}: {
  recorder: RaceRecorder;
  athletes: Athlete[];
  /** Why the lane swap is inert, from the board's interlock table
   * (`app/util/speedlineLocks`), or null while it is live. */
  swapLock?: string | null;
}) => {
  const {
    round,
    requestRound,
    requestGender,
    pendingChange,
    confirmPendingChange,
    cancelPendingChange,
    roundMatches,
    laneAthletes,
    swapLanes,
    voidRun,
    fsOutcome,
    awardRunTo,
    createTime,
    updateTime,
    deleteTime,
    laneFeedback,
    selectedGender,
    selectedMatchId,
    selectMatch,
    updateMatch,
    derivedWinner,
    runWins,
    resetSeries,
  } = recorder;

  const athleteName = (id?: string): string =>
    (id && athletes.find((a) => a.athleteId === id)?.name) || 'TBD';

  // A run can be voided once at least one lane has a persisted Time to delete.
  const canVoid = Boolean(laneFeedback[1]?.saved || laneFeedback[2]?.saved);

  /**
   * The two rail presses that spend something the operator cannot get back —
   * persisted Times and the on-air best-of-3 — behind the board's one confirm
   * shell (`speedline-void-run-reset-series-confirm`). Both had fired on a
   * single press while the harmless Reset asked.
   *
   * Both follow §4.8's "nothing spent, no question": a void with no Time saved
   * deletes nothing (the false-start rerun case, where the run never recorded)
   * and a 0–0 series has no tally to lose, so each applies instantly there —
   * the question exists for what it names, not as ceremony.
   *
   * Each question CAPTURES what it is about (null = not asked), rather than
   * re-deriving it: the answer clears the very state the words came from, and
   * MUI keeps the dialog mounted through its exit transition — a live read
   * would flicker to "Deletes ." / "Reset the 0–0 series?" on the way out.
   */
  const [voidAsked, setVoidAsked] = useState<string[] | null>(null);
  const [resetSeriesAsked, setResetSeriesAsked] = useState<string | null>(null);

  // The saved Times a void would delete, in the words the lane chips use.
  const voidCost = ([1, 2] as const).flatMap((lane) => {
    const feedback = laneFeedback[lane];
    return feedback?.saved
      ? [`Saved ${formatMs(feedback.valueMs)} (${athleteName(feedback.saved.input.athleteId)})`]
      : [];
  });

  const requestVoid = (): void => (voidCost.length === 0 ? voidRun() : setVoidAsked(voidCost));
  const confirmVoid = (): void => {
    setVoidAsked(null);
    voidRun();
  };

  const requestResetSeries = (): void =>
    runWins[1] + runWins[2] > 0
      ? setResetSeriesAsked(`${runWins[1]}–${runWins[2]}`)
      : resetSeries();
  const confirmResetSeries = (): void => {
    setResetSeriesAsked(null);
    resetSeries();
  };

  // False-start advisory (rules S2–S4): only acted on with a match selected (the
  // head judge resolves the round). The strip states the advised consequence and
  // offers its one-tap action; when it owns a void/award action the standalone
  // "Void run" button is hidden so there is never a duplicate/ambiguous control.
  const fsAdvised = selectedMatchId ? fsOutcome : ({ kind: 'none' } as const);
  const fsHasAction =
    fsAdvised.kind === 'rerun-round' ||
    fsAdvised.kind === 'rerun-start' ||
    fsAdvised.kind === 'round-to-opponent';
  const fsAdvice = (o: typeof fsAdvised): string => {
    switch (o.kind) {
      case 'rerun-round':
        return 'Both lanes false-started — void the run and rerun.';
      case 'rerun-start':
        return `Lane ${o.offender} false-started and won — a start rerun is advised.`;
      case 'round-to-opponent':
        return `Lane ${o.offender}'s 2nd false start forfeits the round.`;
      case 'awaiting-finish':
        return `Lane ${o.offender} false-started — the run continues; video review decides (rule S4).`;
      case 'result-stands':
        return `Lane ${o.offender} false-started but the clean lane won — result stands.`;
      default:
        return '';
    }
  };

  return (
    <Paper component="section" aria-label="Result recording" variant="outlined" sx={{ p: 2 }}>
      {/* The gutter is load-bearing (`speedline-recording-rail-heading-gap`):
          MUI floats the outlined Round label 9 px ABOVE its own field box, so a
          heading sitting flush on the row is overprinted by it at every desk
          width. Measured, not guessed — 8 px still left a 1 px overlap at
          1920/1440/1280/1024; `mb: 2` clears the float by 7 px and is the
          rail's own row rhythm (`Stack spacing={2}`), so the heading sits one
          gap above the first field like every other gap in the card. The
          caption dialect is the desk's (§6): the fix is the gap, not a heavier
          heading. */}
      <Typography variant="overline" component="div" sx={{ letterSpacing: '0.1em', mb: 2 }}>
        Result recording
      </Typography>
      <Stack spacing={2}>
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <TextField
            label="Round"
            select
            value={round}
            onChange={(e) => requestRound(e.target.value as (typeof TIME_ROUNDS)[number])}
            sx={{ minWidth: 160, flex: '1 1 160px' }}
          >
            {TIME_ROUNDS.map((r) => (
              <MenuItem key={r} value={r}>
                {roundLabel(r)}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Gender"
            select
            value={selectedGender}
            onChange={(e) => requestGender(e.target.value as (typeof GENDERS)[number])}
            sx={{ minWidth: 130, flex: '1 1 130px' }}
          >
            {GENDERS.map((g) => (
              <MenuItem key={g} value={g}>
                {genderLabel(g)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <SelectField
          label="Match (speed)"
          value={selectedMatchId}
          onChange={(e) => selectMatch(e.target.value)}
          helperText="Fills both lanes; sets the match winner once both finish"
          sx={{ width: '100%' }}
          placeholder={{ value: '', label: '— no match —' }}
          options={roundMatches.map((m) => ({
            value: m.matchId,
            label: matchLabel(m, athleteName),
          }))}
        />

        {/* Colourless chrome — no state to name, so no tone — but a press on
            the desk all the same, and the wrapper is what carries the 44 px
            target and the blur rule (§6/§4.4). The empty-selection disable
            says itself in the lane pickers; only the race lock needs the line. */}
        <Stack sx={{ alignItems: 'flex-start' }}>
          <RaceButton
            variant="outlined"
            startIcon={<SwapHorizIcon />}
            disabled={(!laneAthletes[1] && !laneAthletes[2]) || swapLock !== null}
            onClick={swapLanes}
            aria-label="Swap lanes"
          >
            Swap
          </RaceButton>
          <WhyLine reason={swapLock} />
        </Stack>

        {selectedMatchId && (
          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{
              alignItems: 'center',
              flexWrap: 'wrap',
              p: 1.5,
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
              Best of 3
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
              {([1, 2] as const).map((lane) => {
                const leads = runWins[lane] > runWins[lane === 1 ? 2 : 1];
                return [
                  lane === 2 && (
                    <Typography key="dash" component="span" variant="h6" color="text.disabled">
                      –
                    </Typography>
                  ),
                  <Typography
                    key={lane}
                    component="span"
                    variant="h5"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 700,
                      color: leads ? 'success.main' : 'text.primary',
                    }}
                  >
                    {runWins[lane]}
                  </Typography>,
                ];
              })}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              ({athleteName(laneAthletes[1])} vs {athleteName(laneAthletes[2])})
            </Typography>
            <RaceButton variant="outlined" onClick={requestResetSeries} sx={{ ml: 'auto' }}>
              Reset series
            </RaceButton>
          </Stack>
        )}

        {selectedMatchId && fsAdvised.kind !== 'none' && (
          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{
              alignItems: 'center',
              flexWrap: 'wrap',
              p: 1.5,
              borderRadius: 1,
              border: 1,
              borderColor: 'error.main',
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="overline" color="error.dark" sx={{ letterSpacing: '0.08em' }}>
              False start
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {fsAdvice(fsAdvised)}
            </Typography>
            {(fsAdvised.kind === 'rerun-round' || fsAdvised.kind === 'rerun-start') && (
              <RaceButton tone="stop" onClick={requestVoid} sx={{ ml: 'auto' }}>
                Void run &amp; rerun
              </RaceButton>
            )}
            {fsAdvised.kind === 'round-to-opponent' && (
              <RaceButton
                tone="save"
                onClick={() => awardRunTo(fsAdvised.opponent)}
                sx={{ ml: 'auto' }}
              >
                Award round to {athleteName(laneAthletes[fsAdvised.opponent])}
              </RaceButton>
            )}
          </Stack>
        )}

        {!fsHasAction && (
          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <RaceButton tone="stop" disabled={!canVoid} onClick={requestVoid}>
              Void run
            </RaceButton>
            <Typography variant="caption" color="text.secondary">
              Deletes this run&apos;s recorded times
            </Typography>
          </Stack>
        )}

        {selectedMatchId && (
          <MatchWinnerLine derivedWinner={derivedWinner} athleteName={athleteName} />
        )}

        {createTime.isError && (
          <Alert severity="warning">
            Time not saved: {apiErrorMessage(createTime.error)} (timing is unaffected)
          </Alert>
        )}

        {updateTime.isError && (
          <Alert severity="warning">
            Time not updated: {apiErrorMessage(updateTime.error)} (timing is unaffected)
          </Alert>
        )}

        {deleteTime.isError && (
          <Alert severity="warning">
            Run not voided: {apiErrorMessage(deleteTime.error)} (timing is unaffected)
          </Alert>
        )}

        {updateMatch.isError && (
          <Alert severity="warning">
            Match not updated: {apiErrorMessage(updateMatch.error)} (timing is unaffected)
          </Alert>
        )}
      </Stack>

      <BoardConfirmDialog
        open={voidAsked !== null}
        titleId="void-run-confirm-title"
        title="Void this run?"
        body={
          voidAsked === null ? null : `Deletes ${voidAsked.join(' and ')}. This cannot be undone.`
        }
        confirmLabel="Void run"
        safeAnswer="Keep times"
        onConfirm={confirmVoid}
        onCancel={() => setVoidAsked(null)}
      />

      <BoardConfirmDialog
        open={resetSeriesAsked !== null}
        titleId="reset-series-confirm-title"
        title={`Reset the ${resetSeriesAsked ?? ''} series?`}
        body="The runs each athlete has won are cleared here and on the rounds-summary graphic. The recorded times are kept."
        confirmLabel="Reset series"
        safeAnswer="Keep series"
        onConfirm={confirmResetSeries}
        onCancel={() => setResetSeriesAsked(null)}
      />

      <SelectionChangeConfirmDialog
        pendingChange={pendingChange}
        round={round}
        clearsClause="the selected match, both lane athletes, and the best-of-3 series"
        onKeep={cancelPendingChange}
        onConfirm={confirmPendingChange}
      />
    </Paper>
  );
};
