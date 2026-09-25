#!/usr/bin/env node

/**
 * Pre-flight for `npm run dev`: deps installed, Docker reachable, and the web
 * app pointed at the local backends (not prod). See doc/dev/local-dev.md.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('🔍 Local dev environment check');
console.log('================================');

let ok = true;
const warn = (msg) => {
  ok = false;
  console.log(`⚠️  ${msg}`);
};

const major = Number(process.versions.node.split('.')[0]);
console.log(`${major >= 24 ? '✅' : '❌'} Node ${process.versions.node} (need >= 24)`);
if (major < 24) ok = false;

for (const pkg of ['', 'web', 'server']) {
  const dir = join(root, pkg, 'node_modules');
  const label = pkg || 'root';
  if (existsSync(dir)) {
    console.log(`✅ ${label}: dependencies installed`);
  } else {
    warn(`${label}: node_modules missing — run \`npm --prefix ${pkg || '.'} ci\``);
  }
}

try {
  execSync('docker info', { stdio: 'ignore' });
  console.log('✅ Docker is running');
} catch {
  warn(
    'Docker is not reachable — start Docker Desktop (the data plane needs the LocalStack container)',
  );
}

// LocalStack (DynamoDB + S3 photos) — informational; `npm run dev` brings it up.
try {
  const out = execSync(
    'docker compose -f docker/docker-compose.yml ps --status running --services',
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  ).toString();
  console.log(
    /(^|\n)localstack(\n|$)/.test(out)
      ? '✅ LocalStack container is running (DynamoDB + S3)'
      : 'ℹ️  LocalStack container not up yet — `npm run db:up` starts it (DynamoDB + S3)',
  );
} catch {
  // Docker unreachable — already warned above.
}

const webEnv = join(root, 'web', '.env.development');
if (existsSync(webEnv)) {
  const contents = readFileSync(webEnv, 'utf8');
  const local = /^\s*VITE_APP_LOCAL_DEV\s*=\s*true\s*$/m.test(contents);
  const wsUrl = /^\s*VITE_APP_WS_URL\s*=\s*ws/m.test(contents);
  const apiUrl = /^\s*VITE_APP_API_URL\s*=\s*http/m.test(contents);
  console.log('✅ web/.env.development present');
  if (!local)
    warn(
      'web/.env.development: VITE_APP_LOCAL_DEV is not "true" — Cognito sign-in will be required',
    );
  if (!wsUrl)
    warn(
      'web/.env.development: VITE_APP_WS_URL is not a ws:// URL — the app will hit the prod backend',
    );
  if (!apiUrl)
    warn(
      'web/.env.development: VITE_APP_API_URL is not set — the /admin and /stream pages will not work',
    );
} else {
  warn('web/.env.development missing — copy web/.env.development.example to web/.env.development');
}

console.log('================================');
if (ok) {
  console.log('✅ Ready for local development');
} else {
  console.log('💡 Fix the items above, then re-run. See doc/dev/local-dev.md for setup.');
}

// Non-fatal — let `npm run dev` start regardless.
process.exit(0);
