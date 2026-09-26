import { Box, Divider, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useRef } from 'react';
import { Countdown } from './Countdown';
import { useGamepads } from 'app/hooks/useGamepads';
import { overlayOwnsBoard } from 'app/hooks/useAdvanceInput';
import { useLapsingConfirm } from 'app/hooks/useLapsingConfirm';
import {
  DEFAULT_CAP,
  FINAL_CAP,
  currentTurn,
  tryClockDisplay,
  type TrySeriesState,
} from 'app/util/bestTrickSeries';
import type { CountdownDisplayState } from 'app/util/timerChannel';
import type { AdvanceNames } from 'app/util/advanceRoute';
import type { PlayerId } from 'app/util/breakState';
import type { LaneCardTier } from 'app/util/laneCard';
import { seriesTallyNeedsConfirm } from 'app/util/resetGuard';
import { LANE_2_OFFSET, LANE_BUTTONS } from 'app/util/buzzer';
import { athleteControlName, laneControlName } from 'app/util/controlName';
import { bestTrickLocks, type Lock } from 'app/util/lockReason';
import { athleteLabel } from 'app/util/raceNames';
import { BoardConfirmDialog } from 'app/components/BoardConfirmDialog';
import { LockedControl } from 'app/components/LockedControl';
import { Numeral } from 'app/components/Numeral';
import { RaceButton } from 'app/components/RaceButton';
import { SecondsField } from 'app/components/SecondsField';
import { WhyLine } from 'app/components/WhyLine';
import { NBSP, StateWord } from './cardText';
import { chosenKey, colors, fonts, liveCaption } from 'app/theme/tokens';

interface Props {
  /** The armed series, or null while the phase is off (ADR 0032 idiom). */
  series: TrySeriesState | null;
  /** The two athletes by side (the board derives it once). */
  athleteNames: AdvanceNames;
  /**
   * The lane a run is live on, or null: best trick is the phase AFTER both
   * turns, so a live run locks the whole panel (brief §4.7).
   */
  runningLane: PlayerId | null;
  /** The cap the round defaults to (5 in the final, else 3) for the Begin button. */
  defaultCap: number;
  onArm(cap: number): void;
  onDisarm(): void;
  onSetCap(cap: number): void;
  onSetTryMs(tryMs: number): void;
  onStartTry(side: PlayerId): void;
  onSkipTry(side: PlayerId): void;
  onEndTry(): void;
  onReset(): void;
  /**
   * The orange key when the interlocks hold it shut. The board answers it as it
   * answers a no-op ADVANCE (§3) — `alert` plus the plate's 1 s flash in the
   * lock's own words — so a press during the other lane's run is not answered
   * only by the 12 px handset-rail line.
   */
  onBlocked(lock: Lock): void;
}

/**
 * The orange key inside each athlete's block (`LANE_BUTTONS.try`, +offset for
 * athlete 2) — the one the lane transport leaves free. Idle clock: start the
 * pressed side's try; running clock: **either** key ends the try (mirroring the
 * single side-agnostic End try button — no risk of ending the wrong side's
 * window).
 */
const TRY_BUTTON: Record<PlayerId, number> = {
  1: LANE_BUTTONS.try,
  2: LANE_BUTTONS.try + LANE_2_OFFSET,
};

/**
 * The two series-wide presses with no undo. Both discard the same tally —
 * `Reset series` re-arms it, `Leave best trick` drops the series and the next
 * `Begin` starts a fresh one — so once a try has been spent both ask the one
 * question, with the one safe answer (§4.8). Only the wording changes: the
 * button, the title, and the name the handset readout logs.
 */
type SeriesAsk = 'reset' | 'leave';

const SERIES_ASKS: Record<SeriesAsk, { verb: string; title: string; gerund: string }> = {
  reset: { verb: 'Reset series', title: 'Reset the best-trick series?', gerund: 'Resetting' },
  leave: { verb: 'Leave best trick', title: 'Leave the best-trick series?', gerund: 'Leaving' },
};

/** The answer that keeps the tally, whichever press asked. */
const KEEP_SERIES = 'Keep series';

/** The three race tracks the armed panel is spent on before anything else —
 * both Start trys and End try, at §6's 120 px — plus the deck's two gutters and
 * the panel's own hairline on each side. */
const PANEL_FLOOR_PX = 3 * 120 + 2 * 16 + 2;

/**
 * The panel's inline inset: whatever the live column can spare above that
 * floor, up to the desk's own 16 px. Read off the panel's own width, not the
 * viewport, so the ceiling the deck above it takes is what measures it.
 * Exported because jsdom parses no `clamp()` into computed padding, so the test
 * holds it against the floor the DOM reports.
 */
export const BEST_TRICK_PAD_INLINE = `clamp(0px, (100% - ${PANEL_FLOOR_PX}px) / 2, 16px)`;

/**
 * The chosen key of the cap pair, on §6's `chosenKey` — the same mark the theme
 * gives the mode toggle, hand-applied here because these keys are `Button`s and
 * the theme rule is a `MuiToggleButton` one. MUI's contained default is the
 * brand fill, which §6 confines to links and nav: on a segmented SETTING it
 * reads as a second primary action beside End try. It holds through the lock
 * because a lock may not take which option is chosen, and the tally beside it
 * counts against that number.
 */
const CAP_CHOSEN_SX = {
  ...chosenKey,
  '&:hover': { ...chosenKey, filter: 'brightness(0.96)' },
  '&.Mui-disabled': chosenKey,
} as const;

/** The side marker under the tally (§6 word style, go tier): whose attempt the
 * series is waiting on. Reserved — the row renders on both sides. */
const MARK_SX = {
  fontFamily: fonts.display,
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.4,
  letterSpacing: '0.06em',
} as const;

/**
 * Presentational console for the battle **best-trick** phase (rule F6), in the
 * `CountdownControl` mould: it owns no series state — every button dispatches to
 * the page's `trySeriesReducer` and everything shown (enabled/label state, the
 * `timerId 3` try clock) derives from the `series` prop. The embedded
 * `Countdown` runs controlled off `tryClockDisplay` (one state path — no
 * message stream, no recovery side channel), at the lane cards' `control` scale
 * so it carries the same frame tiers: the try window is a competition clock and
 * reads like one.
 */
export const BestTrickPanel = (props: Props) => {
  const { series } = props;
  const { lastPressedGamepadButton } = useGamepads();
  const tallyAtRisk = series !== null && seriesTallyNeedsConfirm(series);
  // The tally is the risk, so a peer reset or a disarm retires the question
  // (`useLapsingConfirm`); what it holds is which press asked.
  const [asking, setAsking] = useLapsingConfirm<SeriesAsk>(tallyAtRisk);

  const keepSeries = () => setAsking(null);

  const apply = (ask: SeriesAsk) => (ask === 'reset' ? props.onReset() : props.onDisarm());

  const request = (ask: SeriesAsk) => () => {
    if (tallyAtRisk) {
      setAsking(ask);
      return;
    }
    apply(ask);
  };

  const confirmAsk = () => {
    if (asking === null) return;
    setAsking(null);
    apply(asking);
  };

  // The wording of the open question; `reset` is only the resting value —
  // nothing reads it while `asking` is null.
  const ask = SERIES_ASKS[asking ?? 'reset'];

  // Memoed on the series object; idempotent re-applies on unrelated series
  // changes are harmless (the anchors ride in the state, so nothing re-anchors).
  // Total by construction — a controlled clock takes a state, never `undefined`
  // — though the `series === null` face never renders (the phase-off branch
  // below returns the Begin button instead of a clock).
  const display = useMemo<CountdownDisplayState>(
    () => (series === null ? { kind: 'idle', remainingMs: 0 } : tryClockDisplay(series)),
    [series],
  );

  // The interlock table (brief §4.7), shared by the buttons and the pad keys.
  const locks = bestTrickLocks({ series, runningLane: props.runningLane });

  // The pad effect is keyed only on the press token, so its closure can hold a
  // stale series. Mirror the live props into refs (the CountdownControl pattern).
  const seriesRef = useRef(series);
  seriesRef.current = series;
  const locksRef = useRef(locks);
  locksRef.current = locks;

  useEffect(() => {
    if (lastPressedGamepadButton === undefined) return;
    // A question on screen owns the board (§4.8): only ADVANCE answers it, so
    // the orange key waits with the lane keys.
    if (overlayOwnsBoard()) return;
    const { button } = lastPressedGamepadButton;
    if (button !== TRY_BUTTON[1] && button !== TRY_BUTTON[2]) return;
    const live = seriesRef.current;
    if (live !== null && live.clock.running) {
      props.onEndTry();
      return;
    }
    const side: PlayerId = button === TRY_BUTTON[1] ? 1 : 2;
    // Off a series the key is not silent, it is LOCKED (`bestTrickLocks` words
    // it `best trick is not armed`, or blames the running lane first) — the
    // board answers it like any other blocked key rather than swallowing it.
    const lock = locksRef.current.startTry[side];
    if (lock !== null) {
      props.onBlocked(lock);
      return;
    }
    props.onStartTry(side);
    // Effect keyed only on the button token so a repeated press re-fires; the
    // guards read the live series/locks via the refs.
  }, [lastPressedGamepadButton]);

  if (series === null) {
    return (
      <Stack spacing={1} sx={{ alignItems: 'center', width: '100%' }}>
        <Divider flexItem />
        <LockedControl lock={locks.begin}>
          <RaceButton
            tone="goOutline"
            disabled={locks.begin !== null}
            onClick={() => props.onArm(props.defaultCap)}
          >
            Begin best trick ({props.defaultCap} tries)
          </RaceButton>
        </LockedControl>
        <WhyLine lock={locks.begin} />
      </Stack>
    );
  }

  const { cap, tryMs, used, clock } = series;
  const turn = currentTurn(series);

  const athlete = (side: PlayerId) => athleteLabel(side, props.athleteNames[side]);

  // The series state in the lane cards' word/tier language, so the try clock
  // reads like the two above it. A spent series is `finished` and says so —
  // what to do about it is the plate's line (`NOTHING TO ADVANCE — enter
  // scores`), not a second sentence here.
  const card: { tier: LaneCardTier; word: string } = clock.running
    ? { tier: 'running', word: `TRY OPEN · ${athlete(clock.side)}` }
    : turn === null
      ? { tier: 'finished', word: 'SERIES COMPLETE' }
      : { tier: 'ready', word: `NEXT · ${athlete(turn)}` };

  const sideBlock = (side: PlayerId) => {
    const onTheLine = turn === side;
    // Contained `go` only on the side the series is waiting for, and only while
    // no window is open — exactly one Start try on the board is ever the loud
    // one, and while a try runs End try is louder than both (§6).
    const suggested = onTheLine && !clock.running;
    return (
      <Stack
        component="section"
        aria-label={athleteControlName('Best trick', side)}
        spacing={1}
        sx={{ alignItems: 'center' }}
      >
        {/* `component`, or MUI renders a `subtitle` variant as an `<h6>` — and
            an athlete's name is a line in a named section, not a heading. */}
        <Typography
          variant="subtitle1"
          component="div"
          sx={{ fontWeight: suggested ? 'bold' : 'normal' }}
        >
          {athlete(side)}
        </Typography>
        <Numeral fontSize={20} fontWeight={600} color={colors.ink.hi}>
          {`${used[side]} / ${cap}`}
        </Numeral>
        <Typography component="div" sx={{ ...MARK_SX, color: colors.race.goText }}>
          {onTheLine ? 'ON THE LINE' : NBSP}
        </Typography>
        <LockedControl lock={locks.startTry[side]}>
          <RaceButton
            tone={suggested ? 'go' : 'goOutline'}
            size="race"
            aria-label={laneControlName('try', 'battle', side)}
            disabled={locks.startTry[side] !== null}
            onClick={() => props.onStartTry(side)}
          >
            Start try
          </RaceButton>
        </LockedControl>
        <WhyLine lock={locks.startTry[side]} />
        <LockedControl lock={locks.skip[side]}>
          <RaceButton
            tone="neutral"
            aria-label={athleteControlName('Skip', side)}
            disabled={locks.skip[side] !== null}
            onClick={() => props.onSkipTry(side)}
          >
            Skip
          </RaceButton>
        </LockedControl>
      </Stack>
    );
  };

  return (
    <Paper
      variant="outlined"
      data-testid="best-trick-panel"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        width: '100%',
        py: 2,
        paddingInline: BEST_TRICK_PAD_INLINE,
      }}
    >
      {/* Settings and the two series-wide controls, off the try path: Reset
          series and Leave best trick sit behind a dashed divider rather than
          beside End try (the S03 finding — the one press with no undo was flush
          against the loud one). Both still ≥44 px; the offset and the confirm
          are their guard, not size. */}
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        sx={{ alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}
      >
        <Typography variant="h6" component="div">
          Best trick
        </Typography>
        <Typography variant="caption" sx={liveCaption}>
          Tries
        </Typography>
        {/* The armed cap is drawn as a fill, so it is spoken too: each key names
            what it sets and reports `aria-pressed` (§6 — fill alone is a
            colour-only cue). */}
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          role="group"
          aria-label="Tries"
          sx={{ alignItems: 'center' }}
        >
          {[DEFAULT_CAP, FINAL_CAP].map((c) => {
            const chosen = cap === c;
            return (
              <LockedControl key={c} lock={locks.settings}>
                <RaceButton
                  aria-label={`${c} tries`}
                  aria-pressed={chosen}
                  tone={chosen ? undefined : 'neutral'}
                  variant={chosen ? 'contained' : undefined}
                  sx={chosen ? CAP_CHOSEN_SX : undefined}
                  disabled={locks.settings !== null}
                  onClick={() => props.onSetCap(c)}
                >
                  {c}
                </RaceButton>
              </LockedControl>
            );
          })}
        </Stack>
        <LockedControl lock={locks.settings}>
          {/* Ms-backed, so the seconds<->ms conversion and the 1 s floor stay
              here: the shared field takes and hands back plain seconds. */}
          <SecondsField
            label="Try (s)"
            sx={{ width: 96 }}
            value={Math.round(tryMs / 1000)}
            disabled={locks.settings !== null}
            onChange={(seconds) => props.onSetTryMs(Math.max(1, seconds) * 1000)}
          />
        </LockedControl>
        <Divider orientation="vertical" flexItem sx={{ borderStyle: 'dashed' }} />
        {(['reset', 'leave'] as const).map((which) => (
          <LockedControl key={which} lock={locks.series}>
            <RaceButton tone="neutral" disabled={locks.series !== null} onClick={request(which)}>
              {SERIES_ASKS[which].verb}
            </RaceButton>
          </LockedControl>
        ))}
      </Stack>

      {/* Tracks, not flex children (the lane transport's own idiom): each Start
          try keeps its 120 px however long the name above it runs. */}
      <Box
        data-testid="best-trick-deck"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 2,
          alignItems: 'flex-start',
          width: '100%',
        }}
      >
        {sideBlock(1)}
        <Stack spacing={1} sx={{ alignItems: 'center' }}>
          <StateWord tier={card.tier}>{card.word}</StateWord>
          <Countdown mode="controlled" display={display} size="control" expiredLabel="TIME" />
          {/* The loudest object on the panel while a window is open: both Start
              try buttons are locked then, so the contained stop fill is the only
              lit control left — and the disabled tier takes it back the instant
              the window closes (§6). */}
          <LockedControl lock={locks.endTry}>
            <RaceButton
              tone="stop"
              size="race"
              disabled={locks.endTry !== null}
              onClick={props.onEndTry}
            >
              End try
            </RaceButton>
          </LockedControl>
        </Stack>
        {sideBlock(2)}
      </Box>

      <BoardConfirmDialog
        open={asking !== null}
        titleId="try-series-confirm-title"
        title={ask.title}
        body={
          <>
            {athlete(1)} has used {used[1]} of {cap} tries, {athlete(2)} {used[2]}. {ask.gerund}{' '}
            clears both tallies — they cannot be recovered.
          </>
        }
        confirmLabel={ask.verb}
        safeAnswer={KEEP_SERIES}
        onConfirm={confirmAsk}
        onCancel={keepSeries}
      />
    </Paper>
  );
};
