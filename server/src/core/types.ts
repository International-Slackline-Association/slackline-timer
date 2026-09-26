/**
 * Competition data-plane entities and enums — the web↔server parity surface.
 *
 * The enums are ported 1:1 from timertimer's Ecto schemas and must stay
 * exactly in sync with `web/src/app/types.ts` — they end up inside DynamoDB
 * sort keys, so silent drift corrupts data permanently. The repo has no npm
 * workspaces, so the duplication is conscious; a parity test on the web side
 * (`web/test/app/types.parity.test.ts`) asserts both copies match.
 *
 * This file must stay free of imports: it is compiled by the web package's
 * test runner for the parity check. Server-only request validators live in
 * `./validators`.
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

/** Elapsed-ms value that means "Did Not Finish". Preserve this exact integer. */
export const DNF_SENTINEL = 3_355_550;

/** Per-competition freestyle timing config (ADR 0019 §6). */
export interface FreestyleConfig {
  /** Break duration between freestyle runs, ms. 30s default applied at read time. */
  breakMs?: number;
}

export interface Competition {
  compId: string;
  name: string;
  /** ISO dates (YYYY-MM-DD). `endDate` bounds read-token and photo-URL expiry. */
  startDate: string;
  endDate: string;
  /** Bumping this invalidates every outstanding read token for the competition. */
  tokenVersion: number;
  /**
   * Optional timing config, nested by discipline so future freestyle params
   * (active budget, warm-up) join `config.freestyle` without widening this type.
   */
  config?: { freestyle?: FreestyleConfig };
}

/** Default freestyle break when `config.freestyle.breakMs` is unset (ADR 0019 §6). */
export const DEFAULT_FREESTYLE_BREAK_MS = 30_000;

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
  /** S3 object key (content-hashed); reads embed a signed `photoUrl` instead. */
  photoKey?: string;
}

export interface Time {
  timeId: string;
  compId: string;
  athleteId: string;
  round: TimeRound;
  /** Elapsed milliseconds; `DNF_SENTINEL` means DNF. */
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
   * `round_name`). `round` is the functional source of truth (identity, bracket
   * logic, SK ordering); when empty/absent the client falls back to the standard
   * round label. Seeded/advanced bracket matches leave this empty.
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
 * Mirrored in web/src/app/types.ts.
 */
export const normalizeScoreValue = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * The freestyle overall: the four judged components minus the control penalty,
 * normalized to kill float noise (ADR 0039). Single source of the formula per
 * package (mirrored in web/src/app/types.ts).
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
 * `controlPenalty` stays uncapped (2 pts/leash-fall has no rule ceiling) and is
 * absent here so the validator leaves it `>= 0` only. Duplicated in
 * web/src/app/types.ts, guarded by web/test/app/types.parity.test.ts.
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
 * quali, `scoreInput` zeroes them, and `validateScoreInput` 400s a nonzero value.
 * Duplicated in web/src/app/types.ts, guarded by web/test/app/types.parity.test.ts.
 */
export const BATTLE_ONLY_SCORE_COMPONENTS = ['bestTrick', 'controlPenalty'] as const;

/**
 * The ceiling on an Overall override: the sum of the maxima of the components
 * that apply in this round (100 at quali, 120 in a battle). There is no floor —
 * the control penalty is uncapped, so a battle overall may legitimately go
 * negative. Duplicated in web/src/app/util/scoreInput.ts (where the console
 * blocks Save on it), guarded by web/test/app/types.parity.test.ts.
 */
export const overallMax = (round: MatchRound): number => {
  const battleOnly = BATTLE_ONLY_SCORE_COMPONENTS as readonly string[];
  return Object.entries(SCORE_COMPONENT_MAX)
    .filter(([comp]) => round !== 'qualification' || !battleOnly.includes(comp))
    .reduce((sum, [, max]) => sum + max, 0);
};

/**
 * Split a legacy single `name` into firstName + lastName on the FIRST space:
 * the first word is the given name, everything after it the family name (which
 * may be empty for a mononym). Whitespace is trimmed/collapsed. This is the
 * one-time migration rule for records authored before the name split (ADR 0016).
 */
export const splitName = (name: string): { firstName: string; lastName: string } => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
};

/** Join firstName + lastName into the derived `name`, trimming a missing half. */
export const fullName = (firstName: string, lastName: string): string =>
  `${firstName} ${lastName}`.trim();

/** Display names ported from timertimer's `Match.get_round_name/1`. */
export const roundDisplayName = (round: string): string => {
  switch (round) {
    case 'test':
      return 'test round';
    case 'qualification':
      return 'qualifications';
    case 'quarter':
      return 'quarter-finals';
    case 'half':
      return 'semi-finals';
    case 'small_final':
      return 'small-finals';
    case 'final':
      return 'finals';
    default:
      return 'all rounds';
  }
};

/** Display names ported from timertimer's `Match.get_gender_name/1`. */
export const genderDisplayName = (gender: Gender): string =>
  gender === 'male' ? "men's" : "women's";
