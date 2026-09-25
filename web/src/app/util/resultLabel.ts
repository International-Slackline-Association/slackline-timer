/**
 * The discipline-split result rule shared by the broadcast overlays.
 *
 * Speed and freestyle encode a result differently (best elapsed time vs a judged
 * `overall`, each with its own DNF encoding — see doc/dev/architecture.md), yet every
 * overlay that shows a single athlete's result applies the same rule. Extracted
 * here so VsOverlay, useLiveSideAthlete, and RankingsOverlay share one source of
 * truth instead of three drifting copies.
 */

import { type Discipline } from 'app/types';
import { DNF_LABEL, formatMs } from 'app/util/time';

/** The fastest attempt (min `timeMs`) in a list, or undefined when there are none. */
export const bestTimeMs = (times: readonly { timeMs: number }[]): number | undefined =>
  times.reduce<number | undefined>(
    (m, t) => (m === undefined || t.timeMs < m ? t.timeMs : m),
    undefined,
  );

/**
 * Render a freestyle score value to the shared 2-decimal display precision (ADR
 * 0039). Values are exact doubles post-normalization; 2 dp is the one display
 * rule across every raw/console/overlay surface. (`combined` rank-averages stay
 * `toFixed(1)` — they are 0.5 steps, not a judged score.)
 */
export const formatScore = (v: number): string => v.toFixed(2);

/** Freestyle result label: DNF wins over any stored value; otherwise the judged overall to 2 decimals. */
export const freestyleResultLabel = (score: { dnf?: boolean; overall?: number | null }): string =>
  score.dnf ? DNF_LABEL : formatScore(score.overall ?? 0);

/**
 * The result label for one athlete on the given plane: the freestyle judged
 * overall / DNF, or the speed best time (`formatMs` renders the DNF sentinel).
 */
export const resultLabel = (
  discipline: Discipline,
  entry: { dnf?: boolean; overall?: number | null; bestTimeMs?: number },
): string =>
  discipline === 'freestyle' ? freestyleResultLabel(entry) : formatMs(entry.bestTimeMs);

/**
 * The result label for a standings row, where every result field is optional
 * (a bracket placement can exist before any run). `resultLabel` would render an
 * absent result as `00:00:00` / `0.0`, so the no-result case gets an explicit
 * em dash.
 */
export const standingsResultLabel = (
  discipline: Discipline,
  entry: { dnf?: boolean; overall?: number | null; bestTimeMs?: number },
): string => {
  const hasResult =
    discipline === 'freestyle'
      ? entry.dnf === true || entry.overall != null
      : entry.bestTimeMs !== undefined;
  return hasResult ? resultLabel(discipline, entry) : '—';
};
