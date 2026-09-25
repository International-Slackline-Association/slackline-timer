import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Cognito path is exercised via this mock; the LOCAL_DEV path never
// touches Amplify.
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'cognito-id-token' } },
  }),
}));

const fetchMock = vi.fn();

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Re-import the client with a chosen env (constants are read at module load). */
const loadClient = async (env: Record<string, string>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return import('app/api/client');
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('apiFetch', () => {
  it('fails fast when no API URL is configured', async () => {
    // HTTP_API_URL now defaults to the deployed eu-central-2 URL, so exercise the
    // guard via an explicit blank override ('' is kept by ??, unlike undefined).
    const { apiFetch, ApiError } = await loadClient({ VITE_APP_API_URL: '' });
    await expect(apiFetch('/competitions')).rejects.toThrow(ApiError);
    await expect(apiFetch('/competitions')).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the dummy token in LOCAL_DEV and parses the JSON response', async () => {
    const { apiFetch } = await loadClient({
      VITE_APP_API_URL: 'http://localhost:3002',
      VITE_APP_LOCAL_DEV: 'true',
    });
    fetchMock.mockResolvedValue(jsonResponse(200, [{ compId: 'c1' }]));

    const result = await apiFetch('/competitions');

    expect(result).toEqual([{ compId: 'c1' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3002/competitions');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('local-dev');
  });

  it('uses the Cognito IdToken when signed in', async () => {
    const { apiFetch } = await loadClient({ VITE_APP_API_URL: 'https://api.example.com' });
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/competitions');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('cognito-id-token');
  });

  it('prefers an explicit read token (overlay pages)', async () => {
    const { apiFetch } = await loadClient({ VITE_APP_API_URL: 'https://api.example.com' });
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/competitions/c1/athletes', { readToken: 'event-read-token' });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('event-read-token');
  });

  it('serializes bodies and sets the content type', async () => {
    const { apiFetch } = await loadClient({
      VITE_APP_API_URL: 'http://localhost:3002',
      VITE_APP_LOCAL_DEV: 'true',
    });
    fetchMock.mockResolvedValue(jsonResponse(201, { athleteId: 'a1' }));

    await apiFetch('/competitions/c1/athletes', { method: 'POST', body: { name: 'Jane' } });

    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ name: 'Jane' });
  });

  it('maps non-2xx to ApiError with the server message and details', async () => {
    const { apiFetch, ApiError } = await loadClient({
      VITE_APP_API_URL: 'http://localhost:3002',
      VITE_APP_LOCAL_DEV: 'true',
    });
    fetchMock.mockResolvedValue(
      jsonResponse(400, { message: 'invalid athlete', details: ['name is required'] }),
    );

    const failure = apiFetch('/competitions/c1/athletes', { method: 'POST', body: {} });
    await expect(failure).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'invalid athlete',
      details: ['name is required'],
    });
    expect(new ApiError(400, 'x')).toBeInstanceOf(ApiError);
  });

  it('returns undefined for 204 responses', async () => {
    const { apiFetch } = await loadClient({
      VITE_APP_API_URL: 'http://localhost:3002',
      VITE_APP_LOCAL_DEV: 'true',
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiFetch('/competitions/c1/athletes/a1', { method: 'DELETE' })).resolves.toBe(
      undefined,
    );
  });
});
