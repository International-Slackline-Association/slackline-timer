// Hand-written declarations for seedPreflight.mjs — the module stays plain ESM
// so external e2e tooling can import it directly, while the TS test suite still
// typechecks against it.

export declare const LOCAL_TABLES: string[];

export declare const isLocalApi: (api: string | undefined) => boolean;

export declare const missingLocalTables: (opts?: {
  endpoint?: string;
  tables?: string[];
}) => Promise<string[]>;

export declare const seedTableHint: (opts?: {
  api?: string;
  endpoint?: string;
  tables?: string[];
}) => Promise<string | null>;
