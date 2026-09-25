/**
 * Competition-ranking numerals for an ordered list of displayed result values:
 * equal consecutive values share one rank prefixed `=` (e.g. `=1`, `=1`, `=1`),
 * and the next distinct value resumes at the standard skip rank (…, `4`). A
 * solo value renders as its plain rank. The input is already in ranked order.
 *
 * The tie rule keys off the DISPLAYED result string — whatever a row shows is
 * what decides whether it ties — so it is fail-safe against how the value was
 * derived. Extracted from `Stream/RankingsOverlay.tsx` so the `RankBadge`
 * micro-template (and any other ranked surface) can share the tie logic
 * (ADR 0034 §6, formatter-first).
 */
export const rankLabels = (values: string[]): string[] => {
  const labels: string[] = [];
  let i = 0;
  while (i < values.length) {
    let j = i + 1;
    while (j < values.length && values[j] === values[i]) j += 1;
    const tied = j - i > 1;
    for (let k = i; k < j; k += 1) labels.push(tied ? `=${i + 1}` : `${i + 1}`);
    i = j;
  }
  return labels;
};

/**
 * Numerals for SERVER-assigned shared ranks (already 1224-style, e.g. the
 * combined ranking): a rank held by more than one row renders `=N`, a solo
 * rank stays plain. The counterpart of `rankLabels` for surfaces where the
 * server owns the tie rule and the client only renders the marker.
 */
export const serverRankLabels = (ranks: number[]): string[] => {
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  return ranks.map((rank) => ((counts.get(rank) ?? 0) > 1 ? `=${rank}` : `${rank}`));
};
