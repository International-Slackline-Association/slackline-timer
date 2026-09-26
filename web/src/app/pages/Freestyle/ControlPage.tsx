import { Box, Stack, Typography, useMediaQuery } from '@mui/material';
import { type ReactNode } from 'react';
import { ControlStatusHeader } from 'app/components/ControlStatusHeader';
import { RecorderToast } from 'app/components/RecorderToast';
import { useFreestyleBoard } from 'app/hooks/useFreestyleBoard';
import { useSessionId } from 'app/hooks/useControlSession';
import { liveCaption } from 'app/theme/tokens';
import type { PlayerId } from 'app/util/breakState';
import { currentStep, type BoardStep } from 'app/util/boardStep';
import { athleteLabel } from 'app/util/raceNames';
import { roundLabel } from 'app/util/rounds';
import { BestTrickPanel } from './BestTrickPanel';
import { NBSP } from './cardText';
import { CountdownControl } from './CountdownControl';
import { CompactBoardLayout } from './CompactBoardLayout';
import { DeskSection } from './DeskSection';
import { FreestyleScoreControls } from './FreestyleScoreControls';
import { FreestyleSelectionPanel } from './FreestyleSelectionPanel';
import { FreestyleSetupPanel } from './FreestyleSetupPanel';
import { HandsetCard } from './HandsetCard';
import { PauseClock } from './PauseClock';
import { TallyPlate } from './TallyPlate';
import { WarmupCard } from './WarmupCard';
/**
 * The board layout (FREESTYLE_BOARD_UX §2): three fixed columns at ≥1280×800 so
 * the clocks, the plate and both Save buttons share one 1440×900 screen —
 * setup and warm-up left, the live column centre, the score rail right. Outside
 * that box the live flow collapses to tabs so only one step has to fit at a
 * time; Setup becomes a secondary surface there, holding the warm-up, setup
 * details and handset help while the active step stays in view.
 *
 * The gate is width AND height (fsux-desk-fold-budget): a 1280×720 screen is
 * wide enough for the three columns and too short to hold them, so it took the
 * desk and put the lane transport under the fold. Height is the scarce axis on
 * a laptop, and the tab layout is the answer to a short screen exactly as it is
 * to a narrow one.
 *
 * The height half is **900**, not the 800 it shipped at: measured with the
 * fold budget spent down (`freestyle-board-fold-budget`), the battle desk's
 * last control lands at 879 and quali's at 862, so 800 was a promise the
 * layout could not keep — at 1280×800 it took the desk and put End turn,
 * Reset and Athlete 2's Save under the fold in both modes. 900 is the
 * responsive contract's laptop and the nearest honest threshold above what the
 * desk measures; everything shorter gets the tab layout, which holds every
 * lane and Save control above a 720 px fold.
 *
 * The columns stretch to the desk row rather than to their own content: the
 * plate is `position: sticky` inside the live column, and a sticky box may not
 * leave its containing block — a content-sized column releases it at its own
 * foot, taking the buzzer's twin off screen while a longer rail keeps scrolling.
 * Each column's sections stay top-aligned; only the box grows.
 */
const DESK_SX = {
  width: '100%',
  display: 'grid',
  gap: 2,
  gridTemplateColumns: '1fr',
  alignItems: 'stretch',
  '@media (min-width:1280px) and (min-height:900px)': {
    gridTemplateColumns: '248px minmax(0, 1fr) 360px',
  },
} as const;
/** The live column's width ceiling: two lane cards plus the changeover gutter
 * read as one board up to 800 px, and stop growing into a scan across the desk.
 *
 * The sticky plate takes this ceiling too. Spanning the whole live column
 * (`VW - 672`) hung its right-hand verb 448 px clear of the lane it names at
 * 1920. */
const RUN_MAX_WIDTH = 800;
/**
 * Quali runs one athlete, so its deck is the single centred card (§2) — and it
 * is the one deck the plate does NOT follow. Measured in a browser (jsdom lays
 * nothing out): at 500 px the `TAKE BREAK` verb wraps its reserved slot at the
 * 1920 type scale, which grows the sticky plate 137 px and steps the deck under
 * the operator's hand the moment a run starts. A wrapped verb breaks §4.12; a
 * plate that overhangs its 500 px deck is a cosmetic mismatch. So quali keeps
 * the full column (owner's pre-decided branch, `fsux-tally-plate-width`).
 */
const QUALI_RUN_MAX_WIDTH = 500;
/**
 * The Freestyle control board — layout only. Every machine, relay send, beep
 * and expiry timeout lives in `useFreestyleBoard`; this file decides what the
 * operator sees and where (the desk of FREESTYLE_BOARD_UX §2, laying out the
 * numbered chronology of ADR 0036), and hands each panel the slice of the board
 * it renders.
 *
 * The desk is read by landmark, not by outline: every panel names itself as a
 * section (`DeskSection`, the handset card, each lane card, both score panels)
 * and its visible title is plain text, so the console header's `h1` is the only
 * heading on the page. A panel title that declares a heading element — or lets
 * MUI's `subtitle*`/`h6` variants declare one for it — lands at whatever level
 * it was typed at, under a page with nothing at level 2 to hold it.
 */
export const FreestyleControlPage = () => {
  const wideDesk = useMediaQuery('(min-width:1280px) and (min-height:900px)');
  const sessionId = useSessionId();
  const { chrome, selection, format, warmup, lanes, advance, bestTrick } =
    useFreestyleBoard(sessionId);
  const { recorder } = selection;
  /** The deck's ceiling, and the sticky plate's above it — except in quali,
   * where the plate keeps the column (see `QUALI_RUN_MAX_WIDTH`). */
  const deckMaxWidth = format.mode === 'quali' ? QUALI_RUN_MAX_WIDTH : RUN_MAX_WIDTH;
  /** The selection row is NOT on the deck's ceiling. `QUALI_RUN_MAX_WIDTH` is a
   * clock-deck measurement (the TAKE BREAK verb's wrap), and quali's flattened
   * four-field row does not fit in it: at 500 px the four selects land at ~115 px
   * each and clip their own option text. It takes the same ceiling battle's row
   * does, which is where quali's sticky plate already sits. */
  const selectionMaxWidth = RUN_MAX_WIDTH;
  const plateMaxWidth = format.mode === 'quali' ? 'none' : RUN_MAX_WIDTH;
  const hasAthlete = Boolean(recorder.athletes[1] || recorder.athletes[2]);
  const names = selection.athleteNames;
  const step = currentStep({
    mode: format.mode,
    battle: lanes.battle,
    trySeries: bestTrick.series,
    warmupRunning: warmup.running,
    hasAthlete,
  });
  const section = (id: BoardStep, children: ReactNode) => (
    <DeskSection step={id} current={step} mode={format.mode} showCaption={wideDesk}>
      {children}
    </DeskSection>
  );
  const laneControl = (lane: PlayerId) => (
    <CountdownControl
      id={lane}
      // The held-run reserve costs a row of the lane card, and only a quali
      // lane can open a break (ADR 0036). §4.12's no-shift promise is the
      // DESK's — the tab layout shows one step at a time and mounts the break
      // rows when a break opens (`freestyle-compact-run-tab-fold`).
      reserveBreakRows={format.mode === 'quali' && wideDesk}
      runningLane={lanes.running}
      bestTrickArmed={bestTrick.series !== null}
      lane={lanes.battle[lane]}
      mode={format.mode}
      isAdvanceTarget={advance.startLane === lane}
      name={names[lane]}
      peerEventToken={lanes.peerToken[lane]}
      onStart={lanes.actions.start}
      onStop={lanes.actions.stop}
      onReset={lanes.actions.reset}
      onTakeBreak={lanes.actions.takeBreak}
      onBlocked={advance.blocked}
    />
  );
  const tallyPlate = (
    <TallyPlate
      board={{
        mode: format.mode,
        battle: lanes.battle,
        trySeries: bestTrick.series,
        names,
        warmup: warmup.display,
        link: chrome.link,
        audioBlocked: chrome.audioBlocked,
        peerState: chrome.peerState,
        saves: recorder.entries,
      }}
      onAdvance={advance.press}
      noopPress={advance.noopPress}
    />
  );
  const setupSection = section(
    'setup',
    <FreestyleSetupPanel
      sessionId={sessionId}
      mode={format.mode}
      onModeChange={format.applyMode}
      runSeconds={format.runSeconds}
      onRunSecondsChange={format.setRunSeconds}
      onApplyRunBudget={format.applyRunBudget}
      holdsState={format.holdsState}
      blocker={format.blocker}
      liveBlocker={format.liveBlocker}
      runningLane={lanes.running}
      warmup={warmup}
      enabledPreview={chrome.enabledPreview}
      onTogglePreview={chrome.togglePreview}
    />,
  );
  const handsetSection = (
    <HandsetCard
      mode={format.mode}
      battle={lanes.battle}
      trySeries={bestTrick.series}
      names={names}
    />
  );
  const warmupSection = section('warmup', <WarmupCard warmup={warmup} />);
  const selectionSection = section(
    'selection',
    <Box
      data-testid="selection-column"
      sx={{
        width: '100%',
        maxWidth: selectionMaxWidth,
      }}
    >
      <FreestyleSelectionPanel
        selection={recorder}
        athletes={selection.athletes}
        mode={format.mode}
        peerEventToken={selection.peerToken}
        swapLock={selection.swapLock}
        nextUpAthleteId={selection.qualiNextUp}
        onNextUpAthleteChange={selection.setQualiNextUp}
      />
    </Box>,
  );
  const runSection = section(
    'run',
    <Box
      data-testid="run-column"
      sx={{
        width: '100%',
        maxWidth: deckMaxWidth,
      }}
    >
      {format.mode === 'quali' ? (
        laneControl(1)
      ) : (
        <Box
          data-testid="run-deck"
          sx={{
            display: 'grid',
            gap: 0.75,
            gridTemplateColumns: 'minmax(0, 5fr) minmax(88px, 2fr) minmax(0, 5fr)',
            alignItems: 'center',
          }}
        >
          {laneControl(1)}
          <Stack spacing={0.25} sx={{ alignItems: 'center' }}>
            <PauseClock startedAt={lanes.pauseStartedAt} goesAgain={lanes.goesAgain} />
            <Typography variant="caption" sx={{ ...liveCaption, color: 'text.secondary' }}>
              {lanes.nextUp === null
                ? NBSP
                : `Next: ${athleteLabel(lanes.nextUp, names[lanes.nextUp])}`}
            </Typography>
          </Stack>
          {laneControl(2)}
        </Box>
      )}
    </Box>,
  );
  const bestTrickSection =
    format.mode === 'battle'
      ? section(
          'bestTrick',
          <Box data-testid="best-trick-column" sx={{ width: '100%', maxWidth: deckMaxWidth }}>
            <BestTrickPanel
              series={bestTrick.series}
              runningLane={lanes.running}
              athleteNames={names}
              defaultCap={bestTrick.defaultCap}
              onArm={bestTrick.actions.arm}
              onDisarm={bestTrick.actions.disarm}
              onSetCap={bestTrick.actions.setCap}
              onSetTryMs={bestTrick.actions.setTryMs}
              onStartTry={bestTrick.actions.startTry}
              onSkipTry={bestTrick.actions.skipTry}
              onEndTry={bestTrick.actions.endTry}
              onReset={bestTrick.actions.reset}
              onBlocked={advance.blocked}
            />
          </Box>,
        )
      : null;
  const scoreSection = section(
    'score',
    <FreestyleScoreControls
      scoring={recorder}
      athletes={selection.athletes}
      mode={format.mode}
      resetLanes={{
        lanes: { 1: lanes.battle[1], 2: lanes.battle[2] },
        runningLane: lanes.running,
        bestTrickArmed: bestTrick.series !== null,
        onReset: lanes.actions.resetBoth,
      }}
    />,
  );
  return (
    <Stack spacing={1.5} sx={{ width: '100%', padding: { xs: 1, sm: 2 } }}>
      <ControlStatusHeader
        context={{
          mode: 'Freestyle',
          round: roundLabel(recorder.round),
          boardMode: format.mode === 'battle' ? 'BATTLE' : 'QUALI',
        }}
        health={{
          link: chrome.link,
          audioBlocked: chrome.audioBlocked,
          peer: chrome.peerState,
          recovered: chrome.selfRecovered,
          sound: chrome.sound,
        }}
        recording={{ active: hasAthlete, detail: 'no athletes selected' }}
      />
      {wideDesk ? (
        <Box sx={DESK_SX}>
          <Stack spacing={1.5} data-testid="desk-left">
            {setupSection}
            {handsetSection}
            {warmupSection}
          </Stack>
          <Stack spacing={1.5} data-testid="desk-live" sx={{ minWidth: 0 }}>
            <Box
              data-testid="plate-rail"
              sx={{
                position: 'sticky',
                maxWidth: plateMaxWidth,
                top: 0,
                zIndex: 2,
                backgroundColor: 'background.default',
                pb: 0.75,
              }}
            >
              {tallyPlate}
            </Box>
            {selectionSection}
            {runSection}
            {bestTrickSection}
          </Stack>
          <Stack spacing={1.5} data-testid="desk-right">
            {scoreSection}
          </Stack>
        </Box>
      ) : (
        <CompactBoardLayout
          mode={format.mode}
          step={step}
          tallyPlate={tallyPlate}
          selectionSection={selectionSection}
          runSection={runSection}
          bestTrickSection={bestTrickSection}
          scoreSection={scoreSection}
          warmupSection={warmupSection}
          setupSection={setupSection}
          handsetSection={handsetSection}
        />
      )}
      {chrome.audioElement}
      <RecorderToast
        open={recorder.toast !== null}
        message={recorder.toast?.text ?? ''}
        severity={recorder.toast?.severity ?? 'success'}
        onClose={recorder.clearToast}
      />
    </Stack>
  );
};
