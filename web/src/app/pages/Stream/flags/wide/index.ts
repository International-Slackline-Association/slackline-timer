import { DELIVERED_WIDE_FLAGS } from 'app/pages/Stream/flags/wide/delivered';
import { REBUILT_WIDE_FLAGS } from 'app/pages/Stream/flags/wide/rebuilt';

/**
 * Wide flag art for the `AthleteCard` foot strip, in two tiers of descending
 * fidelity. The tiers exist because the art has two very different origins, and
 * a broadcast graphic should never silently prefer the weaker one:
 *
 * | Tier                            | Origin                                                        |
 * | ------------------------------- | ------------------------------------------------------------- |
 * | [`delivered`](./delivered.ts)   | the event **designer's** own art, from the delivered masters   |
 * | [`rebuilt`](./rebuilt.ts)       | **reconstructed by an LLM** for nations the designer missed     |
 *
 * `emblems.ts` is not a tier: it is the vendored flag-icons crest artwork that
 * `rebuilt` composes into its bands, so a reconstruction still carries a nation's
 * real coat of arms rather than an approximation of one.
 *
 * This module owns the **precedence** so no consumer re-derives it: delivered
 * wins, always. A nation the designer later delivers therefore outranks its
 * reconstruction the moment it lands in `delivered.ts`, with no edit here — and
 * the stale entry in `rebuilt.ts` should then be dropped (a test asserts the two
 * tables never overlap, so a forgotten one fails the build rather than shipping
 * the weaker art).
 */
export const wideFlagArt = (alpha2: string): string | undefined =>
  DELIVERED_WIDE_FLAGS[alpha2] ?? REBUILT_WIDE_FLAGS[alpha2];

/** Which tier answered for a nation — for tests and provenance, not rendering. */
export const wideFlagTier = (alpha2: string): 'delivered' | 'rebuilt' | undefined => {
  if (alpha2 in DELIVERED_WIDE_FLAGS) return 'delivered';
  if (alpha2 in REBUILT_WIDE_FLAGS) return 'rebuilt';
  return undefined;
};

export { DELIVERED_WIDE_FLAGS, REBUILT_WIDE_FLAGS };
export { VENDOR_EMBLEMS } from 'app/pages/Stream/flags/wide/emblems';
