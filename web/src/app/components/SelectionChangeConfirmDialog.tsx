import { BoardConfirmDialog } from 'app/components/BoardConfirmDialog';
import { roundLabel } from 'app/util/rounds';

/**
 * Confirm a round/gender change that would orphan a selected match (ADR 0033 +
 * the gender guard). Shared by the Speedline and Freestyle selection panels,
 * which differ only in what the change clears (`clearsClause`) — the board's
 * confirm shell (`BoardConfirmDialog`) plus this one question's own copy.
 */
export const SelectionChangeConfirmDialog = ({
  pendingChange,
  round,
  clearsClause,
  onKeep,
  onConfirm,
}: {
  pendingChange: { kind: 'gender' | 'round' } | null;
  round: string;
  clearsClause: string;
  onKeep: () => void;
  onConfirm: () => void;
}) => {
  const target = pendingChange?.kind === 'gender' ? 'gender' : 'round';
  // The change asked about, in one place: the destructive button and the name
  // the handset readout gives the question (§4.8). One dialog stands over both
  // pickers, so the fixed `Change the match` pointed the operator's way out at
  // a control neither door carries.
  const changeAction = `Change ${target}`;
  return (
    <BoardConfirmDialog
      open={pendingChange !== null}
      titleId="selection-change-confirm-title"
      title={`Change the ${target}?`}
      body={
        <>
          A match is selected for {roundLabel(round)}. Changing the {target} clears {clearsClause}.
        </>
      }
      confirmLabel={changeAction}
      safeAnswer="Keep match"
      onConfirm={onConfirm}
      onCancel={onKeep}
    />
  );
};
