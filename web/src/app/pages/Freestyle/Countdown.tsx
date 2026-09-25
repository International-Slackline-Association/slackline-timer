import React, { useEffect, useReducer, useRef } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { ElapsedTime } from 'app/components/ElapsedTime';
import {
  CountdownWSMessage,
  DistributiveOmit,
  type CountdownTimerRow,
} from 'app/hooks/useWebSocket';
import type { CountdownDisplayState } from 'app/util/timerChannel';
import {
  clockFromMessage,
  clockFromRecovery,
  initClockStore,
  reduceClock,
} from 'app/util/countdownClock';
import { countdownSkin, type CountdownSize } from 'app/util/countdownSkin';
import { remainingFrom } from 'app/util/time';
import { Plate } from 'app/pages/Stream/Plate';
import { colors, fonts, overlayTextShadow, radii } from 'app/theme/tokens';
import { refVh, refVw } from 'app/util/overlayScale';

// Size variants of the hero numeral, mirroring the Speedline Stopwatch.
// `projector` fills a projector/broadcast screen via clamp/vw (DESIGN_SYSTEM §4)
// rather than a fixed MUI h3 — two player clocks sit side by side, so the vw
// factor leaves room for both. `control` is the contained variant for the
// operator's ControlPage, where the clock lives in a narrow grid column.
// `hero` is the two-up athlete-display variant (FreestyleAthleteDisplay's
// BATTLE mode): TWO player clocks stack, and a "Battle Over" band can join them
// on the same 1080p column, so the numeral is height-bound near its ceiling —
// 2×numeral + two names + the band must all clear 1080p. It scales off the
// viewport HEIGHT, bounded by a matched vw term so a 5-char clock also fits a
// narrow window (§4 clamp rule, vh-major).
// `heroSolo` is the single-clock athlete-display variant (the warm-up hero and
// the QUALI single lane): when the surface shows exactly ONE clock filling the
// screen there is no stacked twin to leave room for, so the numeral grows much
// larger than `hero`. The vw term is the binding cap here — a 5-char `mm:ss`
// clock plus its on-dark frame must still clear 1920px wide — so it is tuned to
// fill FHD without overflow.
// `secondary` is the control variant's half-scale sibling: the warm-up card
// (FREESTYLE_BOARD_UX §6 "Clock scales"). Four clocks at one scale said all
// four mattered equally (audit S27) — the warm-up is the only one that is not a
// competition result, so it reads as secondary by SIZE alone (same panel skin)
// and stops competing with the lane clocks for the operator's eye.
// `plate` is the timertimer-style white lower-third (FreestyleTimerDisplay,
// the Speedline Stopwatch twin): the clock draws its OWN solid white plate
// around the time only, with the name and break rows outside it on the bare
// keyed ground.
// The colour each scale's ground owes is `app/util/countdownSkin`.
export const COUNTDOWN_SIZES = {
  projector: { numeral: 'clamp(3rem, 14vw, 13rem)', name: 'clamp(1.25rem, 4vw, 3.5rem)' },
  control: { numeral: 'clamp(2rem, 5vw, 4rem)', name: 'clamp(1rem, 2vw, 1.5rem)' },
  secondary: { numeral: 'clamp(1rem, 2.5vw, 2rem)', name: 'clamp(0.875rem, 1vw, 1rem)' },
  hero: {
    numeral: 'clamp(3rem, min(31vh, 17.5vw), 40rem)',
    name: 'clamp(1.5rem, min(8vh, 6vw), 8rem)',
  },
  // Single full-screen clock: width-bound. `mm:ss` is 5 monospace glyphs (3.0em
  // in JetBrains Mono) and the on-dark frame adds ~0.54em of padding+border, so
  // ~3.54em total ⇒ 27vw ≈ 518px on 1920 fills to ~1830px wide, clearing FHD
  // with room to spare while dwarfing `hero`. The vh term (56vh) only bites on a
  // taller/narrower window; the rem cap is a sanity ceiling on huge displays.
  heroSolo: {
    numeral: 'clamp(3rem, min(56vh, 27vw), 34rem)',
    name: 'clamp(1.5rem, min(8vh, 6vw), 8rem)',
  },
  plate: { numeral: refVh(60), name: refVh(32) },
} as const;

// The plate variant's white time plate — a FIXED-width scoreboard box, the
// Speedline Stopwatch twin (its plate is 320 reference px for the 7-glyph
// `M:SS.CC`). It must NOT track the athlete-name width — a name-sized clock box
// is unusable. Tuned narrower than Speedline's 320 because the countdown is a
// 5-glyph `mm:ss`, so this width gives the same numeral size, plate height and
// left/right breathing room the Speedline plate has around its longer time.
const PLATE_WIDTH = refVw(256);

/**
 * The on-deck marker (ADR 0037): a small amber "get set" arrow before a name,
 * in amber so it reads without recolouring the white name. `role`/`aria-label`
 * keep the glyph meaningful. ONE component because two surfaces mark "next":
 * battle marks the idle lane's own clock (`isNext`), quali — which has no idle
 * lane — names the operator's next athlete under the hero (`nextUpName`), and
 * the audience must not be able to tell the two apart.
 */
const OnDeckArrow = ({ color }: { color: string }) => (
  <Box
    component="span"
    role="img"
    aria-label="On deck"
    sx={{ color, fontSize: '1em', mr: '0.35em', verticalAlign: 'top' }}
  >
    ▶
  </Box>
);

/** A message-driven surface before its first message/recovery arrives. */
const UNSEEDED: CountdownDisplayState = { kind: 'idle', remainingMs: 0 };

/** The hidden stand-in that holds the caption row's height off-break. Its words
 * are the break caption's, so the row reserves exactly the space it will need. */
const RESERVED_CAPTION = 'Break · 0 left';

/** The props every clock takes, whatever drives it. */
interface CommonProps {
  name?: string;
  /**
   * Marks this clock's athlete as on deck (next to perform): renders a small
   * amber (race.set — "get set") arrow before the name. Battle changeover only;
   * the athlete display sets it off the board's relayed `nextUp` hint (ADR 0037).
   */
  isNext?: boolean;
  /**
   * Who performs AFTER this clock's athlete, as a resolved name — the QUALI
   * twin of `isNext` (`freestyle-quali-next-up`). Quali runs one athlete at a
   * time, so the next rider has no clock of their own to mark: the same on-deck
   * arrow carries their name under this one instead. Rendered only when the
   * board has named someone; battle leaves it unset and marks the idle lane.
   */
  nextUpName?: string;
  /**
   * Fired exactly once when a running countdown crosses to zero (not on a stop
   * above zero). The warm-up channel uses it for the long beep + label swap; a
   * performance lane reaching 0 fires it too. See DECISIONS 0015 §3.
   */
  onExpire?: () => void;
  /**
   * Fired exactly once when a quali break clock crosses to zero (DECISIONS
   * 0019/0036). Both surfaces beep off it; the control side holds the lane
   * paused for a manual Start.
   */
  onBreakExpire?: () => void;
  /**
   * A caption rendered under the clock once the countdown has expired (e.g.
   * "WARM-UP OVER"). The numeral itself holds at 00:00 in the expiry hue —
   * never replaced by the label, so the clock stays readable and the layout
   * around it doesn't jump on expiry.
   */
  expiredLabel?: string;
  /** Render scale — per-variant rationale on `COUNTDOWN_SIZES`. */
  size?: CountdownSize;
  /**
   * The clock paints on a dark ground (the athlete display's slate `void`, or
   * composited over footage on its stream twin) — one of the two props that
   * pick the surface's colour contract; what each ground owes is the table in
   * `app/util/countdownSkin`. Defaults on for the `hero`/`heroSolo` scales —
   * the athlete display's own variants — and is passed explicitly by the
   * projector-scale hero clocks (best trick) mounted on the same surface.
   */
  onDark?: boolean;
  /**
   * Keep the held-run row (the paused active budget, above the numeral) mounted
   * but invisible while no break runs, so the numeral — and everything laid out
   * under it (the control buttons) — does not jump when a break opens/closes.
   * A break is a QUALI thing (ADR 0036): battle has none, so reserving it there
   * is a dead row the lane transport pays for (`fsux-battle-fold-margin`).
   */
  reserveBreakRows?: boolean;
  /**
   * Keep the shared caption row under the numeral mounted but invisible while
   * it has nothing to say. It is not the break's row alone: the expiry word
   * (`expiredLabel`, the lane's `TIME`) rides it too, and every lane reaches
   * that — so a board with no breaks still reserves this one (§4.12).
   */
  reserveCaptionRow?: boolean;
  /**
   * The owner holds a partly-spent budget: this clock is idle because a turn
   * was taken off it, not because it is armed. `phase` alone cannot tell the
   * two apart (a fall returns the lane to `idle`), so the owner passes it —
   * `countdownSkin` breaks the frame for it (§6, audit S02) and the lane's
   * state word carries the same distinction redundantly.
   */
  held?: boolean;
}

/**
 * The operator's ControlPage clock (the Speedline `Stopwatch.laneState`
 * pattern, ADR 0027/0032): the page's reducers own timer state outright and
 * drive the clock through `display`, applied on every change. The wall-clock
 * ticks stay internal (display timing only), derived from the state's anchors.
 *
 * There is no `isReady` here BY DESIGN (brief §9 S10): a controlled clock reads
 * local state, so the relay being down or reconnecting must never blank it —
 * the operator's lane, warm-up and try clocks keep rendering and ticking with
 * the socket closed. And no `message`/`recovery`: one state path, no message
 * replay, no snapshot side channel — a controlled clock cannot be handed a
 * second source of truth.
 */
interface ControlledProps extends CommonProps {
  mode: 'controlled';
  display: CountdownDisplayState;
}

/**
 * A preview/display surface's clock: it renders whatever the relay says, so it
 * has nothing to show before the socket is up — hence the `isReady` gate, which
 * belongs to THIS variant only.
 */
interface FeedProps extends CommonProps {
  mode: 'feed';
  /** The receiver socket's message stream. */
  message: DistributiveOmit<CountdownWSMessage, 'sessionId'> | null | undefined;
  /** The socket is OPEN. While false the whole clock is laid out but not painted. */
  isReady: boolean;
  /** Which lane's messages this clock consumes. */
  timerId: number;
  /** A recovered lane state (peer-to-peer state recovery), applied on change. An
   * on-break lane carries the live break clock and allowance so the quali break
   * resumes. The canonical wire row minus `timerId` (the parent already knows
   * the lane); see `CountdownTimerRow` for the per-field epoch/break notes. */
  recovery?: Omit<CountdownTimerRow, 'timerId'>;
}

type Props = ControlledProps | FeedProps;

/**
 * A countdown clock face. Its INPUTS are a discriminated union too
 * (`controlled` | `feed`): a control page owns the state and hands in
 * `display`; a preview/display surface hands in the socket's `message` stream
 * (+ the recovery side channel and the readiness gate). Neither mode can carry
 * the other's props, so "controlled but also fed", and a controlled clock
 * blanked by a dropped socket, are unrepresentable.
 *
 * The domain state is ONE discriminated union —
 * `idle | running | onBreak | expired`, the same `CountdownDisplayState` a
 * controlled parent hands in — owned by the pure `reduceClock` machine
 * (`app/util/countdownClock.ts`); illegal combinations of the former boolean
 * bag (`isRunning && onBreak`, `expired && onBreak`) are unrepresentable.
 * Each input (controlled `display`, wire message, recovered snapshot) maps
 * purely to a next state and APPLYs; the interval below is display plumbing
 * at the edge — it dispatches ticks and detects the zero-crossings, and both
 * clocks derive from the state's wall-clock anchor (never decrement), so a
 * throttled tab still shows and expires off real elapsed time.
 */
export const Countdown: React.FC<Props> = (props) => {
  const {
    name,
    isNext = false,
    nextUpName,
    size = 'projector',
    onDark = size === 'hero' || size === 'heroSolo',
    onExpire,
    onBreakExpire,
    expiredLabel,
    reserveBreakRows = false,
    reserveCaptionRow = false,
    held = false,
  } = props;
  // The mode-specific inputs, narrowed ONCE: hooks can't be conditional, so
  // each effect below takes the plain (possibly undefined) value as a dep.
  const display = props.mode === 'controlled' ? props.display : undefined;
  const message = props.mode === 'feed' ? props.message : undefined;
  const timerId = props.mode === 'feed' ? props.timerId : undefined;
  const recovery = props.mode === 'feed' ? props.recovery : undefined;
  // Feed-only readiness gate (brief §9 S10) — a controlled clock is never
  // blanked by the transport.
  const gated = props.mode === 'feed' && !props.isReady;
  const sizes = COUNTDOWN_SIZES[size];
  // In controlled mode the first paint already reads the owned state (no 0:00
  // flash before the apply effect lands); message-driven surfaces start idle
  // at 0 until their first message/recovery arrives.
  const [{ state, liveMs }, dispatch] = useReducer(reduceClock, display, (d) =>
    initClockStore(d ?? UNSEEDED, Date.now()),
  );

  // onExpire / onBreakExpire are read inside the once-per-second tick; mirror
  // them into refs so the tick closure always sees the live callback without
  // re-arming (which would reset the interval phase).
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const onBreakExpireRef = useRef(onBreakExpire);
  onBreakExpireRef.current = onBreakExpire;

  // Controlled mode (control page): apply the owned display state on every
  // change. The union applies VERBATIM — anchors come from the state (the
  // reducer's wall-clock epochs), so a mid-join hydration and a local action
  // land on the identical path and the ticks derive the same live value the
  // owner would.
  useEffect(() => {
    if (display) {
      dispatch({ type: 'APPLY', state: display, at: Date.now() });
    }
  }, [display]);

  useEffect(() => {
    // Session-scoped messages carry no `timerId` (ws-session-message-family) and
    // are not this lane's business — the `in` check filters them out just as the
    // former `timerId: -1` sentinel did.
    if (!message || !('timerId' in message) || message.timerId !== timerId) {
      return;
    }
    const at = Date.now();
    dispatch({ type: 'APPLY', state: clockFromMessage(message, at), at });
  }, [message]);

  // Apply a recovered snapshot lane (feed surfaces; a controlled page's own
  // reducer hydration covers its mid-join catch-up). The recovered remaining is
  // epoch-adjusted by the control page to the send epoch it carries
  // (`startedAt`/`breakStartedAt`); anchoring to that shared epoch makes a
  // late joiner derive the SAME remaining as every already-connected viewer
  // instead of re-anchoring to its own receipt (which spread joiners by
  // delivery latency — the ~1s recovery drift).
  useEffect(() => {
    if (!recovery) {
      return;
    }
    const at = Date.now();
    dispatch({ type: 'APPLY', state: clockFromRecovery(recovery, at), at });
  }, [recovery]);

  // The display tick — the ONE interval (the union guarantees at most one
  // clock is live): re-derives the numeral off the state's anchor and detects
  // the zero-crossing. The closure latch makes each crossing fire exactly once
  // however many late ticks land past it — re-arming on a state change resets
  // it. The crossing callbacks are edge effects (a state observation could not
  // tell a local crossing from an applied `expired`); the reducer guards the
  // transitions, so a raced stale fire is a no-op.
  useEffect(() => {
    const s = state;
    if (s.kind !== 'running' && s.kind !== 'onBreak') {
      return;
    }
    let fired = false;
    const id = setInterval(() => {
      const at = Date.now();
      dispatch({ type: 'TICK', at });
      if (fired) {
        return;
      }
      if (s.kind === 'running' && remainingFrom(s.remainingMs, s.startedAt, at) <= 0) {
        fired = true;
        dispatch({ type: 'RUN_ZERO' });
        onExpireRef.current?.();
      } else if (s.kind === 'onBreak' && remainingFrom(s.breakMs, s.breakStartedAt, at) <= 0) {
        fired = true;
        dispatch({ type: 'BREAK_ZERO' });
        onBreakExpireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [state]);

  // How this clock paints on its surface: the §6 colour/frame table, derived in
  // one pure place (`countdownSkin`) so the numeral, the frame and the caption
  // cannot disagree about the ground or the state.
  const skin = countdownSkin({ size, onDark, kind: state.kind, held });
  const onBreak = state.kind === 'onBreak';
  // What the shared caption row says, or undefined while it is only reserving
  // its height. The allowance is a broadcast/preview caption: on the operator's
  // panel the owner already renders the lane's state word (`BREAK · n LEFT`),
  // and two lines saying it would be noise on a board read at a glance.
  const caption =
    state.kind === 'onBreak' && skin.ground !== 'panel'
      ? `Break · ${state.breaksLeft} left`
      : state.kind === 'expired'
        ? expiredLabel
        : undefined;
  // The main numeral: the live break clock on break, the live run clock while
  // running, the (static) armed budget when idle, 0 when expired.
  const numeralMs =
    state.kind === 'running' || state.kind === 'onBreak'
      ? liveMs
      : state.kind === 'idle'
        ? state.remainingMs
        : 0;

  // The main clock slot's chrome — the name/break/caption rows stay outside it
  // on the bare ground. The plate variant wraps the TIME in the solid white
  // broadcast plate; the framed grounds wrap it in the §6 state frame, stroke
  // ONLY: any fill lightens the ground exactly behind the digits and eats the
  // contrast the frame exists to protect.
  const boxed = (clock: React.ReactNode) => {
    if (skin.ground === 'plate') {
      return (
        <Plate
          bordered={false}
          fill={colors.overlay.plateFilled}
          sx={{ width: PLATE_WIDTH, display: 'flex', justifyContent: 'center' }}
        >
          {clock}
        </Plate>
      );
    }
    const frame = skin.frame;
    if (!frame) {
      return clock;
    }
    return (
      <Plate
        stroke={frame.hue}
        strokeWidth={frame.thin}
        sx={{
          borderStyle: frame.style,
          // The live weight cue rides the SIDES only, so the vertical growth is
          // zero and the name row above never moves.
          borderLeftWidth: frame.wide,
          borderRightWidth: frame.wide,
          px: frame.px,
          // On dark the strokes are em-scaled to the huge numeral, so the box
          // must carry its font size; the panel's are fixed px in a rounded well.
          ...(skin.ground === 'dark'
            ? { fontSize: sizes.numeral, lineHeight: 1 }
            : { borderRadius: `${radii.sm}px` }),
        }}
      >
        {clock}
      </Plate>
    );
  };

  return (
    <Stack
      sx={{
        display: gated ? 'none' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Keep a (control-variant) clock inside its column so a running time
        // cannot bleed sideways onto the centre controls.
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      {name && (
        <Typography
          component="div"
          sx={{
            fontFamily: fonts.display,
            fontSize: sizes.name,
            lineHeight: 1.05,
            fontWeight: 'bold',
            // Freestyle is judged, not raced — no per-player winner/loser hue, so
            // the name is plain white over the slate-backed overlay scrim, the
            // §7 rules 4/6 legibility treatment that survives chroma + busy video.
            color: 'common.white',
            textShadow: overlayTextShadow,
          }}
        >
          {/* Battle's marker rides the name row rather than a separate text
              line — the lane's own athlete is the one on deck. */}
          {isNext && <OnDeckArrow color={skin.nextArrowColor} />}
          {name}
        </Typography>
      )}
      {/* On-break layout (DECISIONS 0019/0036, quali advisory): the break clock
          takes the main slot in the amber caution tier; the held active budget
          sits above it a tier down (it is paused), with the allowance caption.
          With reserveBreakRows the held-run row stays mounted (hidden)
          off-break, so the main numeral and anything below it never move. */}
      {(onBreak || reserveBreakRows) && (
        <Box component="div" sx={{ visibility: onBreak ? 'visible' : 'hidden' }}>
          {/* Held run on break; off-break the hidden reserved row mirrors the
              main numeral (never a stray 00:00 in the DOM). */}
          <ElapsedTime
            ms={state.kind === 'onBreak' ? state.heldMs : numeralMs}
            format="clock"
            component="div"
            fontSize={sizes.name}
            lineHeight={1}
            fontWeight="bold"
            color={skin.heldRunColor}
            textShadow={skin.rowShadow}
          />
        </Box>
      )}
      {/* The state rides the numeral's hue on the keyed/plate/panel grounds and
          the frame on dark (§6) — either way `skin` has already resolved it, so
          the clock renders once. Freestyle is judged, not raced: no per-lane
          winner/loser hue. */}
      {boxed(
        <ElapsedTime
          ms={numeralMs}
          format="clock"
          component="div"
          fontSize={sizes.numeral}
          lineHeight={1}
          fontWeight="bold"
          color={skin.numeralColor}
          textShadow={skin.numeralShadow}
        />,
      )}
      {/* ONE caption slot under the numeral — the break allowance while a break
          runs, the owner's expiry word once the budget is spent. They share the
          row because they share the position: two slots would move the
          transport below as a lane crossed from one to the other (§4.12).
          Off-break it is the reserved placeholder — mounted, hidden, never a
          stray real value. */}
      {(onBreak || reserveCaptionRow || caption !== undefined) && (
        <Typography
          component="div"
          sx={{
            fontFamily: fonts.display,
            fontSize: sizes.name,
            lineHeight: 1.05,
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: skin.captionColor,
            textShadow: skin.rowShadow,
            visibility: caption === undefined ? 'hidden' : 'visible',
          }}
        >
          {caption ?? RESERVED_CAPTION}
        </Typography>
      )}
      {/* Quali's on-deck marker: the next rider has no clock to mark, so their
          name rides one under this clock at half the name tier — smaller than
          the athlete performing, and the SAME arrow, so the audience reads the
          two markers as one thing. Mounted only when the board has named
          someone; nothing below it moves, since it is the column's last row. */}
      {nextUpName && (
        <Typography
          component="div"
          sx={{
            fontFamily: fonts.display,
            fontSize: `calc(${sizes.name} * 0.5)`,
            lineHeight: 1.05,
            fontWeight: 'bold',
            color: 'common.white',
            textShadow: overlayTextShadow,
            mt: '0.4em',
          }}
        >
          <OnDeckArrow color={skin.nextArrowColor} />
          {nextUpName}
        </Typography>
      )}
    </Stack>
  );
};
