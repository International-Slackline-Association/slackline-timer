import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

// ADR 0048 in enforced form: environment-specific AWS identifiers belong in
// configuration, never in the tree. Comments alone did not hold that line, so
// this walks every *tracked* file (`git ls-files`, which puts ignored artefacts
// and node_modules out of scope by construction) and fails on any literal that
// identifies a specific deployment — the shape the ADR 0025 secrets guard uses,
// because a rule only survives if reinstating the old form turns a suite red.
//
// The patterns match the *id-bearing* forms only, so prose about `execute-api`
// or `cloudfront.net` stays legal and a hit means a real id is present.
const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  {
    pattern: /\b[a-z0-9]{10}\.execute-api\.[a-z0-9-]+\.amazonaws\.com/g,
    what: 'an API Gateway endpoint (comes from the HttpApiUrl / WebsocketUrl stack output)',
  },
  {
    pattern: /\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]{9}\b/g,
    what: 'a Cognito user pool id (comes from COGNITO_USER_POOL_ID in .env.deploy)',
  },
  {
    pattern: /\bE[A-Z0-9]{12}\b/g,
    what: 'a CloudFront distribution id (comes from the WebDistributionId stack output)',
  },
  {
    pattern: /\b[a-z0-9]{13,14}\.cloudfront\.net\b/g,
    what: 'a CloudFront distribution domain (comes from the WebUrl / PhotoCdnDomain stack output)',
  },
];

// The decommission ledger is the one place a retired physical name is the
// point: it records what `cdk destroy` leaves behind so a later teardown can
// find it.
const ALLOWED = new Set(['server/scripts/decommission/stacks.json']);

// `.env.deploy` keys whose values are generic tokens rather than deployment
// identity — see the oracle test below for why they are exempt.
const GENERIC_CONFIG = new Set(['COGNITO_REGION', 'COGNITO_TIMER_GROUP']);

// Text formats only. Lockfiles are excluded for speed — generated, and a
// registry tarball URL cannot carry a deployment identifier.
const SCANNED = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.html',
  '.sh',
  '.example',
]);

const repoRoot = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const trackedFiles = (): string[] =>
  execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

describe('committed source carries no deployment identifiers', () => {
  it('has no hardcoded AWS endpoint, pool or distribution literal', () => {
    const offences: string[] = [];

    for (const file of trackedFiles()) {
      if (ALLOWED.has(file)) continue;
      if (file.endsWith('package-lock.json')) continue;
      if (file.endsWith('no-committed-endpoints.test.ts')) continue;
      if (!SCANNED.has(extname(file))) continue;

      const text = readFileSync(join(repoRoot, file), 'utf8');
      for (const { pattern, what } of FORBIDDEN) {
        for (const match of text.matchAll(pattern)) {
          const line = text.slice(0, match.index).split('\n').length;
          offences.push(`${file}:${line} — ${match[0]} is ${what}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  // No pattern separates an app client id (an opaque lowercase blob) or a
  // Hosted-UI domain (an ordinary hostname) from legitimate content, and
  // hardcoding them here would commit the values the rule exists to keep out.
  // So where an operator's real config exists, use it as the oracle: nothing
  // `.env.deploy` sets may appear in a tracked file — covering the client id,
  // the Hosted-UI domain, the account id and the profile name at once. CI has
  // no `.env.deploy`, so this is a developer-machine check; the shape rules
  // above are what gate the PR.
  it('leaks no value from a local .env.deploy into the tree', () => {
    let env: string;
    try {
      env = readFileSync(join(repoRoot, '.env.deploy'), 'utf8');
    } catch {
      return; // No operator config on this machine — nothing to check against.
    }

    const configured = env
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [
        line.slice(0, line.indexOf('=')).trim(),
        line.slice(line.indexOf('=') + 1).trim(),
      ])
      // A region and a group name are vocabulary this repo must use in prose,
      // CI and code — matching on them reports the documentation, not a leak.
      // The identity is what may never appear: account, pool, client,
      // Hosted-UI host, operator profile.
      .filter(([key]) => !GENERIC_CONFIG.has(key))
      .filter(([, value]) => value.length >= 8);

    const offences: string[] = [];
    for (const file of trackedFiles()) {
      if (file.endsWith('package-lock.json')) continue;
      if (!SCANNED.has(extname(file))) continue;

      const text = readFileSync(join(repoRoot, file), 'utf8');
      for (const [key, value] of configured) {
        // Report the key, never the value: this message reaches terminals and
        // CI logs.
        if (text.includes(value)) offences.push(`${file} contains the value of ${key}`);
      }
    }

    expect(offences).toEqual([]);
  });

  it('scans a meaningful number of files', () => {
    // Guards the guard: a broken `git ls-files` or a wrong repo root would make
    // the rule above pass by scanning nothing at all.
    const scanned = trackedFiles().filter((f) => SCANNED.has(extname(f)));
    expect(scanned.length).toBeGreaterThan(100);
  });
});
