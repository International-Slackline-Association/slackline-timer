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

// The overlay's single relay connection sees two kinds of message: the write
// Lambdas' `db_update` (drives cache invalidation) and the control board's
// `updateSelection` (drives the live VS match + SVO card). Both arrive on the
// same socket; the type union below is what `useWS` returns for this room.
type StreamMessage =
  DbUpdateWSMessage | Extract<StopwatchWSMessage, { type: 'updateSelection' | 'request_state' }>;

/**
 * Keeps a `/stream/*` overlay live over one relay connection: invalidates the
 * React Query cache on every `db_update` (so the overlay re-fetches without
 * polling) and on every socket (re)open (so a `db_update` missed during a drop
 * can't leave it stale), AND tracks the latest `updateSelection` from the
 * control board.
 * Returns the current live selection (or null until the board pushes one), so an
 * overlay can follow the operator's choice without opening a second socket —
 * plus the socket's `readyState` so the caller can flag stale data during an
 * outage (`ConnectionLostBadge`).
 * Also reused by the `/admin/*` shell (`AdminLiveRefresh`) purely for the
 * invalidation half — the returned selection is ignored there.
 *
 * `discipline` scopes the tracked selection: both disciplines share one relay
 * room (compId = sessionId), so a discipline-pinned overlay must ignore the
 * OTHER board's selection — otherwise a speed pick would knock a freestyle VS
 * card back to its positional fallback (and an SVO-live card would show the
 * speed athlete outright). Foreign selections are dropped before the LWW stamp,
 * so the operator's last same-discipline pick persists across the other board's
 * pushes. Omitted (the H2R bridge — one tab, no discipline in its URL) tracks
 * whichever board is live.
 */
export const useStreamRefresh = (
  compId: string,
  readToken?: string,
  discipline?: Discipline,
): { selection: LiveSelection | null; readyState: ReadyState } => {
  const queryClient = useQueryClient();
  const { lastJsonMessage, readyState, sendWSMessage } = useWS<StreamMessage>({
    sessionId: compId,
    readToken,
  });
  const [selection, setSelection] = useState<LiveSelection | null>(null);
  // LWW seq (ADR 0038 §4), one hop out from the panels: crossed concurrent
  // panel edits reach the overlay in arbitrary arrival order, so drop the
  // losing (stale-stamped) side exactly like the control panels do.
  const selectionStampRef = useRef<SelectionStamp>(INITIAL_SELECTION_STAMP);

  // On every OPEN transition, catch up on both channels an overlay can miss
  // while it was disconnected (or before it ever connected):
  //   1. the HTTP data plane — re-invalidate so a `db_update` missed during a
  //      drop can't leave the overlay stale (why in `allDbUpdateQueryKeys`);
  //   2. the control board's live selection — ask the panels to re-broadcast it
  //      via `request_state`, mirroring the control panels' own on-OPEN request.
  //      The board otherwise re-pushes `updateSelection` only on a change or its
  //      own OPEN, so an overlay joining mid-event would sit on its positional
  //      fallback (the live VS match / SVO card) until the operator next touched
  //      the board. Read-only overlays are allowed to send exactly this one
  //      message — the relay refuses everything else from them (messageHandler).
  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      for (const queryKey of allDbUpdateQueryKeys(compId)) {
        void queryClient.invalidateQueries({ queryKey });
      }
      sendWSMessage({ type: 'request_state', data: {} });
    }
  }, [readyState, queryClient, compId, sendWSMessage]);

  useEffect(() => {
    if (lastJsonMessage?.type === 'db_update') {
      for (const queryKey of dbUpdateQueryKeys(compId, lastJsonMessage.data.entity)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    } else if (lastJsonMessage?.type === 'updateSelection') {
      // Discipline crosstalk guard (see the hook doc): drop the other board's
      // selection before the stamp so this overlay's own pick isn't disturbed.
      if (discipline && lastJsonMessage.data.discipline !== discipline) return;
      const stamp = acceptSelectionStamp(selectionStampRef.current, lastJsonMessage);
      if (stamp) {
        selectionStampRef.current = stamp;
        setSelection(lastJsonMessage.data);
      }
    }
  }, [lastJsonMessage, queryClient, compId, discipline]);

  return { selection, readyState };
};
