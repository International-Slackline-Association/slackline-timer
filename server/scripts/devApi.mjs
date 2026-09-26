// Offline backend: ensure local infra (DynamoDB tables + S3 photo bucket in the
// LocalStack container), then run the HTTP data API on :3002 and the WebSocket
// relay on :3001 — both the real, esbuild-bundled Lambda handlers running
// in-process (scripts/localHttpHarness.mjs + localWsHarness.mjs), so there is no
// drift from the deployed CDK stack. WebSocket + Lambda-asset emulation inside
// LocalStack needs the Pro license (ADR 0023, phase 2); until then the harnesses
// are the local runtime. Needs the LocalStack container (`npm run db:up`).
// See doc/dev/local-dev.md.

import { spawn } from 'node:child_process';

import { ensureLocalBucket } from './createLocalBucket.mjs';
import { ensureLocalTables } from './createLocalTables.mjs';
import { applyOfflineEnv } from './offlineEnv.mjs';

applyOfflineEnv();

const run = async () => {
  await ensureLocalTables();
  await ensureLocalBucket();

  // No shell: node is directly spawnable, an args array + `shell: true` trips
  // DEP0190, and on Windows killing the cmd.exe wrapper would orphan the harness.
  const spawnHarness = (script) =>
    spawn(process.execPath, [script], { stdio: 'inherit', env: process.env });

  const children = [
    spawnHarness('scripts/localHttpHarness.mjs'),
    spawnHarness('scripts/localWsHarness.mjs'),
  ];

  const shutdown = () => children.forEach((c) => c.kill());
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  children.forEach((c) => c.on('exit', (code) => process.exit(code ?? 0)));
};

run().catch((err) => {
  console.error('❌ dev:api failed:', err.message);
  console.error('   Is the LocalStack container up (npm run db:up)?');
  process.exit(1);
});
