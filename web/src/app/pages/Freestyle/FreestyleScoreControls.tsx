import {
  Box,
  Button,
  Chip,
  Divider,
  InputAdornment,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { type FormEvent } from 'react';

import { BoardConfirmDialog } from 'app/components/BoardConfirmDialog';
import { LockedControl } from 'app/components/LockedControl';
import { MatchWinnerLine } from 'app/components/MatchWinnerLine';
import { RaceButton, blurOnClickProps } from 'app/components/RaceButton';
// The board's one wheel rule (§9). The judged components are number inputs that
// are not seconds, so they take the rule rather than the field it lives on.
import { blurOnWheel } from 'app/components/SecondsField';
import { WhyLine } from 'app/components/WhyLine';
import { useLapsingConfirm } from 'app/hooks/useLapsingConfirm';
import type { AthleteSlot, ScoreEntry } from 'app/hooks/useScoreRecorder';
import { liveCaption } from 'app/theme/tokens';
import {
  BATTLE_ONLY_SCORE_COMPONENTS,
  SCORE_COMPONENT_MAX,
  computeOverall,
  type Athlete,
} from 'app/types';
import { type LaneState } from 'app/util/battleMachine';
import { athleteControlName } from 'app/util/controlName';
import { resetBothLock } from 'app/util/lockReason';
import { laneHoldsPhrase, laneResetNeedsConfirm } from 'app/util/resetGuard';
import { formatScore } from 'app/util/resultLabel';
import { scoreCorrectionHref } from 'app/util/scoresLink';
import {
  entryDraft,
  isScoreBoundElsewhere,
  overrideDraft,
  scoreEntryErrors,
  winnerAwaiting,
  zeroBattleOnlyForRound,
  type ScoreFields,
  type ScoreResult,
  type SlotEntry,
} from 'app/util/scoreInput';

/**
 * Freestyle score entry: the five judged components + Save/DNF per athlete slot. The
 * selection (round/gender/match + the athlete per slot) lives ABOVE the run
 * board in `FreestyleSelectionPanel` (ADR 0036 layout); both panels take their
 * own half of the one `useScoreRecorder`, which stays the single owner. The overall is
 * previewed from the components (the same formula the server uses) and can be
 * overridden. In quali only Athlete 1 records (one athlete at a time); battle
 * shows both athlete slots and the derived match winner.
 *
 * Where each athlete slot's save stands is a PERSISTENT slot on their panel
 * (FREESTYLE_BOARD_UX §4.9), never only the toast that has already gone by the
 * time the operator looks up from the slackline: `not entered` → `SAVING…` →
 * `SAVED n` / `NOT SAVED · reason` + a retry that re-posts the kept values.
 */

/** The manual's order (`doc/user/freestyle-judging.md` §6) — DOM order is the
 * tab order, and the operator reads the numbers off the judges' sheet. */
const COMPONENTS: { field: keyof ScoreFields; label: string }[] = [
  { field: 'difficulty', label: 'Difficulty' },
  { field: 'combo', label: 'Combo' },
  { field: 'style', label: 'Style' },
  { field: 'bestTrick', label: 'Best trick' },
  { field: 'controlPenalty', label: 'Control penalty' },
];

/** The judged components, two to a row. */
const COMPONENT_GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 0.75,
} as const;

/**
 * The reserved helper line under every judged field, at its own leading rather
 * than MUI's 1.66 body default. Three rows of it per panel and two panels per
 * battle rail is ~36 px between Athlete 2's Save and the fold, and the line
 * carries three words of error (`max 40`) — never a paragraph
 * (`freestyle-board-fold-budget`). Reserved as ever: an error appearing must
 * not shove Save out from under the hand (§4.12).
 */
const COMPONENT_FIELD_SX = {
  '& .MuiFormHelperText-root': { marginTop: '2px', lineHeight: 1.25 },
} as const;

/** Holds the status slot's height across all four states, so a save landing
 * never shifts the Save button out from under the operator's hand (§4.12):
 * the chip's row plus one caption line, the tallest of the four. Its contents
 * ride ONE wrapping row, so the `Move score to …` offer shares the chip's line
 * wherever the panel is wide enough — the compact Score tab, where a row of
 * its own is what pushed Save ~40 px under the fold
 * (`fsux-score-rail-move-row-fold`) — and drops under it on the 360 px rail. */
const STATUS_SLOT_SX = { minHeight: 52, alignItems: 'center', alignContent: 'center' } as const;

/** The rail's whole-board re-arm, named once: the button that raises the
 * question, the question's own title, the button that carries it out, and how
 * the handset readout names it (§4.8/§4.14) — four places the operator reads
 * one control. */
const RESET_LANES = 'Reset lanes';
/** Its safe answer — the lane cards' own word, for the one question that
 * stands over both of them. */
const KEEP_TIMING = 'Keep timing';

/** The permanent cap on a judged field (§9) — `/ 40`, or the uncapped penalty. */
const capAdornment = (max: number | undefined) => (
  <InputAdornment position="end">
    <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
      {max === undefined ? '− uncapped' : `/ ${max}`}
    </Typography>
  </InputAdornment>
);

/** What a saved panel recorded, in the plate's words (`SAVED 26.00`). */
const savedLabel = (result: ScoreResult): string =>
  result.dnf ? 'SAVED DNF' : `SAVED ${formatScore(result.overall ?? 0)}`;

export const FreestyleScoreControls = ({
  scoring,
  athletes,
  mode,
  resetLanes,
}: {
  scoring: ScoreEntry;
  athletes: Athlete[];
  mode: 'quali' | 'battle';
  /**
   * The rail-foot next-match action (§4.9), offered once both athlete slots are
   * saved: re-arm both lanes for the next pair without hunting for the two
   * per-lane Resets. It answers to the same two rules they do — `laneLocks`
   * via `resetBothLock` for whether it may fire at all, `laneResetNeedsConfirm`
   * for what it has to ask first — so the rail and the cards cannot diverge.
   */
  resetLanes?: {
    lanes: Record<AthleteSlot, LaneState>;
    runningLane: AthleteSlot | null;
    bestTrickArmed: boolean;
    onReset: () => void;
  };
}) => {
  const {
    round,
    athletes: selected,
    entries,
    records,
    setField,
    setOverride,
    recordScore,
    recordDnf,
    moveScore,
    movingSlot,
    selectedMatchId,
    updateMatch,
    retryMatchUpdate,
    derivedWinner,
  } = scoring;

  // Lanes a re-arm would cost a turn (the per-lane rule) — the question names
  // them, and an empty list is the case that needs no question at all: two
  // spent lanes, the way every battle ends, re-arm in one press.
  const holdingLanes = resetLanes
    ? ([1, 2] as const).filter((lane) => laneResetNeedsConfirm(resetLanes.lanes[lane]))
    : [];

  // The interlock behind the press (§4.7), through the one map: the rail cannot
  // stay open on a board that has closed the two Resets it stands in for.
  const resetLock = resetLanes ? resetBothLock(resetLanes) : null;

  // Two things retire this question (`useLapsingConfirm`): a peer re-arming the
  // lane it names, which empties the list it would restate itself over, and a
  // peer arming best trick, which locks the press behind it (§4.7). What it
  // holds is the stamp `laneHoldsPhrase` reads a lane down against, as the lane
  // cards' own confirm does.
  const [asking, setAsking] = useLapsingConfirm<number>(
    holdingLanes.length > 0 && resetLock === null,
  );
  const cancelReset = (): void => setAsking(null);

  const athleteName = (id?: string): string =>
    (id && athletes.find((a) => a.athleteId === id)?.name) || 'TBD';

  const componentMax = SCORE_COMPONENT_MAX as Partial<Record<keyof ScoreFields, number>>;

  // Best trick + control penalty are battles-only (rule F8): at qualification
  // they're hidden and forced to 0, so the previewed overall matches what
  // `scoreInput` persists (which zeroes them too).
  const battleOnly = BATTLE_ONLY_SCORE_COMPONENTS as readonly string[];
  const visibleComponents =
    round === 'qualification'
      ? COMPONENTS.filter((c) => !battleOnly.includes(c.field))
      : COMPONENTS;

  /** The always-rendered save state of one athlete slot (§4.9). */
  const statusSlot = (slot: AthleteSlot, entry: SlotEntry) => {
    const record = records[slot];
    // The slot's row is filed under someone else: the panel reopened under a
    // new athlete and the save stayed where it was POSTed.
    const boundElsewhere = isScoreBoundElsewhere(record, selected[slot]);

    /** A row that IS on the server: what it recorded, and what to do about it. */
    const savedRow = (result: ScoreResult) => (
      <>
        <Chip
          size="small"
          label={`${savedLabel(result)}${
            boundElsewhere && record ? ` · ${athleteName(record.input.athleteId)}` : ''
          }`}
          sx={{ bgcolor: 'success.main', color: 'success.contrastText', fontWeight: 600 }}
        />
        {boundElsewhere ? (
          /* The recovery for a score entered against the wrong person — one
             tap, and explicit: a re-pick may be exploratory, so nothing moves
             until the operator says to (the lane card's own rule). It takes
             the Scores-page line's place, because in this state it IS the
             correction path. */
          <RaceButton
            type="button"
            tone="save"
            aria-label={athleteControlName(`Move score to ${athleteName(selected[slot])}`, slot)}
            disabled={movingSlot === slot}
            onClick={() => moveScore(slot)}
          >
            Move score to {athleteName(selected[slot])}
          </RaceButton>
        ) : (
          /* The one correction path (manual §6), landing on the row it
             names (`scoresLink`) rather than the whole table. A new tab, not
             a route: the board is a live timing surface and navigating away
             would drop its socket mid-match. */
          <Typography variant="caption" sx={{ ...liveCaption, color: 'text.secondary' }}>
            locked — correct it on the{' '}
            <Link
              href={scoreCorrectionHref(round, selected[slot])}
              target="_blank"
              rel="noopener"
              {...blurOnClickProps<HTMLAnchorElement>()}
            >
              Scores page ↗
            </Link>
          </Typography>
        )}
      </>
    );

    switch (entry.status) {
      case 'empty':
      case 'editing':
        // The panel is free for the next athlete, but a row it already wrote
        // is not: it keeps its own status here until it is moved, rather than
        // reading `not entered` over a save that exists.
        return record && boundElsewhere ? (
          savedRow(record.result)
        ) : (
          <Typography variant="caption" sx={{ ...liveCaption, color: 'text.secondary' }}>
            not entered
          </Typography>
        );
      case 'pending':
        return (
          <Typography variant="caption" sx={{ ...liveCaption, color: 'text.secondary' }}>
            SAVING…
          </Typography>
        );
      case 'saved':
        return savedRow(entry.result);
      case 'error':
        return (
          <>
            <Chip
              size="small"
              label={`NOT SAVED · ${entry.reason}`}
              sx={{ bgcolor: 'error.dark', color: 'error.contrastText', fontWeight: 600 }}
            />
            <Typography variant="caption" sx={{ ...liveCaption, color: 'text.secondary' }}>
              values kept · timing unaffected
            </Typography>
          </>
        );
      // A status with no slot would render nothing at all — an athlete whose
      // save state is simply missing from the rail. Fail to compile instead.
      default:
        return ((_exhaustive: never) => null)(entry);
    }
  };

  const athletePanel = (slot: AthleteSlot) => {
    const entry = entries[slot];
    const { fields, override } = entryDraft(entry);
    const effectiveFields = zeroBattleOnlyForRound(round, fields);
    const computed = computeOverall(effectiveFields);
    // A saved panel is locked (the POST upserts, so a re-save would overwrite
    // the recorded row); it unlocks when the slot's athlete changes. Locked
    // means `readOnly`, NOT `disabled`: the recorded value is the one number
    // the operator reads back off this panel, and disabled ink is unreadable
    // in sunlight (audit S21).
    const locked = entry.status === 'saved';
    const pending = entry.status === 'pending';
    const failed = entry.status === 'error';
    // Cap violations (rule F8) and a bad Overall override: flagged inline and
    // blocking Save, so a typo (400 for 40) can't reach the server or flip a
    // match via the overall.
    const boundErrors = scoreEntryErrors(round, fields, override);
    const hasBoundError = Object.keys(boundErrors).length > 0;
    const canSave = Boolean(selected[slot]) && !locked && !pending && !hasBoundError;
    // A failed DNF retries as a DNF: the entry carries what the POST was for,
    // so the retry re-posts that rather than silently turning it into a
    // judged 0.00. Editing a field reopens the panel and Save comes back.
    const retryDnf = failed && entry.result.dnf;
    const saveLabel = failed ? 'Retry save' : 'Save';
    const lockAdornment = locked
      ? {
          endAdornment: <LockIcon fontSize="small" sx={{ color: 'text.disabled' }} />,
          readOnly: true,
        }
      : undefined;
    // Enter anywhere in the panel is the Save: `38 Tab 27 Tab 29 Tab 15 Tab 0
    // Enter` records an athlete without the operator's hand leaving the numpad.
    const submitPanel = (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!canSave) return;
      if (retryDnf) recordDnf(slot);
      else recordScore(slot);
    };
    return (
      <Stack
        component="form"
        // `noValidate`: the caps also ride the inputs as `max` (for the spinners
        // and the numeric keypad), and native validation would answer an
        // over-cap Enter with a browser bubble instead of our own red field.
        noValidate
        onSubmit={submitPanel}
        // Named, so the rail's two panels are landmarks a reader can move
        // between and the title line below stays text — MUI renders a bare
        // `subtitle2` as an `<h6>` (`ControlPage`'s desk JSDoc).
        aria-label={athleteControlName('Score', slot)}
        spacing={0.75}
        sx={{ flex: '1 1 220px', minWidth: 220 }}
      >
        {/* One line, whatever the name (§4.12 — the lane card's identity row
            takes the same rule): a two-line title in the 360 px rail pushed
            Athlete 2's Save past the fold on the very screen the desk exists
            to fit. The full name is the panel's `title`; the slot is what
            addresses it. */}
        <Typography
          variant="subtitle2"
          component="div"
          noWrap
          title={selected[slot] ? athleteName(selected[slot]) : undefined}
        >
          Athlete {slot}
          {selected[slot] ? ` — ${athleteName(selected[slot])}` : ''}
        </Typography>
        {/* Two per row: the judged components are the tallest thing in the
            320 px rail, and both athlete slots' Save must share the operator's screen
            with the clocks (§2). DOM order is the manual's, so the tab order the
            keyboard path relies on is the order the judges' sheet is read in. */}
        <Box sx={COMPONENT_GRID_SX}>
          {visibleComponents.map(({ field, label }) => {
            const max = componentMax[field];
            const fieldError = boundErrors[field];
            return (
              <TextField
                key={field}
                label={label}
                type="number"
                size="small"
                value={fields[field]}
                onChange={(e) => setField(slot, field, +e.target.value)}
                error={Boolean(fieldError)}
                // Always rendered: an error appearing must not shove the Save
                // button out from under the operator's hand (§4.12).
                helperText={fieldError ?? ' '}
                sx={COMPONENT_FIELD_SX}
                slotProps={{
                  htmlInput: {
                    min: 0,
                    inputMode: 'decimal',
                    onWheel: blurOnWheel,
                    ...(max !== undefined ? { max } : {}),
                  },
                  input: lockAdornment ?? { endAdornment: capAdornment(max) },
                }}
              />
            );
          })}
          {/* Last in the grid, as it is last in the tab order: the judged
              components fill it, and an override replaces what they compute. */}
          <TextField
            label="Overall"
            // Text, not `number`: a number input sanitizes a half-typed value
            // (`-`, `1e`) to '', which is why the draft is raw text
            // (`OverrideDraft`). No wheel guard either — a wheel cannot scrub
            // text — and the ceiling rides `scoreEntryErrors`, not `max`.
            type="text"
            size="small"
            value={override ?? computed}
            onChange={(e) => setOverride(slot, overrideDraft(e.target.value))}
            error={Boolean(boundErrors.overall)}
            helperText={
              boundErrors.overall ??
              (override === null ? `computed (${formatScore(computed)})` : 'overridden')
            }
            sx={COMPONENT_FIELD_SX}
            slotProps={{
              htmlInput: { inputMode: 'decimal' },
              input:
                lockAdornment ??
                (override === null
                  ? undefined
                  : {
                      endAdornment: (
                        <InputAdornment position="end">
                          {/* Out of the tab run (§4.11): it sits INSIDE the
                              Overall field, so a keyboard Tab from the last
                              number landed here instead of on the Save that
                              records it. A pointer still reaches it, and the
                              per-athlete name keeps it addressable — the
                              battle rail renders two. */}
                          <Button
                            type="button"
                            size="small"
                            tabIndex={-1}
                            aria-label={athleteControlName('use computed', slot)}
                            sx={{ minWidth: 0, px: 0.5, whiteSpace: 'nowrap' }}
                            {...blurOnClickProps<HTMLButtonElement>({
                              onClick: () => setOverride(slot, null),
                            })}
                          >
                            use computed
                          </Button>
                        </InputAdornment>
                      ),
                    }),
            }}
          />
        </Box>
        <Stack
          direction="row"
          useFlexGap
          spacing={0.5}
          sx={{ ...STATUS_SLOT_SX, flexWrap: 'wrap' }}
        >
          {statusSlot(slot, entry)}
        </Stack>
        {/* A reserved slot (§4.12), dead on a locked panel: dropping the row
            shortened the panel, sliding Athlete 2's own Save, the winner line and
            the rail-foot reset up under the operator's hand. Present-but-dead
            also keeps the DNF target where the hand left it; the status slot
            above carries the reason. */}
        {/* Per-athlete accessible names (§10): the battle rail renders two of these
            panels, so a bare "Save" is ambiguous to a screen reader — and to a
            test, which then addresses an athlete by DOM position. The visible word
            leads the name, so speech input still reaches it by what it says. */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <RaceButton
            type="submit"
            tone="save"
            aria-label={athleteControlName(saveLabel, slot)}
            disabled={!canSave}
            sx={{ flex: 1 }}
          >
            {saveLabel}
          </RaceButton>
          <RaceButton
            type="button"
            tone="dnf"
            aria-label={athleteControlName('DNF', slot)}
            disabled={!selected[slot] || pending || locked}
            onClick={() => recordDnf(slot)}
          >
            DNF
          </RaceButton>
        </Stack>
      </Stack>
    );
  };

  const bothSaved = ([1, 2] as const).every((slot) => entries[slot].status === 'saved');

  const requestReset = (): void => {
    if (!resetLanes) return;
    if (holdingLanes.length > 0) {
      setAsking(Date.now());
      return;
    }
    resetLanes.onReset();
  };

  const confirmReset = (): void => {
    if (asking === null) return;
    setAsking(null);
    resetLanes?.onReset();
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5, width: '100%', maxWidth: 720 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {athletePanel(1)}
          {mode === 'battle' && athletePanel(2)}
        </Stack>

        {mode === 'battle' && selectedMatchId && (
          <MatchWinnerLine
            derivedWinner={derivedWinner?.winnerId ?? null}
            source={derivedWinner?.source}
            awaiting={winnerAwaiting(entries)}
            athleteName={athleteName}
            update={
              updateMatch.isError ? { error: updateMatch.error, onRetry: retryMatchUpdate } : null
            }
          />
        )}

        {mode === 'battle' && resetLanes && bothSaved && (
          <Box>
            <Divider sx={{ borderStyle: 'dashed', mb: 1.5 }} />
            <LockedControl lock={resetLock}>
              <RaceButton
                tone="neutral"
                startIcon={<RestartAltIcon />}
                onClick={requestReset}
                disabled={resetLock !== null}
              >
                {RESET_LANES} for the next match
              </RaceButton>
            </LockedControl>
            <WhyLine lock={resetLock} />
          </Box>
        )}
      </Stack>

      {/* A clause per holding lane, composed per render off the stamp the
          question was asked at — so the shared shell takes a node, never a
          string it would have to format (§4.9). */}
      <BoardConfirmDialog
        open={asking !== null}
        titleId="reset-lanes-title"
        title={`${RESET_LANES}?`}
        body={
          asking !== null && resetLanes ? (
            <>
              {holdingLanes
                .map((lane) => laneHoldsPhrase(lane, resetLanes.lanes[lane], asking))
                .join(' · ')}{' '}
              — resetting re-arms both lanes for the next match. The saved scores are not affected.
            </>
          ) : null
        }
        confirmLabel={RESET_LANES}
        safeAnswer={KEEP_TIMING}
        onConfirm={confirmReset}
        onCancel={cancelReset}
      />
    </Paper>
  );
};
