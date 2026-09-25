// The stack ledger (../decommission/stacks.json) reader — the single source of
// truth the commission / decommission / verify scripts share.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LEDGER_PATH = fileURLToPath(new URL('../decommission/stacks.json', import.meta.url));

/** Parse and return the whole ledger object (has `.stacks`). */
export function loadLedger() {
  let raw;
  try {
    raw = readFileSync(LEDGER_PATH, 'utf8');
  } catch {
    throw new Error(`ledger not found: ${LEDGER_PATH}`);
  }
  return JSON.parse(raw);
}

/**
 * Find the `stacks[]` entry with the given `name`. Throws (with `context` in the
 * message, e.g. 'commissioning'/'decommissioning') when there is no such entry.
 */
export function resolveEntry(name, context) {
  const entry = loadLedger().stacks.find((s) => s.name === name);
  if (!entry) {
    const suffix = context ? ` — add it before ${context}.` : '';
    throw new Error(`no stacks[] entry named '${name}' in stacks.json${suffix}`);
  }
  return entry;
}
