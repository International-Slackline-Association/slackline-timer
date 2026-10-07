import { getBaseToken } from 'app/auth';
import { setWsAuthDenied } from 'app/auth/wsAuthSignal';
import { WS_URL } from 'app/constants';
import { isRelayFrame } from 'app/hooks/wsFrameGuard';
import { type Discipline, type Gender } from 'app/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as reactUseWebSocket from 'react-use-websocket';
import { ReadyState } from 'react-use-websocket';

// react-use-websocket 4.13 is CJS-only (no ESM build). Under vite's CJS interop
// the hook ends up behind one or more `default` keys, and the depth differs per
// environment — vite dev double-wraps the namespace (`.default.default`), the
// production build and vitest wrap once (`.default`). Unwrap to the callable so
// the same import works in dev, the build, and tests.
type UseWebSocket = typeof reactUseWebSocket.default;
const unwrapDefault = (mod: unknown): UseWebSocket => {
  let value: unknown = mod;
  while (value && typeof value !== 'function' && 'default' in (value as object)) {
    value = (value as { default: unknown }).default;
  }
  return value as UseWebSocket;
};
const useWebSocket = unwrapDefault(reactUseWebSocket);

/**
 * What both boards' selections share: who/what is live now. The control page
 * re-sends on every selection change and on socket OPEN, like
 * `updateLaneNames`. `round` is a `TimeRound` for speed and a `MatchRound` for
 * freestyle — a string here, validated by the consuming query (the recorder
 * owns the enum).
 */
interface SelectionCommon {
  round: string;
  gender: Gender;
  matchId: string | null;
  athlete1Id: string | null;
  athlete2Id: string | null;
}

/**
 * The Speedline board's live selection. Its two extra fields are session-only
 * relay state — never persisted — and exist on this arm alone, so a freestyle
 * consumer cannot read them and a freestyle board cannot send them.
 */
export interface SpeedSelection extends SelectionCommon {
  discipline: 'speed';
  /**
   * The live best-of-3 run-wins tally `{ 1, 2 }` for the selected speed match
   * (ADR 0017 §4), so the rounds-summary overlay can build the series story off
   * the board without a second source. The wire shape is the LANE view of the
   * board's athlete-keyed tally (ADR 0044), projected through the SAME
   * message's `athlete1Id`/`athlete2Id` — so a consumer pairing name↔count
   * from one message is consistent by construction, and a lane swap simply
   * re-broadcasts each athlete's wins under their new side. Peer panels re-key
   * it by those athlete ids on application.
   */
  runWins?: { 1: number; 2: number };
  /**
   * The live per-lane false-start counts `{ 1, 2 }` for the speed board (rules
   * S2–S4, ADR 0035), so overlays render a lane-scoped "FALSE START" badge off
   * the board.
   */
  falseStarts?: { 1: number; 2: number };
}

/**
 * The Freestyle board's live selection. Every extra field is relay-only and
 * optional; an overlay ignores the ones it does not know.
 */
export interface FreestyleSelection extends SelectionCommon {
  discipline: 'freestyle';
  /**
   * The board's explicit Quali/Battle mode (ADR 0036 — not inferred from a
   * missing athlete 2). Quali collapses the preview/broadcast timer to a single
   * centred hero. Re-pushed on every OPEN like the rest of the selection, so
   * late joiners recover it. Absent (pre-0036 sender) renders as battle.
   */
  freestyleMode?: 'quali' | 'battle';
  /**
   * The live **best-trick** (battle part 2, rule F6) tally, present only while
   * that phase is armed on the control board. `tries` is the per-side used
   * count out of `cap` (3, or 5 in the final), `turn` is who is up now (running
   * side, else the alternation suggestion; `null` = series done), and
   * `clockRunning` says whether a 30 s try window is live. Drives the preview's
   * BEST TRICK hero; the try clock itself rides the `timerId 3` countdown
   * channel.
   */
  bestTrick?: {
    cap: number;
    tries: { 1: number; 2: number };
    turn: 1 | 2 | null;
    clockRunning: boolean;
    /**
     * The series revision (ADR 0049): bumped by every local series transition,
     * adopted as-is by a mirror. A peer panel drops a `bestTrick` below the rev
     * it holds — an echo sent before the mirror caught up, which otherwise
     * rolled the acting panel's tally back. Absent from a pre-rev page, read as 0.
     */
    rev: number;
  };
  /**
   * The **battle** next-up player — whom the next ADVANCE would start
   * (`advanceTarget`, ADR 0037), relayed so the audience athlete display can warn
   * the next rider. Rides the selection like `bestTrick`, so the display never
   * re-derives it from replayed timer messages. Set only in battle mode while
   * nothing runs and no try is armed (the board's own "Next:" hint window);
   * `null`/absent otherwise.
   */
  nextUp?: 1 | 2 | null;
  /**
   * The **quali** next-up athlete, by id. Quali runs one athlete at a time, so
   * there is no idle slot for `nextUp` to point at and the order is not
   * derivable from anything the board holds — the operator names it and the
   * app only shows the room. Consumers resolve the id to a
   * name the way the athlete pickers do, and render the marker the battle
   * `nextUp` marker renders. Session-only like the rest: a reload clears it.
   */
  qualiNextUp?: string | null;
}

/**
 * The control board's current selection, broadcast (relay-only, no server
 * state) so overlays can show who/what is live now. Discriminated on
 * `discipline`: the two boards share the `SelectionCommon` identity and nothing
 * else, so neither can read — or send — the other's session state.
 */
export type LiveSelection = SpeedSelection | FreestyleSelection;

/**
 * The shared client-message envelope. `senderId` is the sending page's per-mount
 * id (ADR 0038 §4): the equal-`seq` tiebreak for the `updateSelection`
 * last-writer-wins stamp — not a self-echo filter: the relay excludes the
 * sending connection from the fan-out, so no page receives its own sends
 * (ADR 0043). Optional; the relay ignores it.
 */
export interface WSEnvelope {
  sessionId: string;
  senderId?: string;
}

/**
 * The five session-scoped (not lane-scoped) message variants, shared by both
 * mode unions. They address the whole session, so — unlike the Countdown lane
 * messages — they carry NO `timerId`; lane consumers filter on
 * `timerId !== <lane id>`, which drops them (and a legacy `timerId: -1` one).
 *
 * `state_snapshot`'s payload is the only mode-specific piece (Speedline vs
 * Countdown reconstruction), so the union is generic over it.
 */
export type SessionWSMessage<Snapshot> = WSEnvelope &
  (
    | {
        type: 'updatePreview';
        data: {
          enabled: boolean;
        };
      }
    | {
        type: 'updateLaneNames';
        data: {
          lane1: string;
          lane2: string;
          /**
           * Which discipline's board these names belong to — the `updateLaneNames`
           * analogue of `LiveSelection.discipline`. Both disciplines share one
           * relay room (`compId` = `sessionId`), so a freestyle preview must drop
           * the speed board's names (only the freestyle hero band reads them).
           * Optional: an untagged frame (pre-feature sender) applies
           * unconditionally.
           */
          discipline?: Discipline;
        };
      }
    | {
        type: 'updateSelection';
        data: LiveSelection;
        /** Last-writer-wins stamp (ADR 0038 §4): monotonic per sender, minted by
         * `useControlSession`, tiebroken by `senderId`. Every consumer — control
         * panel or passive overlay/preview follower (`acceptSelectionStamp`) —
         * drops a selection at or below its last seen stamp: without it, two
         * edits crossing in flight swap panel values on every round trip forever,
         * and a late-arriving loser rolls an overlay back. Unstamped (pre-feature
         * sender) applies unconditionally. */
        seq?: number;
        /** A re-statement of a value this panel ADOPTED, carrying the stamp it
         * adopted: it must lose every tie, or whether a mirror outranks its own
         * author falls to the per-mount `senderId` UUIDs (ADR 0038 §4, 2026-09-22
         * addendum). On the variant, not the envelope: the mirrored timer path
         * emits no `ws` effect by construction, so "echo" means nothing on any
         * other frame. Omitted reads as authoritative. */
        echo?: true;
      }
    // State recovery (peer-to-peer, ADR 0011/0038): a joining or reconnecting
    // page — control panels included — asks; every control panel answers. The
    // relay forwards both (`request_state` canonicalised, ADR 0050).
    | {
        type: 'request_state';
        data: Record<string, never>;
      }
    | {
        type: 'state_snapshot';
        data: Snapshot;
      }
  );

export type StopwatchWSMessage =
  | SessionWSMessage<SpeedlineSnapshot>
  | (WSEnvelope &
      (
        | {
            type: 'start';
            data: {
              startTime: number;
              /** The lanes this start ignites — a solo quali run (exactly one
               * lane with an athlete) starts only that lane and the other stays
               * dormant (`activeStartLanes` in app/util/raceTime). */
              lanes: number[];
            };
          }
        | {
            type: 'stop';
            data: {
              timerId: number;
              stopTime: number;
            };
          }
        // The undo of a mis-pressed `stop`: the lane's clock continues off the
        // ORIGINAL GO epoch every surface still holds, so the frame carries only
        // the lane. Not a re-sent `start` — that re-ignites both lanes and moves
        // the epoch the lights, beeps and every overlay anchor on.
        | {
            type: 'resume';
            data: {
              timerId: number;
            };
          }
        | {
            type: 'reset';
            data: Record<string, never>;
          }
        | {
            type: 'updateSignalPhase';
            data: {
              currentPhase: number;
              /* Only two shapes flow: the SEED — `currentPhase: PRE_BEEP_PHASE`
               * with `anchorEpoch` + `lanes` — and the abort/reset echo
               * (`currentPhase <= 0`, neither field). set1/set2/GO are never
               * sent; receivers derive them off the seed anchor. */
              /* The seed's wall-clock arm epoch: the schedule a receiver derives
               * the whole sequence — lights, beeps, AND the race-clock start
               * epoch (`anchor + GO_OFFSET_MS`) — from, and the reference that
               * gates each beep (silent on a catch-up jump, light still shown).
               * Absent on the abort echo. */
              anchorEpoch?: number;
              /* The lanes GO will ignite (see `start`): a receiver starts the
               * lane clocks at its locally-derived GO edge instead of waiting
               * out the relay latency on the authoritative `start` (which still
               * follows as confirmation/recovery truth). Seed-only. */
              lanes?: number[];
            };
          }
        | {
            type: 'updateText';
            data: {
              text: string;
            };
          }
      ));

/**
 * A full reconstruction of the Speedline control page's live state, sent in
 * reply to a `request_state`. Epoch ms are used for start/stop. Per timer: both
 * null ⇒ idle, startTime set & stopTime null ⇒ running, both set ⇒ finished.
 */
export interface SpeedlineSnapshot {
  isPreviewEnabled: boolean;
  /** The sender's wall clock when this snapshot was BUILT — its age, in the same
   * clock as the `startTime`/`stopTime` epochs beside it (all control-minted).
   * A display that already applied a live frame for a lane compares the two to
   * tell a genuinely newer snapshot from a stale one and un-freeze a lane whose
   * `resume` it missed (`Stopwatch.mergeRecovery`). Absent (pre-feature sender):
   * never un-freezes. */
  at?: number;
  signalPhase: number;
  text: string;
  timers: Array<{
    timerId: number;
    startTime: number | null;
    stopTime: number | null;
  }>;
  /** Per-lane false-start counts, so a reconnecting preview recovers a flagged
   * lane's badge (rules S2–S4). Optional — absent on a pre-feature control page. */
  falseStarts?: { 1: number; 2: number };
}

export type CountdownWSMessage =
  | SessionWSMessage<CountdownSnapshot>
  | (WSEnvelope & {
      timerId: number;
    } & (
        | {
            type: 'start_countdown';
            data: {
              remainingMs: number;
              /**
               * The control's `Date.now()` epoch when the clock began — a
               * SHARED anchor, like the stopwatch's `startTime`
               * (doc/dev/architecture.md → "What an overlay needs to stay in
               * sync"). Receivers derive `now − startedAt` off it rather than
               * their own receipt time, which spreads them by delivery latency
               * — and `formatClock`'s whole-second floor turns sub-second skew
               * into a full 1 s difference. Absent (pre-feature sender): falls
               * back to receipt-time `Date.now()`. `stop`/`reset`/`end_break`
               * carry frozen values and need no anchor.
               */
              startedAt?: number;
            };
          }
        | {
            type: 'stop_countdown';
            data: {
              remainingMs: number;
            };
          }
        | {
            type: 'reset_countdown';
            data: {
              remainingMs: number;
            };
          }
        // The quali advisory break (ADR 0019, narrowed by 0036 — battle has
        // no break clock). `runRemainingMs` is the lane's held active budget;
        // `breakMs` is the comp's `config.freestyle.breakMs`; `breaksLeft` is the
        // quali allowance; `startedAt` is the shared break-clock anchor (see
        // `start_countdown` above — optional, receipt-time fallback). At
        // break-zero the lane holds for a manual Start.
        | {
            type: 'start_break';
            data: {
              runRemainingMs: number;
              breakMs: number;
              breaksLeft: number;
              startedAt?: number;
            };
          }
        | {
            type: 'end_break';
            data: {
              runRemainingMs: number;
            };
          }
      ));

/**
 * One recovered Freestyle countdown lane on the wire — the canonical
 * snapshot-row shape. `CountdownSnapshot.timers` is an array of these; the
 * per-lane recovery views (`Countdown`'s `recovery` prop, the feed's
 * `RecoveredLane`) are this row minus the `timerId` (they are keyed by lane), so
 * they derive from here via `Omit<CountdownTimerRow, 'timerId'>` rather than
 * hand-copying the field list.
 */
export interface CountdownTimerRow {
  timerId: number;
  remainingMs: number;
  isRunning: boolean;
  // The send-time epoch to which `remainingMs` (running) / `breakRemainingMs`
  // (on break) applies — the shared anchor a recovered lane derives its tick
  // off (`remainingFrom(remainingMs, startedAt, now)`). NOT the original
  // run-start: `remainingMs` stays the adjusted authority the late-joiner
  // rules in `useFreestyleTimerFeed` read (`remainingMs <= 0` = ran out). Both
  // optional: absent (pre-feature sender) falls back to receipt-time `Date.now()`.
  startedAt?: number;
  breakStartedAt?: number;
  // Quali break recovery (ADR 0019/0036): an on-break lane holds the
  // (paused) active budget in `remainingMs` and carries the live break clock,
  // so a mid-break reconnect resumes the break tick rather than rendering
  // blank. `breaksLeft` rides in EVERY phase (0 is a real, spent count) so a
  // mid-run join adopts the true remaining allowance; absent on the
  // allowance-free channels (warm-up, best trick) and on pre-feature peers.
  onBreak?: boolean;
  breakRemainingMs?: number;
  breaksLeft?: number;
  // The budget the lane was last ARMED to (ADR 0046 §2) — what a Reset restores,
  // as distinct from `remainingMs`, which is what is left of it. It rides the
  // snapshot because it is what decides whether a lane reads pristine or held:
  // a joiner seeding it from its own format default would read a mirrored lane
  // as held and then re-arm the whole room to that default on the next Reset.
  // Optional/additive like the anchors — absent on the best-trick try clock (no
  // armed budget) and on a pre-feature control page, where the receiver
  // falls back to the lane budget on an idle lane and keeps its local value
  // otherwise (`laneFromSnapshot`).
  armedMs?: number;
}

/**
 * A reconstruction of the Freestyle control page's live state, sent in reply to
 * a `request_state`. The countdown ticks on a local setInterval, so `remainingMs`
 * is computed at send time (a running lane adjusted for wall-clock elapsed since
 * it started); `startedAt` carries the send-time epoch that adjusted value
 * applies to (see the `CountdownTimerRow` field notes) so a recovered running
 * lane anchors its tick to a shared wire epoch instead of its own receipt time,
 * and late joiners converge.
 */
export interface CountdownSnapshot {
  isPreviewEnabled: boolean;
  timers: CountdownTimerRow[];
}

/**
 * Emitted server-side by the write Lambdas after every successful
 * competition-data write (the analogue of timertimer's "db" PubSub topic).
 * Consumers invalidate the matching React Query keys and re-fetch; the payload
 * carries ids only, never the data (ADR 0006).
 */
export type DbUpdateWSMessage = WSEnvelope & {
  type: 'db_update';
  data: {
    entity: 'competition' | 'athlete' | 'time' | 'match' | 'score';
    action: 'created' | 'updated' | 'deleted';
    id: string;
  };
};

export type WSMessage = StopwatchWSMessage | CountdownWSMessage | DbUpdateWSMessage;

/**
 * `Omit` distributed over each union member. Plain `Omit<A | B, K>` collapses to
 * the members' *shared* keys, which would drop the Countdown lane variants'
 * `timerId` (the session variants lack it).
 */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * App-level keepalive (ADR 0024): API Gateway drops a WS connection after
 * 10 idle minutes, so every client pings inside that window. Not part of the
 * relayed unions above — `messageHandler` swallows it before the fan-out, so a
 * ping never reaches a peer's `onMessage`.
 */
export type KeepaliveWSMessage = { sessionId: string; type: 'ping' };

/**
 * Receipt ack (debug telemetry): displays confirm timer-critical messages
 * (start/stop/reset) they consumed, so CloudWatch can join a relayed message
 * with the consumers that actually received it (and name the ones that went
 * silent). Like `ping`, NOT part of the relayed unions — `messageHandler`
 * logs and swallows it before the fan-out, so an ack never reaches a peer.
 * `key` is the message's own control-minted epoch (startTime/stopTime),
 * absent for `reset`; `page` identifies the consumer (pathname).
 */
export type AckWSMessage = {
  sessionId: string;
  type: 'ack';
  /**
   * `ua` separates consumer software in the logs (imperfect but sufficient:
   * H2R's Electron carries `h2r-graphics-electron/x.y.z`, a parallel test
   * browser plain Chrome/Safari). Attached by `sendAck` itself, not callers.
   */
  data: { of: string; key?: number; page: string; ua: string };
};

export const WS_KEEPALIVE_INTERVAL_MS = 8 * 60 * 1000;

const WS_RECONNECT_DELAY_CAP_MS = 30_000;

/**
 * Reconnect backoff: exponential up to a 30s ceiling, with half-jitter
 * (`(cap/2, cap]`) so a room full of clients dropped by the same outage does
 * not reconnect in lockstep. Attempts are unbounded (ADR 0024) — a venue
 * outage of any length must never permanently strand an open page.
 */
export const wsReconnectDelay = (attempt: number, random: () => number = Math.random): number => {
  const cap = Math.min(1000 * 2 ** attempt, WS_RECONNECT_DELAY_CAP_MS);
  return cap / 2 + random() * (cap / 2);
};

/**
 * The page's relay socket (ADR 0043: one per page, both directions).
 *
 * Inbound frames reach `onMessage` one at a time (ADR 0051): parsed, checked by
 * `isRelayFrame` (a malformed or unknown frame is dropped here, never handed to
 * a consumer), then delivered inside `flushSync`, so each frame's state updates
 * commit before the next frame is handled — two frames landing in one task are
 * two commits, never one batched render that keeps only the last. A throwing
 * handler is logged and contained; the socket keeps delivering.
 *
 * `onMessage` is read through a ref, so it may close over the latest render
 * without re-subscribing. The library never stores a message (`filter` below),
 * so a frame re-renders only the components its handler actually updates.
 */
export const useWS = <T extends WSMessage>(params: {
  sessionId: string;
  /** Event read token for /stream/* overlays — used instead of a Cognito session. */
  readToken?: string;
  /** Called once per valid inbound frame, synchronously and flushed. */
  onMessage?: (frame: T) => void;
}) => {
  const { readToken, sessionId, onMessage } = params;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Per-mount sender id, stamped on every outgoing message — the selection
  // LWW tiebreak (ADR 0038 §4; see the WSEnvelope doc).
  const [senderId] = useState<string>(() => crypto.randomUUID());

  // Resolved on every (re)connect: react-use-websocket re-invokes a function
  // `url` per (re)open, so a reconnect past the ~1h IdToken lifetime carries a
  // fresh token. A read token (overlays) wins over the `app/auth` seam's
  // baseline credential. Memoised: the library keys its connect effect on
  // `url`, so a new identity per render would reopen the socket.
  const getUrl = useCallback(async (): Promise<string> => {
    const authToken = readToken ?? (await getBaseToken()) ?? '';
    const url = new URL(WS_URL);
    // Verified by the $connect authorizer: a Cognito IdToken (admin, or a
    // manager granted this session) or an event read token.
    url.searchParams.set('Authorization', authToken);
    url.searchParams.set('sessionId', sessionId);
    return url.toString();
  }, [readToken, sessionId]);

  // A denied authorizer rejects the handshake: the socket closes (code 1006)
  // without ever reaching OPEN. Track whether this connection ever opened so
  // we can tell an auth rejection apart from a normal drop and surface it.
  const everOpened = useRef(false);
  // A new target (sessionId/readToken) is a fresh connection — re-evaluate.
  useEffect(() => {
    everOpened.current = false;
  }, [getUrl]);

  // Stable: the library reads its options through a ref, and the handler is
  // reached through `onMessageRef`.
  const receive = useCallback((event: MessageEvent) => {
    let frame: unknown;
    try {
      frame = JSON.parse(event.data as string);
    } catch {
      console.warn('Dropped an unparsable relay frame');
      return;
    }
    if (!isRelayFrame(frame)) {
      // The payload only in dev, for the same reason as the wire trace below.
      console.warn('Dropped an unrecognised relay frame', import.meta.env.DEV ? frame : '');
      return;
    }
    // Dev-only wire trace: an event-long relay is chatty (a socket per page +
    // every overlay), and the payloads would otherwise leak into screen captures.
    if (import.meta.env.DEV) {
      console.log('Received:', frame);
    }
    try {
      // One commit per frame is the delivery contract (see the JSDoc).
      // eslint-disable-next-line @eslint-react/dom-no-flush-sync
      flushSync(() => onMessageRef.current?.(frame as T));
    } catch (error) {
      console.error('Relay frame handler failed', error);
    }
  }, []);

  const { sendJsonMessage, readyState } = useWebSocket<T>(
    getUrl,
    {
      onMessage: receive,
      // Never let the library store the frame: its `lastMessage` state would
      // re-render this whole page per frame for a value nothing reads, and a
      // single-slot state is the batching hazard `receive` exists to avoid.
      filter: () => false,
      // Reconnect on drops so the lazy `getUrl` above can supply a fresh token
      // (and so a transient network blip self-heals during a competition).
      shouldReconnect: () => true,
      reconnectAttempts: Infinity,
      reconnectInterval: wsReconnectDelay,
      // Unreachable under Infinity attempts — a tripwire should a cap return.
      onReconnectStop: (attempts) => {
        console.error(`WebSocket gave up reconnecting after ${attempts} attempts — reload`);
      },
      onOpen: () => {
        everOpened.current = true;
        setWsAuthDenied(false);
      },
      onClose: () => {
        // Closed before ever opening ⇒ the $connect authorizer rejected us
        // (no admin role or grant on this session, or an expired/invalid
        // token). Read-token overlays are gated separately, so only operator
        // sessions are flagged.
        if (!everOpened.current && readToken == null) {
          setWsAuthDenied(true);
        }
      },
    },
    true,
  );

  // Keepalive: resets API Gateway's 10-min idle timer between quiet runs.
  // Sent from every connection (control panels, previews, overlays alike) —
  // the relay swallows it, and even a refused read-only send resets the timer.
  useEffect(() => {
    if (readyState !== ReadyState.OPEN) return;
    const intervalId = window.setInterval(() => {
      sendJsonMessage({ type: 'ping', sessionId } satisfies KeepaliveWSMessage);
    }, WS_KEEPALIVE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [readyState, sendJsonMessage, sessionId]);

  // Identity-stable: callers list it as an effect dep (e.g. request_state on OPEN).
  const sendWSMessage = useCallback(
    (message: DistributiveOmit<T, 'sessionId'>) => {
      const messageToSend = { ...message, sessionId, senderId };
      sendJsonMessage(messageToSend);
      if (import.meta.env.DEV) {
        console.log('Sent:', messageToSend);
      }
    },
    [sendJsonMessage, sessionId, senderId],
  );

  // Receipt ack (see AckWSMessage): outside the relayed union `T` — the server
  // logs + swallows it, so it must never be shaped like a peer message.
  const sendAck = useCallback(
    (data: Omit<AckWSMessage['data'], 'ua'>) => {
      sendJsonMessage({
        type: 'ack',
        sessionId,
        data: { ...data, ua: navigator.userAgent },
      } satisfies AckWSMessage);
    },
    [sendJsonMessage, sessionId],
  );

  return {
    sendWSMessage,
    sendAck,
    readyState,
    senderId,
  };
};
