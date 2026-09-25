/**
 * The vocabulary the Freestyle board's three timer channels share — the two
 * lanes (`battleMachine`), the best-trick try clock (`bestTrickSeries`) and the
 * warm-up (`warmupChannel`).
 *
 * Each channel is its own machine with its own states and events; what they
 * hold in common is the pair of shapes at their edges: what a transition hands
 * the effect drain, and what a transition hands a `Countdown` to render. Both
 * lived in `battleMachine.ts` because the battle lanes were written first, so
 * the warm-up and the try clock — neither of which knows what a lane is —
 * imported a lane module to speak the shared language. They now import this
 * one; `battleMachine` re-exports both so a lane-side reader still finds them
 * where the reducer uses them.
 *
 * Nothing lane-shaped belongs here. `laneDisplay` (a `LaneState` → display
 * projection) stays with the lanes, as does the try clock's own
 * `tryClockDisplay` — the projections are each machine's business; only the
 * target shape is shared.
 */

import type { CountdownWSMessage, DistributiveOmit } from 'app/hooks/useWebSocket';
import type { RaceSound } from 'app/util/raceSound';

/**
 * A side-effect for the edge to perform. `ws` messages are the unchanged relay
 * contract (the page stamps `sessionId` on send); `audio` is the beep the
 * control surface plays, from the one shared `RaceSound` vocabulary (four
 * expiries, four tones). Returned as data so transitions stay pure and
 * table-testable — the tone map IS the effect table.
 *
 * One contract for all three channels — `useEffectDrain` performs it
 * identically whichever of them returned it — hence the channel-neutral name:
 * it was `BattleEffect` while the lanes were the only machine that produced it.
 */
export type TimerEffect =
  | { kind: 'ws'; message: DistributiveOmit<CountdownWSMessage, 'sessionId'> }
  | { kind: 'audio'; sound: RaceSound };

/**
 * Controlled display state for a control-page `Countdown` (the Speedline
 * `Stopwatch.laneState` pattern, ADR 0027/0032): the page's reducers own timer
 * state outright and drive each display through this shape, so the displays
 * consume no messages and need no snapshot-recovery side channel — a
 * `PEER_SNAPSHOT` that hydrates the reducer hydrates the clocks with it.
 * `running`/`onBreak` carry their wall-clock anchor plus the remaining AT that
 * anchor, so the display's tick derives the live value (never accumulates).
 * Shared by all three channel owners: the lanes (`battleMachine.laneDisplay`),
 * the try clock (`bestTrickSeries.tryClockDisplay`), the warm-up on the page.
 */
export type CountdownDisplayState =
  | { kind: 'idle'; remainingMs: number }
  | { kind: 'running'; remainingMs: number; startedAt: number }
  | { kind: 'onBreak'; heldMs: number; breakMs: number; breakStartedAt: number; breaksLeft: number }
  | { kind: 'expired' };
