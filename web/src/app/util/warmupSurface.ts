/**
 * The ONE "which surface does the session show" rule, shared by the two paths
 * that must agree — the live incremental message stream
 * and a late joiner's snapshot recovery. It used to be encoded twice inside
 * `useFreestyleTimerFeed`, and the copies drifted once already
 * (warmup-hold-late-joiner-post-expiry-divergence); one pure predicate keeps
 * the rule in exactly one place, table-tested off the untestable realtime hook.
 *
 * The rule: a display that has heard NOTHING yet is `unseeded` and shows no
 * clock at all — a broadcast surface with the wrong number on it is worse than
 * one with none (the operator sees the gap; the reconnect fills it). From the
 * first piece of evidence on, a warm-up start (re)claims the surface; it hands
 * off to the selected athletes' armed lanes when the warm-up ENDS (the operator
 * stops it, or it runs out via the surfaces' Countdown onExpire) or when a
 * competition action — a lane run / best-trick try / break — takes over. A
 * warm-up reset only re-arms the clock and never resurfaces the hero
 * mid-competition.
 */

import type { CountdownSnapshot } from 'app/hooks/useWebSocket';
import { BEST_TRICK_TIMER_ID } from 'app/util/bestTrickSeries';
import { WARMUP_TIMER_ID } from 'app/util/warmupChannel';

/** Which clock surface the session is showing. `unseeded` is the fail-safe
 * empty state: nothing has arrived, so nothing is drawn (never a fabricated
 * hero off the defaults). */
export type WarmupSurface = 'unseeded' | 'warmup' | 'lanes';

/** Evidence always seeds: whatever arrives, the surface leaves `unseeded`. */
export type SeededWarmupSurface = Exclude<WarmupSurface, 'unseeded'>;

export type WarmupSurfaceEvidence =
  | {
      /** One relayed live timer action (the countdown/break wire family),
       * folded onto the surface state it arrived over. */
      kind: 'live';
      current: WarmupSurface;
      action: {
        type:
          'start_countdown' | 'stop_countdown' | 'reset_countdown' | 'start_break' | 'end_break';
        timerId: number;
      };
    }
  | {
      /** A late joiner's recovered `state_snapshot` rows — re-derives the rule
       * absolutely, with no prior surface to fold onto. */
      kind: 'snapshot';
      timers: CountdownSnapshot['timers'];
    };

/** "The surface stands" — except from `unseeded`, which has no surface to
 * stand on: the channel that spoke supplies the seed. */
const stand = (current: WarmupSurface, seed: SeededWarmupSurface): SeededWarmupSurface =>
  current === 'unseeded' ? seed : current;

/**
 * Is the competition itself under way? Any non-warm-up channel that is running,
 * on break, spent (lanes always snapshot with their armed budget, so 0 means it
 * ran out — the recoveredExpired rule), or holding LESS than the budget it was
 * armed to (`armedMs`, ADR 0046 §2 — a half-spent lane means the match is in
 * progress, so a battle reset for the next match cannot resurrect the hero).
 * The try clock counts by mere presence: its row rides the snapshot only while
 * the best-trick series is armed (useFreestyleBoard's buildSnapshot).
 */
const competitionBusy = (timers: CountdownSnapshot['timers']): boolean =>
  timers.some(
    (t) =>
      t.timerId !== WARMUP_TIMER_ID &&
      (t.timerId === BEST_TRICK_TIMER_ID ||
        t.isRunning ||
        t.onBreak === true ||
        t.remainingMs <= 0 ||
        (t.armedMs != null && t.remainingMs !== t.armedMs)),
  );

export const nextWarmupSurface = (evidence: WarmupSurfaceEvidence): SeededWarmupSurface => {
  if (evidence.kind === 'live') {
    const { current, action } = evidence;
    if (action.timerId === WARMUP_TIMER_ID) {
      // A start (re)claims the surface; a stop hands it off to the armed lanes
      // (a restart re-claims); a reset only re-arms the clock — but on an
      // unseeded display that re-arm IS the evidence the warm-up is what's next.
      if (action.type === 'start_countdown') return 'warmup';
      if (action.type === 'stop_countdown') return 'lanes';
      return stand(current, 'warmup');
    }
    // A start/break on any OTHER channel is a competition action, which takes
    // the surface over from a pending warm-up. Its quieter messages (a lane
    // stop / reset / break end) leave the surface alone — but they still seed
    // an unseeded one to the LANES: a competition channel spoke, so a warm-up
    // hero would be pure fabrication (the `Set both lanes` join,
    // fsux-preview-warmup-seed).
    return action.type === 'start_countdown' || action.type === 'start_break'
      ? 'lanes'
      : stand(current, 'lanes');
  }

  // Snapshot re-derivation: a RUNNING warm-up with time-to-go left always
  // shows; a pending one (armed budget, not spent) shows unless the competition
  // is already under way. remainingMs is the authority for the warm-up too: a
  // fully-elapsed window (<= 0) is expired-and-cleared even when the snapshot
  // still flags it running — the control's own onExpire hand-off may not have
  // landed at the instant it was built — so the late joiner matches the
  // already-connected viewers whose hero Countdown fired onExpire, never a
  // resurrected WARM-UP OVER hold
  // (warmup-hold-late-joiner-post-expiry-divergence).
  // A RESTING warm-up is pending only while it is PRISTINE — holding exactly the
  // budget it was armed to (`armedMs`, ADR 0046 §2, which the warm-up row now
  // carries too). Stopping the window part-way is the normal way a warm-up ends,
  // and a window already in use must not read as the next pair's fresh one. A
  // pre-feature sender omits the field and keeps the older, coarser reading.
  const warmup = evidence.timers.find((t) => t.timerId === WARMUP_TIMER_ID);
  const pristine =
    warmup != null && (warmup.armedMs == null || warmup.remainingMs === warmup.armedMs);
  const shows =
    warmup != null &&
    warmup.remainingMs > 0 &&
    (warmup.isRunning || (pristine && !competitionBusy(evidence.timers)));
  return shows ? 'warmup' : 'lanes';
};
