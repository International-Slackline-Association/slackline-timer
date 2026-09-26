import { getBaseToken } from 'app/auth';
import { HTTP_API_URL } from 'app/constants';

/**
 * Typed fetch client for the competition-data HTTP API.
 *
 * Credentials, in priority order:
 *  1. an explicit event read token (the `?token=` from a /stream/* overlay
 *     URL) — sent as the Authorization header;
 *  2. the baseline credential from the `app/auth` seam — the Cognito IdToken
 *     in production, a dummy token in local dev (this client never branches on
 *     the environment itself).
 *
 * The server's authorizer accepts both credential types on the same header.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const resolveToken = async (readToken?: string): Promise<string> => {
  if (readToken) return readToken;
  const token = await getBaseToken();
  if (!token) {
    throw new ApiError(401, 'not signed in');
  }
  return token;
};

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Event read token for /stream/* overlay pages (instead of a Cognito session). */
  readToken?: string;
  signal?: AbortSignal;
}

/**
 * Perform an API request. `path` is appended to HTTP_API_URL (e.g.
 * `/competitions/worlds-2026/athletes`). Throws ApiError on non-2xx, carrying
 * the server's message + validation details.
 */
export const apiFetch = async <T>(path: string, options: ApiRequestOptions = {}): Promise<T> => {
  const token = await resolveToken(options.readToken);
  const response = await fetch(`${HTTP_API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: token,
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: options.signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? safeJson(text) : undefined;

  if (!response.ok) {
    const message =
      (data as { message?: string } | undefined)?.message ?? `request failed (${response.status})`;
    const details = (data as { details?: string[] } | undefined)?.details;
    throw new ApiError(response.status, message, details);
  }

  return data as T;
};

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
