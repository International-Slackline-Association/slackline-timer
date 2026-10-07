import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ReadyState } from 'react-use-websocket';

import {
  type DbUpdateWSMessage,
  type LiveSelection,
  type StopwatchWSMessage,
  useWS,
} from 'app/hooks/useWebSocket';
import { type Discipline } from 'app/types';
import { allDbUpdateQueryKeys, dbUpdateQueryKeys } from 'app/pages/Stream/dbUpdateInvalidation';
import {
  INITIAL_SELECTION_STAMP,
  acceptSelectionStamp,
  type SelectionStamp,
} from 'app/util/selectionLww';

// The write Lambdas' `db_update` and the board's `updateSelection` in; the
// `request_state` catch-up out.
type StreamMessage =
  DbUpdateWSMessage | Extract<StopwatchWSMessage, { type: 'updateSelection' | 'request_state' }>;

/**
 * Keeps a `/stream/*` overlay live over one relay connection: invalidates the
 * React Query cache on every `db_update` and on every socket (re)open, and
 * tracks the board's latest `updateSelection`. Returns that selection (null
 * until the board pushes one) and the socket's `readyState`
 * (`ConnectionLostBadge`). `AdminLiveRefresh` reuses it for the invalidation
 * half only.
 *
 * `discipline` scopes the tracked selection: both disciplines share one relay
 * room (compId = sessionId), so a discipline-pinned overlay must ignore the
 * OTHER board's selection — a speed pick would knock a freestyle VS card back
 * to its positional fallback. Foreign selections are dropped before the LWW
 * stamp, so the last same-discipline pick survives the other board's pushes.
 * Omitted (the H2R bridge) tracks whichever board is live.
 */
export const useStreamRefresh = (
  compId: string,
  readToken?: string,
  discipline?: Discipline,
): { selection: LiveSelection | null; readyState: ReadyState } => {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<LiveSelection | null>(null);
  // LWW seq (ADR 0038 §4), one hop out from the panels: crossed concurrent
  // panel edits reach the overlay in arbitrary arrival order, so drop the
  // losing (stale-stamped) side exactly like the control panels do.
  const selectionStampRef = useRef<SelectionStamp>(INITIAL_SELECTION_STAMP);
  // Per frame, off this render's `compId`/`discipline` (ADR 0051): a prop
  // change re-processes nothing — no frame is held to re-read.
  const handleFrame = (message: StreamMessage) => {
    if (message.type === 'db_update') {
      for (const queryKey of dbUpdateQueryKeys(compId, message.data.entity)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    } else if (message.type === 'updateSelection') {
      // Discipline crosstalk guard (see the docblock).
      if (discipline && message.data.discipline !== discipline) return;
      const stamp = acceptSelectionStamp(selectionStampRef.current, message);
      if (stamp) {
        selectionStampRef.current = stamp;
        setSelection(message.data);
      }
    }
  };
  const { readyState, sendWSMessage } = useWS<StreamMessage>({
    sessionId: compId,
    readToken,
    onMessage: handleFrame,
  });

  // On every OPEN, catch up on both channels missed while disconnected:
  //   1. the data plane — re-invalidate (why in `allDbUpdateQueryKeys`);
  //   2. the board's selection — `request_state`, since the board re-pushes
  //      `updateSelection` only on a change or its own OPEN; a mid-event joiner
  //      would otherwise sit on its positional fallback. It is the one frame a
  //      read-only socket may send (ADR 0050).
  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      for (const queryKey of allDbUpdateQueryKeys(compId)) {
        void queryClient.invalidateQueries({ queryKey });
      }
      sendWSMessage({ type: 'request_state', data: {} });
    }
  }, [readyState, queryClient, compId, sendWSMessage]);

  return { selection, readyState };
};
