// Hand-written declarations for stackOutputs.mjs — the module stays plain ESM
// (the deploy entrypoint is a node script, not a bundled TS source) while the
// test suite still typechecks against it.

export declare function runAws(
  args: string[],
  opts?: { profile?: string; region?: string },
): string;

export declare function stackOutputs(
  stackName: string,
  opts?: {
    region?: string;
    profile?: string;
    run?: (args: string[], opts?: { profile?: string; region?: string }) => string;
  },
): Record<string, string>;

export declare function requireOutputs(
  outputs: Record<string, string>,
  names: string[],
  opts?: { stackName?: string; region?: string },
): Record<string, string>;
