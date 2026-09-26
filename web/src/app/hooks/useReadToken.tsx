import { useLocation } from 'react-router-dom';

/**
 * The event read token from a `/stream/*` overlay URL's `?token=` param, or
 * undefined on the admin/operator pages. Overlay pages pass it to `apiFetch`
 * (read hooks) and `useWS` so they authenticate without a Cognito session.
 */
export const useReadToken = (): string | undefined => {
  const { search } = useLocation();
  return new URLSearchParams(search).get('token') ?? undefined;
};
