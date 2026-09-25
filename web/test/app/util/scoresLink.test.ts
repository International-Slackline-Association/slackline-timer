import { describe, expect, it } from 'vitest';

import { scoreCorrectionHref, scoresFilterSeed } from 'app/util/scoresLink';

describe('scoreCorrectionHref', () => {
  it('names the athlete and the round the panel locked on', () => {
    expect(scoreCorrectionHref('qualification', 'a1')).toBe(
      '/admin/scores?athlete=a1&round=qualification',
    );
  });

  it('drops the athlete when the player has none', () => {
    expect(scoreCorrectionHref('final', '')).toBe('/admin/scores?round=final');
  });

  it('escapes an athlete id rather than splicing it in raw', () => {
    expect(scoreCorrectionHref('half', 'a 1&x')).toBe('/admin/scores?athlete=a+1%26x&round=half');
  });
});

describe('scoresFilterSeed', () => {
  it('reads both filters off the link', () => {
    expect(scoresFilterSeed('?athlete=a2&round=final')).toEqual({
      athleteId: 'a2',
      round: 'final',
    });
  });

  it('leaves both unfiltered on a bare page visit', () => {
    expect(scoresFilterSeed('')).toEqual({ athleteId: '', round: '' });
  });

  it('ignores a round outside the sort-key vocabulary', () => {
    expect(scoresFilterSeed('?athlete=a2&round=overall')).toEqual({
      athleteId: 'a2',
      round: '',
    });
  });
});
