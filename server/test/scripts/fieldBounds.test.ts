import { describe, expect, it } from 'vitest';

import { DNF_SENTINEL, FIELD_LIMITS } from 'core/types';
import { COUNTRY_RE, ID_RE, MAX_ATHLETES_PER_COMP, PHOTO_KEY_RE } from 'core/validators';

import {
  BOUNDS,
  COUNTRY_RE as AUDIT_COUNTRY_RE,
  ID_RE as AUDIT_ID_RE,
  PHOTO_KEY_RE as AUDIT_PHOTO_KEY_RE,
  auditItems,
  evaluateItem,
  type StoredItem,
} from '../../scripts/maintenance/lib/fieldBounds.mjs';

/**
 * Guards the rules auditFieldBounds.mjs checks prod against before a bound
 * tightens: a rule that under-reports lets a legacy record 400 on its next PUT,
 * one that echoes a value leaks PII into an ops log, and a copy that drifts from
 * the validators audits the wrong bounds.
 */

const NOW = Date.UTC(2026, 9, 6);
const HASH = 'a'.repeat(64);
const rules = (item: StoredItem) => evaluateItem(item, { now: NOW }).map((v) => v.rule);

const athlete = (over: Record<string, unknown> = {}): StoredItem => ({
  PK: 'COMP#hwc',
  SK: 'ATHLETE#a1',
  athleteId: 'a1',
  firstName: 'Ana',
  lastName: 'Lopez',
  name: 'Ana Lopez',
  birthDate: '2001-04-02',
  country: 'ESP',
  photoKey: `photos/hwc/${HASH}.jpg`,
  ...over,
});

const match = (over: Record<string, unknown> = {}): StoredItem => ({
  PK: 'COMP#hwc',
  SK: 'MATCH#speed#female#final#m1',
  matchId: 'm1',
  position: 1,
  athlete1Id: 'a1',
  athlete2Id: 'a2',
  ...over,
});

describe('evaluateItem', () => {
  it('passes items inside every bound, including boundary values', () => {
    expect(rules(athlete({ country2: '276', shortName: 'x'.repeat(24) }))).toEqual([]);
    expect(
      rules({
        PK: 'COMP#hwc',
        SK: 'META',
        name: 'x'.repeat(100),
        config: { freestyle: { breakMs: 600_000 } },
      }),
    ).toEqual([]);
    expect(
      rules({
        PK: 'COMP#hwc',
        SK: 'TIME#final#a1#t1',
        athleteId: 'a1',
        timeMs: DNF_SENTINEL,
        startTime: NOW + BOUNDS.startTimeSkewMs,
      }),
    ).toEqual([]);
    expect(rules(match({ winnerId: 'a2', position: 0, roundName: 'x'.repeat(40) }))).toEqual([]);
    expect(
      rules({ PK: 'COMP#hwc', SK: 'SCORE#final#a1', controlPenalty: 100, overall: -1000 }),
    ).toEqual([]);
  });

  it('reports an over-long name by length, never by value', () => {
    const name = 'Secret'.repeat(20);
    const [v] = evaluateItem(athlete({ firstName: name }), { now: NOW });
    expect(v).toEqual({ rule: 'athlete.firstName', detail: `length=${name.length}` });
  });

  it('checks every bounded athlete field', () => {
    expect(
      rules(
        athlete({
          lastName: 'x'.repeat(51),
          name: 'x'.repeat(102),
          shortName: 'x'.repeat(25),
          notes: 'x'.repeat(2001),
          athleteId: 'a/1',
        }),
      ),
    ).toEqual([
      'athlete.athleteId',
      'athlete.lastName',
      'athlete.name',
      'athlete.shortName',
      'athlete.notes',
    ]);
  });

  it('bounds birthDate to an ISO date in 1900..current year without echoing it', () => {
    for (const birthDate of ['1899-12-31', '2027-01-01', '02.04.2001', '2001-13-45']) {
      const out = evaluateItem(athlete({ birthDate }), { now: NOW });
      expect(out.map((v) => v.rule)).toEqual(['athlete.birthDate']);
      expect(out[0].detail).not.toContain(birthDate);
    }
    expect(rules(athlete({ birthDate: '1900-01-01' }))).toEqual([]);
  });

  it('reports the failing country code verbatim', () => {
    expect(evaluateItem(athlete({ country: 'D', country2: 'GER1' }), { now: NOW })).toEqual([
      { rule: 'athlete.country', detail: '"D"' },
      { rule: 'athlete.country2', detail: '"GER1"' },
    ]);
  });

  it('splits a foreign-comp photoKey from a malformed one', () => {
    expect(evaluateItem(athlete({ photoKey: `photos/old-id/${HASH}.png` }), { now: NOW })).toEqual([
      { rule: 'athlete.photoKey.foreignComp', detail: 'photos/old-id/' },
    ]);
    expect(rules(athlete({ photoKey: `photos/hwc/${HASH}.gif` }))).toEqual(['athlete.photoKey']);
    expect(rules(athlete({ photoKey: '' }))).toEqual(['athlete.photoKey']);
  });

  it('bounds time fields as integers', () => {
    const time = (over: Record<string, unknown>) => ({
      PK: 'COMP#hwc',
      SK: 'TIME#final#a1#t1',
      athleteId: 'a1',
      timeMs: 5000,
      startTime: NOW,
      ...over,
    });
    expect(rules(time({ timeMs: 86_400_001 }))).toEqual(['time.timeMs']);
    expect(rules(time({ timeMs: 1.5 }))).toEqual(['time.timeMs']);
    expect(rules(time({ startTime: 0 }))).toEqual(['time.startTime']);
    expect(rules(time({ startTime: NOW + BOUNDS.startTimeSkewMs + 1 }))).toEqual([
      'time.startTime',
    ]);
    expect(rules(time({ matchId: '' }))).toEqual(['time.matchId']);
  });

  it('flags a winner outside the pair and a self-pairing (L8a)', () => {
    expect(rules(match({ winnerId: 'a3' }))).toEqual(['match.winnerNotInPair']);
    expect(rules(match({ athlete2Id: 'a1' }))).toEqual(['match.samePair']);
    expect(rules(match({ athlete1Id: undefined, athlete2Id: undefined }))).toEqual([]);
    expect(rules(match({ position: 65, roundName: 'x'.repeat(41) }))).toEqual([
      'match.roundName',
      'match.position',
    ]);
  });

  it('bounds score controlPenalty and overall, rejecting non-numbers', () => {
    const score = (over: Record<string, unknown>) => ({
      PK: 'COMP#hwc',
      SK: 'SCORE#final#a1',
      ...over,
    });
    expect(rules(score({ controlPenalty: 101, overall: -1001 }))).toEqual([
      'score.controlPenalty',
      'score.overall',
    ]);
    expect(rules(score({ controlPenalty: '5' }))).toEqual(['score.controlPenalty']);
  });

  it('bounds breakMs to 1..600000', () => {
    const meta = (breakMs: unknown) => ({
      PK: 'COMP#hwc',
      SK: 'META',
      name: 'HWC',
      config: { freestyle: { breakMs } },
    });
    expect(rules(meta(0))).toEqual(['competition.breakMs']);
    expect(rules(meta(600_001))).toEqual(['competition.breakMs']);
  });
});

describe('auditItems', () => {
  it('groups per competition, caps examples and collects the distinct failures', () => {
    const items: StoredItem[] = [
      { PK: 'COMP#hwc', SK: 'META', name: 'HWC' },
      ...['a1', 'a2', 'a3'].map((id) =>
        athlete({ SK: `ATHLETE#${id}`, athleteId: id, country: 'GER1' }),
      ),
      athlete({ SK: 'ATHLETE#a4', athleteId: 'a4', photoKey: `photos/old/${HASH}.jpg` }),
      { PK: 'COMP#hwc', SK: 'MANAGER#sub-1', sub: 'sub-1' },
      { PK: 'USER#sub-1', SK: 'COMP#hwc' },
      { PK: 'COMP#clean', SK: 'META', name: 'Clean' },
    ];
    const report = auditItems(items, { now: NOW, maxExamples: 2 });

    expect(report.scanned).toBe(8);
    expect(report.skipped).toBe(2);
    expect(report.violationCount).toBe(4);
    expect(report.competitions.clean).toEqual({ items: 1, athletes: 0, violations: {} });
    const hwc = report.competitions.hwc;
    expect(hwc.athletes).toBe(4);
    expect(hwc.violations['athlete.country'].count).toBe(3);
    expect(hwc.violations['athlete.country'].examples).toEqual([
      { PK: 'COMP#hwc', SK: 'ATHLETE#a1', detail: '"GER1"' },
      { PK: 'COMP#hwc', SK: 'ATHLETE#a2', detail: '"GER1"' },
    ]);
    expect(report.failingCountries).toEqual(['"GER1"']);
    expect(report.foreignPhotoPrefixes).toEqual({ 'photos/old/': 1 });
  });

  it('flags a competition over the athlete cap', () => {
    const items = Array.from({ length: BOUNDS.athletesPerComp + 1 }, (_, i) =>
      athlete({ SK: `ATHLETE#a${i}`, athleteId: `a${i}` }),
    );
    const report = auditItems(items, { now: NOW });
    expect(report.competitions.hwc.violations['competition.athleteCount']).toEqual({
      count: 1,
      examples: [{ PK: 'COMP#hwc', SK: 'ATHLETE#*', detail: `athletes=${items.length}` }],
    });
  });

  it('never puts a name, birthDate or notes value in the report', () => {
    const report = auditItems(
      [athlete({ firstName: 'Zelda'.repeat(20), notes: 'private'.repeat(400) })],
      { now: NOW },
    );
    const json = JSON.stringify(report);
    for (const secret of ['Zelda', 'private', 'Lopez', '2001-04-02']) {
      expect(json).not.toContain(secret);
    }
  });
});

describe('audit ↔ validator parity', () => {
  it('audits the bounds the validators enforce', () => {
    expect(BOUNDS).toEqual({
      competitionName: FIELD_LIMITS.competitionName,
      breakMs: FIELD_LIMITS.breakMs,
      firstName: FIELD_LIMITS.firstName,
      lastName: FIELD_LIMITS.lastName,
      legacyName: FIELD_LIMITS.legacyName,
      shortName: FIELD_LIMITS.shortName,
      birthYear: { min: FIELD_LIMITS.birthYearMin },
      notes: FIELD_LIMITS.notes,
      timeMs: FIELD_LIMITS.timeMs,
      startTimeSkewMs: FIELD_LIMITS.startTimeSkewMs,
      roundName: FIELD_LIMITS.roundName,
      position: FIELD_LIMITS.position,
      controlPenaltyMax: FIELD_LIMITS.controlPenaltyMax,
      overallMin: FIELD_LIMITS.overallMin,
      athletesPerComp: MAX_ATHLETES_PER_COMP,
    });
  });

  it('audits with the validator patterns', () => {
    expect(AUDIT_ID_RE.source).toBe(ID_RE.source);
    expect(AUDIT_COUNTRY_RE.source).toBe(COUNTRY_RE.source);
    expect(AUDIT_PHOTO_KEY_RE.source).toBe(PHOTO_KEY_RE.source);
  });
});
