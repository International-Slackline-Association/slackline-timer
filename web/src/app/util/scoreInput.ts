import type { MatchInput } from 'app/api/matches';
import {
  BATTLE_ONLY_SCORE_COMPONENTS,
  SCORE_COMPONENT_MAX,
  computeOverall,
  normalizeScoreValue,
  type Match,
  type MatchRound,
  type Score,
  type ScoreInput,
} from 'app/types';
import { appendEffects, drainEffects } from 'app/util/effectStore';
import { matchToInput } from 'app/util/raceTime';

/**
 * The pure half of the Freestyle scoring console (`useScoreRecorder`): the
 * per-athlete-slot entry machine (bottom of the file) plus the helpers that turn a
 * judge panel into a persistable Score and resolve a match winner from two of
 * them. Kept free of React/IO so every record-or-skip decision is exhaustively
 * testable — the live control page can't be unit-tested (it opens real WebSocket
 * connections).
 *
 * The five components are the operator's inputs; `overall` is optional — when an
 * explicit value is given it is carried through, otherwise the server computes it
 * from the components, mirrored here so the previewed value matches what's stored.
 */

/** The five judged component fields the operator types in (strings from inputs). */
export interface ScoreFields {
  difficulty: number;
  combo: number;
  style: number;
  bestTrick: number;
  controlPenalty: number;
}

/**
 * Per-field bound-violation messages for an athlete slot's components (rule F8). Only
 * the capped components appear (`controlPenalty` is uncapped); an in-range or
 * negative value is omitted (the `>= 0` floor is enforced by the input's own
 * `min`/the server).
 */
const scoreFieldErrors = (fields: ScoreFields): Partial<Record<keyof ScoreFields, string>> => {
  const errors: Partial<Record<keyof ScoreFields, string>> = {};
  for (const [comp, max] of Object.entries(SCORE_COMPONENT_MAX) as [
    keyof typeof SCORE_COMPONENT_MAX,
    number,
  ][]) {
    if (fields[comp] > max) errors[comp] = `Max ${max}`;
  }
  return errors;
};

/**
 * Zero the battle-only components (best trick, control penalty) for a
 * qualification Score (rule F8: both apply in battles only, none in quali).
 * Non-quali rounds pass the fields through unchanged. The console hides these
 * inputs at quali, but zeroing here is the enforcement point so no stale value
 * can reach the server (which 400s a nonzero quali value).
 */
export const zeroBattleOnlyForRound = (round: MatchRound, fields: ScoreFields): ScoreFields => {
  if (round !== 'qualification') return fields;
  const out = { ...fields };
  for (const comp of BATTLE_ONLY_SCORE_COMPONENTS) out[comp] = 0;
  return out;
};

/**
 * The ceiling on an Overall override: the sum of the maxima of the components
 * that apply in this round (100 at quali, 120 in a battle). There is no floor —
 * the control penalty is uncapped, so a battle overall may legitimately go
 * negative. Duplicated in server/src/core/types.ts (where `validateScoreInput`
 * 400s the same value), guarded by test/app/types.parity.test.ts.
 */
export const overallMax = (round: MatchRound): number => {
  const battleOnly = BATTLE_ONLY_SCORE_COMPONENTS as readonly string[];
  return Object.entries(SCORE_COMPONENT_MAX)
    .filter(([comp]) => round !== 'qualification' || !battleOnly.includes(comp))
    .reduce((sum, [, max]) => sum + max, 0);
};

/**
 * The Overall override as the operator holds it: `null` = none (the computed
 * value stands), else the raw text typed. Raw, because a battle overall may be
 * negative (the control penalty is uncapped, §4.9) and `-` is not a number yet:
 * parsed eagerly it read as "no override" and the field snapped back to the
 * computed value on the keystroke that opened the minus, putting a negative
 * overall out of reach of the board entirely.
 */
export type OverrideDraft = string | null;

/** Read the Overall field: an emptied field clears the override. */
export const overrideDraft = (raw: string): OverrideDraft => raw.trim() || null;

/**
 * What an override draft is worth — `null` with none, else the number, or NaN
 * while it is half-typed (`scoreEntryErrors` blocks Save on that).
 */
export const overrideValue = (override: OverrideDraft): number | null =>
  override === null ? null : Number(override);

/**
 * Every reason an athlete panel may not be saved, keyed by the field that carries
 * the message — the components over their cap (rule F8) plus the Overall
 * override. One call, so the form's "can this be saved" question has one
 * answer; an empty object means Save is free to go.
 */
export const scoreEntryErrors = (
  round: MatchRound,
  fields: ScoreFields,
  override: OverrideDraft,
): Partial<Record<keyof ScoreFields | 'overall', string>> => {
  const errors: Partial<Record<keyof ScoreFields | 'overall', string>> = scoreFieldErrors(
    zeroBattleOnlyForRound(round, fields),
  );
  const value = overrideValue(override);
  if (value === null) return errors;
  // NaN is a half-typed number (`-`, `1e`) still under the operator's hands.
  // Unflagged it would post as a silent 0 — and the overall is the value the
  // athlete is ranked on.
  if (Number.isNaN(value)) errors.overall = 'Enter a number';
  else if (value > overallMax(round)) errors.overall = `Max ${overallMax(round)}`;
  return errors;
};

/**
 * Build the Score to POST/PUT for an athlete slot. Returns `null` (record nothing) when
 * no athlete is assigned — so an idle slot doesn't create a junk score.
 * `overall` is included only when explicitly overridden (non-null).
 */
export const scoreInput = (
  athleteId: string,
  round: MatchRound,
  fields: ScoreFields,
  overall: number | null,
  matchId?: string,
): ScoreInput | null => {
  if (!athleteId) return null;
  return {
    athleteId,
    round,
    ...zeroBattleOnlyForRound(round, fields),
    ...(overall !== null ? { overall } : {}),
    ...(matchId ? { matchId } : {}),
  };
};

/**
 * Build a DNF Score for an athlete slot: all-zero components plus `dnf: true`, mirroring
 * the speed plane's `dnfTimeInput`. Returns `null` for an unassigned slot. The
 * zeros satisfy the server's component validators; ranking ignores them once dnf
 * is set, sinking the athlete below 0.0 while keeping them in the field.
 */
export const dnfScoreInput = (
  athleteId: string,
  round: MatchRound,
  matchId?: string,
): ScoreInput | null => {
  if (!athleteId) return null;
  return {
    athleteId,
    round,
    difficulty: 0,
    combo: 0,
    style: 0,
    bestTrick: 0,
    controlPenalty: 0,
    dnf: true,
    ...(matchId ? { matchId } : {}),
  };
};

/**
 * Re-send a persisted Score's body under a different athlete — the freestyle
 * twin of `moveTimeInput`. `athleteId` is a sort-key field, so the server runs
 * the PUT as a transactional delete+put: one row moves, none is created.
 */
export const moveScoreInput = (prev: ScoreInput, athleteId: string): ScoreInput => ({
  ...prev,
  athleteId,
});

/**
 * What an athlete slot's panel restores to when a Score already exists for it:
 * the draft to redisplay plus the record that Score leaves on the slot.
 */
export interface SlotRestore {
  draft: EntryDraft;
  record: SavedScore;
}

/** The override a persisted overall implies: none while it is exactly what the
 * components compute, else the stored value carried verbatim (a manual
 * override, or a legacy row whose overall never matched its parts). */
const overrideOf = (fields: ScoreFields, overall: number): OverrideDraft =>
  overall === computeOverall(fields) ? null : String(overall);

/**
 * Find the Score already persisted for an athlete slot (its athlete at the
 * current round) and unpack it for redisplay, or `null` when the slot is
 * unassigned or has no saved Score yet. The (round, athleteId) pair is the
 * Score identity, so that lookup — not `matchId` — is used, restoring scores
 * entered without a match link too.
 *
 * The record it returns is the row's handle: a restored score is as
 * re-attributable as one this board just posted, and the PUT that moves it
 * re-sends this body verbatim under the new athlete.
 */
export const restoreSlotFromScores = (
  athleteId: string | undefined,
  round: MatchRound,
  scores: Score[],
): SlotRestore | null => {
  if (!athleteId) return null;
  const score = scores.find((s) => s.round === round && s.athleteId === athleteId);
  if (!score) return null;
  // Coerce nullish numerics to 0 at this unpacking edge: a legacy/partial record
  // can carry `undefined` where the type says `number` (the persisted-data-vs-types
  // gotcha). Left raw, an absent `overall` reaches `formatScore(fb.overall)` on the
  // console (crash) and `deriveFreestyleMatchWinner` (NaN winner), and absent
  // components feed uncontrolled inputs. Zero matches how a fresh/DNF score stores them.
  const fields: ScoreFields = {
    difficulty: score.difficulty ?? 0,
    combo: score.combo ?? 0,
    style: score.style ?? 0,
    bestTrick: score.bestTrick ?? 0,
    controlPenalty: score.controlPenalty ?? 0,
  };
  const overall = score.overall ?? 0;
  const dnf = score.dnf ?? false;
  const override = overrideOf(fields, overall);
  return {
    draft: { fields, override },
    record: {
      scoreId: score.scoreId,
      input: {
        athleteId,
        round,
        ...fields,
        ...(dnf ? { dnf: true } : {}),
        ...(override !== null ? { overall } : {}),
        ...(score.matchId ? { matchId: score.matchId } : {}),
      },
      result: { overall, dnf },
    },
  };
};

/**
 * An athlete slot's finalised result for the current match: the ranking `overall`
 * (the override when set, else `computeOverall`, per ADR 0010/0013) plus the
 * DNF flag — or null when that slot has no persisted score this match. Unlike
 * speed (lane stops), freestyle has no per-run reset, so this is read off the
 * two entry panels (`matchResultsOf`), which a match change clears.
 */
export type SlotResult = ScoreResult | null;

/**
 * Resolve the freestyle match winner from the two athlete slots' finalised results,
 * returning the full Match PUT body (with `winnerId` set or cleared) or `null`
 * when nothing should be written yet. The freestyle analogue of speed's
 * `runWinningLane` winner derivation (`useRaceRecorder`):
 *
 *  - both athlete slots must have a result, else null (wait for both Saves/DNFs);
 *  - a DNF slot can't win (the freestyle DNF, ADR 0012);
 *  - both DNF → no winner (winnerId cleared);
 *  - exactly one non-DNF slot → that athlete wins;
 *  - two non-DNF slots with equal normalized `overall` (tie) → no winner (cleared);
 *  - otherwise the higher normalized `overall` wins;
 *  - the winning slot must have an assigned athlete, else null (no write).
 */
export const deriveFreestyleMatchWinner = (
  match: Match,
  slotAthletes: Record<1 | 2, string>,
  slotResults: Record<1 | 2, SlotResult>,
): MatchInput | null => {
  const r1 = slotResults[1];
  const r2 = slotResults[2];
  if (r1 === null || r2 === null) return null;

  let winningSlot: 1 | 2 | null;
  if (r1.dnf && r2.dnf) {
    winningSlot = null;
  } else if (r1.dnf) {
    winningSlot = 2;
  } else if (r2.dnf) {
    winningSlot = 1;
  } else {
    // Compare normalized overalls (ADR 0039): two mathematically equal sums from
    // different component mixes differ by ~1e-14 raw, which would silently decide
    // a battle on float noise instead of clearing it for the operator to resolve.
    const o1 = normalizeScoreValue(r1.overall);
    const o2 = normalizeScoreValue(r2.overall);
    if (o1 === o2) {
      winningSlot = null; // exact tie — operator resolves via MatchForm
    } else {
      winningSlot = o1 > o2 ? 1 : 2;
    }
  }

  const winnerId = winningSlot === null ? '' : slotAthletes[winningSlot];
  if (winningSlot !== null && !winnerId) return null;

  // Re-derive from this resolution: strip any prior winner, then set the new one.
  // A cleared winner (tie / both-DNF) drops the key so the PUT unsets it.
  const { winnerId: _prior, ...base } = matchToInput(match);
  return { ...base, ...(winnerId ? { winnerId } : {}) };
};

/**
 * The per-athlete-slot entry machine.
 *
 * One athlete slot's judge panel as a discriminated union (HSM rule 1), replacing the
 * five parallel slices the scoring console used to keep (`fields`, `overrides`,
 * `feedback`, a `matchResults` ref, `derivedWinner`). Those could represent
 * states the board has no meaning for — a locked panel with no recorded value,
 * an override typed into a save already in flight, a match result for a POST
 * that then failed. Here each arm carries exactly the fields valid in it.
 *
 * The transition is pure and effect-emitting like the board's own machines
 * (`battleMachine`): a landed save queues `resolve_match` for the edge, which is
 * what keeps the Match winner derived from PERSISTED results only.
 */

/** An athlete slot's finalised judged value: the ranking `overall` plus the DNF flag. */
export interface ScoreResult {
  overall: number;
  dnf: boolean;
}

/**
 * The Score row an athlete slot has persisted: the id a PUT addresses, the body
 * it was written with, and the value it recorded. Held BESIDE the entry union
 * rather than inside it, because it outlives the panel — picking the next
 * athlete reopens the panel but leaves the row where it is, and this is the
 * only handle left to re-file it (`moveScoreInput`). The speed plane keeps the
 * same pair (`LaneFeedback.saved`), for the same recovery.
 */
export interface SavedScore {
  scoreId: string;
  input: ScoreInput;
  result: ScoreResult;
}

/** Is this slot's persisted row filed under someone other than the athlete now
 * on it? The one question the re-attribution offer is made on — asked by the
 * panel that renders it and by the move that performs it. */
export const isScoreBoundElsewhere = (
  record: SavedScore | null,
  athleteId: string | undefined,
): boolean => Boolean(record && athleteId && record.input.athleteId !== athleteId);

/**
 * The operator's live inputs: the five components plus the overall override
 * (`OverrideDraft`, null = use the computed value). Kept verbatim through a save
 * so a failed POST can be retried, and redisplayed on a locked panel.
 */
export interface EntryDraft {
  fields: ScoreFields;
  override: OverrideDraft;
}

export type SlotEntry =
  | { status: 'empty' }
  | ({ status: 'editing' } & EntryDraft)
  /** A POST in flight; `result` is the value it will record. */
  | ({ status: 'pending'; result: ScoreResult } & EntryDraft)
  /** Persisted. `origin` separates a save this board made from one restored off
   * the server — only the former outranks a `Match.winnerId` the operator may
   * have resolved by hand, and only the former ever writes the Match. */
  | ({ status: 'saved'; result: ScoreResult; origin: 'live' | 'restored' } & EntryDraft)
  /** The POST failed; the draft stays editable and `reason` is rendered. */
  | ({ status: 'error'; result: ScoreResult; reason: string } & EntryDraft);

const EMPTY_FIELDS: ScoreFields = {
  difficulty: 0,
  combo: 0,
  style: 0,
  bestTrick: 0,
  controlPenalty: 0,
};

const EMPTY_ENTRY: SlotEntry = { status: 'empty' };

/** What the panel renders and a Save posts, for any arm. */
export const entryDraft = (entry: SlotEntry): EntryDraft =>
  entry.status === 'empty'
    ? { fields: EMPTY_FIELDS, override: null }
    : { fields: entry.fields, override: entry.override };

/** A panel taking input: neither locked by a save nor mid-POST. */
export const isEntryOpen = (entry: SlotEntry): boolean =>
  entry.status !== 'pending' && entry.status !== 'saved';

/**
 * The result a Match winner may be derived from — a persisted one only. A
 * pending POST is not a result yet and a failed one never became one, so no
 * winner can be written off a score the server never took.
 */
const persistedResult = (entry: SlotEntry): SlotResult =>
  entry.status === 'saved' ? entry.result : null;

export const matchResultsOf = (entries: Record<1 | 2, SlotEntry>): Record<1 | 2, SlotResult> => ({
  1: persistedResult(entries[1]),
  2: persistedResult(entries[2]),
});

/**
 * The one effect the machine emits: a save landed, so the selected Match's
 * winner may now be resolvable. Performed at the edge (it PUTs).
 */
export type ScoreEntryEffect = { kind: 'resolve_match' };

export interface ScoreEntryStore {
  entries: Record<1 | 2, SlotEntry>;
  /** The Score each slot has persisted, or null — see `SavedScore`. */
  records: Record<1 | 2, SavedScore | null>;
  effects: ScoreEntryEffect[];
}

/** Per-athlete-slot actions; `SAVED`/`FAILED` are the POST's two replies, and
 * `MOVED` the re-attribution PUT's. */
type SlotAction =
  | { type: 'EDIT_FIELD'; player: 1 | 2; field: keyof ScoreFields; value: number }
  | { type: 'EDIT_OVERRIDE'; player: 1 | 2; value: OverrideDraft }
  | { type: 'SUBMIT'; player: 1 | 2; result: ScoreResult }
  | { type: 'SAVED'; player: 1 | 2; record: SavedScore }
  | { type: 'FAILED'; player: 1 | 2; reason: string }
  | { type: 'RESTORE'; player: 1 | 2; draft: EntryDraft; record: SavedScore }
  | { type: 'MOVED'; player: 1 | 2; record: SavedScore }
  | { type: 'CLEAR'; player: 1 | 2 };

export type ScoreEntryAction =
  SlotAction | { type: 'CLEAR_BOTH' } | { type: 'SWAP' } | { type: 'DRAIN' };

/** One slot's whole state: the panel, and the row it has on the server. */
interface SlotState {
  entry: SlotEntry;
  record: SavedScore | null;
}

interface SlotTransition extends SlotState {
  effects: ScoreEntryEffect[];
}

/** The panel a persisted body redisplays as — the inverse of `scoreInput`. */
const draftOfInput = (input: ScoreInput): EntryDraft => ({
  fields: {
    difficulty: input.difficulty,
    combo: input.combo,
    style: input.style,
    bestTrick: input.bestTrick,
    controlPenalty: input.controlPenalty,
  },
  override: input.overall === undefined ? null : String(input.overall),
});

const reduceSlot = ({ entry, record }: SlotState, action: SlotAction): SlotTransition => {
  const idle: SlotTransition = { entry, record, effects: [] };
  switch (action.type) {
    case 'EDIT_FIELD': {
      if (!isEntryOpen(entry)) return idle;
      const { fields, override } = entryDraft(entry);
      return {
        entry: { status: 'editing', fields: { ...fields, [action.field]: action.value }, override },
        record,
        effects: [],
      };
    }

    case 'EDIT_OVERRIDE':
      if (!isEntryOpen(entry)) return idle;
      return {
        entry: { status: 'editing', ...entryDraft(entry), override: action.value },
        record,
        effects: [],
      };

    case 'SUBMIT':
      // A locked panel never re-posts (the POST upserts on the Score's stable
      // sort key, so a second save would silently overwrite the recorded row),
      // and neither does one already in flight.
      if (!isEntryOpen(entry)) return idle;
      return {
        entry: { status: 'pending', ...entryDraft(entry), result: action.result },
        record,
        effects: [],
      };

    case 'SAVED':
      // Only a panel still waiting for this reply accepts it: an athlete change
      // mid-flight must not lock a fresh entry over a stale response.
      if (entry.status !== 'pending') return idle;
      return {
        entry: {
          status: 'saved',
          ...entryDraft(entry),
          result: action.record.result,
          origin: 'live',
        },
        record: action.record,
        effects: [{ kind: 'resolve_match' }],
      };

    case 'FAILED':
      if (entry.status !== 'pending') return idle;
      return {
        entry: {
          status: 'error',
          ...entryDraft(entry),
          result: entry.result,
          reason: action.reason,
        },
        record,
        effects: [],
      };

    case 'RESTORE':
      return {
        entry: {
          status: 'saved',
          ...action.draft,
          result: action.record.result,
          origin: 'restored',
        },
        record: action.record,
        effects: [],
      };

    case 'MOVED':
      // The row moved to the athlete now on the slot, so the panel is that
      // athlete's save: locked on the moved value, and `live` — this board
      // wrote it, which is what lets it outrank a stored `Match.winnerId`.
      // Nothing to move for a slot that never persisted a row.
      if (!record) return idle;
      return {
        entry: {
          status: 'saved',
          ...draftOfInput(action.record.input),
          result: action.record.result,
          origin: 'live',
        },
        record: action.record,
        effects: [{ kind: 'resolve_match' }],
      };

    case 'CLEAR':
      // The panel reopens for the next athlete; the row it wrote stays on the
      // slot, so a mis-filed save keeps its one-tap recovery.
      return entry.status === 'empty' ? idle : { entry: EMPTY_ENTRY, record, effects: [] };

    default:
      return ((_exhaustive: never): SlotTransition => idle)(action);
  }
};

export const initialScoreEntries = (): ScoreEntryStore => ({
  entries: { 1: EMPTY_ENTRY, 2: EMPTY_ENTRY },
  records: { 1: null, 2: null },
  effects: [],
});

/**
 * `useReducer` adapter over the per-athlete-slot transition, with the shared effect
 * queue (`util/effectStore`). The two whole-store actions are the ones that move
 * both panels at once: a selection cascade clears them, the setup swap exchanges
 * them (entry and recorded result together — a Score is keyed by athlete, not by
 * slot). Identity is preserved when nothing changed, so an idle dispatch costs
 * no re-render.
 */
export const scoreEntryReducer = (
  store: ScoreEntryStore,
  action: ScoreEntryAction,
): ScoreEntryStore => {
  switch (action.type) {
    case 'DRAIN':
      return drainEffects(store);

    case 'CLEAR_BOTH':
      // A selection cascade is a new pair: the rows go with the panels, since
      // the athletes they were filed under are no longer on the board.
      return ([1, 2] as const).every(
        (slot) => store.entries[slot].status === 'empty' && store.records[slot] === null,
      )
        ? store
        : { ...store, entries: { 1: EMPTY_ENTRY, 2: EMPTY_ENTRY }, records: { 1: null, 2: null } };

    case 'SWAP':
      return {
        ...store,
        entries: { 1: store.entries[2], 2: store.entries[1] },
        records: { 1: store.records[2], 2: store.records[1] },
      };

    default: {
      const current: SlotState = {
        entry: store.entries[action.player],
        record: store.records[action.player],
      };
      const { entry, record, effects } = reduceSlot(current, action);
      if (entry === current.entry && record === current.record && effects.length === 0)
        return store;
      return {
        entries: { ...store.entries, [action.player]: entry },
        records: { ...store.records, [action.player]: record },
        effects: appendEffects(store.effects, effects),
      };
    }
  }
};

/**
 * What the winner line is still waiting for, or null once both athlete slots are
 * persisted (§4.9). A winner is derived from saved results only, so a blank
 * line would read as "no winner" when it means "not yet" — this names whose
 * save is outstanding instead.
 */
export const winnerAwaiting = (entries: Record<1 | 2, SlotEntry>): string | null => {
  const missing = ([1, 2] as const).filter((slot) => entries[slot].status !== 'saved');
  if (missing.length === 0) return null;
  return missing.length === 2 ? 'waits for both saves' : `waits for Athlete ${missing[0]} save`;
};

/**
 * The match winner as the console displays it. `winnerId` is the athlete id or
 * '' (an explicit no-winner — tie / both DNF); `source` says whether it was
 * resolved from the two saved scores or read off the stored Match.
 */
export interface MatchWinner {
  winnerId: string;
  source: 'persisted' | 'derived';
}

/**
 * Resolve what the winner line shows. A derivation from both persisted scores
 * wins once this board saved one of them — that save is the newer fact, and
 * waiting for the Match PUT to round-trip would flash the superseded winner.
 * Otherwise the stored `Match.winnerId` wins: on a restored match it may be an
 * operator's manual resolution (a tie decided on the Matches page), which
 * re-deriving would silently contradict.
 */
export const resolveMatchWinner = (
  match: Match | undefined,
  slotAthletes: Record<1 | 2, string>,
  entries: Record<1 | 2, SlotEntry>,
): MatchWinner | null => {
  if (!match) return null;
  const derived = deriveFreestyleMatchWinner(match, slotAthletes, matchResultsOf(entries));
  const savedHere = ([1, 2] as const).some(
    (slot) => entries[slot].status === 'saved' && entries[slot].origin === 'live',
  );
  if (derived && (savedHere || !match.winnerId)) {
    return { winnerId: derived.winnerId ?? '', source: 'derived' };
  }
  return match.winnerId ? { winnerId: match.winnerId, source: 'persisted' } : null;
};
