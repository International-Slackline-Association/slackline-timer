import { Box, Stack, Tab, Tabs } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
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
  const [compactTab, setCompactTab] = useState<CompactBoardTab>(() => compactTabOf(step));
  useEffect(() => {
    setCompactTab(compactTabOf(step));
  }, [step]);
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
