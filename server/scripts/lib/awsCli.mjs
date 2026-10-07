// Shared CLI glue for the commission/decommission/maintenance scripts: AWS CLI v2
// / CDK CLI shell-outs (auth prerequisite: each script's README), plus
// loadProfileCreds for the scripts that use the SDK.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The ignored repo-root `.env.deploy` (template: `.env.deploy.example`); every
// script here imports this module. An exported var still wins (loadEnvFile does
// not overwrite); an absent file is fine.
const DEPLOY_ENV = fileURLToPath(new URL('../../../.env.deploy', import.meta.url));
if (existsSync(DEPLOY_ENV)) process.loadEnvFile(DEPLOY_ENV);

/**
 * Parse argv into `{ ...defaults, _: [positionals] }`. Flags are `--kebab-case`;
 * a flag whose next argv token is another flag (or missing) is treated as a
 * boolean `true` (so `--what-if` needs no value), otherwise it consumes the next
 * token as its value. `--help`/`-h` set `opts.help`. Kebab keys are also exposed
 * camelCased (e.g. `--what-if` → both `opts['what-if']` and `opts.whatIf`).
 */
export function parseArgs(argv, defaults = {}) {
  const opts = { ...defaults, _: [] };
  const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      let value;
      if (next === undefined || next.startsWith('--')) {
        value = true;
      } else {
        value = next;
        i += 1;
      }
      opts[key] = value;
      const c = camel(key);
      if (c !== key) opts[c] = value;
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

const AWS_ENV = {
  ...process.env,
  // Make the CLI's Python emit UTF-8 so non-ASCII names don't crash its stdout
  // encoder (the old Windows cp1252 charmap error).
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
};

/**
 * Run `aws <args>` with the given profile/region, returning stdout. Throws with
 * the CLI's stderr on a non-zero exit (usually an expired SSO session).
 */
export function runAws(args, { profile, region } = {}) {
  const full = [...args];
  if (region) full.push('--region', region);
  if (profile) full.push('--profile', profile);
  try {
    return execFileSync('aws', full, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      env: AWS_ENV,
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('`aws` CLI not found on PATH — install AWS CLI v2 (see README.md).', {
        cause: err,
      });
    }
    const stderr = err.stderr?.toString?.().trim();
    throw new Error(stderr || err.message, { cause: err });
  }
}

/**
 * Like runAws but never throws on a non-zero exit — returns `{ ok, stdout }`.
 * For existence probes (describe-table / head-bucket / get-parameter /
 * get-distribution): a 404 must NOT abort the sweep, it just means
 * "already gone / doesn't exist".
 */
export function tryAws(args, { profile, region } = {}) {
  const full = [...args];
  if (region) full.push('--region', region);
  if (profile) full.push('--profile', profile);
  try {
    const stdout = execFileSync('aws', full, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      env: AWS_ENV,
      stdio: ['ignore', 'pipe', 'ignore'], // swallow stderr
    });
    return { ok: true, stdout };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('`aws` CLI not found on PATH — install AWS CLI v2 (see README.md).', {
        cause: err,
      });
    }
    return { ok: false, stdout: err.stdout?.toString?.() ?? '' };
  }
}

/**
 * Resolve the effective AWS profile: explicit `--profile` → $AWS_PROFILE → the
 * AWS CLI default. Returns `undefined` when nothing is set so callers omit
 * `--profile` and let the CLI's own default credential resolution apply.
 */
export function resolveProfile(opts = {}) {
  return opts.profile || process.env.AWS_PROFILE || undefined;
}

/**
 * Resolve the AWS account the stacks live in: explicit `--account` → the
 * `.env.deploy` (or exported) $AWS_ACCOUNT_ID, else throw. Never probed from STS:
 * callers use it to *name* an environment (`aws://<account>/<region>`), and
 * adopting whatever the ambient credentials resolve to would target the wrong
 * account.
 */
export function resolveAccount(opts = {}) {
  const account = opts.account || process.env.AWS_ACCOUNT_ID;
  if (!account) {
    throw new Error(
      'AWS account id not set — put AWS_ACCOUNT_ID in the repo-root `.env.deploy` ' +
        '(template: .env.deploy.example) or pass --account <id>.',
    );
  }
  return account;
}

/**
 * Materialize concrete temporary credentials for `profile` into the env.
 *
 * The SDK's default chain does not reliably refresh the SSO role creds:
 * `--profile` alone fails "security token included in the request is invalid"
 * right after `aws sso login`, while the CLI succeeds. `export-credentials` does
 * refresh, and its keys land in `process.env` for the SDK's fromEnv provider
 * (first in the chain). Same workaround as the CDK deploys: doc/dev/deploy.md §8.
 *
 * `env-no-export` emits bare `AWS_*=value` lines (no `export`, no quotes); values
 * can contain `=` and `/` (the session token), so split on the FIRST `=` only.
 * AWS_PROFILE is then cleared so the concrete env creds win outright and nothing
 * re-triggers the failing SSO role-assume.
 */
export function loadProfileCreds(profile) {
  const out = runAws(['configure', 'export-credentials', '--format', 'env-no-export'], { profile });
  for (const line of out.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0 && line.startsWith('AWS_')) {
      process.env[line.slice(0, eq)] = line.slice(eq + 1).trim();
    }
  }
  delete process.env.AWS_PROFILE;
}

/** Run a script's async main, printing an SSO hint on failure and exiting 1. */
export function runMain(mainFn) {
  mainFn().catch((err) => {
    const profileArg = process.env.AWS_PROFILE ? ` --profile ${process.env.AWS_PROFILE}` : '';
    console.error(`\n❌ ${err.message}`);
    console.error(`   (expired SSO? try: aws sso login${profileArg})`);
    process.exit(1);
  });
}
