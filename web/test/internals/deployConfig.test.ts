import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BACKEND_OUTPUTS,
  buildViteEnv,
  liveStack,
  VITE_VARS,
} from '../../internals/deployConfig.mjs';

/**
 * Guards what the web deploy resolves before it builds
 * (web/internals/deployConfig.mjs). `vite build` fails without the six
 * VITE_APP_* vars, so the only question is WHERE they come from: a missing one
 * must stop the deploy rather than bake in a stale committed value.
 */

const STACK = { name: 'a-backend-stack', region: 'eu-central-2' };
const OUTPUTS = { WebsocketUrl: 'wss://ws.example', HttpApiUrl: 'https://api.example/prod' };
const ENV = {
  COGNITO_USER_POOL_ID: 'eu-central-1_Example',
  COGNITO_CLIENT_ID: 'a-client',
  COGNITO_DOMAIN: 'auth.example.com',
  COGNITO_TIMER_GROUP: 'operators',
};

/** A throwaway stacks.json on disk — liveStack reads the ledger as a file. */
const ledger = (stacks: unknown[]) => {
  const path = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'stacks.json');
  writeFileSync(path, JSON.stringify({ stacks }));
  return path;
};

describe('buildViteEnv', () => {
  it('builds every var vite requires from the stack outputs plus .env.deploy', () => {
    const viteEnv = buildViteEnv({ outputs: OUTPUTS, env: ENV, stack: STACK });
    expect(Object.keys(viteEnv).sort()).toEqual(VITE_VARS.map((v) => v.vite).sort());
    expect(viteEnv.VITE_APP_WS_URL).toBe('wss://ws.example');
    expect(viteEnv.VITE_APP_API_URL).toBe('https://api.example/prod');
    expect(viteEnv.VITE_APP_COGNITO_DOMAIN).toBe('auth.example.com');
  });

  it('asks the backend stack for exactly the outputs it consumes', () => {
    expect(BACKEND_OUTPUTS).toEqual(['WebsocketUrl', 'HttpApiUrl']);
  });

  it('refuses to build when a .env.deploy value is missing, naming it and the template', () => {
    const { COGNITO_DOMAIN: _dropped, ...partial } = ENV;
    const build = () => buildViteEnv({ outputs: OUTPUTS, env: partial, stack: STACK });
    expect(build).toThrow(/refusing to build/);
    expect(build).toThrow(/VITE_APP_COGNITO_DOMAIN/);
    expect(build).toThrow(/COGNITO_DOMAIN \(repo-root \.env\.deploy\)/);
    expect(build).toThrow(/\.env\.deploy\.example/);
  });

  it('points a missing API URL at the stack that should publish it', () => {
    const build = () =>
      buildViteEnv({ outputs: { WebsocketUrl: 'wss://ws.example' }, env: ENV, stack: STACK });
    expect(build).toThrow(/HttpApiUrl \(output of stack a-backend-stack in eu-central-2\)/);
  });

  it('reports every unresolved var at once, not just the first', () => {
    const build = () => buildViteEnv({ stack: STACK });
    for (const { vite } of VITE_VARS) expect(build).toThrow(new RegExp(vite));
  });

  it('treats a blank value as unset', () => {
    // A half-filled `.env.deploy` line (`COGNITO_DOMAIN=`) is not a value; it
    // would otherwise reach the bundle as an empty Hosted-UI domain.
    expect(() =>
      buildViteEnv({ outputs: OUTPUTS, env: { ...ENV, COGNITO_DOMAIN: '  ' }, stack: STACK }),
    ).toThrow(/VITE_APP_COGNITO_DOMAIN/);
  });
});

describe('liveStack', () => {
  it('resolves the single live stack of a role to its name and region', () => {
    const path = ledger([
      { name: 'old', role: 'web', region: 'eu-central-1', status: 'retired' },
      { name: 'current', role: 'web', region: 'eu-central-1', status: 'live' },
      { name: 'backend', role: 'backend', region: 'eu-central-2', status: 'live' },
    ]);
    expect(liveStack('web', path)).toEqual({ name: 'current', region: 'eu-central-1' });
    expect(liveStack('backend', path)).toEqual({ name: 'backend', region: 'eu-central-2' });
  });

  it('never selects a retired stack', () => {
    const path = ledger([{ name: 'old', role: 'web', region: 'eu-central-1', status: 'retired' }]);
    expect(() => liveStack('web', path)).toThrow(/exactly one live 'web' stack.*found 0/s);
  });

  it('refuses to guess between two live stacks of a role', () => {
    const path = ledger([
      { name: 'a', role: 'web', region: 'eu-central-1', status: 'live' },
      { name: 'b', role: 'web', region: 'eu-central-1', status: 'live' },
    ]);
    expect(() => liveStack('web', path)).toThrow(/found 2 \(a, b\)/);
  });

  it('names the ledger it could not read', () => {
    expect(() => liveStack('web', 'no/such/stacks.json')).toThrow(
      /cannot read the stack ledger no\/such\/stacks\.json/,
    );
  });

  it('resolves the repo ledger to two stacks in two regions', () => {
    // The region split is the thing a single-region deploy script gets wrong:
    // the API URLs and the UI bucket are published by different stacks.
    const backend = liveStack('backend');
    const web = liveStack('web');
    expect(backend.name).not.toBe(web.name);
    expect(backend.region).not.toBe(web.region);
  });
});
