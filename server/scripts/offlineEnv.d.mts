// Hand-written declarations for offlineEnv.mjs — the module stays plain ESM (the
// dev scripts and harnesses are node scripts) while the TS test suite still
// typechecks against it.

export declare const OFFLINE_ENV: Record<string, string>;

export declare const applyOfflineEnv: () => void;
