/**
 * Competition data-plane entities and enums — the web copy.
 *
 * The repo has no npm workspaces, so these are consciously duplicated from
 * `server/src/core/types.ts` (the authoritative copy: the enums end up inside
 * DynamoDB sort keys). `types.parity.test.ts` asserts the two stay identical —
 * if that test fails, fix the drift, never the test.
 *
 * This file must stay free of imports: it is compiled by the server package's
 * type-checker if ever imported across, and keeping it dependency-free keeps
 * the parity check trivial.
 */

/** Rounds a Match can belong to (timertimer `Match.round`). */
export const MATCH_ROUNDS = [
  'test',
  'qualification',
  'quarter',
  'half',
  'small_final',
  'final',
] as const;

/** Rounds a Time can belong to — Match rounds plus `training` (timertimer `Time.round`). */
export const TIME_ROUNDS = [
  'test',
  'training',
  'quarter',
  'half',
  'small_final',
  'final',
  'qualification',
] as const;

export const GENDERS = ['male', 'female'] as const;

/** Disciplines a competition runs as independent brackets (speed vs judged freestyle). */
export const DISCIPLINE = ['speed', 'freestyle'] as const;

/**
 * Derived standings pseudo-rounds served by `GET …/rankings/{round}`. They must
 * NEVER join MATCH_ROUNDS/TIME_ROUNDS — those are DynamoDB sort-key vocabularies,
 * while a standings view is computed at read time, never stored.
 */
export const STANDINGS_VIEWS = ['overall', 'combined'] as const;

export type MatchRound = (typeof MATCH_ROUNDS)[number];
export type TimeRound = (typeof TIME_ROUNDS)[number];
export type Gender = (typeof GENDERS)[number];
export type Discipline = (typeof DISCIPLINE)[number];
export type StandingsView = (typeof STANDINGS_VIEWS)[number];

/** Runtime guards (mirror server/src/core/types.ts) — used to validate URL params. */
export const isTimeRound = (v: unknown): v is TimeRound =>
  typeof v === 'string' && (TIME_ROUNDS as readonly string[]).includes(v);

export const isMatchRound = (v: unknown): v is MatchRound =>
  typeof v === 'string' && (MATCH_ROUNDS as readonly string[]).includes(v);

export const isGender = (v: unknown): v is Gender =>
  typeof v === 'string' && (GENDERS as readonly string[]).includes(v);

export const isDiscipline = (v: unknown): v is Discipline =>
  typeof v === 'string' && (DISCIPLINE as readonly string[]).includes(v);

export const isStandingsView = (v: unknown): v is StandingsView =>
  typeof v === 'string' && (STANDINGS_VIEWS as readonly string[]).includes(v);

/**
 * Snap a freestyle score value to 6 decimals (ADR 0039). Scores stay exact
 * doubles (no judging resolution imposed), but plain float addition leaks binary
 * noise (`26.700000000000003`) that breaks `===` tie detection and the ranking
 * sort. 6 dp is far below human input precision yet far above the ≤1e-12 noise at
 * overall magnitude ≤120, so equal sums from different component mixes compare
 * bit-identical while quarter-point entries (`6.25`) survive untouched.
 * Mirrored in server/src/core/types.ts.
 */
export const normalizeScoreValue = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * The freestyle overall: the four judged components minus the control penalty,
 * normalized to kill float noise (ADR 0039). Single source of the formula per
 * package (mirrored in server/src/core/types.ts).
 */
export const computeOverall = (s: {
  difficulty: number;
  combo: number;
  style: number;
  bestTrick: number;
  controlPenalty: number;
}): number =>
  normalizeScoreValue(s.difficulty + s.combo + s.style + s.bestTrick - s.controlPenalty);

/**
 * Per-component score maxima (rule F8). The four judged components are capped;
 * `controlPenalty` stays uncapped and is absent here. Mirrors the server copy in
 * server/src/core/types.ts, guarded by test/app/types.parity.test.ts.
 */
export const SCORE_COMPONENT_MAX = {
  difficulty: 40,
  combo: 30,
  style: 30,
  bestTrick: 20,
} as const;

/**
 * Score components that apply in battles only, never in qualification (rule F8:
 * "Control penalty … battles only, none in quali" / "Best trick … battles only").
 * A qualification Score must carry 0 for both — the console hides these inputs at
 * quali, `scoreInput` zeroes them, and the server 400s a nonzero value. Mirrors
 * server/src/core/types.ts, guarded by test/app/types.parity.test.ts.
 */
export const BATTLE_ONLY_SCORE_COMPONENTS = ['bestTrick', 'controlPenalty'] as const;

/**
 * Split a legacy single `name` into firstName + lastName on the FIRST space (the
 * first word is the given name, the rest the family name; may be empty for a
 * mononym). Mirrors the server copy — the migration rule for pre-split records.
 */
export const splitName = (name: string): { firstName: string; lastName: string } => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
};

/** Join firstName + lastName into the derived `name`, trimming a missing half. */
export const fullName = (firstName: string, lastName: string): string =>
  `${firstName} ${lastName}`.trim();

/** Per-competition freestyle timing config (ADR 0019 §6). */
export interface FreestyleConfig {
  /** Break duration between freestyle runs, ms. 30s default applied at read time. */
  breakMs?: number;
}

export interface Competition {
  compId: string;
  name: string;
  /** ISO dates (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  /**
   * Optional timing config, nested by discipline so future freestyle params
   * (active budget, warm-up) join `config.freestyle` without widening this type.
   */
  config?: { freestyle?: FreestyleConfig };
}

/**
 * A per-competition manager grant (competition ACL). A manager is an ISA user
 * (not in the `timeradmin` group) granted operator access to this competition;
 * the grant is keyed server-side by their immutable Cognito `sub`.
 */
export interface Manager {
  sub: string;
  email: string;
  grantedByEmail: string;
  grantedBySub: string;
  /** Epoch ms. */
  grantedAt: number;
}

/** Default freestyle break when `config.freestyle.breakMs` is unset (ADR 0019 §6). */
export const DEFAULT_FREESTYLE_BREAK_MS = 30_000;

/** A Freestyle timing format: the run/warm-up budgets a board mode applies. */
export interface FreestyleFormatPreset {
  /** Per-run active budget, seconds. */
  runSeconds: number;
  /** Warm-up clock budget, seconds. */
  warmupSeconds: number;
}

/**
 * Championship Freestyle timing formats (rules F4/F5): quali (2:00 run / 5:00
 * warm-up) and battle (2:30 run / 7:00 warm-up). Keyed by board mode — format
 * and mode are the SAME operator input (the ADR 0036 respec), so picking a mode
 * on the console applies its timings. These are format constants the rules
 * define, not per-competition data — the active-budget/warm-up half of the
 * config direction ADR 0019 §6 deferred, kept as console constants so the
 * operator stops retyping 150/420 every battle.
 */
export const FREESTYLE_FORMAT_PRESETS: Record<'quali' | 'battle', FreestyleFormatPreset> = {
  quali: { runSeconds: 120, warmupSeconds: 300 },
  battle: { runSeconds: 150, warmupSeconds: 420 },
};

export interface Athlete {
  athleteId: string;
  compId: string;
  /** Given name — rendered bold on the broadcast cards. */
  firstName: string;
  /** Family name — rendered light on the broadcast cards. Empty for a mononym. */
  lastName: string;
  /**
   * Derived `${firstName} ${lastName}` (trimmed). Stored on write so reads are
   * self-describing and the many list/label consumers keep a single string to
   * render; never authored directly.
   */
  name: string;
  /** Optional condensed label for tight overlays; display falls back to lastName. */
  shortName?: string;
  /** ISO date (YYYY-MM-DD). */
  birthDate: string;
  /** ISO country code. */
  country: string;
  /** Optional second country (dual representation), as in timertimer. */
  country2?: string;
  gender: Gender;
  notes?: string;
  /** S3 object key; the API embeds a signed `photoUrl` on reads instead. */
  photoKey?: string;
  /** CloudFront-signed URL, present on API reads when a photo exists. */
  photoUrl?: string;
}

export interface Time {
  timeId: string;
  compId: string;
  athleteId: string;
  round: TimeRound;
  /** Elapsed milliseconds; `DNF_SENTINEL` (see app/util/time.ts) means DNF. */
  timeMs: number;
  /** Epoch milliseconds of the run start. */
  startTime: number;
  /**
   * The Match this Time was recorded for, when the operator picked one in the
   * timer console (ADR 0013). A non-key provenance attribute — absent for a
   * match-less run; never stored falsy (optional-spread, like `Score.dnf`).
   */
  matchId?: string;
}

export interface Match {
  matchId: string;
  compId: string;
  /** Which bracket this match belongs to (speed vs freestyle). */
  discipline: Discipline;
  round: MatchRound;
  /**
   * Optional display-only override of the round-derived label (timertimer
   * `round_name`). `round` remains the functional source of truth; when this is
   * empty/absent, display falls back to `roundLabel(round)` (see
   * `app/util/rounds.ts` `displayRoundName`).
   */
  roundName?: string;
  gender: Gender;
  /** Ordering within the round. */
  position: number;
  athlete1Id?: string;
  athlete2Id?: string;
  winnerId?: string;
}

/**
 * Freestyle judged score — one record per athlete per round (the (round, athleteId)
 * pair is the identity). Freestyle reuses MATCH_ROUNDS and the speed bracket view.
 */
export interface Score {
  scoreId: string;
  compId: string;
  athleteId: string;
  round: MatchRound;
  difficulty: number;
  combo: number;
  style: number;
  bestTrick: number;
  controlPenalty: number;
  /** Ranking value, higher = better. Defaults to the computeOverall formula. */
  overall: number;
  /**
   * true = attempted-and-failed (DNS/DNF); ranks last among present athletes,
   * renders "DNF". The freestyle analogue of the speed plane's DNF_SENTINEL —
   * stored components/overall are irrelevant once this is set. Absent for a
   * normal score (never stored falsy).
   */
  dnf?: boolean;
  /**
   * The Match this Score was recorded for, when the operator picked one in the
   * scoring console (ADR 0013). A non-key provenance attribute — absent for a
   * match-less score; never stored falsy (optional-spread, like `dnf`).
   */
  matchId?: string;
}

/**
 * Score create/update payload; `overall` is optional (server computes when
 * omitted). The optional `dnf` flag rides along (Omit only drops the derived
 * scoreId/compId/overall), so a DNF builder can set it on create.
 */
export type ScoreInput = Omit<Score, 'scoreId' | 'compId' | 'overall'> & { overall?: number };

/** Ranking entry returned by GET /competitions/{compId}/rankings/{round}. */
export interface RankedAthlete {
  athlete: Athlete;
  bestTimeMs: number;
  /** Present with ?allTimes=true — every attempt, chronological. */
  allTimesMs?: number[];
  /** Freestyle ranking value (higher = better), present on freestyle rankings. */
  overall?: number;
  /** The freestyle score backing `overall`, present on freestyle rankings. */
  score?: Score;
  /** Freestyle DNF flag, present on freestyle rankings — renders "DNF". */
  dnf?: boolean;
}

/** Where a standings placement comes from — also the round its result is read from. */
export type StandingsSource = 'final' | 'small_final' | 'half' | 'quarter' | 'qualification';

/**
 * Placement row returned by GET …/rankings/overall (rule G3): bracket outcomes
 * merged with the qualification ranking. The result fields mirror RankedAthlete
 * (the athlete's best result from the `source` round, quali fallback) but are
 * all optional — a placement can exist before any result (renders "—").
 */
export interface StandingsEntry {
  athlete: Athlete;
  rank: number;
  source: StandingsSource;
  /** Present while the rank can still change (an undecided bracket upstream). */
  provisional?: boolean;
  bestTimeMs?: number;
  overall?: number;
  score?: Score;
  dnf?: boolean;
}

/**
 * Row returned by GET …/rankings/combined (rule G2): the cross-discipline
 * combined title. `combined` = (speedRank + freestyleRank) / 2 is the ranked
 * quantity and the displayed result; `rank` is server-assigned 1224-style
 * (equal averages share it — render `=N` on repeats, never re-derive ties).
 */
export interface CombinedEntry {
  athlete: Athlete;
  rank: number;
  combined: number;
  speedRank: number;
  freestyleRank: number;
  /** Present while either discipline's placement can still change. */
  provisional?: boolean;
}
