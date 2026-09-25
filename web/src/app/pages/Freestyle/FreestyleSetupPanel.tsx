import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import { PreviewControls } from 'app/components/PreviewControls';
import { RaceButton, blurOnClickProps } from 'app/components/RaceButton';
import { SecondsField } from 'app/components/SecondsField';
import { WhyLine } from 'app/components/WhyLine';
import type { WarmupChannel } from 'app/hooks/useWarmupChannel';
import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import { liveCaption } from 'app/theme/tokens';
import { FREESTYLE_FORMAT_PRESETS } from 'app/types';
import { lockReason } from 'app/util/lockReason';

/** Reserves the Warm-up field's helper row while it has nothing to say, so
 * its lock line costs no layout when it appears. */
const NO_HELPER = ' ';

const MODE_TOOLTIP =
  `Quali run ${FREESTYLE_FORMAT_PRESETS.quali.runSeconds} s · warm-up ${FREESTYLE_FORMAT_PRESETS.quali.warmupSeconds} s — ` +
  `Battle run ${FREESTYLE_FORMAT_PRESETS.battle.runSeconds} s · warm-up ${FREESTYLE_FORMAT_PRESETS.battle.warmupSeconds} s`;

/**
 * Step 1 of the board: pre-run configuration, at the head of the desk's left
 * rail. The mode stays visible on the desk; the longer setup/config surface now
 * sits behind an explicit dialog so the live board can stay shorter without
 * losing access to the exact same controls.
 */
export const FreestyleSetupPanel = ({
  sessionId,
  mode,
  onModeChange,
  runSeconds,
  onRunSecondsChange,
  onApplyRunBudget,
  holdsState,
  blocker,
  liveBlocker,
  runningLane,
  warmup,
  enabledPreview,
  onTogglePreview,
}: {
  sessionId: string;
  mode: FreestyleMode;
  onModeChange: (next: FreestyleMode) => void;
  /** The Run (s) DRAFT — applied to the lanes only by `Set both lanes`. */
  runSeconds: number;
  onRunSecondsChange: (seconds: number) => void;
  onApplyRunBudget: () => void;
  /** The board holds something a re-arm would discard: the two format controls
   * lock, and `blocker` says why. One string for the why-line and the Tooltip,
   * so the rendered reason and the hovered one cannot drift apart. */
  holdsState: boolean;
  blocker: string | null;
  /** The same reading, gated on `boardLive` — the two second fields are drafts,
   * so only a ticking clock may hold them (§4.5). Handing them `blocker`
   * unchanged would print a held lane's "Reset Athlete 1 first" under a field
   * that is still editable, since `boardLive ⇒ boardHoldsState` is strict. */
  liveBlocker: string | null;
  runningLane: 1 | 2 | null;
  warmup: WarmupChannel;
  enabledPreview: boolean;
  onTogglePreview: () => void;
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Each field's own channel words its own lock; anything else ticking words it
  // through the board. Disabled and why-line read the same pair, so they cannot
  // disagree.
  const runLocked = runningLane !== null || liveBlocker !== null;
  const runHelper =
    runningLane !== null
      ? lockReason({ kind: 'hold', hold: { kind: 'running', lane: runningLane } })
      : (liveBlocker ?? 'applies with Set both lanes');
  const warmupLocked = warmup.running || liveBlocker !== null;
  const warmupHelper = warmup.running
    ? lockReason({ kind: 'hold', hold: { kind: 'warmup' } })
    : (liveBlocker ?? NO_HELPER);

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, width: '100%', maxWidth: 360 }}>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="caption" sx={{ ...liveCaption, color: 'text.secondary' }}>
              Mode
            </Typography>
            <Tooltip title={blocker ?? MODE_TOOLTIP} describeChild>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                aria-label="Board mode"
                value={mode}
                disabled={holdsState}
                onChange={(_e, next: FreestyleMode | null) => {
                  if (next !== null) onModeChange(next);
                }}
              >
                <ToggleButton value="quali" {...blurOnClickProps<HTMLElement>()}>
                  Quali
                </ToggleButton>
                <ToggleButton value="battle" {...blurOnClickProps<HTMLElement>()}>
                  Battle
                </ToggleButton>
              </ToggleButtonGroup>
            </Tooltip>
            <WhyLine reason={blocker} />
          </Stack>

          <Stack spacing={0.5}>
            <Typography variant="caption" sx={{ ...liveCaption, color: 'text.secondary' }}>
              Run {runSeconds} s · Warm-up {warmup.defaultSeconds} s · Preview{' '}
              {enabledPreview ? 'ON' : 'OFF'}
            </Typography>
            <RaceButton tone="neutral" fullWidth onClick={() => setDetailsOpen(true)}>
              Setup details
            </RaceButton>
          </Stack>
        </Stack>
      </Paper>

      <Dialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        aria-labelledby="freestyle-setup-details-title"
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id="freestyle-setup-details-title">Freestyle setup details</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <SecondsField
              label="Run (s)"
              value={runSeconds}
              disabled={runLocked}
              helperText={runHelper}
              onChange={onRunSecondsChange}
            />
            <Stack spacing={0.5}>
              <Tooltip title={blocker ?? ''}>
                <span>
                  <RaceButton
                    variant="contained"
                    fullWidth
                    disabled={holdsState}
                    onClick={onApplyRunBudget}
                  >
                    Set both lanes to {runSeconds} s
                  </RaceButton>
                </span>
              </Tooltip>
              <WhyLine reason={blocker} />
            </Stack>
            <SecondsField
              label="Warm-up (s)"
              value={warmup.defaultSeconds}
              disabled={warmupLocked}
              helperText={warmupHelper}
              onChange={warmup.setDefaultSeconds}
            />
            <PreviewControls
              enabled={enabledPreview}
              onToggle={onTogglePreview}
              links={[
                { href: `/freestyle/preview?sessionId=${sessionId}`, label: 'Preview' },
                { href: `/freestyle/athletes?sessionId=${sessionId}`, label: 'Athlete display' },
              ]}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsOpen(false)} autoFocus>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
