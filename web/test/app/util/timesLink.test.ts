import { describe, expect, it } from 'vitest';

import { timeCorrectionHref, timesFilterSeed } from 'app/util/timesLink';

describe('timeCorrectionHref', () => {
  it('names the athlete and the round the lane recorded under', () => {
    expect(timeCorrectionHref('qualification', 'a1')).toBe(
      '/admin/times?athlete=a1&round=qualification',
    );
  });

  it('drops the athlete when the lane has none', () => {
    expect(timeCorrectionHref('final', '')).toBe('/admin/times?round=final');
  });

  it('escapes an athlete id rather than splicing it in raw', () => {
    expect(timeCorrectionHref('half', 'a 1&x')).toBe('/admin/times?athlete=a+1%26x&round=half');
  });
});

describe('timesFilterSeed', () => {
  it('reads both filters off the link', () => {
    expect(timesFilterSeed('?athlete=a2&round=final')).toEqual({ athleteId: 'a2', round: 'final' });
  });

  it('keeps training, a Time round that no Match has', () => {
    expect(timesFilterSeed('?round=training')).toEqual({ athleteId: '', round: 'training' });
  });

  it('leaves both unfiltered on a bare page visit', () => {
    expect(timesFilterSeed('')).toEqual({ athleteId: '', round: '' });
  });

  it('ignores a round outside the sort-key vocabulary', () => {
    expect(timesFilterSeed('?athlete=a2&round=overall')).toEqual({ athleteId: 'a2', round: '' });
  });
});
