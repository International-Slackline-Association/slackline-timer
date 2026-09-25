import { describe, expect, it } from 'vitest';

import { DNF_SENTINEL } from 'core/types';
import {
  validateAthleteInput,
  validateCompetitionInput,
  validateCompetitionUpdateInput,
  validateMatchInput,
  validateScoreInput,
  validateTimeInput,
} from 'core/validators';

describe('validateCompetitionInput', () => {
  const valid = {
    compId: 'isa-worlds-2026',
    name: 'ISA Worlds',
    startDate: '2026-07-01',
    endDate: '2026-07-05',
  };

  it('accepts a valid competition and trims strings', () => {
    const r = validateCompetitionInput({ ...valid, name: '  ISA Worlds  ' });
    expect(r).toEqual({ ok: true, value: valid });
  });

  it('rejects a compId that is not URL-safe (it is the relay room key)', () => {
    expect(validateCompetitionInput({ ...valid, compId: 'has spaces' }).ok).toBe(false);
    expect(validateCompetitionInput({ ...valid, compId: '' }).ok).toBe(false);
  });

  it('rejects endDate before startDate', () => {
    const r = validateCompetitionInput({ ...valid, endDate: '2026-06-30' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/endDate/);
  });

  it('collects all errors at once', () => {
    const r = validateCompetitionInput({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('validateCompetitionUpdateInput', () => {
  const valid = { name: 'ISA Worlds', startDate: '2026-07-01', endDate: '2026-07-05' };

  it('accepts name/dates and ignores compId/tokenVersion if sent', () => {
    const r = validateCompetitionUpdateInput({
      ...valid,
      compId: 'whatever',
      tokenVersion: 99,
    });
    expect(r).toEqual({ ok: true, value: valid });
  });

  it('rejects endDate before startDate', () => {
    const r = validateCompetitionUpdateInput({ ...valid, endDate: '2026-06-30' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/endDate/);
  });

  it('accepts a positive integer freestyle breakMs', () => {
    const r = validateCompetitionUpdateInput({
      ...valid,
      config: { freestyle: { breakMs: 45000 } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.config).toEqual({ freestyle: { breakMs: 45000 } });
  });

  it('drops config entirely when breakMs is absent', () => {
    const r = validateCompetitionUpdateInput({ ...valid, config: { freestyle: {} } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.config).toBeUndefined();
  });

  it('rejects a non-positive or non-integer breakMs', () => {
    expect(
      validateCompetitionUpdateInput({ ...valid, config: { freestyle: { breakMs: 0 } } }).ok,
    ).toBe(false);
    expect(
      validateCompetitionUpdateInput({ ...valid, config: { freestyle: { breakMs: -5 } } }).ok,
    ).toBe(false);
    expect(
      validateCompetitionUpdateInput({ ...valid, config: { freestyle: { breakMs: 1.5 } } }).ok,
    ).toBe(false);
  });
});

describe('validateAthleteInput', () => {
  const valid = {
    firstName: 'Jane',
    lastName: 'Doe',
    shortName: 'JD',
    birthDate: '2000-01-31',
    country: 'CH',
    gender: 'female',
  };

  it('accepts firstName/lastName and derives the legacy name', () => {
    const r = validateAthleteInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.firstName).toBe('Jane');
      expect(r.value.lastName).toBe('Doe');
      expect(r.value.name).toBe('Jane Doe');
      expect(r.value.shortName).toBe('JD');
    }
  });

  it('makes shortName optional and omits it when absent', () => {
    const { shortName: _omit, ...withoutShort } = valid;
    const r = validateAthleteInput(withoutShort);
    expect(r.ok).toBe(true);
    if (r.ok) expect('shortName' in r.value).toBe(false);
  });

  it('omits an empty/whitespace shortName rather than storing it', () => {
    const r = validateAthleteInput({ ...valid, shortName: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect('shortName' in r.value).toBe(false);
  });

  it('migrates a legacy name-only payload by splitting on the first space', () => {
    const { firstName: _f, lastName: _l, ...legacy } = valid;
    const r = validateAthleteInput({ ...legacy, name: 'Jane Doe' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.firstName).toBe('Jane');
      expect(r.value.lastName).toBe('Doe');
      expect(r.value.name).toBe('Jane Doe');
    }
  });

  it('accepts optional country2 / notes / photoKey', () => {
    const r = validateAthleteInput({
      ...valid,
      country2: 'DE',
      notes: 'left-footed',
      photoKey: 'photos/c/abc.jpg',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.country2).toBe('DE');
      expect(r.value.notes).toBe('left-footed');
      expect(r.value.photoKey).toBe('photos/c/abc.jpg');
    }
  });

  it('rejects missing required fields and bad gender', () => {
    const r = validateAthleteInput({ firstName: 'x', gender: 'unknown' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join()).toMatch(/lastName/);
      expect(r.errors.join()).toMatch(/birthDate/);
      expect(r.errors.join()).toMatch(/country/);
      expect(r.errors.join()).toMatch(/gender/);
    }
  });

  it('rejects a payload with neither firstName nor a legacy name', () => {
    const r = validateAthleteInput({
      shortName: 'JD',
      birthDate: '2000-01-31',
      country: 'CH',
      gender: 'female',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/firstName/);
  });
});

describe('validateTimeInput', () => {
  const NOW = 1_750_000_000_000;

  it('accepts a valid time with explicit startTime', () => {
    const r = validateTimeInput(
      { athleteId: 'a1', round: 'final', timeMs: 12_340, startTime: NOW - 60_000 },
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      value: { athleteId: 'a1', round: 'final', timeMs: 12_340, startTime: NOW - 60_000 },
    });
  });

  it('defaults startTime to now - timeMs (timertimer maybe_put_start_time)', () => {
    const r = validateTimeInput({ athleteId: 'a1', round: 'training', timeMs: 9_000 }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.startTime).toBe(NOW - 9_000);
  });

  it('accepts the DNF sentinel as timeMs', () => {
    const r = validateTimeInput({ athleteId: 'a1', round: 'final', timeMs: DNF_SENTINEL }, NOW);
    expect(r.ok).toBe(true);
  });

  it('clamps the defaulted startTime to >= 0 when timeMs exceeds now', () => {
    const r = validateTimeInput({ athleteId: 'a1', round: 'final', timeMs: 5_000 }, 1_000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.startTime).toBe(0);
  });

  it('rejects a Match-only round value mismatch and bad timeMs', () => {
    expect(validateTimeInput({ athleteId: 'a1', round: 'nope', timeMs: 1 }, NOW).ok).toBe(false);
    expect(validateTimeInput({ athleteId: 'a1', round: 'final', timeMs: -1 }, NOW).ok).toBe(false);
    expect(validateTimeInput({ athleteId: 'a1', round: 'final', timeMs: 1.5 }, NOW).ok).toBe(false);
  });

  it('carries a matchId through and drops an absent one', () => {
    const linked = validateTimeInput(
      { athleteId: 'a1', round: 'final', timeMs: 10, matchId: 'm1' },
      NOW,
    );
    expect(linked.ok).toBe(true);
    if (linked.ok) expect(linked.value.matchId).toBe('m1');

    const absent = validateTimeInput({ athleteId: 'a1', round: 'final', timeMs: 10 }, NOW);
    expect(absent.ok).toBe(true);
    if (absent.ok) expect('matchId' in absent.value).toBe(false);
  });

  it('rejects a non-string / empty matchId', () => {
    expect(
      validateTimeInput({ athleteId: 'a1', round: 'final', timeMs: 10, matchId: 5 }, NOW).ok,
    ).toBe(false);
    expect(
      validateTimeInput({ athleteId: 'a1', round: 'final', timeMs: 10, matchId: '  ' }, NOW).ok,
    ).toBe(false);
  });
});

describe('validateMatchInput', () => {
  const valid = {
    discipline: 'speed',
    round: 'final',
    roundName: 'Final 1',
    gender: 'male',
    position: 1,
  };

  it('accepts a valid match without athletes (TBD bracket slot)', () => {
    const r = validateMatchInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(valid);
  });

  it('accepts athlete slots and winner', () => {
    const r = validateMatchInput({ ...valid, athlete1Id: 'a1', athlete2Id: 'a2', winnerId: 'a1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.winnerId).toBe('a1');
  });

  it('rejects training as a Match round (Time-only round)', () => {
    const r = validateMatchInput({ ...valid, round: 'training' });
    expect(r.ok).toBe(false);
  });

  it('requires a valid discipline', () => {
    const r = validateMatchInput({ ...valid, discipline: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/discipline/);
  });

  it('treats roundName as an optional display-only override', () => {
    const { roundName: _omit, ...withoutName } = valid;
    const r = validateMatchInput(withoutName);
    expect(r.ok).toBe(true);
    if (r.ok) expect('roundName' in r.value).toBe(false);
  });

  it('omits an empty/whitespace roundName rather than storing it', () => {
    const r = validateMatchInput({ ...valid, roundName: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect('roundName' in r.value).toBe(false);
  });

  it('rejects a non-string roundName', () => {
    const r = validateMatchInput({ ...valid, roundName: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/roundName/);
  });

  it('requires gender and integer position (timertimer changeset)', () => {
    const r = validateMatchInput({ discipline: 'speed', round: 'final', position: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join()).toMatch(/gender/);
      expect(r.errors.join()).toMatch(/position/);
    }
  });
});

describe('validateScoreInput', () => {
  const valid = {
    athleteId: 'a1',
    round: 'final',
    difficulty: 8.5,
    combo: 7,
    style: 6.25,
    bestTrick: 9,
    controlPenalty: 2.75,
  };

  it('computes overall from the components when omitted', () => {
    const r = validateScoreInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.overall).toBe(8.5 + 7 + 6.25 + 9 - 2.75);
      expect(r.value.athleteId).toBe('a1');
    }
  });

  it('treats an empty-string overall as omitted (form blank)', () => {
    const r = validateScoreInput({ ...valid, overall: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.overall).toBe(8.5 + 7 + 6.25 + 9 - 2.75);
  });

  it('stores an explicitly provided overall as-is', () => {
    const r = validateScoreInput({ ...valid, overall: 99.5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.overall).toBe(99.5);
  });

  it('normalizes an explicit overall to kill float noise (ADR 0039)', () => {
    const r = validateScoreInput({ ...valid, overall: 26.700000000000003 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.overall).toBe(26.7);
  });

  it('accepts zero components', () => {
    const r = validateScoreInput({
      athleteId: 'a1',
      round: 'final',
      difficulty: 0,
      combo: 0,
      style: 0,
      bestTrick: 0,
      controlPenalty: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.overall).toBe(0);
  });

  it('rejects missing athlete, a non-Match round, and negative/non-numeric components', () => {
    expect(validateScoreInput({ ...valid, athleteId: '' }).ok).toBe(false);
    expect(validateScoreInput({ ...valid, round: 'training' }).ok).toBe(false);
    expect(validateScoreInput({ ...valid, difficulty: -1 }).ok).toBe(false);
    expect(validateScoreInput({ ...valid, style: 'x' }).ok).toBe(false);
    const r = validateScoreInput({ ...valid, overall: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/overall/);
  });

  it('rejects a component over its per-component maximum (rule F8)', () => {
    const over = validateScoreInput({ ...valid, difficulty: 40.5 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.join()).toMatch(/difficulty must be <= 40/);
    expect(validateScoreInput({ ...valid, combo: 31 }).ok).toBe(false);
    expect(validateScoreInput({ ...valid, style: 31 }).ok).toBe(false);
    expect(validateScoreInput({ ...valid, bestTrick: 21 }).ok).toBe(false);
  });

  it('rejects a nonzero best trick / control penalty at qualification (rule F8: battles only)', () => {
    const bt = validateScoreInput({
      ...valid,
      round: 'qualification',
      bestTrick: 1,
      controlPenalty: 0,
    });
    expect(bt.ok).toBe(false);
    if (!bt.ok) expect(bt.errors.join()).toMatch(/bestTrick must be 0 in qualification/);
    const cp = validateScoreInput({
      ...valid,
      round: 'qualification',
      bestTrick: 0,
      controlPenalty: 2,
    });
    expect(cp.ok).toBe(false);
    if (!cp.ok) expect(cp.errors.join()).toMatch(/controlPenalty must be 0 in qualification/);
  });

  it('accepts a qualification Score with zero best trick + control penalty', () => {
    const r = validateScoreInput({
      ...valid,
      round: 'qualification',
      bestTrick: 0,
      controlPenalty: 0,
    });
    expect(r.ok).toBe(true);
  });

  it('leaves best trick + control penalty free at battle rounds', () => {
    const r = validateScoreInput({ ...valid, round: 'final', bestTrick: 9, controlPenalty: 2 });
    expect(r.ok).toBe(true);
  });

  it('accepts a component exactly at its maximum, and leaves controlPenalty uncapped', () => {
    const atMax = validateScoreInput({
      ...valid,
      difficulty: 40,
      combo: 30,
      style: 30,
      bestTrick: 20,
      controlPenalty: 999,
    });
    expect(atMax.ok).toBe(true);
  });

  it('rejects an overall above the applicable maxima for the round (typo-proofing)', () => {
    const battle = validateScoreInput({ ...valid, overall: 120.5 });
    expect(battle.ok).toBe(false);
    if (!battle.ok) expect(battle.errors.join()).toMatch(/overall must be <= 120/);

    const quali = validateScoreInput({
      ...valid,
      round: 'qualification',
      bestTrick: 0,
      controlPenalty: 0,
      overall: 101,
    });
    expect(quali.ok).toBe(false);
    if (!quali.ok) expect(quali.errors.join()).toMatch(/overall must be <= 100/);
  });

  it('accepts an overall exactly at the bound, and has no lower bound', () => {
    expect(validateScoreInput({ ...valid, overall: 120 }).ok).toBe(true);
    // A battle control penalty is uncapped, so a negative overall is legitimate.
    expect(validateScoreInput({ ...valid, overall: -12 }).ok).toBe(true);
  });

  it('leaves a DNF score unbounded — it carries no judged value', () => {
    expect(validateScoreInput({ ...valid, dnf: true, overall: 999 }).ok).toBe(true);
  });

  it('carries dnf:true through but drops a falsy/absent dnf', () => {
    const withDnf = validateScoreInput({ ...valid, dnf: true });
    expect(withDnf.ok).toBe(true);
    if (withDnf.ok) expect(withDnf.value.dnf).toBe(true);

    const absent = validateScoreInput(valid);
    expect(absent.ok).toBe(true);
    if (absent.ok) expect('dnf' in absent.value).toBe(false);

    const falsy = validateScoreInput({ ...valid, dnf: false });
    expect(falsy.ok).toBe(true);
    if (falsy.ok) expect('dnf' in falsy.value).toBe(false);
  });

  it('rejects a non-boolean dnf', () => {
    const r = validateScoreInput({ ...valid, dnf: 'yes' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/dnf/);
  });

  it('carries a matchId through and drops an absent one', () => {
    const linked = validateScoreInput({ ...valid, matchId: 'm1' });
    expect(linked.ok).toBe(true);
    if (linked.ok) expect(linked.value.matchId).toBe('m1');

    const absent = validateScoreInput(valid);
    expect(absent.ok).toBe(true);
    if (absent.ok) expect('matchId' in absent.value).toBe(false);
  });

  it('rejects a non-string / empty matchId', () => {
    expect(validateScoreInput({ ...valid, matchId: 5 }).ok).toBe(false);
    expect(validateScoreInput({ ...valid, matchId: '  ' }).ok).toBe(false);
  });
});
