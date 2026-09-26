// Hand-written declarations for cognitoCommon.mjs. Only the surface the TS test
// suite consumes is declared — the rest is imported by .mjs scripts, which need
// no types (same arrangement as lib/seedPreflight.d.mts).

export declare function requireConfig<T extends Record<string, unknown>>(
  opts: T,
  ...keys: string[]
): T;
