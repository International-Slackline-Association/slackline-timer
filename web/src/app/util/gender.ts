import { type Gender } from 'app/types';

/**
 * Two meanings share the `Gender` enum, so the label is variant-keyed:
 *
 * - `'subject'` describes a single athlete ("Male"/"Female") — used on the
 *   athlete admin where the label is a person's attribute.
 * - `'category'` names the competition grouping ("Men"/"Women") — used on
 *   matches, rankings, overlays, and the timer consoles, where the label is the
 *   field a bracket runs over.
 *
 * Defaults to `'category'`, the dominant usage. Route every gender label through
 * here so the raw lowercase enum never reaches an operator-facing surface.
 */
export const genderLabel = (
  gender: Gender,
  variant: 'category' | 'subject' = 'category',
): string =>
  variant === 'subject'
    ? gender === 'male'
      ? 'Male'
      : 'Female'
    : gender === 'male'
      ? 'Men'
      : 'Women';
