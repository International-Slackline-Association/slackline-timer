import { describe, expect, it } from 'vitest';

import { harnessGuard } from '../../scripts/lib/harnessGuard.mjs';

/**
 * Guards the local harnesses' network allowlists (scripts/lib/harnessGuard.mjs).
 * The offline authorizers take `local-dev` as an operator, so these checks are
 * all that stands between a hostile web page and the developer's local data.
 */

describe('harnessGuard', () => {
  it('binds loopback unless HARNESS_HOST opts in', () => {
    expect(harnessGuard(3002, {}).bindHost).toBe('127.0.0.1');
    expect(harnessGuard(3002, { HARNESS_HOST: '192.168.1.20' }).bindHost).toBe('192.168.1.20');
  });

  it('accepts only loopback Host headers on its own port (DNS rebinding)', () => {
    const { isAllowedHost } = harnessGuard(3002, {});
    expect(isAllowedHost('127.0.0.1:3002')).toBe(true);
    expect(isAllowedHost('LOCALHOST:3002')).toBe(true);
    expect(isAllowedHost('localhost:3001')).toBe(false);
    expect(isAllowedHost('attacker.example:3002')).toBe(false);
    expect(isAllowedHost('192.168.1.20:3002')).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
  });

  it('adds HARNESS_HOST to the Host allowlist, bracketing IPv6', () => {
    expect(
      harnessGuard(3002, { HARNESS_HOST: '192.168.1.20' }).isAllowedHost('192.168.1.20:3002'),
    ).toBe(true);
    expect(harnessGuard(3001, { HARNESS_HOST: 'fe80::1' }).isAllowedHost('[fe80::1]:3001')).toBe(
      true,
    );
  });

  it('allows the Vite dev origins plus HARNESS_ALLOWED_ORIGINS, nothing else', () => {
    const { isAllowedOrigin } = harnessGuard(3002, {
      HARNESS_ALLOWED_ORIGINS: ' http://192.168.1.20:5173 ,https://lan.test ',
    });
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('http://192.168.1.20:5173')).toBe(true);
    expect(isAllowedOrigin('https://lan.test')).toBe(true);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('null')).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });
});
