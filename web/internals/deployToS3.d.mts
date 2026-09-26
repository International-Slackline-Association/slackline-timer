// Hand-written declarations for deployToS3.mjs — see stackOutputs.d.mts for why
// the module stays plain ESM. Only the guards the test suite pins are declared;
// the rest of the script is the CLI entrypoint and is not imported anywhere.

export declare function assertBucketIsOurs(
  bucket: string,
  opts: {
    profile?: string;
    region?: string;
    account: string;
    run?: (args: string[], opts?: { profile?: string; region?: string }) => string;
  },
): void;
