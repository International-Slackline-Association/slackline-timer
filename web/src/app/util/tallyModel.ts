/**
 * The TALLY plate's content, derived (FREESTYLE_BOARD_UX §3/§4.1).
 *
 * The plate answers two questions at once — **where the board is** (left: a
 * state word plus one live fact) and **what the next ADVANCE press does**
 * (right: the verb and its target). The right half is `advanceLabel` over the
 * very route the press dispatches, so the promise and the press are one
 * decision; this module only adds the left half and the unbounded sub-line.
 *
 * Pure and clock-free in the same sense as `advanceRoute`: the wall clock rides
 * in on `now`, so the live facts (`02:14 left`, `00:12`) are a render-time
 * projection and every row is a table test rather than a page screenshot.
 *
 * Readings of the brief's §3 table resolved rather than copied (the awaiting
 * row's resolution has since been folded back into §3):
 *  - the "no athlete" row's right-hand `SELECT AN ATHLETE` moved to the
 *    sub-line. A press with no athlete assigned still starts the lane, and §4.1
 *    outranks the row: the plate must never name an effect the press does not
 *    have. The header's `Not recording` chip is the other half of that warning.
 *  - a lane holding time reads `HOLDING`, not `BREAK OVER · HOLDING`: a break
 *    that ran out and a fall mid-run leave the reducer in the same state, so
 *    the plate says what it knows instead of guessing which one happened.
 *  - the live readings a few rows hang off the right half (`RESUME · name ·
 *    mm:ss held`, `TAKE BREAK (n left)`, `START TRY · name · try k of cap`)
 *    ride the LEFT half instead: only the left half re-renders on the tick, so
 *    a reading parked beside the verb would be a second-old copy of a number
 *    the fact slot already owns — and the verb+target stay the bounded shape
 *    §4.1 measures. The label enforces it (`advanceRoute.ts`); the plate pins
 *    it again over its own table (`test/app/util/tallyModel.test.ts`).
 */

import type { PeerState } from 'app/hooks/useControlSession';
import type { LinkPhase } from 'app/hooks/useLinkPhase';
import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import {
  advanceLabel,
  advanceRoute,
  settleThen,
  type AdvanceNames,
  type AdvanceRoute,
} from 'app/util/advanceRoute';
import { boardHoldsState } from 'app/util/boardState';
import {
  advanceTarget,
  isPristine,
  laneRemainingMs,
  runningLane,
  sameLaneAgain,
  type BattleState,
  type LaneState,
} from 'app/util/battleMachine';
import type { CountdownDisplayState } from 'app/util/timerChannel';
import { currentTurn, tryRemainingMs, type TrySeriesState } from 'app/util/bestTrickSeries';
import { breakRemainingFrom, type PlayerId } from 'app/util/breakState';
import { laneCardState, type LaneCardTier } from 'app/util/laneCard';
import type { SlotEntry } from 'app/util/scoreInput';
import { formatClock, remainingFrom } from 'app/util/time';

/** Everything the plate reads. The three timer owners, the two selections that
 * name their athletes, and the three out-of-cycle facts the sub-line carries. */
export interface TallyInput {
  mode: FreestyleMode;
  battle: BattleState;
  trySeries: TrySeriesState | null;
  names: AdvanceNames;
  /** The warm-up channel's face — an orthogonal clock, outside the press cycle. */
  warmup: CountdownDisplayState;
  /** The session's graded link (`useLinkPhase`) — the same phase the header's
   * chip says, so the plate cannot report the link differently from the slot
   * above it. */
  link: LinkPhase;
  /** Autoplay still blocking the local cues — the beeps the operator times by. */
  audioBlocked: boolean;
  /** Whether a peer panel has answered this one's `request_state` yet. */
  peerState: PeerState;
  /** The two score panels, whose save state the sub-line mirrors. */
  saves: Record<PlayerId, SlotEntry>;
  now: number;
}

/** What a graded link is worth saying on the plate, exhaustively: only the two
 * alarm phases earn a place in the sub-line (the calm ones are the link doing
 * its job), and they say different things — a board that never reached the
 * relay has no preview to have lost. The words are the header chips' own, one
 * register down; a new phase has to answer here before it can ship.
 */
const LINK_TEXT: Record<LinkPhase, string> = {
  open: '',
  connecting: '',
  reconnecting: '',
  unreachable: 'not connected',
  lost: 'preview not receiving',
};

/** The §6 fill tier, taken from the VERB — a stop-coloured plate always means
 * "this press ends something", whatever the board is doing. */
export type TallyTone = 'go' | 'stop' | 'set' | 'idle';

/** The plate's second channel: where the BOARD is, in the lane cards' own
 * tiers, plus the `idle` a board that has not heard from the room yet is in.
 * The verb tier alone reports the §2 colour language inverted — a quali lane
 * running paints amber (the press takes a break) and a battle lane running
 * red — so "something is live" needs a channel the next press cannot swing. */
export type TallyStateTier = LaneCardTier | 'idle';

export interface TallyModel {
  tone: TallyTone;
  stateTier: TallyStateTier;
  /** The state word: at most three ` · `-joined parts (`RUNNING · P1 BIANCHI`). */
  word: string;
  /** The one live fact under it (`02:14 left`). */
  fact: string;
  /** The press verb (`STOP`, `NOTHING TO ADVANCE`). */
  verb: string;
  /** Who/what it acts on — or, on a no-op, the em-dashed reason. */
  target: string;
  /** The unbounded line: the `then:` hint plus whatever sits outside the cycle. */
  subline: string;
  noop: boolean;
}

interface StateLine {
  word: string;
  fact: string;
}

const LANES = [1, 2] as const;

/** `P1 BIANCHI`, or the bare player number before an athlete is picked. */
const who = (lane: PlayerId, names: AdvanceNames): string =>
  names[lane] ? `P${lane} ${names[lane].toUpperCase()}` : `P${lane}`;

const breaks = (n: number): string => (n === 1 ? '1 break' : `${n} breaks`);

/** The run a paused lane still holds — what the next RESUME press gives back.
 * The same reading whether the pause is a break or a fall, so both rows read it
 * from here. */
const held = (lane: LaneState, now: number): string =>
  `${formatClock(laneRemainingMs(lane, now))} held`;

const tone = (route: AdvanceRoute): TallyTone => {
  switch (route.kind) {
    case 'noop':
      return 'idle';
    case 'try':
      return route.verb === 'END TRY' ? 'stop' : 'go';
    case 'battle':
      switch (route.verb) {
        case 'STOP':
          return 'stop';
        case 'TAKE BREAK':
          return 'set';
        default:
          return 'go';
      }
  }
};

/** The single quali lane, whose four phases ARE the state (ADR 0037 §3). */
const qualiLine = ({ battle, names, now }: TallyInput): StateLine => {
  const lane = battle[1];
  switch (lane.phase) {
    case 'running': {
      const left = `${formatClock(laneRemainingMs(lane, now))} left`;
      return {
        word: `RUNNING · ${who(1, names)}`,
        fact: lane.breaksLeft > 0 ? `${left} · ${breaks(lane.breaksLeft)}` : left,
      };
    }
    case 'onBreak': {
      const left = formatClock(breakRemainingFrom(lane.breakMs, lane.breakStartedAt, now));
      return { word: 'BREAK', fact: `${left} · ${lane.breaksLeft} left · ${held(lane, now)}` };
    }
    case 'finished':
      return { word: 'TIME · SCORE', fact: 'budget spent' };
    case 'idle':
      return isPristine(lane)
        ? { word: 'READY', fact: `armed ${formatClock(lane.armedMs)}` }
        : { word: 'HOLDING', fact: held(lane, now) };
  }
};

/** The best-trick leg, which owns the board whenever the series is armed. */
const seriesLine = (series: TrySeriesState, names: AdvanceNames, now: number): StateLine => {
  if (series.clock.running) {
    const side = series.clock.side;
    return {
      word: `TRY · ${who(side, names)} · ${series.used[side]}/${series.cap}`,
      fact: `${formatClock(tryRemainingMs(series, now))} left`,
    };
  }
  const next = currentTurn(series);
  return next === null
    ? { word: 'BEST TRICK DONE · SCORE', fact: `${series.cap} tries each` }
    : {
        word: `BEST TRICK · P${next} NEXT`,
        fact: `try ${series.used[next] + 1} of ${series.cap}`,
      };
};

/** Waiting for a turn to be started: which turn, and what the press will start
 * it with. `TURN 3` is unreachable — two lanes, one turn each — so the count
 * clamps rather than inventing a third. */
const readyLine = (battle: BattleState, target: PlayerId, now: number): StateLine => {
  const taken = LANES.filter((lane) => !isPristine(battle[lane])).length;
  const bothArmed =
    isPristine(battle[1]) && isPristine(battle[2]) && battle[1].armedMs === battle[2].armedMs;
  return {
    word: `READY · TURN ${Math.min(2, taken + 1)}`,
    fact: bothArmed
      ? `both budgets ${formatClock(battle[1].armedMs)}`
      : `P${target} holds ${formatClock(laneRemainingMs(battle[target], now))}`,
  };
};

/** The battle leg, in the router's own precedence: a live turn, the series, the
 * turn that just ended, the end of the match, else the next turn. */
const battleLine = (input: TallyInput): StateLine => {
  const { battle, trySeries, names, now } = input;
  const live = runningLane(battle);
  if (live !== null) {
    return {
      word: `RUNNING · ${who(live, names)}`,
      fact: `${formatClock(laneRemainingMs(battle[live], now))} left`,
    };
  }
  if (trySeries !== null) return seriesLine(trySeries, names, now);

  const target = advanceTarget(battle);
  if (target === null) return { word: 'BATTLE OVER · SCORE', fact: 'both budgets spent' };
  // The word the plate promised a press earlier (`then: start … again`),
  // delivered: CHANGEOVER here would name a handover that is not happening. The
  // fact is the budget that decides whether the match has another turn in it —
  // the gutter beside the cards still counts the gap.
  if (sameLaneAgain(battle)) {
    return { word: `AGAIN · ${who(target, names)}`, fact: held(battle[target], now) };
  }
  return battle.pauseStartedAt !== null
    ? { word: 'CHANGEOVER', fact: formatClock(Math.max(0, now - battle.pauseStartedAt)) }
    : readyLine(battle, target, now);
};

/**
 * Where the board is, as a tier — in `battleLine`'s own precedence, so the
 * stripe and the state word can never name two states.
 *
 * The two states no lane card covers: the gap between turns takes `break`
 * (whether or not anybody changes over), being an interval clock §6 paints in
 * the same `setDim`; an armed best-trick series is `ready`, its next press
 * being a try.
 */
const battleTier = ({ battle, trySeries }: TallyInput): TallyStateTier => {
  if (runningLane(battle) !== null) return 'running';
  if (trySeries !== null) {
    if (trySeries.clock.running) return 'running';
    return currentTurn(trySeries) === null ? 'finished' : 'ready';
  }
  const target = advanceTarget(battle);
  if (target === null) return 'finished';
  return battle.pauseStartedAt !== null ? 'break' : laneCardState(battle[target]).tier;
};

/** One athlete slot's save state, in the wireframe's own words (§2, panel D). An
 * untouched or half-typed panel has no news for the plate. */
const saveText = (slot: PlayerId, entry: SlotEntry): string => {
  const label = `P${slot}`;
  switch (entry.status) {
    case 'empty':
    case 'editing':
      return '';
    case 'pending':
      return `${label} SAVING…`;
    case 'error':
      return `${label} NOT SAVED — retry`;
    case 'saved':
      // A saved overall can arrive from a persisted Score, where the field may
      // predate the type (the house `?? 0` guard at the render edge).
      return entry.result.dnf
        ? `${label} SAVED DNF`
        : `${label} SAVED ${(entry.result.overall ?? 0).toFixed(2)}`;
  }
};

/** The warm-up rides the sub-line rather than the cycle: it is a third clock,
 * never something ADVANCE acts on. */
const warmupText = (warmup: CountdownDisplayState, now: number): string => {
  if (warmup.kind === 'running') {
    return `warm-up ${formatClock(remainingFrom(warmup.remainingMs, warmup.startedAt, now))}`;
  }
  return warmup.kind === 'expired' ? 'warm-up over' : '';
};

/** What a panel that has not heard from the room yet is entitled to claim: the
 * lanes it draws are its own defaults, not the match. Only ever shown while the
 * board holds nothing of its own — a live run is truth, not presumption, and a
 * reconnect blip must not blank the state word over a running clock. */
const AWAITING_LINE: StateLine = {
  word: 'AWAITING BOARD STATE…',
  fact: 'a peer panel may still answer',
};

export const tallyModel = (input: TallyInput): TallyModel => {
  // The router withholds the one follow-up that needs a wall clock (a battle
  // turn end whose partner is spent); the plate ticks, so it settles it here.
  const route = settleThen(
    advanceRoute(input.mode, input.battle, input.trySeries),
    input.battle,
    input.now,
  );
  const label = advanceLabel(route, input.names);
  const noop = route.kind === 'noop';
  const awaiting =
    input.peerState === 'awaiting' &&
    !boardHoldsState({
      mode: input.mode,
      battle: input.battle,
      trySeries: input.trySeries,
      warmupRunning: input.warmup.kind === 'running',
    });
  const line = awaiting
    ? AWAITING_LINE
    : input.mode === 'quali'
      ? qualiLine(input)
      : battleLine(input);
  // A quali board IS its single lane (ADR 0037 §3), so the plate and the card
  // under it read one derivation.
  const stateTier: TallyStateTier = awaiting
    ? 'idle'
    : input.mode === 'quali'
      ? laneCardState(input.battle[1]).tier
      : battleTier(input);

  const subline = [
    // A no-op's reason belongs beside the verb (`NOTHING TO ADVANCE — …`), so
    // the sub-line is free for the scoring state the operator now acts on.
    noop ? '' : label.detail,
    ...(noop ? LANES.map((player) => saveText(player, input.saves[player])) : []),
    warmupText(input.warmup, input.now),
    LINK_TEXT[input.link],
    input.audioBlocked ? 'audio locked' : '',
    input.names[1] || input.names[2] ? '' : 'select an athlete',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    tone: awaiting ? 'idle' : tone(route),
    stateTier,
    ...line,
    verb: label.verb,
    target: noop ? `— ${label.detail}` : label.target,
    subline,
    noop,
  };
};
