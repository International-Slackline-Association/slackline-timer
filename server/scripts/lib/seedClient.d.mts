// Hand-written declarations for the seedClient.mjs exports the TS test suite
// uses — the module stays plain ESM so the seed scripts can import it directly.

export type SeedCall = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: unknown }>;

export declare const MAX_PHOTO_BYTES: number;

export declare const uploadPhoto: (
  call: SeedCall,
  compId: string,
  filePath: string,
) => Promise<string>;

export declare const makeCall: (opts: {
  api: string;
  token: string;
  retryDelayMs?: number;
  maxRetries?: number;
}) => SeedCall;
