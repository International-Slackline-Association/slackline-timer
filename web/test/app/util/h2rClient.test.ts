import { afterEach, describe, expect, it, vi } from 'vitest';

import { pushToH2r } from 'app/util/h2rClient';
import type { H2rPost } from 'app/util/h2rBridge';

const posts: H2rPost[] = [
  { kind: 'text', path: '/updateVariableText/name_1', body: { text: 'Jane Doe' } },
  { kind: 'data', path: '/data/photo_1', body: [] },
];

afterEach(() => {
  vi.restoreAllMocks();
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

  it('trims a trailing slash on the target so the path is not doubled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushToH2r('http://127.0.0.1:4001/', [posts[0]]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4001/updateVariableText/name_1',
      expect.anything(),
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
