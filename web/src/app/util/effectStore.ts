/**
 * Shared effect-queue scaffolding for the two Freestyle machines (`battleMachine`
 * lanes, `bestTrickSeries`). Each store carries its pure domain state alongside a
 * queue of pending effects for the edge to drain (effects-as-data, so the
 * transition stays pure and the drain is order-independent even if several events
 * land before a render). These two helpers own the queue mechanics both reducers
 * used to inline; the machines stay separate — only the boilerplate is shared.
 *
 * Both preserve referential identity when nothing changes (an empty drain, a
 * no-effect transition), so an idle dispatch never forces a re-render or a
 * needless re-drain.
 */

/** The `DRAIN` case: clear the queue after the edge has performed it. Identity
 * when already empty. */
export const drainEffects = <T extends { effects: readonly unknown[] }>(store: T): T =>
  store.effects.length === 0 ? store : { ...store, effects: [] };

/** Append a transition's newly-produced effects to the pending queue. Identity
 * (the same array) when the transition produced none. */
export const appendEffects = <E>(pending: E[], produced: E[]): E[] =>
  produced.length === 0 ? pending : [...pending, ...produced];
