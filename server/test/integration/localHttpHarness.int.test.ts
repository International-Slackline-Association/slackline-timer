import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compPk } from 'core/keys';

import { clearPartition, COMPETITION_TABLE, ensureTables, isDynamoReachable } from './helpers';

/**
 * Guards what scripts/localHttpHarness.mjs adds beyond the real handlers
 * (already covered by handlers.int.test.ts): the route table +
 * APIGatewayProxyEventV2 construction, and the dev-box lockdown (loopback bind,
 * Host/Origin allowlists, no header-less admin fallback). Boots the harness as a subprocess on a
 * throwaway port and drives it over real HTTP — so a method/path → routeKey
 * mismatch, a dropped path param, or the literal-vs-parameterised ordering
 * (…/matches/seed must beat …/{matchId}) fails here, not silently in a headless
 * agent round. Self-skips when the local DynamoDB container is down (CI without
 * Docker), like the other *.int.test.ts suites — see helpers.ts.
 */

const reachable = isDynamoReachable();
const PORT = 3102; // off the default 3002 so a running `npm run dev` doesn't clash
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH = { authorization: 'Bearer local-dev' };
const VITE_ORIGIN = 'http://127.0.0.1:5173';
const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((i) => i?.family === 'IPv4' && !i.internal)?.address;

/** Raw request, so the Host header can be forged (fetch forbids setting it). */
const rawGet = (path: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    request({ host: '127.0.0.1', port: PORT, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on('error', reject)
      .end();
  });
// vitest runs from the server package root (npm --prefix server test), where the
// scripts/ path and tsconfig the harness bundles against resolve.
const serverDir = process.cwd();

let harness: ChildProcess;

const waitForListen = (child: ChildProcess) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('harness did not start in time')), 20_000);
    child.stdout?.on('data', (d: Buffer) => {
      if (d.toString().includes('local HTTP data plane')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error(`harness exited early (code ${code})`)));
  });

describe.skipIf(!reachable)('localHttpHarness (SAM-free HTTP data plane)', () => {
  const compId = `it-harness-${randomUUID()}`;

  beforeAll(async () => {
    await ensureTables();
    harness = spawn('node', ['scripts/localHttpHarness.mjs'], {
      cwd: serverDir,
      env: { ...process.env, HTTP_PORT: String(PORT) },
    });
    await waitForListen(harness);
  }, 30_000);

  afterAll(async () => {
    harness?.kill();
    if (reachable) await clearPartition(COMPETITION_TABLE, compPk(compId));
  });

  it('serves GET /competitions → 200 (the boot smoke)', async () => {
    const res = await fetch(`${BASE}/competitions`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('round-trips a competition through POST then GET with the path param', async () => {
    const created = await fetch(`${BASE}/competitions`, {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({
        compId,
        name: 'Harness Cup',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
      }),
    });
    expect(created.status).toBe(201);

    const got = await fetch(`${BASE}/competitions/${compId}`, { headers: AUTH });
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({ compId, name: 'Harness Cup' });
  });

  it('routes …/matches/seed to the matches handler (literal beats {matchId})', async () => {
    // An empty body fails the matches validator (400) — proof it reached the
    // matches handler and passed requireWrite, not the {matchId} PUT/DELETE.
    const res = await fetch(`${BASE}/competitions/${compId}/matches/seed`, {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unmapped route', async () => {
    expect((await fetch(`${BASE}/nope`)).status).toBe(404);
  });

  it('401s a request without an Authorization header, as in prod', async () => {
    const res = await fetch(`${BASE}/competitions`);
    expect(res.status).toBe(401);
  });

  it('echoes an allowlisted Origin on the preflight and the response', async () => {
    const preflight = await fetch(`${BASE}/competitions`, {
      method: 'OPTIONS',
      headers: { origin: VITE_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(VITE_ORIGIN);

    const res = await fetch(`${BASE}/competitions`, {
      headers: { ...AUTH, origin: VITE_ORIGIN },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe(VITE_ORIGIN);
  });

  it('refuses a foreign Origin without any CORS grant', async () => {
    const preflight = await fetch(`${BASE}/competitions`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();

    const res = await fetch(`${BASE}/competitions`, {
      method: 'POST',
      headers: { ...AUTH, origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('421s a foreign Host header (DNS rebinding)', async () => {
    expect(await rawGet('/competitions', { ...AUTH, host: `attacker.example:${PORT}` })).toBe(421);
    expect(await rawGet('/competitions', { ...AUTH, host: `localhost:${PORT}` })).toBe(200);
  });

  it('400s a malformed % escape and keeps serving', async () => {
    const res = await fetch(`${BASE}/competitions/%E0%A4%A`, { headers: AUTH });
    expect(res.status).toBe(400);
    expect((await fetch(`${BASE}/competitions`, { headers: AUTH })).status).toBe(200);
  });

  it.skipIf(!lanIp)('binds loopback only', async () => {
    await expect(fetch(`http://${lanIp}:${PORT}/health`)).rejects.toThrow();
  });

  // The literal body is the readiness-probe wire contract, so a foreign process
  // squatting :3002 can't be misread as the harness being up — keep it in sync
  // with scripts/lib/harnessHealth.mjs.
  it('answers the harness-identifying readiness probe (GET /health)', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ harness: 'slackline-local-http' });
  });
});
