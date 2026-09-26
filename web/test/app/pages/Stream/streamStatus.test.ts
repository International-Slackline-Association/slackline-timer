import { describe, expect, it } from 'vitest';

import { deriveStreamStatus, streamStatusFromQueries } from 'app/pages/Stream/streamStatus';

describe('deriveStreamStatus', () => {
  it('reports loading while in flight, regardless of the other flags', () => {
    expect(deriveStreamStatus(true, false, false)).toBe('loading');
    expect(deriveStreamStatus(true, true, true)).toBe('loading');
  });

  it('reports error once resolved with a failure', () => {
    expect(deriveStreamStatus(false, true, false)).toBe('error');
    expect(deriveStreamStatus(false, true, true)).toBe('error');
  });

  it('reports empty when resolved without error but rowless', () => {
    expect(deriveStreamStatus(false, false, true)).toBe('empty');
  });

  it('reports ready when resolved with content', () => {
    expect(deriveStreamStatus(false, false, false)).toBe('ready');
  });

  it('orders precedence loading > error > empty > ready', () => {
    // loading wins over error
    expect(deriveStreamStatus(true, true, false)).toBe('loading');
    // error wins over empty
    expect(deriveStreamStatus(false, true, true)).toBe('error');
  });
});

describe('streamStatusFromQueries', () => {
  const q = (isLoading: boolean, isError: boolean) => ({ isLoading, isError });

  it('is loading/error when any constituent query is', () => {
    expect(streamStatusFromQueries([q(false, false), q(true, false)], false)).toBe('loading');
    expect(streamStatusFromQueries([q(false, false), q(false, true)], false)).toBe('error');
  });

  it('keeps the loading > error > empty precedence across queries', () => {
    expect(streamStatusFromQueries([q(true, false), q(false, true)], true)).toBe('loading');
    expect(streamStatusFromQueries([q(false, true), q(false, false)], true)).toBe('error');
    expect(streamStatusFromQueries([q(false, false), q(false, false)], true)).toBe('empty');
  });

  it('is ready only when every query resolved cleanly and content exists', () => {
    expect(streamStatusFromQueries([q(false, false), q(false, false)], false)).toBe('ready');
  });
});
