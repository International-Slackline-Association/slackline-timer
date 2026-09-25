import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import type { ReactNode } from 'react';

import { RaceButton } from 'app/components/RaceButton';
import { useConfirmGuard } from 'app/hooks/useAdvanceInput';

/**
 * The board's one confirm shell (FREESTYLE_BOARD_UX §4.8). Every question the
 * control boards raise stands over a press with no undo — a lane's Reset, the
 * rail's whole-board re-arm, a best-trick tally, a selection change that
 * orphans a match — and each is the same object: a titled dialog, the safe
 * answer autoFocused, and one destructive `RaceButton tone="stop"`.
 *
 * It registers `useConfirmGuard` itself, so an ADVANCE press behind the
 * question answers it safely instead of stepping the board, and the handset
 * readout can name what the press answered. The readout's name for the question
 * IS `confirmLabel`: the button that raises it, the button that carries it out
 * and the line the readout prints are one control in the operator's words, and
 * a shell that took them separately would be a seam for them to drift at.
 *
 * What stays the caller's is everything domain: the board stands TWO of some of
 * these questions (one per lane, one per picker), so a fixed title or name
 * would send the operator to a control they cannot find; and a body composed
 * per render — a clause per holding lane, a tally read off the payload — is a
 * node the caller builds, never a string this component formats. A body of
 * `null` is a body: the two lane-side questions read their payload and drop it
 * as the question closes, and the dialog empties with them.
 *
 * The state half is NOT here: `useLapsingConfirm` owns whether a question
 * stands, and drops it when a peer takes the risk away.
 */
export const BoardConfirmDialog = ({
  open,
  titleId,
  title,
  body,
  confirmLabel,
  safeAnswer,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Id of the title element, per instance where a board stands two. */
  titleId: string;
  title: string;
  body: ReactNode;
  /** The destructive answer's words — and the name the readout logs. */
  confirmLabel: string;
  /** The autoFocused safe answer's words (`Keep timing` / `Keep series` / …). */
  safeAnswer: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const safeAnswerProps = useConfirmGuard(open, onCancel, {
    dialog: confirmLabel,
    safeAction: safeAnswer,
  });
  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby={titleId}>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      {body !== null && (
        <DialogContent>
          <DialogContentText>{body}</DialogContentText>
        </DialogContent>
      )}
      <DialogActions>
        <Button {...safeAnswerProps} />
        <RaceButton tone="stop" onClick={onConfirm}>
          {confirmLabel}
        </RaceButton>
      </DialogActions>
    </Dialog>
  );
};
