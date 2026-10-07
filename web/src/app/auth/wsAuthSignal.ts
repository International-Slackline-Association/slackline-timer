import { useSyncExternalStore } from 'react';

/**
 * Cross-component signal for "the WebSocket `$connect` authorizer rejected us"
 * (HTTP 401 → the socket closes during the handshake and never reaches OPEN).
 * The browser learns of a denied session only from that failed connection: a
 * cached IdToken can look valid past its ~1h lifetime, and a manager may hold
 * no grant on the opened competition (ADR 0045).
 *
 * `useWS` reports the verdict here; `RequireSignedIn` turns it into a clear
 * message instead of a silently stuck "Closed" socket. Lives in the `app/auth`
 * seam so the gate can subscribe without importing the WS hook.
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
