import { useEffect } from 'react';
import type { TimerEffect } from 'app/util/timerChannel';
import type { CountdownWSMessage, DistributiveOmit } from 'app/hooks/useWebSocket';
import type { RaceSound } from 'app/util/raceSound';

/**
 * Drain a Freestyle machine's queued effects at the edge (HSM rule 4: effects
 * run because state changed, never inside the pure transition). Broadcasts each
 * `ws` effect over the relay (the unchanged contract — the session hook stamps
 * `sessionId`) and plays each `audio` beep on the control surface, then
 * dispatches `DRAIN` to clear the queue.
 *
 * Both Freestyle reducers (the battle lanes and the best-trick series) share
 * this byte-identical drain; the store's own scaffolding (`util/effectStore`)
 * keeps the effect queue referentially stable, so an empty pass is a no-op.
 * `dispatch` accepts any action superset that includes `DRAIN`, so a machine's
 * full `Dispatch` type slots in unchanged.
 */
export function useEffectDrain(
  effects: TimerEffect[],
  sendWSMessage: (message: DistributiveOmit<CountdownWSMessage, 'sessionId'>) => void,
  playAudio: (sound: RaceSound) => void,
  dispatch: (action: { type: 'DRAIN' }) => void,
): void {
  useEffect(() => {
    if (effects.length === 0) return;
    for (const effect of effects) {
      if (effect.kind === 'ws') {
        sendWSMessage(effect.message);
      } else {
        playAudio(effect.sound);
      }
    }
    dispatch({ type: 'DRAIN' });
  }, [effects, sendWSMessage, playAudio, dispatch]);
}
