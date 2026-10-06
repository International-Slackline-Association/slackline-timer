// Hand-written declarations for harnessGuard.mjs — the module stays plain ESM
// (the harnesses are node scripts) while the TS test suite still typechecks
// against it.

export declare const LOOPBACK_HOST: string;
export declare const DEV_ORIGINS: string[];

export declare const harnessGuard: (
  port: number,
  env?: Record<string, string | undefined>,
) => {
  bindHost: string;
  isAllowedHost: (host: string | undefined) => boolean;
  isAllowedOrigin: (origin: string | undefined) => boolean;
};
