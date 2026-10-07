import { describe, expect, it } from 'vitest';

import { safe, safeQuoted } from 'core/logSafe';

describe('safe', () => {
  it('replaces non-printable characters so a value cannot start a new log line', () => {
    expect(safe('a\nkey=999\r\tb')).toBe('a?key=999??b');
    expect(safe('café')).toBe('caf?');
  });

  it('truncates to the cap', () => {
    expect(safe('x'.repeat(100))).toHaveLength(64);
    expect(safe('x'.repeat(100), 10)).toBe('x'.repeat(10));
  });

  it('stringifies non-strings', () => {
    expect(safe(42)).toBe('42');
    expect(safe(undefined)).toBe('undefined');
  });
});

describe('safeQuoted', () => {
  it('keeps spaces but cannot close the surrounding quotes', () => {
    expect(safeQuoted('Mozilla/5.0 (X11) "x" y')).toBe("Mozilla/5.0 (X11) 'x' y");
  });

  it('truncates to 256 by default', () => {
    expect(safeQuoted('u'.repeat(10_000))).toHaveLength(256);
  });
});
