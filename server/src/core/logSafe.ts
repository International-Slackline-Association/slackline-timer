/**
 * Log-field sanitising for client-supplied values. Every non-printable char
 * becomes `?`, so a value can never start a new CloudWatch line or forge the
 * `key=` / `delivered=` fields the Logs Insights incident joins parse; the cap
 * bounds the ingest a single field can cost.
 */
export const safe = (value: unknown, max = 64): string =>
  String(value)
    .slice(0, max)
    .replace(/[^\x20-\x7e]/g, '?');

/** For a field logged inside `"…"` (the user-agent): spaces kept, `"` cannot close it. */
export const safeQuoted = (value: unknown, max = 256): string =>
  safe(value, max).replace(/"/g, "'");
