import { type MatchRound, type Score } from 'app/types';
import { formatScore, freestyleResultLabel } from 'app/util/resultLabel';

/**
 * Shared freestyle judged-breakdown rules for the two overlays that show a
 * component-by-component score — the ranked `ScoreCardOverlay` table and the
 * per-athlete `VsMatchup` freestyle panel. Both must agree on which components a
 * round is judged with and how each cell renders, so the "depending on the round,
 * show the values in the correct format" rule lives in one place.
 */

/** The freestyle breakdown cells: the four judged components, the control
 *  penalty, and the derived total. `total` is not a stored field — it maps to the
 *  judged `overall` / DNF label. */
export type FreestyleCellKey =
  'total' | 'difficulty' | 'combo' | 'style' | 'controlPenalty' | 'bestTrick';

/**
 * Components judged in battles only (rule F8: no control penalty / best trick in
 * qualification). A qualification card drops these two cells; every other round
 * shows the full breakdown. Typed as the wider cell key so callers can test a
 * key that includes `total` without a cast.
 */
export const QUALIFICATION_HIDDEN: readonly FreestyleCellKey[] = ['controlPenalty', 'bestTrick'];

/** True when `key` is judged in `round` (everything but the two battle-only
 *  components at qualification). */
export const isFreestyleCellShown = (key: FreestyleCellKey, round: MatchRound): boolean =>
  round !== 'qualification' || !QUALIFICATION_HIDDEN.includes(key);

/** A DNF strikes the whole breakdown, not just the total — the stored components
 *  are irrelevant once `dnf` is set (see the `Score.dnf` contract). */
const NO_VALUE = '—';

/**
 * The displayed string for one breakdown cell. The total uses the shared
 * discipline-split label (judged overall to 2 dp, or DNF); every component is the
 * 2-dp score, or the DNF em dash. Guards a missing component to 0 the same way
 * every numeric API field is guarded at the render edge (persisted records can
 * predate a component).
 */
export const freestyleCellValue = (
  key: FreestyleCellKey,
  entry: { dnf?: boolean; overall?: number | null; score?: Score },
): string => {
  if (key === 'total') return freestyleResultLabel(entry);
  if (entry.dnf) return NO_VALUE;
  return formatScore(entry.score?.[key] ?? 0);
};
