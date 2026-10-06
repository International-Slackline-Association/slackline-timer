import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { ensureTables, isDynamoReachable } from './helpers';

/**
 * Guards the WS harness's own surface (scripts/localWsHarness.mjs): the
 * management-API HTTP face and the $connect gate in front of the real handlers.
 * The literal /health body is the wire contract verify-g3's readiness probe
 * asserts (driver.mjs backendReady) so a foreign process squatting :3001 can't
 * be misread as the relay being up — keep the string in sync with
 * scripts/lib/harnessHealth.mjs. Boots the harness as a subprocess on a
 * throwaway port; self-skips when the local DynamoDB container is down, like
 * the other *.int.test.ts suites — see helpers.ts.
 */

const reachable = isDynamoReachable();
// Off the default 3001 (a running `npm run dev`) and the driver's private
// relay 3101 / the sibling HTTP suite's 3102.
const PORT = 3103;
const BASE = `http://127.0.0.1:${PORT}`;
// A second harness whose connections table does not exist, so connectionHandler
// answers $connect with a 500.
const BROKEN_PORT = 3104;
const serverDir = process.cwd();

let harness: ChildProcess;
let broken: ChildProcess;

const startHarness = (port: number, env: Record<string, string> = {}) => {
  const child = spawn('node', ['scripts/localWsHarness.mjs'], {
    cwd: serverDir,
    env: {
      ...process.env,
      WS_PORT: String(port),
      WS_API_ENDPOINT: `http://127.0.0.1:${port}`,
      ...env,
    },
  });
  const listening = new Promise<void>((resolve, reject) => {
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
  return { child, listening };
};

/** Resolve 'open' or the handshake's HTTP status when the server refuses it. */
const connect = (port: number, query: string, origin?: string) =>
  new Promise<'open' | number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, origin ? { origin } : {});
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => undefined);
  });

const OPERATOR = `Authorization=local-dev&sessionId=it-ws-${randomUUID()}`;

describe.skipIf(!reachable)('localWsHarness (management API + $connect gate)', () => {
  beforeAll(async () => {
    await ensureTables();
    const main = startHarness(PORT);
    const bad = startHarness(BROKEN_PORT, {
      SPEEDLINE_TIMER_TABLE: 'slackline-timer-v1-relay-missing',
    });
    harness = main.child;
    broken = bad.child;
    await Promise.all([main.listening, bad.listening]);
  }, 30_000);

  afterAll(() => {
    harness?.kill();
    broken?.kill();
  });

  it('answers the harness-identifying readiness probe (GET /health)', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ harness: 'slackline-local-ws' });
  });

  it('returns 404 for an unknown management path', async () => {
    expect((await fetch(`${BASE}/nope`)).status).toBe(404);
  });

  it('400s a malformed @connections id and keeps serving', async () => {
    expect((await fetch(`${BASE}/@connections/%E0%A4%A`, { method: 'POST' })).status).toBe(400);
    expect((await fetch(`${BASE}/health`)).status).toBe(200);
  });

  it('accepts an operator from a Node client (no Origin) and the Vite origin', async () => {
    expect(await connect(PORT, OPERATOR)).toBe('open');
    expect(await connect(PORT, OPERATOR, 'http://127.0.0.1:5173')).toBe('open');
  });

  it('refuses an upgrade from a foreign Origin (cross-site WebSocket hijack)', async () => {
    expect(await connect(PORT, OPERATOR, 'https://evil.example')).toBe(403);
  });

  it('refuses the handshake when connectionHandler does not answer 200', async () => {
    expect(await connect(PORT, 'Authorization=local-dev')).toBe(400);
    expect(await connect(BROKEN_PORT, OPERATOR)).toBe(500);
  });
});
