import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCsp } from '../../../internals/csp.mjs';

import { createH2rPusher, pushToH2r, resolveH2rTarget } from 'app/util/h2rClient';
import type { H2rPost } from 'app/util/h2rBridge';

const posts: H2rPost[] = [
  { kind: 'text', path: '/updateVariableText/name_1', body: { text: 'Jane Doe' } },
  { kind: 'data', path: '/data/photo_1', body: [] },
];

const textPost = (text: string): H2rPost[] => [
  { kind: 'text', path: '/updateVariableText/name_1', body: { text } },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ACCEPTED: [string, string][] = [
  ['http://127.0.0.1:4001', 'http://127.0.0.1:4001'],
  ['http://127.0.0.1:4001/', 'http://127.0.0.1:4001'],
  ['http://localhost:5000', 'http://localhost:5000'],
  ['HTTP://LOCALHOST:4001', 'http://localhost:4001'],
  ['http://127.0.0.1', 'http://127.0.0.1'],
];

/** The connect-src sources of a CSP built from any valid deploy config. */
const connectSources = (): string[] => {
  const policy = buildCsp({
    VITE_APP_API_URL: 'https://api.example/prod',
    VITE_APP_WS_URL: 'wss://ws.example/prod',
    VITE_APP_COGNITO_DOMAIN: 'auth.example.com',
    VITE_APP_COGNITO_USER_POOL_ID: 'eu-central-1_Example',
    WEB_CSP_PHOTO_CDN_DOMAIN: 'd111.cloudfront.net',
    WEB_CSP_PHOTO_UPLOAD_ORIGIN: 'https://photos.s3.eu-central-2.amazonaws.com',
  });
  const directive = policy.split('; ').find((d) => d.startsWith('connect-src '));
  return directive?.split(' ').slice(1) ?? [];
};

/** CSP host-source match, limited to the `scheme://host:*` shape the loopback sources use. */
const cspAllows = (sources: string[], origin: string): boolean => {
  const { protocol, hostname } = new URL(origin);
  return sources.includes(`${protocol}//${hostname}:*`);
};

describe('resolveH2rTarget', () => {
  it.each(ACCEPTED)('accepts the loopback target %s as %s', (raw, origin) => {
    expect(resolveH2rTarget(raw)).toEqual({ origin });
  });

  it.each(ACCEPTED)('accepts %s only because the CSP connect-src admits it', (raw) => {
    const target = resolveH2rTarget(raw);
    expect('origin' in target && cspAllows(connectSources(), target.origin)).toBe(true);
  });

  it.each([
    'https://localhost:4443',
    'https://127.0.0.1:4001',
    'http://[::1]:4001',
    'http://192.168.1.20:4001',
    'http://10.0.0.5:4001',
    'http://h2r.local:4001',
    'https://evil.example',
    'http://127.0.0.1.evil.example:4001',
    'http://localhost.evil.example',
    'ftp://127.0.0.1:4001',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://user:pw@127.0.0.1:4001',
    'http://127.0.0.1:4001/updateVariableText',
    'http://127.0.0.1:4001?x=1',
    'http://127.0.0.1:4001#frag',
    '127.0.0.1:4001',
    'not a url',
  ])('refuses %s', (raw) => {
    expect(resolveH2rTarget(raw)).toEqual({ error: expect.any(String) });
  });
});

describe('pushToH2r', () => {
  it('POSTs each descriptor as JSON to the target base, joining base + path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushToH2r('http://127.0.0.1:4001', posts);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4001/updateVariableText/name_1',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Jane Doe' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4001/data/photo_1',
      expect.objectContaining({ method: 'POST', body: JSON.stringify([]) }),
    );
  });

  it('swallows a failed POST so one dead slot never blocks the rest', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(pushToH2r('http://127.0.0.1:4001', posts)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/** A fetch whose calls settle only when the test says so (or on abort, as the real one does). */
const deferredFetch = () => {
  const calls: { text: string; resolve: () => void }[] = [];
  const fetchMock = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const text = (JSON.parse(init.body as string) as { text: string }).text;
        calls.push({ text, resolve: () => resolve({ ok: true } as Response) });
        init.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
};

describe('createH2rPusher', () => {
  it('keeps one push in flight and sends only the latest queued one next', async () => {
    const { calls } = deferredFetch();
    const pusher = createH2rPusher('http://127.0.0.1:4001');

    pusher.push(textPost('A'));
    pusher.push(textPost('B'));
    pusher.push(textPost('C'));
    expect(calls.map((c) => c.text)).toEqual(['A']);

    calls[0].resolve();
    await vi.waitFor(() => expect(calls.map((c) => c.text)).toEqual(['A', 'C']));
    calls[1].resolve();
    await Promise.resolve();
    expect(calls.map((c) => c.text)).toEqual(['A', 'C']);
  });

  it('aborts a hung push after the timeout so the chain moves on', async () => {
    vi.useFakeTimers();
    const { calls } = deferredFetch();
    const pusher = createH2rPusher('http://127.0.0.1:4001');

    pusher.push(textPost('A'));
    pusher.push(textPost('B'));
    await vi.advanceTimersByTimeAsync(3_000);

    expect(calls.map((c) => c.text)).toEqual(['A', 'B']);
  });

  it('drops the queue and aborts the in-flight push on dispose', async () => {
    const { calls, fetchMock } = deferredFetch();
    const pusher = createH2rPusher('http://127.0.0.1:4001');

    pusher.push(textPost('A'));
    pusher.push(textPost('B'));
    pusher.dispose();
    pusher.push(textPost('C'));
    await vi.waitFor(() =>
      expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true),
    );
    await Promise.resolve();

    expect(calls.map((c) => c.text)).toEqual(['A']);
  });
});
