// Pure planning half of renameCompId.mjs: given the source partition's items,
// derive every write the rename needs. Key shapes mirror src/core/keys.ts.

export const compPk = (id) => `COMP#${id}`;
export const photoPrefix = (id) => `photos/${id}/`;

const MANAGER_SK_PREFIX = 'MANAGER#';
const userPk = (sub) => `USER#${sub}`;
const userCompSk = (compId) => `COMP#${compId}`;

/**
 * The partition copy alone leaves each manager's reverse grant row
 * (`USER#<sub>` / `COMP#<id>`, outside the partition) on the old compId, so the
 * manager's competition list would drop the renamed comp. The forward
 * `MANAGER#<sub>` rows carry `sub`; each yields one reverse put + delete.
 */
export function planRename(source, from, to, { skipPhotos = false } = {}) {
  const oldPrefix = photoPrefix(from);
  const photoMoves = [];
  let foreignPhotos = 0;
  for (const item of source) {
    const key = item.photoKey;
    if (typeof key !== 'string' || key.length === 0) continue;
    if (key.startsWith(oldPrefix)) {
      photoMoves.push({ oldKey: key, newKey: photoPrefix(to) + key.slice(oldPrefix.length) });
    } else {
      foreignPhotos += 1;
    }
  }

  const rewritePhoto = !skipPhotos && photoMoves.length > 0;
  const newItems = source.map((item) => {
    const next = { ...item, PK: compPk(to), compId: to };
    if (rewritePhoto && typeof item.photoKey === 'string' && item.photoKey.startsWith(oldPrefix)) {
      next.photoKey = photoPrefix(to) + item.photoKey.slice(oldPrefix.length);
    }
    return next;
  });

  const reverseGrants = source
    .filter((i) => String(i.SK).startsWith(MANAGER_SK_PREFIX))
    .map((i) => {
      const sub = typeof i.sub === 'string' ? i.sub : String(i.SK).slice(MANAGER_SK_PREFIX.length);
      return {
        put: { PK: userPk(sub), SK: userCompSk(to), compId: to, sub },
        oldKey: { PK: userPk(sub), SK: userCompSk(from) },
      };
    });

  return { newItems, photoMoves, foreignPhotos, reverseGrants };
}

const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * True when every item already at the target equals the item this rename would
 * write there: a re-run after a partial copy, or the `--delete-source` pass.
 * Anything else at the target is another competition and must not be clobbered.
 */
export function isPriorCopy(targetItems, plannedItems) {
  const bySk = new Map(plannedItems.map((i) => [i.SK, i]));
  return targetItems.every((t) => bySk.has(t.SK) && same(t, bySk.get(t.SK)));
}
