import { Box, Chip, Divider, Paper, Typography } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Stack } from '@mui/system';
import { useEffect, useMemo, useRef } from 'react';
import { Countdown } from './Countdown';
import { useGamepads } from 'app/hooks/useGamepads';
import { usePeerFlash } from 'app/hooks/usePeerFlash';
import { overlayOwnsBoard } from 'app/hooks/useAdvanceInput';
import { useLapsingConfirm } from 'app/hooks/useLapsingConfirm';
import { type PlayerId } from 'app/util/breakState';
import { laneDisplay, type LaneState } from 'app/util/battleMachine';
import { laneHoldsPhrase, laneResetNeedsConfirm } from 'app/util/resetGuard';
import { LANE_2_OFFSET, LANE_BUTTONS } from 'app/util/buzzer';
import { laneControlName } from 'app/util/controlName';
import { laneCardState } from 'app/util/laneCard';
import { laneLocks, type Lock } from 'app/util/lockReason';
import { BoardConfirmDialog } from 'app/components/BoardConfirmDialog';
import { LockedControl } from 'app/components/LockedControl';
import { RaceButton } from 'app/components/RaceButton';
import { WhyLine } from 'app/components/WhyLine';
import { NBSP, StateWord } from './cardText';
import { fonts } from 'app/theme/tokens';
import { formatClock } from 'app/util/time';

/** The identity row's reserved depth (§4.12) — a line of the taller half, so
 * picking an athlete does not move the transport under the hand. */
const IDENTITY_ROW_PX = 26;

/** The race pair's floor inside the card — two §6 120 px tracks and the row's
 * own gutter — plus the panel's hairline on both sides. The lane column is
 * spent on this before anything else: at the 1280 px desk it leaves 2 px. */
const CARD_FLOOR_PX = 2 * 120 + 16 + 2;

/**
 * The card's inline inset: whatever the column can spare above that floor, up
 * to the desk's own 16 px. It is read off the card's own width, not the
 * viewport — the 560 px quali card and the 260 px battle lane are the same
 * component on the same desk. Exported because jsdom parses no `clamp()` into
 * computed padding, so the test holds it against the floor the DOM reports.
 */
export const LANE_CARD_PAD_INLINE = `clamp(0px, (100% - ${CARD_FLOOR_PX}px) / 2, 16px)`;

/** The fixed half: the card's owner never changes and the numeral is the
 * card's hero, so it takes the state word's family a step down rather than a
 * heading scale of its own. */
const ATHLETE_LABEL_SX = {
  fontFamily: fonts.display,
  fontSize: 16,
  fontWeight: 600,
  lineHeight: 1.3,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'text.secondary',
  flexShrink: 0,
} as const;

/** The variable half — the one thing on the row worth reading at a glance, and
 * the only one that can outgrow the column: in the 256 px battle lane a wrapped
 * name would grow the card and drop the transport, so it ellipsises instead. */
const ATHLETE_SX = {
  fontSize: 18,
  fontWeight: 'bold',
  lineHeight: 1.3,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
} as const;

interface Props {
  id: PlayerId;
  /** Owned by the page reducer (ADR 0032) — see the component JSDoc. */
  lane: LaneState;
  /**
   * The lane a run is live on, or null. Mutual exclusion reads it, and the
   * lock words name whom the other lane is waiting for.
   */
  runningLane: PlayerId | null;
  /**
   * A best-trick series is armed: the run board is spent for this match, so
   * the whole lane transport goes inert (brief §4.7), Reset included — the
   * lanes are re-armed after Leave best trick, never behind the tries.
   */
  bestTrickArmed: boolean;
  /**
   * The board's explicit mode (ADR 0036). Battle: a Stop is a fall (it just ends
   * the turn — the page anchors the pause count-up) and there is no manual break
   * button. Quali: the advisory Take-break button shows with its allowance.
   */
  mode: 'quali' | 'battle';
  /**
   * The next ADVANCE press would START this lane (`advanceRoute`, §4.1). It is
   * the only thing that paints a contained `go` Start, so exactly one Start on
   * the board is ever the loud one and the buzzer's twin is unambiguous.
   */
  isAdvanceTarget?: boolean;
  name?: string;
  /**
   * The `useControlSession` peer-event token when the newest peer-panel action
   * addressed THIS lane, else null (ADR 0038). Peer events mirror silently by
   * design, so the card labels the ones that moved it.
   */
  peerEventToken?: number | null;
  /**
   * Reserve the clock's hidden held-run row (`Countdown.reserveBreakRows`).
   * Only a quali lane can go on break (ADR 0036) and only the desk owes §4.12's
   * no-shift promise — the tab layout mounts the rows on demand, and the row it
   * saves is what brings the aux control back above a 720 px fold.
   */
  reserveBreakRows?: boolean;
  onStart(lane: PlayerId): void;
  onStop(lane: PlayerId): void;
  onReset(lane: PlayerId): void;
  onTakeBreak(lane: PlayerId): void;
  /**
   * A handset key this card's interlocks made inert. The board answers it the
   * way it answers a no-op ADVANCE (§3) — `alert` plus the plate's 1 s flash,
   * carrying the lock's own words — because the 12 px readout line is not where
   * an eyes-off operator is looking.
   */
  onBlocked(lock: Lock): void;
}

/**
 * Presentational per-lane control (ADR 0032). It owns no timer state — Start /
 * Stop / Reset / Take-break dispatch to the page reducer, and everything shown
 * (button enablement, allowance badge, the embedded clock) derives from the
 * `lane` prop. The only local state is UI-lifetime: the reset-confirm dialog and
 * the peer-applied cue. The embedded `Countdown` runs controlled off the derived
 * `laneDisplay` (one state path — no message stream, no recovery side channel).
 */
export const CountdownControl = (props: Props) => {
  // The wall clock the question was asked at, not a bare flag: the value at
  // risk is re-derived from the lane against this stamp at every render, so a
  // peer event landing mid-question restates the number — and re-arming the
  // lane retires the question (`useLapsingConfirm`).
  const [asking, setAsking] = useLapsingConfirm<number>(laneResetNeedsConfirm(props.lane));
  const { lastPressedGamepadButton } = useGamepads();
  const peerApplied = usePeerFlash(props.peerEventToken ?? null);

  const breaksLeft = props.lane.breaksLeft;
  // Memoed on the lane object: the reducer allocates a new lane only on a real
  // transition, so the controlled display re-applies exactly then.
  const display = useMemo(() => laneDisplay(props.lane), [props.lane]);

  // The card's state word + visual tier (§3/§6) — `phase` plus `armedMs`, so a
  // lane that took a turn never reads as one still armed.
  const card = laneCardState(props.lane);

  // The interlock table (brief §4.7): both the buttons below and the handset
  // keys read it, so the two are inert at exactly the same instants.
  const locks = laneLocks({
    id: props.id,
    lane: props.lane,
    runningLane: props.runningLane,
    bestTrickArmed: props.bestTrickArmed,
  });

  // This lane's Reset, spelled once: the button that raises the question, the
  // question's own title and destructive answer, and the name the handset
  // readout sends the operator to (§4.8/§4.14). The modal covers the card that
  // raised it and the board stands two of these questions, so a board-wide name
  // on the screen leaves `answer the Reset Athlete 2 question first` pointing at
  // a dialog that names neither lane.
  const resetName = laneControlName('reset', props.mode, props.id);

  // The card's why-line names the blocker on the control this lane's operator
  // reaches for next — Stop while it runs, Start otherwise. Any other lock is
  // the state itself restated ("Stop is off because nothing is running"), which
  // is noise on a board read at a glance.
  const whyLock = props.lane.phase === 'running' ? locks.stop : locks.start;

  // The gamepad effect is keyed only on the last pressed button, so its closure
  // can hold stale props. Mirror the live guards into refs so the pad path sees
  // the current lane/locks (matches the Speedline ControlPage pattern). One
  // mirror per object, not one per field it guards on — two copies of the same
  // object can disagree.
  const laneRef = useRef(props.lane);
  laneRef.current = props.lane;
  const modeRef = useRef(props.mode);
  modeRef.current = props.mode;
  const locksRef = useRef(locks);
  locksRef.current = locks;

  // Reset fires from both the button and the yellow handset key, and
  // `laneResetNeedsConfirm` is the one rule for both entry points.
  const requestReset = () => {
    const lock = locksRef.current.reset;
    if (lock !== null) {
      // Only reachable from the pad — the on-screen Reset is disabled by the
      // same lock — so this is the blocked key's answer, not a dead branch.
      props.onBlocked(lock);
      return;
    }
    if (laneResetNeedsConfirm(laneRef.current)) {
      setAsking(Date.now());
      return;
    }
    props.onReset(props.id);
  };

  const keepTiming = () => setAsking(null);

  const confirmReset = () => {
    if (asking === null) return;
    setAsking(null);
    props.onReset(props.id);
  };

  useEffect(() => {
    if (lastPressedGamepadButton === undefined) return;
    // A question on screen owns the board (§4.8): only ADVANCE answers it, so
    // this lane's four keys wait — including the one that opened it.
    if (overlayOwnsBoard()) return;
    const indexAdjustment = props.id === 2 ? LANE_2_OFFSET : 0;
    const index = lastPressedGamepadButton.button - indexAdjustment;
    const live = locksRef.current;
    // Every key answers: it acts, or it hands its own lock to the board (§3's
    // no-op row). The lock is the same field the button beside it greys on, so
    // the pad and the screen cannot word one state two ways.
    const act = (lock: Lock | null, fire: () => void) =>
      lock === null ? fire() : props.onBlocked(lock);
    switch (index) {
      case LANE_BUTTONS.start:
        act(live.start, () => props.onStart(props.id));
        break;
      case LANE_BUTTONS.stop:
        act(live.stop, () => props.onStop(props.id));
        break;
      case LANE_BUTTONS.reset:
        requestReset();
        break;
      case LANE_BUTTONS.aux:
        // Break button: in battle it ends the turn (a fall — Stop-as-fall); in
        // quali it takes the advisory break.
        if (modeRef.current === 'battle') {
          act(live.stop, () => props.onStop(props.id));
        } else {
          act(live.takeBreak, () => props.onTakeBreak(props.id));
        }
        break;
    }
    // Effect keyed only on the button token so a repeated press re-fires; the
    // guards read live values via refs.
  }, [lastPressedGamepadButton]);

  return (
    <Paper
      variant="outlined"
      // A landmark like every other panel on the desk, which is how the
      // identity row below can be a line of text (`ControlPage`'s desk JSDoc).
      component="section"
      aria-label={`Athlete ${props.id}`}
      data-testid={`lane-card-${props.id}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        width: '100%',
        py: 1.5,
        paddingInline: LANE_CARD_PAD_INLINE,
      }}
    >
      {/* Who this card belongs to, on ONE row — §2's `PLAYER 1  Bianchi`. Two
          stacked rows at heading scale spent ~56 px of card height on a label
          that never changes, and that height was what pushed Start/Stop below
          the desk's fold on a 900 px screen. */}
      <Stack
        direction="row"
        data-testid="lane-identity"
        spacing={1}
        sx={{
          minHeight: IDENTITY_ROW_PX,
          width: '100%',
          alignItems: 'baseline',
          justifyContent: 'center',
        }}
      >
        <Typography component="span" sx={ATHLETE_LABEL_SX}>
          Athlete {props.id}
        </Typography>
        <Typography component="span" title={props.name} sx={ATHLETE_SX}>
          {props.name || NBSP}
        </Typography>
        {/* The peer cue rides the identity row rather than reserving one of its
            own — the selection panel's precedent (fsux-desk-fold-budget). The
            row is already ≥ the chip's 24 px, so §4.12 holds: a peer's Start
            never moves the transport, it only ellipsises the name for 2 s. */}
        {peerApplied && (
          <Chip
            size="small"
            variant="outlined"
            label="by other panel"
            aria-label={`Athlete ${props.id} changed by other panel`}
            sx={{ flexShrink: 0, alignSelf: 'center' }}
          />
        )}
      </Stack>
      <StateWord tier={card.tier}>{card.word}</StateWord>
      <Countdown
        mode="controlled"
        display={display}
        size="control"
        reserveBreakRows={props.reserveBreakRows ?? false}
        reserveCaptionRow
        expiredLabel="TIME"
        held={card.tier === 'held'}
      />
      {/* The live-path control contract (brief §6): Start and Stop are the 56 ×
          120 race pair in their own state colour — Start takes the contained
          `go` fill ONLY as the ADVANCE target, so exactly one lane on the board
          is ever the loud one — the aux slot is the green handset's on-screen
          twin, and Reset is the neutral 44 px control, offset behind a dashed
          divider rather than sitting flush beside Stop (the S03 finding: the
          two were adjacent, and Reset is the one press with no undo).

          The pair splits the card in two equal tracks rather than standing as
          a centred island at its reserve width: the same row renders in a
          256 px battle lane and a 560 px quali card, and the 120 px reserve
          plus the 16 px gutter spends that battle lane exactly — leaving
          nothing for the card padding still to come. A `1fr` track never
          shrinks past its content, so the reserve stays the floor.

          The transport buttons carry a per-lane accessible name ("Start Athlete
          2"): the battle board renders two of these blocks plus the warm-up
          strip's own Start/Stop/Reset, so the bare visible label is ambiguous
          to a screen reader — and to a test, which then has to address a lane
          by DOM position. */}
      <Box
        data-testid="lane-transport"
        sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, width: '100%' }}
      >
        <LockedControl lock={locks.start}>
          <RaceButton
            tone={props.isAdvanceTarget ? 'go' : 'goOutline'}
            size="race"
            sx={{ width: '100%' }}
            aria-label={laneControlName('start', props.mode, props.id)}
            onClick={() => props.onStart(props.id)}
            disabled={locks.start !== null}
          >
            Start
          </RaceButton>
        </LockedControl>
        <LockedControl lock={locks.stop}>
          <RaceButton
            tone="stop"
            size="race"
            sx={{ width: '100%' }}
            aria-label={laneControlName('stop', props.mode, props.id)}
            onClick={() => props.onStop(props.id)}
            disabled={locks.stop !== null}
          >
            Stop
          </RaceButton>
        </LockedControl>
      </Box>
      <WhyLine lock={whyLock} />
      {/* One aux slot, one physical key: quali's advisory break and battle's End
          turn are the same green handset button (§4.14), so they are the same
          44 px control in the same place. End turn IS the Stop event — the
          manual's battle word for it (a turn ends on a fall or on the clock).

          Reset shares the row, held off behind the dashed divider that is the
          S03 guard (§6): Reset is the one press with no undo, so what it may
          never be is flush beside Stop. A row of its own said the same thing
          and cost the card 52 px — the row that put the aux control itself
          under a 720 px fold and left the battle desk 2 px of margin at
          1440x900 (`freestyle-compact-run-tab-fold`, `fsux-battle-fold-margin`).
          The divider turned on its side keeps the offset and the gutter; the
          DOM order (aux, then Reset) keeps the tab run Start → Stop → aux →
          Reset. */}
      <Stack
        direction="row"
        data-testid="lane-aux-row"
        spacing={1}
        sx={{ width: '100%', alignItems: 'center' }}
      >
        {props.mode === 'quali' ? (
          <LockedControl lock={locks.takeBreak}>
            {/* Named off the same seam as the handset row for this green key,
                so the twin and the readout cannot word one press two ways. The
                allowance rides the spoken name; it stays OUT of the printed one,
                which §2 pins to `Take break (n left)`. */}
            <RaceButton
              tone="goOutline"
              aria-label={`${laneControlName('aux', 'quali', props.id)} (${breaksLeft} left)`}
              onClick={() => props.onTakeBreak(props.id)}
              disabled={locks.takeBreak !== null}
            >
              Take break ({breaksLeft} left)
            </RaceButton>
          </LockedControl>
        ) : (
          <LockedControl lock={locks.stop}>
            <RaceButton
              tone="goOutline"
              aria-label={laneControlName('aux', 'battle', props.id)}
              onClick={() => props.onStop(props.id)}
              disabled={locks.stop !== null}
            >
              End turn
            </RaceButton>
          </LockedControl>
        )}
        <Divider sx={{ flexGrow: 1, borderStyle: 'dashed' }} />
        <LockedControl lock={locks.reset}>
          <RaceButton
            tone="neutral"
            startIcon={<RestartAltIcon />}
            aria-label={resetName}
            onClick={requestReset}
            disabled={locks.reset !== null}
          >
            Reset
          </RaceButton>
        </LockedControl>
      </Stack>
      {/* The question this card stands over (§4.8), on the board's one shell.
          The body is dropped with the stamp it reads the lane down against, so
          a closing dialog does not restate a number it no longer holds. */}
      <BoardConfirmDialog
        open={asking !== null}
        titleId={`reset-confirm-title-${props.id}`}
        title={`${resetName}?`}
        body={
          asking === null ? null : (
            <>
              {laneHoldsPhrase(props.id, props.lane, asking)} — resetting re-arms to{' '}
              {formatClock(props.lane.armedMs)}.
            </>
          )
        }
        confirmLabel={resetName}
        safeAnswer="Keep timing"
        onConfirm={confirmReset}
        onCancel={keepTiming}
      />
    </Paper>
  );
};
