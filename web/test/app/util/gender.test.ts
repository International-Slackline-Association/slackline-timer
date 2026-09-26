import { describe, expect, it } from 'vitest';

import { GENDERS } from 'app/types';
import { genderLabel } from 'app/util/gender';

describe('genderLabel', () => {
  it('defaults to the category form (Men/Women)', () => {
    expect(genderLabel('male')).toBe('Men');
    expect(genderLabel('female')).toBe('Women');
  });

  it('gives the subject form (Male/Female) for per-athlete labels', () => {
    expect(genderLabel('male', 'subject')).toBe('Male');
    expect(genderLabel('female', 'subject')).toBe('Female');
  });

  it('keeps the category and subject meanings distinct', () => {
    for (const g of GENDERS) {
      expect(genderLabel(g, 'category')).not.toBe(genderLabel(g, 'subject'));
    }
  });

  it('never emits the raw lowercase enum', () => {
    for (const g of GENDERS) {
      expect(genderLabel(g, 'category')).not.toBe(g);
      expect(genderLabel(g, 'subject')).not.toBe(g);
    }
  });
});
