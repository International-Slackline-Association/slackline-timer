import { describe, expect, it } from 'vitest';

import { isValidOperatorSessionId } from 'core/operatorSession';

describe('isValidOperatorSessionId', () => {
  it('rejects the "default" fallback session', () => {
    expect(isValidOperatorSessionId('default')).toBe(false);
  });

  it('rejects an empty session id', () => {
    expect(isValidOperatorSessionId('')).toBe(false);
  });

  it('rejects a missing (undefined) session id', () => {
    expect(isValidOperatorSessionId(undefined)).toBe(false);
  });

  it('accepts a real competition id', () => {
    expect(isValidOperatorSessionId('worlds-2026')).toBe(true);
  });
});
