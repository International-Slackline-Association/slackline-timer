import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * State for a confirm whose risk the operator does not own alone
 * (FREESTYLE_BOARD_UX §4.8). Every question on the board stands over something
 * a peer panel can take away — a peer Reset re-arms the lane the question
 * names, a peer Leave drops the tally, a peer Start locks the press behind it —
 * and a question whose risk is gone has to go with it.
 *
 * Deriving that (`atRisk ? asked : null`) closes the dialog but keeps the ask,
 * and the ask then re-opens it the next time the risk returns: the next Start,
 * the next try, the lifting lock. That is a question nobody asked, on a board
 * where an open one holds the whole handset (`overlayOwnsBoard`). So the lapse
 * **drops** the ask; asking again takes another press.
 *
 * `T` is whatever the question needs to render itself — the stamp its text
 * reads a lane down against, or which of two verbs opened it.
 */
export const useLapsingConfirm = <T>(
  atRisk: boolean,
): [T | null, Dispatch<SetStateAction<T | null>>] => {
  const [asked, setAsked] = useState<T | null>(null);
  // React's "adjusting state when a prop changes": the render this starts is
  // discarded before commit, so the question never reaches the screen over a
  // risk that has already lapsed — where an effect would leave one frame of it.
  if (asked !== null && !atRisk) setAsked(null);
  return [asked, setAsked];
};
