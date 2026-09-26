import { useSyncExternalStore } from 'react';

/**
 * A tiny cross-component signal for "the WebSocket `$connect` authorizer
 * rejected us" (HTTP 401 → the socket closes during the handshake and never
 * reaches OPEN). The relay is the real security boundary, so the browser only
 * learns of a denied operator session from a failed connection — not from the
 * Cognito group claim, which can still look valid on a token that has lapsed
 * past its ~1h lifetime.
 *
 * `useWS` reports the verdict here; `RequireSignedIn` reads it so the denied
 * operator gets the same clear message as a missing group claim instead of a
 * silently stuck "Closed" socket. Kept in the `app/auth` seam (not in the WS
 * hook) so the gate component can subscribe without importing the hook.
 */

let denied = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

/** Called by `useWS` when a connection is denied / recovers. */
export const setWsAuthDenied = (value: boolean): void => {
  if (denied === value) return;
  denied = value;
  emit();
};

/** Reactive read of the denied flag for the gate. */
export const useWsAuthDenied = (): boolean =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => denied,
    () => denied,
  );
