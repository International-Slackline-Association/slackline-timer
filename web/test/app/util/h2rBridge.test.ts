import { describe, expect, it } from 'vitest';

import type { Athlete } from 'app/types';
import {
  H2R_DISCIPLINE_SLOT,
  H2R_VARIABLE_MAP,
  buildH2rPosts,
  type BridgeSide,
} from 'app/util/h2rBridge';

const athlete = (over: Partial<Athlete> = {}): Athlete => ({
  athleteId: 'a1',
  compId: 'c1',
  firstName: 'Jane',
  lastName: 'Doe',
  name: 'Jane Doe',
  birthDate: '1990-01-01',
  country: 'USA',
  gender: 'female',
  ...over,
});

const side = (over: Partial<BridgeSide> = {}): BridgeSide => ({
  athlete: athlete(),
  result: '1:23.45',
  ...over,
});

describe('buildH2rPosts', () => {
  it('maps a single side to the configured text-variable slots', () => {
    const posts = buildH2rPosts({ 1: side(), 2: null }, H2R_VARIABLE_MAP);

    const text = posts.filter((p) => p.kind === 'text');
    // Side 1 gets name/country/result; side 2 is cleared (empty value), never dropped.
    expect(text).toContainEqual({
      kind: 'text',
      path: `/updateVariableText/${H2R_VARIABLE_MAP[1].name}`,
      body: { text: 'Jane Doe' },
    });
    expect(text).toContainEqual({
      kind: 'text',
      path: `/updateVariableText/${H2R_VARIABLE_MAP[1].country}`,
      body: { text: 'USA' },
    });
    expect(text).toContainEqual({
      kind: 'text',
      path: `/updateVariableText/${H2R_VARIABLE_MAP[1].result}`,
      body: { text: '1:23.45' },
    });
  });

  it('clears every slot on an empty side so a stale name never lingers on air', () => {
    const posts = buildH2rPosts({ 1: null, 2: null }, H2R_VARIABLE_MAP);
    const text = posts.filter((p): p is Extract<typeof p, { kind: 'text' }> => p.kind === 'text');
    // Both sides' 3 text vars + the discipline slot, all empty (no live selection).
    expect(text).toHaveLength(7);
    expect(text.every((p) => p.body.text === '')).toBe(true);
  });

  it('pushes the board discipline to its own slot', () => {
    const posts = buildH2rPosts({ 1: side(), 2: null }, H2R_VARIABLE_MAP, 'freestyle');
    const text = posts.filter((p) => p.kind === 'text');
    expect(text).toContainEqual({
      kind: 'text',
      path: `/updateVariableText/${H2R_DISCIPLINE_SLOT}`,
      body: { text: 'freestyle' },
    });
  });

  it('clears the discipline slot when there is no live selection', () => {
    const posts = buildH2rPosts({ 1: null, 2: null }, H2R_VARIABLE_MAP);
    const discipline = posts.find(
      (p) => p.kind === 'text' && p.path === `/updateVariableText/${H2R_DISCIPLINE_SLOT}`,
    );
    if (discipline?.kind !== 'text') throw new Error('expected a discipline text post');
    expect(discipline.body.text).toBe('');
  });

  it('pushes the photo through the HTTP-listener data source when present', () => {
    const posts = buildH2rPosts(
      { 1: side({ athlete: athlete({ photoUrl: 'https://cf/p1.jpg' }) }), 2: null },
      H2R_VARIABLE_MAP,
    );
    const data = posts.find(
      (p) => p.kind === 'data' && p.path === `/data/${H2R_VARIABLE_MAP[1].photo}`,
    );
    expect(data).toBeDefined();
    if (data?.kind !== 'data') throw new Error('expected a data post');
    // H2R HTTP-listener array shape: it fetches profileImageUrl itself.
    expect(data.body).toEqual([
      {
        snippet: { displayMessage: 'Jane Doe' },
        authorDetails: { displayName: 'Jane Doe', profileImageUrl: 'https://cf/p1.jpg' },
        platform: { name: 'speedline' },
      },
    ]);
  });

  it('clears the photo data source (empty array) when a side has no photo', () => {
    const posts = buildH2rPosts(
      { 1: side({ athlete: athlete({ photoUrl: undefined }) }), 2: null },
      H2R_VARIABLE_MAP,
    );
    const data = posts.find(
      (p) => p.kind === 'data' && p.path === `/data/${H2R_VARIABLE_MAP[1].photo}`,
    );
    if (data?.kind !== 'data') throw new Error('expected a data post');
    expect(data.body).toEqual([]);
  });

  it('uses country2 only as a second flag-source suffix, not the primary', () => {
    const posts = buildH2rPosts(
      { 1: side({ athlete: athlete({ country: 'FRA', country2: 'CAN' }) }), 2: null },
      H2R_VARIABLE_MAP,
    );
    const country = posts.find(
      (p) => p.kind === 'text' && p.path === `/updateVariableText/${H2R_VARIABLE_MAP[1].country}`,
    );
    if (country?.kind !== 'text') throw new Error('expected a text post');
    expect(country.body.text).toBe('FRA / CAN');
  });
});
