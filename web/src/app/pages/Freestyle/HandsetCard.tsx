import { useCallback } from 'react';

import { HandsetCard as SharedHandsetCard } from 'app/components/HandsetCard';
import { advanceOverlay } from 'app/hooks/useAdvanceInput';
import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import type { AdvanceNames } from 'app/util/advanceRoute';
import type { BattleState } from 'app/util/battleMachine';
import type { TrySeriesState } from 'app/util/bestTrickSeries';
import { buzzerRows } from 'app/util/buzzer';
import { handsetOutcome, handsetReadout } from 'app/util/handsetReadout';

interface Props {
  mode: FreestyleMode;
  /** The board the pad handlers guard on — the readout's verdicts come from
   * the same interlock table they do, so the two cannot disagree. */
  battle: BattleState;
  trySeries: TrySeriesState | null;
  /** The lane athletes — the ADVANCE key logs its step in the plate's words. */
  names: AdvanceNames;
}

/**
 * The Freestyle desk's handset card: the shared card (`app/components`) with
 * this board's verdicts. Everything visual lives there; what is here is the one
 * thing the two desks cannot share — what a press MEANT on this board.
 */
export const HandsetCard = ({ mode, battle, trySeries, names }: Props) => {
  const describe = useCallback(
    (button: number) =>
      handsetReadout(
        button,
        // Read the overlay HERE: this runs with the DOM of the press, before a
        // confirm this same press closes has been unmounted.
        handsetOutcome(button, {
          mode,
          battle,
          trySeries,
          names,
          advanceOverlay: advanceOverlay(),
        }),
      ),
    [mode, battle, trySeries, names],
  );

  return <SharedHandsetCard title="Freestyle" rows={buzzerRows(mode)} describe={describe} />;
};
