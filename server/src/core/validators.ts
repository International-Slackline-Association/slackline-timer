/**
 * Request-shape validators for the competition data plane. Lambda handlers
 * stay thin; these are the tested parts. Server-only — the shared web↔server
 * parity surface (enums, entities, formulas) lives in `./types`, which must
 * stay import-free for the web parity test.
 */

import {
  BATTLE_ONLY_SCORE_COMPONENTS,
  DISCIPLINE,
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

const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Competition create input (compId is the relay sessionId — keep it URL-safe). */
export const validateCompetitionInput = (
  body: unknown,
): Validated<Pick<Competition, 'compId' | 'name' | 'startDate' | 'endDate'>> => {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(b.compId) || !/^[A-Za-z0-9_-]{1,64}$/.test(b.compId as string)) {
    errors.push('compId is required (1-64 chars, letters/digits/_/-)');
  }
  if (!isNonEmptyString(b.name)) errors.push('name is required');
  if (!isIsoDate(b.startDate)) errors.push('startDate must be an ISO date (YYYY-MM-DD)');
  if (!isIsoDate(b.endDate)) errors.push('endDate must be an ISO date (YYYY-MM-DD)');
  if (errors.length === 0 && Date.parse(b.endDate as string) < Date.parse(b.startDate as string)) {
    errors.push('endDate must not be before startDate');
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      compId: (b.compId as string).trim(),
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

  if (!isNonEmptyString(b.name)) errors.push('name is required');
  if (!isIsoDate(b.startDate)) errors.push('startDate must be an ISO date (YYYY-MM-DD)');
  if (!isIsoDate(b.endDate)) errors.push('endDate must be an ISO date (YYYY-MM-DD)');
  if (errors.length === 0 && Date.parse(b.endDate as string) < Date.parse(b.startDate as string)) {
    errors.push('endDate must not be before startDate');
  }

  let breakMs: number | undefined;
  const config = b.config as { freestyle?: { breakMs?: unknown } } | undefined;
  const rawBreak = config?.freestyle?.breakMs;
  if (rawBreak !== undefined) {
    if (typeof rawBreak !== 'number' || !Number.isInteger(rawBreak) || rawBreak <= 0) {
      errors.push('config.freestyle.breakMs must be a positive integer when given');
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
  if (b.shortName !== undefined && typeof b.shortName !== 'string') {
    errors.push('shortName must be a string when given');
  }
  if (!isIsoDate(b.birthDate)) errors.push('birthDate must be an ISO date (YYYY-MM-DD)');
  if (!isNonEmptyString(b.country)) errors.push('country is required');
  if (!isGender(b.gender)) errors.push(`gender must be one of: ${GENDERS.join(', ')}`);
  if (b.country2 !== undefined && !isNonEmptyString(b.country2)) {
    errors.push('country2 must be a non-empty string when given');
  }
  if (b.notes !== undefined && typeof b.notes !== 'string') {
    errors.push('notes must be a string when given');
  }
  if (b.photoKey !== undefined && !isNonEmptyString(b.photoKey)) {
    errors.push('photoKey must be a non-empty string when given');
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

  if (!isNonEmptyString(b.athleteId)) errors.push('athleteId is required');
  if (!isTimeRound(b.round)) errors.push(`round must be one of: ${TIME_ROUNDS.join(', ')}`);
  if (typeof b.timeMs !== 'number' || !Number.isInteger(b.timeMs) || b.timeMs < 0) {
    errors.push('timeMs must be a non-negative integer');
  }
  if (
    b.startTime !== undefined &&
    (typeof b.startTime !== 'number' || !Number.isInteger(b.startTime) || b.startTime <= 0)
  ) {
    errors.push('startTime must be a positive epoch-ms integer when given');
  }
  if (b.matchId !== undefined && !isNonEmptyString(b.matchId)) {
    errors.push('matchId must be a non-empty string when given');
  }

  if (errors.length > 0) return { ok: false, errors };
  const timeMs = b.timeMs as number;
  return {
    ok: true,
    value: {
      athleteId: (b.athleteId as string).trim(),
      round: b.round as TimeRound,
      timeMs,
      startTime: (b.startTime as number | undefined) ?? Math.max(0, now - timeMs),
      ...(b.matchId !== undefined ? { matchId: (b.matchId as string).trim() } : {}),
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
  if (b.roundName !== undefined && typeof b.roundName !== 'string') {
    errors.push('roundName must be a string when given');
  }
  if (!isGender(b.gender)) errors.push(`gender must be one of: ${GENDERS.join(', ')}`);
  if (typeof b.position !== 'number' || !Number.isInteger(b.position)) {
    errors.push('position must be an integer');
  }
  for (const slot of ['athlete1Id', 'athlete2Id', 'winnerId'] as const) {
    if (b[slot] !== undefined && !isNonEmptyString(b[slot])) {
      errors.push(`${slot} must be a non-empty string when given`);
    }
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

  if (!isNonEmptyString(b.athleteId)) errors.push('athleteId is required');
  if (!isMatchRound(b.round)) errors.push(`round must be one of: ${MATCH_ROUNDS.join(', ')}`);
  for (const comp of ['difficulty', 'combo', 'style', 'bestTrick', 'controlPenalty'] as const) {
    if (typeof b[comp] !== 'number' || !Number.isFinite(b[comp]) || (b[comp] as number) < 0) {
      errors.push(`${comp} must be a finite number >= 0`);
    }
  }
  // Per-component maxima (rule F8); a value over its cap is always a data-entry
  // error (400 for 40), which would otherwise flip a battle via the overall.
  for (const [comp, max] of Object.entries(SCORE_COMPONENT_MAX)) {
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
    (typeof b.overall !== 'number' || !Number.isFinite(b.overall))
  ) {
    errors.push('overall must be a finite number when given');
  }
  // Ceiling on an explicit override, the same bound the console blocks Save on —
  // a typo (400 for 40) can't flip a match through the API either. Upper bound
  // only: an uncapped control penalty may take a battle overall legitimately
  // negative, and a DNF carries no judged value to bound.
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
  if (b.matchId !== undefined && !isNonEmptyString(b.matchId)) {
    errors.push('matchId must be a non-empty string when given');
  }

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
      athleteId: (b.athleteId as string).trim(),
      round: b.round as MatchRound,
      ...components,
      overall:
        b.overall === undefined || b.overall === ''
          ? computeOverall(components)
          : normalizeScoreValue(b.overall as number),
      ...(b.dnf === true ? { dnf: true } : {}),
      ...(b.matchId !== undefined ? { matchId: (b.matchId as string).trim() } : {}),
    },
  };
};
