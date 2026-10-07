import type { WSMessage } from 'app/hooks/useWebSocket';
import {
  isCountdownSnapshotShape,
  isLanePair,
  isSpeedlineSnapshotShape,
} from 'app/util/timerSnapshot';

/**
 * The relay receive guard (ADR 0051): every inbound frame is checked here
 * before any consumer sees it, so one malformed peer frame is dropped instead
 * of throwing inside every page in the room.
 *
 * Policy: check exactly what consumers read, nothing more. Unknown extra keys
 * pass, optional/additive fields are checked only when present, and the legacy
 * shapes still on the wire mid-deploy pass (no `discipline`/`seq`/`echo`/`at`/
 * `startedAt`, a session frame carrying `timerId: -1`). Unknown `type`s are
 * dropped — no consumer has a branch for them.
 *
 * Hand-rolled: zod alone is ~13 kB gzip, carried by every overlay bundle.
 */

type Frame = Record<string, unknown>;

/** A `seq` further ahead than this is a poisoned stamp, not a clock: one would
 * win every LWW tiebreak in the room until the wall clock caught up. */
export const SEQ_MAX_LEAD_MS = 24 * 60 * 60 * 1000;

const isObject = (v: unknown): v is Frame =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isStringOrNull = (v: unknown): boolean => v === null || isString(v);
const isOptional = (v: unknown, check: (v: unknown) => boolean): boolean =>
  v === undefined || check(v);
const isNumberArray = (v: unknown): boolean => Array.isArray(v) && v.every(isNumber);
const isOneOf =
  (...values: unknown[]) =>
  (v: unknown): boolean =>
    values.includes(v);

const isLaneOrNull = isOneOf(1, 2, null);
const isDbEntity = isOneOf('competition', 'athlete', 'time', 'match', 'score');

const dataOf = (frame: Frame): Frame | null => (isObject(frame.data) ? frame.data : null);

/** A frame whose `data` must be an object satisfying `check`. */
const withData =
  (check: (data: Frame) => boolean) =>
  (frame: Frame): boolean => {
    const data = dataOf(frame);
    return data !== null && check(data);
  };

const isBestTrick = (v: unknown): boolean =>
  isObject(v) &&
  isNumber(v.cap) &&
  isLanePair(v.tries) &&
  isLaneOrNull(v.turn) &&
  typeof v.clockRunning === 'boolean' &&
  isOptional(v.rev, isNumber);

/** Both arms of `LiveSelection`; a pre-discipline board omits `discipline`. */
const isSelection = (data: Frame): boolean =>
  isString(data.round) &&
  isString(data.gender) &&
  isOptional(data.matchId, isStringOrNull) &&
  isStringOrNull(data.athlete1Id) &&
  isStringOrNull(data.athlete2Id) &&
  isOptional(data.discipline, isString) &&
  isOptional(data.runWins, isLanePair) &&
  isOptional(data.falseStarts, isLanePair) &&
  isOptional(data.freestyleMode, isString) &&
  isOptional(data.bestTrick, isBestTrick) &&
  isOptional(data.nextUp, isLaneOrNull) &&
  isOptional(data.qualiNextUp, isStringOrNull);

const accept = (): boolean => true;

/** Lane-scoped countdown frames carry `timerId` on the envelope, not in `data`. */
const countdownLane =
  (check: (data: Frame) => boolean) =>
  (frame: Frame): boolean =>
    isNumber(frame.timerId) && withData(check)(frame);

const remainingOnly = (data: Frame): boolean => isNumber(data.remainingMs);

/**
 * One check per wire type. Keyed by the union's own `type`s, so adding a
 * message to `WSMessage` without a check here fails to compile.
 */
const CHECKS: Record<WSMessage['type'], (frame: Frame, now: number) => boolean> = {
  updatePreview: withData((data) => typeof data.enabled === 'boolean'),
  updateLaneNames: withData(
    (data) => isString(data.lane1) && isString(data.lane2) && isOptional(data.discipline, isString),
  ),
  updateSelection: (frame, now) =>
    withData(isSelection)(frame) &&
    isOptional(frame.seq, (seq) => isNumber(seq) && seq <= now + SEQ_MAX_LEAD_MS) &&
    (frame.echo === undefined || frame.echo === true),
  request_state: accept,
  state_snapshot: withData((data) =>
    isNumber(data.signalPhase) ? isSpeedlineSnapshotShape(data) : isCountdownSnapshotShape(data),
  ),
  start: withData((data) => isNumber(data.startTime) && isNumberArray(data.lanes)),
  stop: withData((data) => isNumber(data.timerId) && isNumber(data.stopTime)),
  resume: withData((data) => isNumber(data.timerId)),
  reset: accept,
  updateSignalPhase: withData(
    (data) =>
      isNumber(data.currentPhase) &&
      isOptional(data.anchorEpoch, isNumber) &&
      isOptional(data.lanes, isNumberArray),
  ),
  updateText: withData((data) => isString(data.text)),
  start_countdown: countdownLane(
    (data) => isNumber(data.remainingMs) && isOptional(data.startedAt, isNumber),
  ),
  stop_countdown: countdownLane(remainingOnly),
  reset_countdown: countdownLane(remainingOnly),
  start_break: countdownLane(
    (data) =>
      isNumber(data.runRemainingMs) &&
      isNumber(data.breakMs) &&
      isNumber(data.breaksLeft) &&
      isOptional(data.startedAt, isNumber),
  ),
  end_break: countdownLane((data) => isNumber(data.runRemainingMs)),
  db_update: withData((data) => isDbEntity(data.entity)),
};

/**
 * Whether a parsed relay frame is one this client can consume. `now` bounds the
 * selection stamp (`SEQ_MAX_LEAD_MS`); it defaults to the wall clock.
 */
export const isRelayFrame = (value: unknown, now: number = Date.now()): value is WSMessage => {
  if (!isObject(value) || !isString(value.type)) return false;
  if (!isOptional(value.sessionId, isString) || !isOptional(value.senderId, isString)) {
    return false;
  }
  // Consumers compare it against lane ids (and a legacy session frame carries -1).
  if (!isOptional(value.timerId, isNumber)) return false;
  if (!Object.prototype.hasOwnProperty.call(CHECKS, value.type)) return false;
  return CHECKS[value.type as WSMessage['type']](value, now);
};
