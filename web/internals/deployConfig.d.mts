// Hand-written declarations for deployConfig.mjs — see stackOutputs.d.mts.

export declare function loadDeployEnv(): void;

export declare function liveStack(
  role: 'backend' | 'web',
  ledgerPath?: string,
): { name: string; region: string };

export declare const BUILD_VARS: { name: string; source: 'stack' | 'env'; key: string }[];

export declare const BACKEND_OUTPUTS: string[];

export declare function buildEnv(opts?: {
  outputs?: Record<string, string | undefined>;
  env?: Record<string, string | undefined>;
  stack?: { name?: string; region?: string };
}): Record<string, string>;
