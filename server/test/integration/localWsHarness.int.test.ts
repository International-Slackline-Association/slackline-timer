import { spawn, type ChildProcess } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDynamoReachable } from './helpers';

/**
 * Guards the WS harness's management-API HTTP face (scripts/localWsHarness.mjs):
 * the harness-identifying GET /health probe and the 404 fallback for unknown
 * paths. The literal /health body is the wire contract verify-g3's readiness
 * probe asserts (driver.mjs backendReady) so a foreign process squatting :3001
 * can't be misread as the relay being up — keep the string in sync with
 * scripts/lib/harnessHealth.mjs. Boots the harness as a subprocess on a
 * throwaway port; self-skips when the local DynamoDB container is down, like
 * the other *.int.test.ts suites — see helpers.ts.
 */

const reachable = isDynamoReachable();
// Off the default 3001 (a running `npm run dev`) and the driver's private
// relay 3101 / the sibling HTTP suite's 3102.
const PORT = 3103;
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = process.cwd();

let harness: ChildProcess;

const waitForListen = (child: ChildProcess) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('harness did not start in time')), 20_000);
    child.stdout?.on('data', (d: Buffer) => {
      if (d.toString().includes('local WS relay')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error(`harness exited early (code ${code})`)));
  });

describe.skipIf(!reachable)('localWsHarness (management-API HTTP face)', () => {
  beforeAll(async () => {
    harness = spawn('node', ['scripts/localWsHarness.mjs'], {
      cwd: serverDir,
      env: { ...process.env, WS_PORT: String(PORT), WS_API_ENDPOINT: BASE },
    });
    await waitForListen(harness);
  }, 30_000);

  afterAll(() => {
    harness?.kill();
  });

  it('answers the harness-identifying readiness probe (GET /health)', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ harness: 'slackline-local-ws' });
  });

  it('returns 404 for an unknown management path', async () => {
    expect((await fetch(`${BASE}/nope`)).status).toBe(404);
  });
});
