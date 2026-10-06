// Pure rule evaluation for auditFieldBounds.mjs: checks stored competition-table
// items against the input bounds the data-plane validators enforce (ADR 0052).
// PUT is a full replacement, so any stored value outside a bound 400s on its next
// edit — run this before tightening a bound.
//
// Output carries keys, lengths and reasons only, never the offending names,
// birthDates or notes. Country codes and foreign photo prefixes are reported
// verbatim: they decide whether the planned regex is safe to ship.

// Plain ESM so the script runs under bare node, hence a copy of FIELD_LIMITS /
// MAX_ATHLETES_PER_COMP and the validators' regexes; test/scripts/fieldBounds.test.ts
// fails when the two drift.
export const BOUNDS = {
  competitionName: 100,
  breakMs: { min: 1, max: 600_000 },
  firstName: 50,
  lastName: 50,
  legacyName: 101,
  shortName: 24,
  birthYear: { min: 1900 },
  notes: 2000,
  timeMs: { min: 0, max: 86_400_000 },
  startTimeSkewMs: 24 * 60 * 60 * 1000,
  roundName: 40,
  position: { min: 0, max: 64 },
  controlPenaltyMax: 100,
  overallMin: -1000,
  athletesPerComp: 300,
};

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const COUNTRY_RE = /^[A-Za-z]{2,3}$|^\d{3}$/;
export const PHOTO_KEY_RE = /^photos\/([A-Za-z0-9_-]{1,64})\/[0-9a-f]{64}\.(jpg|png|webp)$/;
const ISO_DATE_RE = /^(\d{4})-\d{2}-\d{2}$/;

const isAbsent = (v) => v === undefined || v === null;
const isIntIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Violation for a string over `max` (or not a string); absent values pass. */
const overLength = (v, max) => {
  if (isAbsent(v)) return null;
  if (typeof v !== 'string') return `type=${typeof v}`;
  return v.length > max ? `length=${v.length}` : null;
};

const badNumber = (v, ok) =>
  isAbsent(v) || (typeof v === 'number' && ok(v)) ? null : `value=${JSON.stringify(v)}`;

const badInt = (v, min, max) => badNumber(v, (n) => isIntIn(n, min, max));

const badId = (v) => {
  if (isAbsent(v)) return null;
  if (typeof v !== 'string') return `type=${typeof v}`;
  return ID_RE.test(v) ? null : `length=${v.length}`;
};

const badBirthDate = (v, currentYear) => {
  if (isAbsent(v)) return null;
  const m = typeof v === 'string' ? ISO_DATE_RE.exec(v) : null;
  if (!m || Number.isNaN(Date.parse(v))) return 'not an ISO date';
  const year = Number(m[1]);
  return year < BOUNDS.birthYear.min || year > currentYear ? 'year out of range' : null;
};

/**
 * Evaluate one item. Returns `[{ rule, detail }]`; `detail` never holds PII. The
 * `country` rules' detail is the raw code, `athlete.photoKey.foreignComp` the
 * foreign `photos/<compId>/` prefix.
 */
export function evaluateItem(item, { now }) {
  const out = [];
  const add = (rule, detail) => {
    if (detail !== null) out.push({ rule, detail });
  };
  const sk = String(item.SK ?? '');
  const kind = sk === 'META' ? 'META' : sk.split('#')[0];
  const compId = String(item.PK ?? '').slice('COMP#'.length);

  switch (kind) {
    case 'META': {
      add('competition.name', overLength(item.name, BOUNDS.competitionName));
      const breakMs = item.config?.freestyle?.breakMs;
      add('competition.breakMs', badInt(breakMs, BOUNDS.breakMs.min, BOUNDS.breakMs.max));
      break;
    }
    case 'ATHLETE': {
      add('athlete.athleteId', badId(item.athleteId));
      add('athlete.firstName', overLength(item.firstName, BOUNDS.firstName));
      add('athlete.lastName', overLength(item.lastName, BOUNDS.lastName));
      add('athlete.name', overLength(item.name, BOUNDS.legacyName));
      add('athlete.shortName', overLength(item.shortName, BOUNDS.shortName));
      add('athlete.birthDate', badBirthDate(item.birthDate, new Date(now).getUTCFullYear()));
      for (const field of ['country', 'country2']) {
        const v = item[field];
        if (!isAbsent(v) && !(typeof v === 'string' && COUNTRY_RE.test(v))) {
          add(`athlete.${field}`, JSON.stringify(v));
        }
      }
      add('athlete.notes', overLength(item.notes, BOUNDS.notes));
      if (!isAbsent(item.photoKey)) {
        const m = typeof item.photoKey === 'string' ? PHOTO_KEY_RE.exec(item.photoKey) : null;
        if (!m) add('athlete.photoKey', 'malformed');
        else if (m[1] !== compId) add('athlete.photoKey.foreignComp', `photos/${m[1]}/`);
      }
      break;
    }
    case 'TIME': {
      add('time.athleteId', badId(item.athleteId));
      add('time.matchId', badId(item.matchId));
      add('time.timeMs', badInt(item.timeMs, BOUNDS.timeMs.min, BOUNDS.timeMs.max));
      add('time.startTime', badInt(item.startTime, 1, now + BOUNDS.startTimeSkewMs));
      break;
    }
    case 'MATCH': {
      for (const field of ['matchId', 'athlete1Id', 'athlete2Id', 'winnerId']) {
        add(`match.${field}`, badId(item[field]));
      }
      add('match.roundName', overLength(item.roundName, BOUNDS.roundName));
      add('match.position', badInt(item.position, BOUNDS.position.min, BOUNDS.position.max));
      const { athlete1Id: a1, athlete2Id: a2, winnerId } = item;
      if (!isAbsent(winnerId) && winnerId !== a1 && winnerId !== a2) {
        add('match.winnerNotInPair', 'winnerId not athlete1Id/athlete2Id');
      }
      if (!isAbsent(a1) && a1 === a2) add('match.samePair', 'athlete1Id === athlete2Id');
      break;
    }
    case 'SCORE': {
      add('score.athleteId', badId(item.athleteId));
      add('score.matchId', badId(item.matchId));
      add(
        'score.controlPenalty',
        badNumber(item.controlPenalty, (v) => v <= BOUNDS.controlPenaltyMax),
      );
      add(
        'score.overall',
        badNumber(item.overall, (v) => v >= BOUNDS.overallMin),
      );
      break;
    }
    default:
      break;
  }
  return out;
}

const emptyComp = () => ({ items: 0, athletes: 0, violations: {} });

/**
 * Audit every scanned item. Only `COMP#` partitions are competitions; the
 * `USER#` reverse manager grants and `MANAGER#` rows carry no bounded fields and
 * count as `skipped`.
 */
export function auditItems(items, { now, maxExamples = 5 }) {
  const competitions = {};
  const failingCountries = new Set();
  const foreignPhotoPrefixes = {};
  let skipped = 0;
  let violationCount = 0;

  const record = (comp, rule, example) => {
    const entry = (comp.violations[rule] ??= { count: 0, examples: [] });
    entry.count += 1;
    violationCount += 1;
    if (entry.examples.length < maxExamples) entry.examples.push(example);
  };

  for (const item of items) {
    const pk = String(item.PK ?? '');
    const sk = String(item.SK ?? '');
    if (!pk.startsWith('COMP#') || sk.startsWith('MANAGER#')) {
      skipped += 1;
      continue;
    }
    const compId = pk.slice('COMP#'.length);
    const comp = (competitions[compId] ??= emptyComp());
    comp.items += 1;
    if (sk.startsWith('ATHLETE#')) comp.athletes += 1;
    for (const { rule, detail } of evaluateItem(item, { now })) {
      if (rule === 'athlete.country' || rule === 'athlete.country2') failingCountries.add(detail);
      if (rule === 'athlete.photoKey.foreignComp') {
        foreignPhotoPrefixes[detail] = (foreignPhotoPrefixes[detail] ?? 0) + 1;
      }
      record(comp, rule, { PK: pk, SK: sk, detail });
    }
  }

  for (const [compId, comp] of Object.entries(competitions)) {
    if (comp.athletes > BOUNDS.athletesPerComp) {
      record(comp, 'competition.athleteCount', {
        PK: `COMP#${compId}`,
        SK: 'ATHLETE#*',
        detail: `athletes=${comp.athletes}`,
      });
    }
  }

  return {
    scanned: items.length,
    skipped,
    violationCount,
    competitions,
    failingCountries: [...failingCountries].sort(),
    foreignPhotoPrefixes,
  };
}
