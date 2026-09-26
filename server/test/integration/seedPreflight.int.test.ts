import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { isLocalApi, missingLocalTables, seedTableHint } from '../../scripts/lib/seedPreflight.mjs';

import { ensureTables, isDynamoReachable } from './helpers';

/**
 * Guards the seed table-existence preflight (scripts/lib/seedPreflight.mjs):
 * a LocalStack container recreated without `npm run db:init` comes up with NO
 * tables, so every seed write 500s while the harness itself answers fine — the
 * generic "is the backend up?" hint then misleads. The preflight names the
 * missing table and points at `npm run db:init` instead. The pure describe
 * needs no container; the DescribeTable describe self-skips like the other
 * *.int.test.ts suites (see helpers.ts).
 */

const reachable = isDynamoReachable();
const LOCAL_API = 'http://127.0.0.1:3002';

describe('seedPreflight (pure)', () => {
  it('recognizes local harness API bases only', () => {
    expect(isLocalApi('http://127.0.0.1:3002')).toBe(true);
    expect(isLocalApi('http://localhost:3002/competitions')).toBe(true);
    // Synthetic: a real api id is barred from the tree (test/repo/), and shape
    // is all that matters — an execute-api host is never the local harness.
    expect(isLocalApi('https://timer-api.execute-api.eu-central-2.amazonaws.com/prod')).toBe(false);
    expect(isLocalApi(undefined)).toBe(false);
    expect(isLocalApi('not a url')).toBe(false);
  });

  it('returns no hint for a remote API (preflight not applicable, no network touched)', async () => {
    await expect(seedTableHint({ api: 'https://api.example.com/prod' })).resolves.toBeNull();
  });

  it('returns no hint when the local DynamoDB is unreachable (a different failure)', async () => {
    // The caller's own "is the backend up?" message covers a down container;
    // the preflight must not masquerade that as a missing-table diagnosis.
    await expect(
      seedTableHint({ api: LOCAL_API, endpoint: 'http://127.0.0.1:1' }),
    ).resolves.toBeNull();
  });
});

describe('seed writers reuse the shared preflight', () => {
  // Both seed writers must delegate local-target detection + the table-existence
  // hint to seedPreflight.mjs — a hand-rolled `127.0.0.1` regex would drift and
  // reintroduce the opaque "seed failed" cascade this preflight exists to fix.
  it.each(['seedRemote.mjs', 'seedLocal.mjs'])('%s imports the shared helper', async (script) => {
    const src = await readFile(new URL(`../../scripts/${script}`, import.meta.url), 'utf8');
    expect(src).toMatch(/from '\.\/lib\/seedPreflight\.mjs'/);
    expect(src).toContain('seedTableHint');
    // No hand-rolled local-detection regex assigned to isLocal — the shared
    // isLocalApi is the one check (a bespoke regex is exactly what drifted).
    expect(src).not.toMatch(/isLocal\s*=\s*\//);
  });

  // A seeder writes real competition data, and the --yes / AUTH_TOKEN guards
  // only bite on a NON-local API — so an API_URL defaulting to a deployed stage
  // inverts them by making the dangerous target the free one.
  it.each(['seedRemote.mjs', 'seedLocal.mjs'])('%s defaults to the local harness', async (s) => {
    const src = await readFile(new URL(`../../scripts/${s}`, import.meta.url), 'utf8');
    const fallback = src.match(/process\.env\.API_URL\s*\?\?\s*([A-Z_]+|'[^']*')/)?.[1];
    if (!fallback) throw new Error(`${s} does not fall back to a fixed API_URL`);
    const api = fallback.startsWith("'")
      ? fallback.slice(1, -1)
      : src.match(new RegExp(`const ${fallback} = '([^']*)'`))?.[1];
    expect(isLocalApi(api)).toBe(true);
  });
});

describe.skipIf(!reachable)('seedPreflight (against the local DynamoDB)', () => {
  it('reports no missing tables once db:init has run', async () => {
    await ensureTables();
    await expect(missingLocalTables()).resolves.toEqual([]);
    await expect(seedTableHint({ api: LOCAL_API })).resolves.toBeNull();
  });

  it('names the missing table and points at `npm run db:init`', async () => {
    const bogus = `preflight-missing-${Date.now()}`;
    await expect(missingLocalTables({ tables: [bogus] })).resolves.toEqual([bogus]);

    const hint = await seedTableHint({ api: LOCAL_API, tables: [bogus] });
    expect(hint).toContain(bogus);
    expect(hint).toContain('npm run db:init');
  });
});
