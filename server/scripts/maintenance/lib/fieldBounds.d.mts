// Hand-written declarations for fieldBounds.mjs — the module stays plain ESM so
// auditFieldBounds.mjs imports it directly, while the TS test suite still
// typechecks against it (same arrangement as scripts/lib/finalResults.mjs).

export declare const BOUNDS: {
  competitionName: number;
  breakMs: { min: number; max: number };
  firstName: number;
  lastName: number;
  legacyName: number;
  shortName: number;
  birthYear: { min: number };
  notes: number;
  timeMs: { min: number; max: number };
  startTimeSkewMs: number;
  roundName: number;
  position: { min: number; max: number };
  controlPenaltyMax: number;
  overallMin: number;
  athletesPerComp: number;
};

export declare const ID_RE: RegExp;
export declare const COUNTRY_RE: RegExp;
export declare const PHOTO_KEY_RE: RegExp;

export type StoredItem = Record<string, unknown> & { PK?: unknown; SK?: unknown };

export interface Violation {
  rule: string;
  detail: string;
}

export interface Example {
  PK: string;
  SK: string;
  detail: string;
}

export interface CompetitionReport {
  items: number;
  athletes: number;
  violations: Record<string, { count: number; examples: Example[] }>;
}

export interface AuditReport {
  scanned: number;
  skipped: number;
  violationCount: number;
  competitions: Record<string, CompetitionReport>;
  failingCountries: string[];
  foreignPhotoPrefixes: Record<string, number>;
}

export declare function evaluateItem(item: StoredItem, opts: { now: number }): Violation[];

export declare function auditItems(
  items: StoredItem[],
  opts: { now: number; maxExamples?: number },
): AuditReport;
