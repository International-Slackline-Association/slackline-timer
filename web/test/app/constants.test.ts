/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The rule these pin (ADR 0048): the browser bundle carries no endpoint of its
 * own. Every value comes from the environment, and a missing one is a hard
 * failure — not `import.meta.env.X ?? '<prod literal>'`, which made the env var
 * an override and shipped our production endpoints to anyone who built without
 * one.
 */

const FULL_ENV: Record<string, string> = {
  VITE_APP_WS_URL: 'wss://ws.example.test/prod',
  VITE_APP_API_URL: 'https://api.example.test/prod',
  VITE_APP_COGNITO_USER_POOL_ID: 'eu-test-1_examplepool',
  VITE_APP_COGNITO_CLIENT_ID: 'exampleclientid',
  VITE_APP_COGNITO_DOMAIN: 'auth.example.test',
  VITE_APP_COGNITO_TIMER_GROUP: 'exampleoperators',
};

const REQUIRED_KEYS = Object.keys(FULL_ENV);

/** Re-import the module under a chosen env — the values are read once, at load. */
const loadConstants = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('app/constants');
};

/** FULL_ENV with `omitted` absent (stubbing `undefined` deletes the key). */
const envWithout = (...omitted: string[]): Record<string, string | undefined> => ({
  ...FULL_ENV,
  ...Object.fromEntries(omitted.map((key) => [key, undefined])),
});

const sourceOf = (file: string): string => readFileSync(resolve(process.cwd(), file), 'utf8');

/** Comments legitimately name example hosts; only executable code is scanned. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('app/constants', () => {
  it('takes every endpoint and identifier from the environment', async () => {
    const constants = await loadConstants({ ...FULL_ENV, VITE_APP_LOCAL_DEV: undefined });

    expect(constants.WS_URL).toBe(FULL_ENV.VITE_APP_WS_URL);
    expect(constants.HTTP_API_URL).toBe(FULL_ENV.VITE_APP_API_URL);
    expect(constants.COGNITO_USER_POOL_ID).toBe(FULL_ENV.VITE_APP_COGNITO_USER_POOL_ID);
    expect(constants.COGNITO_CLIENT_ID).toBe(FULL_ENV.VITE_APP_COGNITO_CLIENT_ID);
    expect(constants.COGNITO_DOMAIN).toBe(FULL_ENV.VITE_APP_COGNITO_DOMAIN);
    expect(constants.TIMER_GROUP).toBe(FULL_ENV.VITE_APP_COGNITO_TIMER_GROUP);
    expect(constants.LOCAL_DEV).toBe(false);
  });

  // The regression guard: with `?? '<some endpoint>'` back, these resolve
  // silently instead of throwing.
  it.each(REQUIRED_KEYS)('fails loudly instead of defaulting when %s is missing', async (key) => {
    await expect(loadConstants(envWithout(key))).rejects.toThrow(key);
  });

  it('points a missing value at where it is meant to come from', async () => {
    await expect(loadConstants(envWithout('VITE_APP_WS_URL'))).rejects.toThrow(
      /web\/\.env\.development\.example[\s\S]*deploy tooling/,
    );
  });

  it('treats a blank value as missing', async () => {
    await expect(loadConstants({ ...FULL_ENV, VITE_APP_API_URL: '' })).rejects.toThrow(
      'VITE_APP_API_URL',
    );
  });

  it('hardcodes no endpoint of its own', () => {
    const code = stripComments(sourceOf('src/app/constants.ts'));

    expect(code).toContain('import.meta.env.VITE_APP_WS_URL');
    expect(code).not.toMatch(/wss?:\/\/|https?:\/\//);
    expect(code).not.toMatch(/amazonaws\.com|slacklineinternational\.org/);
    // The anti-pattern itself: an env read with a literal behind it.
    expect(code).not.toMatch(/import\.meta\.env\.\w+\s*\?\?/);
  });
});

describe('app/constants in LOCAL_DEV', () => {
  const LOCAL_DEV_ON = { VITE_APP_LOCAL_DEV: 'true' };

  it('does not demand Cognito config, which it bypasses entirely', async () => {
    // Explicitly absent, not merely unlisted: test/setup.ts seeds a baseline
    // env, so only an `undefined` stub clears a key.
    const constants = await loadConstants({
      ...envWithout(
        'VITE_APP_COGNITO_USER_POOL_ID',
        'VITE_APP_COGNITO_CLIENT_ID',
        'VITE_APP_COGNITO_DOMAIN',
        'VITE_APP_COGNITO_TIMER_GROUP',
      ),
      ...LOCAL_DEV_ON,
    });

    expect(constants.LOCAL_DEV).toBe(true);
    expect(constants.COGNITO_USER_POOL_ID).toBe('');
    expect(constants.COGNITO_CLIENT_ID).toBe('');
    expect(constants.COGNITO_DOMAIN).toBe('');
    expect(constants.TIMER_GROUP).toBe('');
  });

  it('still demands the endpoints it actually talks to', async () => {
    await expect(
      loadConstants({ ...envWithout('VITE_APP_WS_URL'), ...LOCAL_DEV_ON }),
    ).rejects.toThrow('VITE_APP_WS_URL');
    await expect(
      loadConstants({ ...envWithout('VITE_APP_API_URL'), ...LOCAL_DEV_ON }),
    ).rejects.toThrow('VITE_APP_API_URL');
  });

  it('uses Cognito config when it is supplied anyway', async () => {
    const constants = await loadConstants({ ...FULL_ENV, ...LOCAL_DEV_ON });

    expect(constants.COGNITO_DOMAIN).toBe(FULL_ENV.VITE_APP_COGNITO_DOMAIN);
    expect(constants.TIMER_GROUP).toBe(FULL_ENV.VITE_APP_COGNITO_TIMER_GROUP);
  });
});

describe('the production build guard', () => {
  /**
   * `vite.config.ts` is the real enforcement — the runtime throw above only
   * fires once a browser has been served a broken bundle. Read as source, not
   * imported: importing pulls in the plugin graph and node-only globals that
   * `checkTs` does not cover for that file.
   */
  const viteConfig = sourceOf('vite.config.ts');

  const listed = (): string[] => {
    const block = /const REQUIRED_ENV = \[([\s\S]*?)\]/.exec(viteConfig)?.[1] ?? '';
    return Array.from(block.matchAll(/'(VITE_APP_\w+)'/g), ([, key]) => key);
  };

  const demanded = (): string[] =>
    Array.from(
      sourceOf('src/app/constants.ts').matchAll(/(?:required|cognitoConfig)\(\s*'(VITE_APP_\w+)'/g),
      ([, key]) => key,
    );

  it('refuses a build that is missing any key constants.ts demands', () => {
    expect(viteConfig).toMatch(/command === 'build'[\s\S]*REQUIRED_ENV\.filter/);
    expect(listed().sort()).toEqual(demanded().sort());
  });

  it('keeps refusing a build with the auth gate disabled', () => {
    expect(viteConfig).toContain("env.VITE_APP_LOCAL_DEV === 'true'");
  });
});
