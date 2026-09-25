import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

import { RaceButton } from 'app/components/RaceButton';
import { SelectField, enumOptions } from 'app/components/SelectField';
import { SelectionChangeConfirmDialog } from 'app/components/SelectionChangeConfirmDialog';
import { WhyLine } from 'app/components/WhyLine';
import type { ScoreSelection } from 'app/hooks/useScoreRecorder';
import { usePeerFlash } from 'app/hooks/usePeerFlash';
import { liveCaption } from 'app/theme/tokens';
import { GENDERS, MATCH_ROUNDS, type Athlete } from 'app/types';
import { athleteOptions } from 'app/util/athleteOptions';
import { genderLabel } from 'app/util/gender';
import { matchLabel } from 'app/util/matchLabel';
import { roundLabel, roundsForMode } from 'app/util/rounds';

/** One field of the row: it may grow into the live column's width, but never
 * below the width its longest option needs (§2 — the row must not reflow). The
 * flex basis IS that width, so the row wraps at the field boundary instead of
 * squeezing four selects into their own option text. */
const FIELD_SX = { width: '100%', minWidth: 0 } as const;
const PICKER_SX = { ...FIELD_SX, minWidth: { xs: 0, sm: 170 } } as const;
const field = (basis: number) => ({ flex: `1 1 ${basis}px`, minWidth: 0 });
/**
 * ONE wrapping row for the whole selection (`freestyle-board-fold-budget`).
 * Battle used to stack a "Recording context" grid over a bordered "Athlete
 * assignment" box: two captions, a border and a nested inset spent ~60 px of
 * the live column above the run deck, and that column is what holds the lane
 * transport over the fold. The three assignment controls stay ONE wrap unit
 * (`ASSIGNMENT_SX`), so the manual's promise — Athlete 1 / Swap / Athlete 2
 * stay together, in that order, at every width — is now a property of the row
 * rather than of a box drawn around it.
 */
const SELECTION_ROW_SX = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 0.75,
  alignItems: 'start',
} as const;
/** The assignment trio: one flex item of the row above, laid out as its own
 * three-track grid — so it wraps as a unit and stacks in order when it must. */
const ASSIGNMENT_SX = { flex: '1 1 480px', minWidth: 0 } as const;
const ASSIGNMENT_GRID_SX = {
  display: 'grid',
  gap: 0.75,
  gridTemplateColumns: {
    xs: '1fr',
    md: 'minmax(0, 1fr) minmax(140px, auto) minmax(0, 1fr)',
  },
  alignItems: 'start',
} as const;

/**
 * The board's live selection — round/gender/match + the per-athlete-slot picks —
 * lifted ABOVE the run board (ADR 0036 layout: the lanes render the picked
 * names, so picking below the board was backwards). `useScoreRecorder` stays
 * the single owner of the selection; this panel takes its selection half
 * (`ScoreSelection`), the score-entry panel (`FreestyleScoreControls`) its
 * scoring half.
 *
 * The match link is a battle-only surface (quali is one athlete at a time), so
 * in quali the match select and the Athlete 2 picker unmount. Every picker is
 * the house NATIVE `SelectField` (brief §4.3): a native list belongs to the
 * platform, so an open one can never own the board's Space. The selection-change
 * confirm (ADR 0033 + the gender guard) lives here with the Round and Gender
 * selects it guards; the athlete pickers narrow per the cascade (gender, then
 * the selected match — see `athleteOptions`).
 */
export const FreestyleSelectionPanel = ({
  selection,
  athletes,
  mode,
  peerEventToken,
  swapLock = null,
  nextUpAthleteId = null,
  onNextUpAthleteChange,
}: {
  selection: ScoreSelection;
  athletes: Athlete[];
  mode: 'quali' | 'battle';
  /** The operator-named next athlete in QUALI, by id (`updateSelection`'s
   * `qualiNextUp`), or null. Quali runs one athlete at a time, so nothing on the
   * board can derive who comes next — the operator names it and the audience
   * surfaces show it. Ignored in battle, where the slot marker already owns the
   * question (`LiveSelection.nextUp`, ADR 0037) and this control is not
   * rendered. */
  nextUpAthleteId?: string | null;
  onNextUpAthleteChange?: (athleteId: string) => void;
  /** Why `Swap athletes` is inert, or null — the board's `athleteHold` worded
   * (§4.7, the same interlock Speedline's `Swap` takes on the second desk). */
  swapLock?: string | null;
  /** The `useControlSession` peer-event token when the newest peer-panel action
   * was a selection (ADR 0038), else null — a mirrored round/match/athlete swap
   * moves these fields under the operator, so it says who moved them. */
  peerEventToken?: number | null;
}) => {
  const {
    round,
    requestRound,
    requestGender,
    pendingChange,
    confirmPendingChange,
    cancelPendingChange,
    roundMatches,
    athletes: selected,
    setAthlete,
    swapAthletes,
    selectedGender,
    selectedMatchId,
    selectMatch,
    matches,
  } = selection;

  // The mode owns the Round vocabulary (format = mode, the ADR 0036 respec):
  // quali offers test + qualification, battle test + the playoff rounds. An
  // out-of-mode current round is still reachable — a cancelled mode-switch
  // normalization ("Keep match", ADR 0033) or a peer's mirrored selection
  // (ADR 0038: wire values are the truth) — so keep it listed; the select must
  // always show what will be recorded.
  const modeRounds = roundsForMode(mode);
  const roundOptions = modeRounds.includes(round) ? modeRounds : [...modeRounds, round];

  const athleteName = (id?: string): string =>
    (id && athletes.find((a) => a.athleteId === id)?.name) || 'TBD';

  // The cascading option pool (ADR 0042): the
  // selected match narrows the athlete slots to its two athletes, else gender narrows.
  const selectedMatch = matches.data?.find((m) => m.matchId === selectedMatchId);
  const swapReason =
    swapLock ?? (selection.canSwapAthletes ? null : 'pick both athletes to swap sides');

  const athletePicker = (slot: 1 | 2) => (
    <SelectField
      key={slot}
      label={`Athlete ${slot}`}
      value={selected[slot]}
      onChange={(e) => setAthlete(slot, e.target.value)}
      sx={PICKER_SX}
      placeholder={{ value: '', label: '— not recording —' }}
      options={athleteOptions(athletes, selectedGender, selectedMatch, selected[slot]).map((a) => ({
        value: a.athleteId,
        label: a.name,
      }))}
    />
  );

  const peerApplied = usePeerFlash(peerEventToken ?? null);

  return (
    <Paper variant="outlined" sx={{ p: 1, width: '100%' }}>
      <Stack spacing={0.75}>
        <Stack spacing={0.75}>
          {/* The peer cue shares the caption's row rather than reserving one of
              its own: the slot is still reserved (§4.12 — nothing below moves
              when a peer changes a field), it just no longer costs the desk a
              whole empty row above the fold (fsux-desk-fold-budget). */}
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 24 }}
          >
            <Typography variant="caption" sx={{ ...liveCaption, color: 'text.secondary' }}>
              Recording context
            </Typography>
            {peerApplied && (
              <Chip size="small" variant="outlined" label="changed by another panel" />
            )}
          </Stack>
          <Box data-testid="selection-context-group" sx={SELECTION_ROW_SX}>
            <Box sx={field(140)}>
              <SelectField
                label="Round"
                value={round}
                onChange={(e) => requestRound(e.target.value as (typeof MATCH_ROUNDS)[number])}
                sx={FIELD_SX}
                options={roundOptions.map((r) => ({ value: r, label: roundLabel(r) }))}
              />
            </Box>

            <Box sx={field(110)}>
              <SelectField
                label="Gender"
                value={selectedGender}
                onChange={(e) => requestGender(e.target.value as (typeof GENDERS)[number])}
                sx={FIELD_SX}
                options={enumOptions(GENDERS, genderLabel)}
              />
            </Box>

            {mode === 'battle' ? (
              /* No helper line under it: what the match fills is the manual's
                 §2 sentence and the two pickers beside it show the answer, and
                 a permanent 20 px hint under a once-per-match control is setup
                 chrome the live path pays for (the responsive contract's
                 collapse order). */
              <Box sx={field(210)}>
                <SelectField
                  label="Match (freestyle)"
                  value={selectedMatchId}
                  onChange={(e) => selectMatch(e.target.value)}
                  sx={FIELD_SX}
                  placeholder={{ value: '', label: '— no match —' }}
                  options={roundMatches.map((m) => ({
                    value: m.matchId,
                    label: matchLabel(m, athleteName),
                  }))}
                />
              </Box>
            ) : (
              <>
                <Box sx={field(170)}>{athletePicker(1)}</Box>
                {/* The quali next-up hint: not derivable — the board knows who
                    is selected, not who follows — so the operator names it, and
                    the placeholder clears it in one press. It rides
                    `updateSelection`, so a second panel mirrors it and nothing
                    is persisted. */}
                <Box sx={field(170)}>
                  <SelectField
                    label="Next up"
                    value={nextUpAthleteId ?? ''}
                    onChange={(e) => onNextUpAthleteChange?.(e.target.value)}
                    sx={PICKER_SX}
                    placeholder={{ value: '', label: '— none —' }}
                    options={athleteOptions(
                      athletes,
                      selectedGender,
                      undefined,
                      nextUpAthleteId ?? '',
                    ).map((a) => ({ value: a.athleteId, label: a.name }))}
                  />
                </Box>
              </>
            )}

            {mode === 'battle' && (
              <Box data-testid="athlete-assignment-group" sx={ASSIGNMENT_SX}>
                <Box data-testid="athlete-assignment-grid" sx={ASSIGNMENT_GRID_SX}>
                  <Box data-testid="athlete-assignment-left">{athletePicker(1)}</Box>
                  <Stack
                    data-testid="athlete-swap-control"
                    spacing={0.5}
                    sx={{ alignItems: 'stretch', justifyContent: 'center', minWidth: { md: 140 } }}
                  >
                    <RaceButton
                      variant="outlined"
                      startIcon={<SwapHorizIcon />}
                      disabled={!selection.canSwapAthletes || swapLock !== null}
                      onClick={swapAthletes}
                      sx={{ width: '100%' }}
                    >
                      Swap athletes
                    </RaceButton>
                    <WhyLine reason={swapReason} />
                  </Stack>
                  <Box data-testid="athlete-assignment-right">{athletePicker(2)}</Box>
                </Box>
              </Box>
            )}
          </Box>
        </Stack>
      </Stack>

      <SelectionChangeConfirmDialog
        pendingChange={pendingChange}
        round={round}
        clearsClause="the selected match, both athlete assignments, and their scores"
        onKeep={cancelPendingChange}
        onConfirm={confirmPendingChange}
      />
    </Paper>
  );
};
