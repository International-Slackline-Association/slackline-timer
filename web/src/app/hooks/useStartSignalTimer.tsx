import { useRef, useState } from 'react';

interface Props {
  /**
   * The GO edge. `goEpoch` = the scheduled GO instant (`anchor + GO_OFFSET_MS`)
   * — the race-clock anchor. Passed as an argument because the callback fires
   * from a timer closure predating the arming render, where `signalAnchor`
   * would still be the previous sequence's.
   */
  onSignalComplete(goEpoch: number): void;
}

// The start sequence as a named phase union — the internal source of truth,
// stepped off a stored wall-clock anchor (see PHASE_SCHEDULE), never by counting
// interval ticks. `idle` (nothing armed), `armed` (the T-5s pre-beep cue, no
// lights lit), `set1`/`set2` (the two SET lights), `go` (GO — the race-start
// edge), `cleared` (the sequence completed or was aborted).
export type SignalPhase = 'idle' | 'armed' | 'set1' | 'set2' | 'go' | 'cleared';

// A T-5s pre-beep cue that opens the sequence 3s ahead of the 2-1-GO lights, so
// the audible cadence is 5 -> 2 -> 1 -> longer at 0. It carries the armed look
// (no lights lit yet) and a half-integer value so it stays distinct from the
// integer light phases (0 idle, 1/2/3 lights, -1 cleared/false-start).
export const PRE_BEEP_PHASE = 0.5;

// Each phase maps to the numeric `currentSignalPhase` the previews, the beep
// contract, the reset guard and the light housing already consume, so the wire
// (`updateSignalPhase.currentPhase`) and every surface stay on the same values —
// the named union is an internal remodel, not a protocol change.
const PHASE_SIGNAL_VALUE: Record<SignalPhase, number> = {
  idle: 0,
  armed: PRE_BEEP_PHASE,
  set1: 1,
  set2: 2,
  go: 3,
  cleared: -1,
};

// The pre-beep sits at T-5s and the first light at T-2s, so the lights wait 3s
// after the cue before the 1s-per-phase 2-1-GO run begins. That armed→set1 gap
// doubles as the relay latency budget: the seed is the only event that travels,
// and arriving anywhere inside it keeps every later phase — and the race clock
// — exact on each receiver's own wall clock.
const PRE_BEEP_GAP_MS = 3000;
const LIGHT_STEP_MS = 1000;

/** GO's offset from the sequence anchor (ms). `anchor + GO_OFFSET_MS` is the
 * race-start epoch every surface anchors the stopwatch on — the same schedule
 * point the green light and long beep fire from. */
export const GO_OFFSET_MS = PRE_BEEP_GAP_MS + 2 * LIGHT_STEP_MS;

// The wall-clock schedule: each phase's offset from the anchor epoch stored when
// the sequence arms. Transitions are derived from Date.now() - anchor, so a
// throttled/backgrounded tab that fires a timer late snaps to the correct phase
// instead of drifting the race-start edge (the ADR 0021 / countdown wall-clock
// anchoring discipline the rest of the app follows). `armed` at +0, the 2-1-GO
// run one second apart, `cleared` one second after GO.
const PHASE_SCHEDULE: readonly { readonly phase: SignalPhase; readonly atMs: number }[] = [
  { phase: 'armed', atMs: 0 },
  { phase: 'set1', atMs: PRE_BEEP_GAP_MS },
  { phase: 'set2', atMs: PRE_BEEP_GAP_MS + LIGHT_STEP_MS },
  { phase: 'go', atMs: PRE_BEEP_GAP_MS + 2 * LIGHT_STEP_MS },
  { phase: 'cleared', atMs: PRE_BEEP_GAP_MS + 3 * LIGHT_STEP_MS },
];

// Pure: the scheduled phase at a given elapsed-since-anchor. Before the first
// step (or a negative elapsed) it is `idle`; at/after the last step, `cleared`.
// The single definition of the sequence's timing — table-testable without timers.
export const signalPhaseAt = (elapsedMs: number): SignalPhase => {
  let phase: SignalPhase = 'idle';
  for (const step of PHASE_SCHEDULE) {
    if (elapsedMs >= step.atMs) phase = step.phase;
    else break;
  }
  return phase;
};

// The phase→sound contract of the start sequence: short cues at the pre-beep
// and the two SET lights, long at GO. Shared by every surface that sounds the
// lights — the driving control panel, a mirrored peer panel, and the previews.
// Keyed on the numeric wire value, since peers consume the relayed phase.
export const signalPhaseBeep = (phase: number): 'short' | 'long' | null => {
  if (phase === PRE_BEEP_PHASE || phase === 1 || phase === 2) return 'short';
  if (phase === 3) return 'long';
  return null;
};

// The scheduled offset (ms from the sequence anchor) of each numeric wire phase,
// derived from the single PHASE_SCHEDULE so it can never drift from it. Lets a
// receiver place a relayed phase on the operator's wall clock via the anchor.
const PHASE_OFFSET_BY_VALUE: Record<number, number> = Object.fromEntries(
  PHASE_SCHEDULE.map((step) => [PHASE_SIGNAL_VALUE[step.phase], step.atMs]),
);

// How late a beep may arrive and still sound. A beep is an *edge*, not a state:
// once its instant is comfortably past, replaying it (a late-join / throttled
// catch-up) is worse than silence. The window absorbs normal relay latency and
// machine-clock skew while still muting a real fast-forward jump. The light,
// being a state, is always shown regardless — only the audio is gated.
export const BEEP_GRACE_MS = 400;

// Given the sequence anchor epoch and a numeric wire phase, is that phase's beep
// still live enough to sound at `now`? A phase outside the schedule returns true
// (nothing to place it against — defensive; callers only pass beep phases).
export const beepIsLive = (anchorEpoch: number, phase: number, now: number): boolean => {
  const offset = PHASE_OFFSET_BY_VALUE[phase];
  if (offset === undefined) return true;
  return now - (anchorEpoch + offset) <= BEEP_GRACE_MS;
};

export const useStartSignalTimer = (props: Props) => {
  const [phase, setPhase] = useState<SignalPhase>('idle');
  // `cleared` is BOTH endings — the schedule's terminal phase and the abort
  // latch share the wire value -1, and separating them there would be a
  // protocol change. So the distinction is kept locally, off the only thing
  // that can tell them apart: whether a cancel put us here. Consumers word the
  // Start lock from it (`speedlineLocks`); nothing about the sequence changes.
  const [aborted, setAborted] = useState<boolean>(false);

  // Imperative handles only (never domain state): the wall-clock anchor, the
  // last-applied schedule index, the pending timer, and the once-only latch.
  const anchorRef = useRef<number>(0);
  const appliedIndexRef = useRef<number>(-1);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const signalCompleteCalled = useRef<boolean>(false);

  const clearTimers = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  const fireComplete = () => {
    if (!signalCompleteCalled.current) {
      signalCompleteCalled.current = true;
      // The SCHEDULED GO epoch — not Date.now(), which under a throttled tab
      // fires late and would smear the race start off the light schedule.
      props.onSignalComplete(anchorRef.current + GO_OFFSET_MS);
    }
  };

  const applyPhase = (p: SignalPhase) => {
    setPhase(p);
    // Race start fires on the SET -> GO edge; `cleared` (one second past GO, or a
    // throttled jump that skipped GO entirely) still guarantees the start via the
    // same once-only latch, so the race never fails to begin.
    if (p === 'go' || p === 'cleared') fireComplete();
  };

  // Advance to every phase whose wall-clock boundary has already been reached,
  // then arm the next boundary off the anchor. Driven on each timer fire: a
  // late/throttled fire catches up (all crossed edges fire, in order) instead of
  // losing a step the way a tick-counting interval would.
  const advance = () => {
    const elapsed = Date.now() - anchorRef.current;
    while (
      appliedIndexRef.current + 1 < PHASE_SCHEDULE.length &&
      elapsed >= PHASE_SCHEDULE[appliedIndexRef.current + 1].atMs
    ) {
      appliedIndexRef.current += 1;
      applyPhase(PHASE_SCHEDULE[appliedIndexRef.current].phase);
    }
    const next = appliedIndexRef.current + 1;
    if (next < PHASE_SCHEDULE.length) {
      const delay = Math.max(0, anchorRef.current + PHASE_SCHEDULE[next].atMs - Date.now());
      timeoutRef.current = setTimeout(advance, delay);
    }
  };

  // Arm the sequence. The driving panel calls it bare (anchored to its own
  // clock). A MIRRORING receiver passes the operator's relayed anchor epoch:
  // `advance()` then derives every phase — and, via the consumer, every beep —
  // off that shared wall clock, so the sequence is exact under any relay latency
  // (ADR 0021 discipline). A late anchor (elapsed already past a boundary)
  // catches up in the same tick.
  const startSignal = (anchorEpoch?: number) => {
    clearTimers();
    signalCompleteCalled.current = false;
    setAborted(false);
    anchorRef.current = anchorEpoch ?? Date.now();
    appliedIndexRef.current = -1;
    // Applies `armed` (offset +0) synchronously and arms the first light.
    advance();
  };

  // Cancel the sequence. `-1` (abort / a peer's abort echo) lands on `cleared`
  // (the false-start look, no confirmation on reset); anything else clears to
  // `idle`. Numeric-in for the callers that pass a relayed wire phase.
  const resetSignal = (phase?: number) => {
    clearTimers();
    appliedIndexRef.current = -1;
    signalCompleteCalled.current = false;
    setPhase(phase === -1 ? 'cleared' : 'idle');
    setAborted(phase === -1);
  };

  // `signalAnchor` is the sequence's wall-clock anchor epoch, put on the wire so
  // receivers can tell a live beep from a catch-up jump (0 while idle/unarmed).
  return {
    currentSignalPhase: PHASE_SIGNAL_VALUE[phase],
    signalAnchor: anchorRef.current,
    /** Whether the `cleared` (-1) this hook holds was ABORTED rather than run
     * to its end — local only, never on the wire (see the latch above). */
    signalAborted: aborted,
    startSignal,
    resetSignal,
  };
};
