// Offline backend: ensure the LocalStack tables + photo bucket, then run the
// HTTP harness (:3002) and the WS harness (:3001). Needs the LocalStack
// container (`npm run db:up`). See doc/dev/local-dev.md.

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
