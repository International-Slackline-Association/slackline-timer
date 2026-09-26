// What the web deploy must resolve before it can build or upload: which stacks
// to ask, and which `VITE_APP_*` vars the bundle needs. Split from
// deployToS3.mjs so the resolution rules are testable without the AWS CLI or
// vite.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Not `new URL('..', import.meta.url)`: Vite rewrites that literal form into an
// asset reference, so it throws "URL must be of scheme file" the moment a
// Vitest suite imports this module. Bare `import.meta.url` is left alone.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The ignored repo-root `.env.deploy` (template: `.env.deploy.example`). An
// already-exported variable still wins — loadEnvFile does not overwrite.
const DEPLOY_ENV = join(REPO_ROOT, '.env.deploy');

/** Load `.env.deploy` into process.env if it exists. No-op otherwise. */
export function loadDeployEnv() {
  if (existsSync(DEPLOY_ENV)) process.loadEnvFile(DEPLOY_ENV);
}

// Stack name → region comes from the decommission ledger (its own _readme is
// the spec), not a second copy here: the web app is deployed by two stacks in
// two different regions.
const LEDGER = join(REPO_ROOT, 'server', 'scripts', 'decommission', 'stacks.json');

/**
 * The single `live` stack filling `role` ('backend' | 'web') → `{ name, region }`.
 * Retired/retiring entries are history and must never become a deploy target,
 * so only `live` matches; an ambiguous ledger throws rather than picking one.
 */
export function liveStack(role, ledgerPath = LEDGER) {
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read the stack ledger ${ledgerPath}: ${err.message}`, { cause: err });
  }
  const matches = (ledger.stacks ?? []).filter((s) => s.role === role && s.status === 'live');
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one live '${role}' stack in ${ledgerPath}, found ${matches.length}` +
        `${matches.length ? ` (${matches.map((s) => s.name).join(', ')})` : ''}.`,
    );
  }
  const { name, region } = matches[0];
  if (!name || !region) {
    throw new Error(`the live '${role}' stack entry in ${ledgerPath} has no name/region.`);
  }
  return { name, region };
}

// Every var `vite build` requires, and where each comes from: the API URLs are
// backend-stack outputs; the Cognito pool is hand-provisioned outside this repo
// (no stack can output it), so those four are `.env.deploy` inputs.
export const VITE_VARS = [
  { vite: 'VITE_APP_WS_URL', source: 'stack', key: 'WebsocketUrl' },
  { vite: 'VITE_APP_API_URL', source: 'stack', key: 'HttpApiUrl' },
  { vite: 'VITE_APP_COGNITO_USER_POOL_ID', source: 'env', key: 'COGNITO_USER_POOL_ID' },
  { vite: 'VITE_APP_COGNITO_CLIENT_ID', source: 'env', key: 'COGNITO_CLIENT_ID' },
  { vite: 'VITE_APP_COGNITO_DOMAIN', source: 'env', key: 'COGNITO_DOMAIN' },
  { vite: 'VITE_APP_COGNITO_TIMER_GROUP', source: 'env', key: 'COGNITO_TIMER_GROUP' },
];

/** The backend stack outputs buildViteEnv needs — what to ask describe-stacks for. */
export const BACKEND_OUTPUTS = VITE_VARS.filter((v) => v.source === 'stack').map((v) => v.key);

/**
 * The `VITE_APP_*` env the production build runs with, or a throw naming every
 * unresolved var and where it should have come from. No var has a default: a
 * bundle built with a guessed API URL points a live event at the wrong backend.
 */
export function buildViteEnv({ outputs = {}, env = {}, stack } = {}) {
  const viteEnv = {};
  const missing = [];
  for (const { vite, source, key } of VITE_VARS) {
    const raw = source === 'stack' ? outputs[key] : env[key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value) viteEnv[vite] = value;
    else missing.push({ vite, source, key });
  }
  if (missing.length > 0) {
    const where = ({ source, key }) =>
      source === 'stack'
        ? `${key} (output of stack ${stack?.name ?? '?'} in ${stack?.region ?? '?'})`
        : `${key} (repo-root .env.deploy)`;
    throw new Error(
      'unresolved deploy config — refusing to build:\n' +
        missing.map((m) => `   ${m.vite.padEnd(30)} <- ${where(m)}`).join('\n') +
        '\nAdd the missing entries to the git-ignored `.env.deploy` (template: ' +
        '.env.deploy.example), and deploy the backend stack so it publishes its outputs.',
    );
  }
  return viteEnv;
}
