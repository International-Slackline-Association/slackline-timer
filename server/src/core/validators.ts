/**
 * Request-shape validators for the competition data plane. Lambda handlers
 * stay thin; these are the tested parts. Server-only — the shared web↔server
 * parity surface (enums, entities, formulas) lives in `./types`, which must
 * stay import-free for the web parity test.
 */

import {
  BATTLE_ONLY_SCORE_COMPONENTS,
  DISCIPLINE,
  FIELD_LIMITS,
  GENDERS,
  MATCH_ROUNDS,
  SCORE_COMPONENT_MAX,
  TIME_ROUNDS,
  computeOverall,
  fullName,
  isDiscipline,
  isGender,
  isMatchRound,
  isTimeRound,
  normalizeScoreValue,
  overallMax,
  splitName,
  type Athlete,
  type Competition,
  type Discipline,
  type Gender,
  type Match,
  type MatchRound,
  type Score,
  type Time,
  type TimeRound,
} from './types';

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Every id a body carries, and the compId (= the relay sessionId). */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Alpha-2, IOC/alpha-3 or numeric-3: the shapes `toAlpha2` resolves to a flag. */
export const COUNTRY_RE = /^[A-Za-z]{2,3}$|^\d{3}$/;

/** The content-hashed key `photoUpload` mints; group 1 is the owning compId. */
export const PHOTO_KEY_RE = /^photos\/([A-Za-z0-9_-]{1,64})\/[0-9a-f]{64}\.(jpg|png|webp)$/;

/**
 * Soft cap, checked on athlete create only: 300 × ~3 KB keeps `listAthletes` and
 * the rankings responses near 1 MB, far under Lambda's 6 MB.
 */
export const MAX_ATHLETES_PER_COMP = 300;

export const isBoundedString = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max;

export const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);

export const isIntInRange = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export const isFiniteInRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

const isBirthDate = (v: unknown, now: number): boolean =>
  isIsoDate(v) &&
  isIntInRange(Number(v.slice(0, 4)), FIELD_LIMITS.birthYearMin, new Date(now).getUTCFullYear());

const competitionNameError = (v: unknown): string | null =>
  isNonEmptyString(v) && v.length <= FIELD_LIMITS.competitionName
    ? null
    : `name is required (max ${FIELD_LIMITS.competitionName} chars)`;

const optionalIdError = (b: Record<string, unknown>, field: string): string | null =>
  b[field] === undefined || isId(b[field])
    ? null
    : `${field} must be an id (1-${FIELD_LIMITS.id} chars, letters/digits/_/-) when given`;

/** Competition create input (compId is the relay sessionId — keep it URL-safe). */
export const validateCompetitionInput = (
  body: unknown,
): Validated<Pick<Competition, 'compId' | 'name' | 'startDate' | 'endDate'>> => {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isId(b.compId)) errors.push('compId is required (1-64 chars, letters/digits/_/-)');
  const nameError = competitionNameError(b.name);
  if (nameError) errors.push(nameError);
  if (!isIsoDate(b.startDate)) errors.push('startDate must be an ISO date (YYYY-MM-DD)');
  if (!isIsoDate(b.endDate)) errors.push('endDate must be an ISO date (YYYY-MM-DD)');
  if (errors.length === 0 && Date.parse(b.endDate as string) < Date.parse(b.startDate as string)) {
    errors.push('endDate must not be before startDate');
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      compId: b.compId as string,
      name: (b.name as string).trim(),
      startDate: b.startDate as string,
      endDate: b.endDate as string,
    },
  };
};

/**
 * Competition update input (PUT). Edits the non-key META attributes only —
 * `compId` (PK + relay sessionId) and `tokenVersion` (revocation state) are
 * immutable and ignored if sent. Same name/date rules as create, plus an
 * optional nested freestyle timing config.
 */
export const validateCompetitionUpdateInput = (
  body: unknown,
): Validated<Pick<Competition, 'name' | 'startDate' | 'endDate'> & Pick<Competition, 'config'>> => {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  const nameError = competitionNameError(b.name);
  if (nameError) errors.push(nameError);
  if (!isIsoDate(b.startDate)) errors.push('startDate must be an ISO date (YYYY-MM-DD)');
  if (!isIsoDate(b.endDate)) errors.push('endDate must be an ISO date (YYYY-MM-DD)');
  if (errors.length === 0 && Date.parse(b.endDate as string) < Date.parse(b.startDate as string)) {
    errors.push('endDate must not be before startDate');
  }

  let breakMs: number | undefined;
  const config = b.config as { freestyle?: { breakMs?: unknown } } | undefined;
  const rawBreak = config?.freestyle?.breakMs;
  if (rawBreak !== undefined) {
    const { min, max } = FIELD_LIMITS.breakMs;
    if (!isIntInRange(rawBreak, min, max)) {
      errors.push(`config.freestyle.breakMs must be an integer ${min}..${max} when given`);
    } else {
      breakMs = rawBreak;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: (b.name as string).trim(),
      startDate: b.startDate as string,
      endDate: b.endDate as string,
      ...(breakMs !== undefined ? { config: { freestyle: { breakMs } } } : {}),
    },
  };
};

/**
 * Athlete create/update input. The name source of truth is `firstName` +
 * `lastName`; `name` is derived. For back-compat a legacy `name`-only payload is
 * accepted and split on the first space (ADR 0016). `shortName` is optional
 * (display falls back to lastName), stored only when non-empty.
 */
export const validateAthleteInput = (
  body: unknown,
  now: number = Date.now(),
): Validated<Omit<Athlete, 'athleteId' | 'compId'>> => {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  // Resolve names: explicit firstName/lastName take precedence; otherwise split
  // a legacy `name`. firstName is always required (directly or via the split).
  const hasFirst = isNonEmptyString(b.firstName);
  const migrated = !hasFirst && isNonEmptyString(b.name) ? splitName(b.name as string) : undefined;
  const firstName = hasFirst ? (b.firstName as string).trim() : (migrated?.firstName ?? '');
  const lastName = hasFirst
    ? typeof b.lastName === 'string'
      ? b.lastName.trim()
      : ''
    : (migrated?.lastName ?? '');

  if (!hasFirst && migrated === undefined) {
    errors.push('firstName is required (or a legacy name to split)');
  } else if (hasFirst && !isNonEmptyString(b.lastName)) {
    // A mononym is only allowed via the legacy-name migration path.
    errors.push('lastName is required');
  }
  if (migrated !== undefined && !isBoundedString(b.name, FIELD_LIMITS.legacyName)) {
    errors.push(`name must be at most ${FIELD_LIMITS.legacyName} chars`);
  }
  // Checked on the resolved halves, so a split legacy name obeys them too.
  if (firstName.length > FIELD_LIMITS.firstName) {
    errors.push(`firstName must be at most ${FIELD_LIMITS.firstName} chars`);
  }
  if (lastName.length > FIELD_LIMITS.lastName) {
    errors.push(`lastName must be at most ${FIELD_LIMITS.lastName} chars`);
  }
  if (b.shortName !== undefined && !isBoundedString(b.shortName, FIELD_LIMITS.shortName)) {
    errors.push(`shortName must be a string of at most ${FIELD_LIMITS.shortName} chars when given`);
  }
  if (!isBirthDate(b.birthDate, now)) {
    errors.push(
      `birthDate must be an ISO date (YYYY-MM-DD) from ${FIELD_LIMITS.birthYearMin} to this year`,
    );
  }
  if (typeof b.country !== 'string' || !COUNTRY_RE.test(b.country.trim())) {
    errors.push('country must be an alpha-2, alpha-3/IOC or numeric-3 code');
  }
  if (!isGender(b.gender)) errors.push(`gender must be one of: ${GENDERS.join(', ')}`);
  if (
    b.country2 !== undefined &&
    (typeof b.country2 !== 'string' || !COUNTRY_RE.test(b.country2.trim()))
  ) {
    errors.push('country2 must be an alpha-2, alpha-3/IOC or numeric-3 code when given');
  }
  if (b.notes !== undefined && !isBoundedString(b.notes, FIELD_LIMITS.notes)) {
    errors.push(`notes must be a string of at most ${FIELD_LIMITS.notes} chars when given`);
  }
  if (
    b.photoKey !== undefined &&
    !(typeof b.photoKey === 'string' && PHOTO_KEY_RE.test(b.photoKey))
  ) {
    errors.push('photoKey must be a photos/<compId>/<sha256>.<jpg|png|webp> key when given');
  }

  if (errors.length > 0) return { ok: false, errors };
  const shortName = typeof b.shortName === 'string' ? b.shortName.trim() : '';
  return {
    ok: true,
    value: {
      firstName,
      lastName,
      name: fullName(firstName, lastName),
      ...(shortName !== '' ? { shortName } : {}),
      birthDate: b.birthDate as string,
      country: (b.country as string).trim(),
      ...(b.country2 !== undefined ? { country2: (b.country2 as string).trim() } : {}),
      gender: b.gender as Gender,
      ...(b.notes !== undefined ? { notes: b.notes as string } : {}),
      ...(b.photoKey !== undefined ? { photoKey: b.photoKey as string } : {}),
    },
  };
};

/**
 * Time create/update input. `startTime` is optional on create: it defaults to
 * `now - timeMs` exactly like timertimer's `maybe_put_start_time`.
 */
export const validateTimeInput = (
  body: unknown,
  now: number,
): Validated<Omit<Time, 'timeId' | 'compId'>> => {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isId(b.athleteId)) errors.push('athleteId is required (an id)');
  if (!isTimeRound(b.round)) errors.push(`round must be one of: ${TIME_ROUNDS.join(', ')}`);
  const { min, max } = FIELD_LIMITS.timeMs;
  if (!isIntInRange(b.timeMs, min, max)) errors.push(`timeMs must be an integer ${min}..${max}`);
  if (
    b.startTime !== undefined &&
    !isIntInRange(b.startTime, 1, now + FIELD_LIMITS.startTimeSkewMs)
  ) {
    errors.push('startTime must be an epoch-ms integer no later than a day from now when given');
  }
  const matchIdError = optionalIdError(b, 'matchId');
  if (matchIdError) errors.push(matchIdError);

  if (errors.length > 0) return { ok: false, errors };
  const timeMs = b.timeMs as number;
  return {
    ok: true,
    value: {
      athleteId: b.athleteId as string,
      round: b.round as TimeRound,
      timeMs,
      startTime: (b.startTime as number | undefined) ?? Math.max(0, now - timeMs),
      ...(b.matchId !== undefined ? { matchId: b.matchId as string } : {}),
    },
  };
};

/** Match create/update input. Athlete slots and winner are optional (TBD brackets). */
export const validateMatchInput = (body: unknown): Validated<Omit<Match, 'matchId' | 'compId'>> => {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isDiscipline(b.discipline))
    errors.push(`discipline must be one of: ${DISCIPLINE.join(', ')}`);
  if (!isMatchRound(b.round)) errors.push(`round must be one of: ${MATCH_ROUNDS.join(', ')}`);
  if (b.roundName !== undefined && !isBoundedString(b.roundName, FIELD_LIMITS.roundName)) {
    errors.push(`roundName must be a string of at most ${FIELD_LIMITS.roundName} chars when given`);
  }
  if (!isGender(b.gender)) errors.push(`gender must be one of: ${GENDERS.join(', ')}`);
  const { min, max } = FIELD_LIMITS.position;
  if (!isIntInRange(b.position, min, max)) {
    errors.push(`position must be an integer ${min}..${max}`);
  }
  for (const slot of ['athlete1Id', 'athlete2Id', 'winnerId'] as const) {
    const slotError = optionalIdError(b, slot);
    if (slotError) errors.push(slotError);
  }
  if (b.athlete1Id !== undefined && b.athlete1Id === b.athlete2Id) {
    errors.push('athlete1Id and athlete2Id must differ');
  }
  if (b.winnerId !== undefined && b.winnerId !== b.athlete1Id && b.winnerId !== b.athlete2Id) {
    errors.push('winnerId must be athlete1Id or athlete2Id');
  }

  if (errors.length > 0) return { ok: false, errors };
  const roundName =
    typeof b.roundName === 'string' && b.roundName.trim() !== '' ? b.roundName.trim() : undefined;
  return {
    ok: true,
    value: {
      discipline: b.discipline as Discipline,
      round: b.round as MatchRound,
      ...(roundName !== undefined ? { roundName } : {}),
      gender: b.gender as Gender,
      position: b.position as number,
      ...(b.athlete1Id !== undefined ? { athlete1Id: b.athlete1Id as string } : {}),
      ...(b.athlete2Id !== undefined ? { athlete2Id: b.athlete2Id as string } : {}),
      ...(b.winnerId !== undefined ? { winnerId: b.winnerId as string } : {}),
    },
  };
};

/**
 * Score create/update input. `overall` is optional: when absent it is computed
 * from the components via `computeOverall`; when given it is stored as-is,
 * bounded above by `overallMax` for the round.
 */
export const validateScoreInput = (body: unknown): Validated<Omit<Score, 'scoreId' | 'compId'>> => {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isId(b.athleteId)) errors.push('athleteId is required (an id)');
  if (!isMatchRound(b.round)) errors.push(`round must be one of: ${MATCH_ROUNDS.join(', ')}`);
  for (const comp of ['difficulty', 'combo', 'style', 'bestTrick', 'controlPenalty'] as const) {
    if (typeof b[comp] !== 'number' || !Number.isFinite(b[comp]) || (b[comp] as number) < 0) {
      errors.push(`${comp} must be a finite number >= 0`);
    }
  }
  // Per-component maxima (rule F8); a value over its cap is always a data-entry
  // error (400 for 40), which would otherwise flip a battle via the overall. The
  // control penalty has no rule ceiling, only the storage bound.
  const componentMax = {
    ...SCORE_COMPONENT_MAX,
    controlPenalty: FIELD_LIMITS.controlPenaltyMax,
  };
  for (const [comp, max] of Object.entries(componentMax)) {
    if (typeof b[comp] === 'number' && Number.isFinite(b[comp]) && (b[comp] as number) > max) {
      errors.push(`${comp} must be <= ${max}`);
    }
  }
  // Battles-only components (rule F8) would otherwise leak into the quali overall.
  if (b.round === 'qualification') {
    for (const comp of BATTLE_ONLY_SCORE_COMPONENTS) {
      if (typeof b[comp] === 'number' && b[comp] !== 0) {
        errors.push(`${comp} must be 0 in qualification (battles only)`);
      }
    }
  }
  if (
    b.overall !== undefined &&
    b.overall !== '' &&
    !isFiniteInRange(b.overall, FIELD_LIMITS.overallMin, Infinity)
  ) {
    errors.push(`overall must be a finite number >= ${FIELD_LIMITS.overallMin} when given`);
  }
  // Ceiling on an explicit override, the same bound the console blocks Save on —
  // a typo (400 for 40) can't flip a match through the API either. The floor is
  // only the storage bound above: the control penalty may take a battle overall
  // legitimately negative, and a DNF carries no judged value to bound.
  if (
    b.dnf !== true &&
    isMatchRound(b.round) &&
    typeof b.overall === 'number' &&
    Number.isFinite(b.overall)
  ) {
    const max = overallMax(b.round);
    if (b.overall > max) errors.push(`overall must be <= ${max}`);
  }
  if (b.dnf !== undefined && typeof b.dnf !== 'boolean') {
    errors.push('dnf must be a boolean when given');
  }
  const matchIdError = optionalIdError(b, 'matchId');
  if (matchIdError) errors.push(matchIdError);

  if (errors.length > 0) return { ok: false, errors };
  const components = {
    difficulty: b.difficulty as number,
    combo: b.combo as number,
    style: b.style as number,
    bestTrick: b.bestTrick as number,
    controlPenalty: b.controlPenalty as number,
  };
  return {
    ok: true,
    value: {
      athleteId: b.athleteId as string,
      round: b.round as MatchRound,
      ...components,
      overall:
        b.overall === undefined || b.overall === ''
          ? computeOverall(components)
          : normalizeScoreValue(b.overall as number),
      ...(b.dnf === true ? { dnf: true } : {}),
      ...(b.matchId !== undefined ? { matchId: b.matchId as string } : {}),
    },
  };
};
