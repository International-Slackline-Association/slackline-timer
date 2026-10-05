import { Box, Stack, Tab, Tabs } from '@mui/material';
import { useState, type ReactNode } from 'react';
import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import type { CurrentStep } from 'app/util/boardStep';
type CompactBoardTab = 'selection' | 'run' | 'bestTrick' | 'score' | 'setup';
/** The board is never ON the setup step (`CurrentStep`), so the setup tab is
 * reached by the warm-up — the one live thing that lives behind it. */
const compactTabOf = (step: CurrentStep): CompactBoardTab => {
  switch (step) {
    case 'bestTrick':
      return 'bestTrick';
    case 'score':
      return 'score';
    case 'warmup':
      return 'setup';
    case 'selection':
      return 'selection';
    case 'run':
      return 'run';
  }
};
/**
 * The tab a step change moves to. The board follows the operator forward, with
 * one exception: a Score tab held while the step lands on Selection from
 * anywhere but Score. The step never passed through Score, so the operator
 * picked the tab by hand and saved over clocks that never ran — the SAVED chip
 * is what they are reading. Save at Score → Reset still follows, because that
 * Selection arrives from Score.
 */
const followTab = (from: CurrentStep, to: CurrentStep, tab: CompactBoardTab): CompactBoardTab =>
  to === 'selection' && tab === 'score' && from !== 'score' ? tab : compactTabOf(to);
interface Props {
  mode: FreestyleMode;
  step: CurrentStep;
  tallyPlate: ReactNode;
  selectionSection: ReactNode;
  runSection: ReactNode;
  bestTrickSection: ReactNode;
  scoreSection: ReactNode;
  warmupSection: ReactNode;
  setupSection: ReactNode;
  handsetSection: ReactNode;
}
export const CompactBoardLayout = ({
  mode,
  step,
  tallyPlate,
  selectionSection,
  runSection,
  bestTrickSection,
  scoreSection,
  warmupSection,
  setupSection,
  handsetSection,
}: Props) => {
  // The tab and the step it last followed change together, during render: the
  // hold above needs the step the board is leaving.
  const [view, setView] = useState(() => ({ step, tab: compactTabOf(step) }));
  if (view.step !== step) setView({ step, tab: followTab(view.step, step, view.tab) });
  const compactTab = view.tab;
  const setCompactTab = (tab: CompactBoardTab) => setView({ step, tab });
  return (
    <Stack spacing={1.5} data-testid="compact-board">
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          backgroundColor: 'background.default',
          pb: 0.75,
        }}
      >
        {tallyPlate}
        <Tabs
          value={compactTab}
          onChange={(_event, value: CompactBoardTab) => setCompactTab(value)}
          variant="scrollable"
          allowScrollButtonsMobile
          aria-label="Freestyle board sections"
          data-testid="compact-board-tabs"
        >
          <Tab value="setup" label="Setup" />
          <Tab value="selection" label="Selection" />
          <Tab value="run" label="Run" />
          {mode === 'battle' ? <Tab value="bestTrick" label="Best trick" /> : null}
          <Tab value="score" label="Score" />
        </Tabs>
      </Box>
      {compactTab === 'selection' ? selectionSection : null}
      {compactTab === 'run' ? runSection : null}
      {compactTab === 'bestTrick' ? bestTrickSection : null}
      {compactTab === 'score' ? scoreSection : null}
      {compactTab === 'setup' ? (
        <Stack spacing={1.5}>
          {warmupSection}
          {setupSection}
          {handsetSection}
        </Stack>
      ) : null}
    </Stack>
  );
};
