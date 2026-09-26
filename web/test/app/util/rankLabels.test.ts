import { describe, expect, it } from 'vitest';

import { rankLabels, serverRankLabels } from 'app/util/rankLabels';

describe('rankLabels', () => {
  it('numbers distinct values 1..n', () => {
    expect(rankLabels(['1:00.00', '1:01.00', '1:02.00'])).toEqual(['1', '2', '3']);
  });

  it('marks a tie with = and resumes at the skip rank', () => {
    // Two tied for 1st, then the next distinct value is 3rd (rank 1 is used twice).
    expect(rankLabels(['1:00.00', '1:00.00', '1:02.00'])).toEqual(['=1', '=1', '3']);
  });

  it('marks a mid-field tie', () => {
    expect(rankLabels(['1:00.00', '1:01.00', '1:01.00', '1:03.00'])).toEqual([
      '1',
      '=2',
      '=2',
      '4',
    ]);
  });

  it('renders a solo value as its plain rank', () => {
    expect(rankLabels(['DNF'])).toEqual(['1']);
  });

  it('handles an empty field', () => {
    expect(rankLabels([])).toEqual([]);
  });
});

describe('serverRankLabels', () => {
  it('renders distinct server ranks as plain numerals', () => {
    expect(serverRankLabels([1, 2, 5])).toEqual(['1', '2', '5']);
  });

  it('prefixes = only where a server rank repeats (1224-style input)', () => {
    expect(serverRankLabels([1, 1, 3, 4])).toEqual(['=1', '=1', '3', '4']);
  });

  it('handles an empty field', () => {
    expect(serverRankLabels([])).toEqual([]);
  });
});
