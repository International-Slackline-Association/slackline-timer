import { getBaseToken } from 'app/auth';
import { setWsAuthDenied } from 'app/auth/wsAuthSignal';
import { WS_URL } from 'app/constants';
import { type Discipline, type Gender } from 'app/types';
import { useCallback, useEffect, useRef, useState } from 'react';
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
 * re-sends on every selection change and on sender-socket OPEN, mirroring
 * `updateLaneNames`. `round` is a `TimeRound` for speed and a `MatchRound` for
 * freestyle — kept as a string here, validated by the consuming query (the
 * recorder owns the enum).
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
 * The Freestyle board's live selection. Every extra field here is relay-only +
 * web-only (no server/parity change) and optional, so a pre-feature overlay
 * simply ignores the ones it does not know.
 */
export interface FreestyleSelection extends SelectionCommon {
  discipline: 'freestyle';
  /**
   * The board's explicit Quali/Battle mode (ADR 0036 — not inferred from a
   * missing athlete 2). Quali collapses the preview/broadcast timer to a single
   * centred hero. Re-pushed on every OPEN like the rest of the selection, so
   * late joiners recover it. Absent on a pre-0036 control page, which renders
   * as battle — the old two-lane default.
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
  };
  /**
   * The **battle** next-up player — whom the next ADVANCE would start
   * (`advanceTarget`, ADR 0037), relayed so the audience athlete display can warn
   * the next rider to get ready. The board's own pure suggestion is
   * control-local; this rides the selection like `bestTrick`
   * so the display shares the one source rather than re-deriving it from replayed
   * timer messages. Populated only in battle mode while nothing runs / no try is
   * armed (the changeover pause — exactly the board's own "Next:" hint window);
   * `null`/absent otherwise (a live run, best trick, quali).
   */
  nextUp?: 1 | 2 | null;
  /**
   * The **quali** next-up athlete, by id. Quali runs one athlete at a time, so
   * there is no idle slot for `nextUp` to point at and the order is not
   * derivable from anything the board holds — the operator names it (owner call,
   * 2026-09-19) and the app only shows the room. Consumers resolve the id to a
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
 * last-writer-wins stamp. Its original role — dropping the relay echo of a
 * control page's own sends off its second socket — died with the second socket
 * (ADR 0043): every page is single-socket now, and the relay excludes the
 * sending *connection* from the fan-out, so no page ever receives its own sends.
 * Additive and optional: the relay ignores it, and a message from a pre-feature
 * page simply arrives without one.
 */
export interface WSEnvelope {
  sessionId: string;
  senderId?: string;
}

/**
 * The five session-scoped (not lane-scoped) message variants, shared by both
 * mode unions. They address the whole session, never a single timer, so — unlike
 * the Countdown envelope's lane messages — they carry NO `timerId`. Lane
 * consumers filter on `timerId !== <lane id>`, so a session message (which has
 * no `timerId`) is filtered out exactly as the former `timerId: -1` sentinel
 * was: dropping the sentinel is wire-compatible (ws-session-message-family).
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
           * the speed board's names and vice versa; without this tag the names
           * cross-talk (the speed board's `updateLaneNames` has no legitimate
           * consumer — only the freestyle hero band reads them). Optional +
           * additive: a pre-feature sender omits it and the consumer applies
           * unconditionally, preserving the old behaviour.
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
         * and a late-arriving loser rolls an overlay back. Optional and additive:
         * an unstamped message (pre-feature page) applies unconditionally. */
        seq?: number;
        /** A re-statement of a value this panel ADOPTED, carrying the stamp it
         * adopted: it must lose every tie (ADR 0038 §4 addendum). A mirror
         * re-pushes whatever its adoption rebuilt, and the forwarded stamp can
         * only tie the panel that authored the value — so without this the tie
         * fell to `senderId`, a per-mount UUID, and whether a mirror outranked
         * its own author was a coin flip fixed for the life of the room. On the
         * variant, not the envelope: the mirrored timer path emits no `ws`
         * effect by construction (ADR 0038), so "echo" has no meaning on any
         * other frame. Optional and additive — an omitted flag reads as
         * authoritative, exactly as a pre-feature page's frames do. */
        echo?: true;
      }
    // State recovery (peer-to-peer): a late-joining / reconnecting page asks the
    // session for the current snapshot; every control panel answers (converged
    // panels agree — last writer wins at the consumer, ADR 0038). Control panels
    // themselves request state on open too, to mirror an already-running peer.
    // The relay stays stateless — it just forwards both.
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
        // The undo of a mis-pressed `stop` (`speedline-resume-stopped-lane`):
        // the lane's stop is withdrawn and its clock continues off the ORIGINAL
        // GO epoch, which every surface still holds — so the frame carries only
        // the lane. Re-sending `start` would not do: it re-ignites both lanes
        // and moves the epoch the lights, beeps and every overlay anchor on.
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
   * `resume` it missed (`Stopwatch.mergeRecovery`). Optional + additive: a
   * pre-feature sender omits it and the consumer keeps the old, never-un-freeze
   * behaviour. */
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
               * SHARED anchor on the wire, mirroring the stopwatch's absolute
               * `startTime` (doc/dev/architecture.md → "What an overlay needs
               * to stay in sync"). Every receiver derives `now − startedAt` off
               * this one epoch, so overlays converge instead of each
               * re-anchoring to its own receipt time — which spread them by
               * delivery latency, and `formatClock`'s whole-second floor
               * amplified any sub-second skew into a full 1 s on-screen
               * difference. Optional + additive: a receiver of a message
               * without it (a pre-feature sender) falls back to receipt-time
               * `Date.now()`, preserving the old behaviour.
               * `stop`/`reset`/`end_break` carry frozen values and need no
               * anchor. Web-only — the relay is opaque.
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
        // break-zero the lane holds for a manual Start. The relay stays opaque —
        // a web-only union change, no server/parity change.
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
  // are optional/additive — absent on a pre-feature control page, where the
  // receiver falls back to receipt-time `Date.now()` (the old behaviour).
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
 * lane anchors its tick to a shared wire epoch instead of its own receipt time —
 * every late joiner then converges rather than smearing (the former ~1s drift).
 */
export interface CountdownSnapshot {
  isPreviewEnabled: boolean;
  timers: CountdownTimerRow[];
}

/**
 * Emitted server-side by the write Lambdas after every successful
 * competition-data write (the analogue of timertimer's "db" PubSub topic).
 * Consumers invalidate the matching React Query keys and re-fetch — the
 * payload deliberately carries ids only, never the data itself.
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
 * the members' *shared* keys, which would silently drop the Countdown lane
 * variants' `timerId` (session variants lack it after ws-session-message-family);
 * this keeps each variant's own keys so `sendWSMessage` still accepts a
 * lane-scoped `timerId`.
 */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * App-level keepalive (ADR 0024): API Gateway drops a WS connection after
 * 10 idle minutes, so every client pings inside that window. Not part of the
 * relayed unions above — `messageHandler` swallows it before the fan-out, so a
 * ping never appears in any peer's `lastJsonMessage`.
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

export const useWS = <T extends WSMessage>(params: {
  sessionId: string;
  /** Event read token for /stream/* overlays — used instead of a Cognito session. */
  readToken?: string;
}) => {
  const { readToken, sessionId } = params;

  // Per-mount sender id, stamped on every outgoing message — the selection
  // LWW tiebreak (ADR 0038 §4; see the WSEnvelope doc).
  const [senderId] = useState<string>(() => crypto.randomUUID());

  // Resolve the credential lazily, on every (re)connect. react-use-websocket
  // re-invokes a function `url` each time it (re)opens the socket, so fetching
  // the token here — rather than reading it once on mount — means a reconnect
  // after the ~1h IdToken lifetime picks up a freshly refreshed token instead
  // of replaying a stale one. Priority: an explicit read token (overlays) >
  // the baseline credential from the `app/auth` seam (Cognito IdToken in prod,
  // refreshed transparently by Amplify; a dummy token in local dev). The hook
  // never branches on the environment — the seam does.
  // Memoised so its identity only changes with sessionId/readToken — otherwise
  // react-use-websocket (which keys its connect effect on the `url` arg) would
  // tear down and reopen the socket on every render.
  const getUrl = useCallback(async (): Promise<string> => {
    const authToken = readToken ?? (await getBaseToken()) ?? '';
    const url = new URL(WS_URL);
    // The $connect authorizer reads this query param and verifies it as a
    // Cognito IdToken (operator group) or an event read token.
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

  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket<T>(
    getUrl,
    {
      // Reconnect on drops so the lazy `getUrl` above can supply a fresh token
      // (and so a transient network blip self-heals during a competition).
      shouldReconnect: () => true,
      reconnectAttempts: Infinity,
      reconnectInterval: wsReconnectDelay,
      // Unreachable under Infinity attempts — kept as a loud tripwire should a
      // cap ever be reintroduced, so a give-up is never silent again.
      onReconnectStop: (attempts) => {
        console.error(`WebSocket gave up reconnecting after ${attempts} attempts — reload`);
      },
      onOpen: () => {
        everOpened.current = true;
        setWsAuthDenied(false);
      },
      onClose: () => {
        // Closed before ever opening ⇒ the $connect authorizer rejected us
        // (not a timeradmin, or an expired/invalid token). Overlays carry their
        // own read token and are gated separately, so only flag operator
        // sessions.
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

  // Dev-only wire trace. Gated behind import.meta.env.DEV so it never runs in a
  // production build: an event-long relay is chatty (a socket per page + every
  // overlay), and the payloads would otherwise leak into on-air screen captures.
  useEffect(() => {
    if (import.meta.env.DEV && lastJsonMessage !== null) {
      console.log('Received:', lastJsonMessage);
    }
  }, [lastJsonMessage]);

  // Memoised so its identity is stable across renders: callers that send on a
  // readyState transition (e.g. the overlay's request_state-on-OPEN) can list it
  // as an effect dep without the effect re-firing on every render.
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

  // Receipt ack (see AckWSMessage): outside the relayed union `T` on purpose —
  // the server logs + swallows it, so it must never be shaped like a peer
  // message. Stable identity for the same reason as sendWSMessage.
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
    lastJsonMessage,
    senderId,
  };
};
