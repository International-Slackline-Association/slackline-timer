import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildCsp, CSP_INPUTS, cspMetaPlugin } from '../../internals/csp.mjs';

/**
 * The build-time meta CSP (ADR 0054): every runtime origin comes from the
 * resolved deploy config, so the policy for a fixture config is pinned whole —
 * a new origin in the app is a change to this string.
 */

const CONFIG = {
  VITE_APP_API_URL: 'https://api.example/prod',
  VITE_APP_WS_URL: 'wss://ws.example/prod',
  VITE_APP_COGNITO_DOMAIN: 'auth.example.com',
  VITE_APP_COGNITO_USER_POOL_ID: 'eu-central-1_Example',
  WEB_CSP_PHOTO_CDN_DOMAIN: 'd111.cloudfront.net',
  WEB_CSP_PHOTO_UPLOAD_ORIGIN: 'https://photos.s3.eu-central-2.amazonaws.com',
};

const POLICY =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https://d111.cloudfront.net; " +
  "font-src 'self' data:; " +
  "media-src 'self' data:; " +
  "connect-src 'self' https://api.example wss://ws.example https://auth.example.com " +
  'https://cognito-idp.eu-central-1.amazonaws.com https://photos.s3.eu-central-2.amazonaws.com ' +
  'http://127.0.0.1:* http://localhost:*; ' +
  "worker-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "object-src 'none'";

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  </head>
</html>`;

/** Run the plugin the way `vite build` does: configResolved, then the html hook. */
const transform = (env: Record<string, string | undefined>, html = HTML) => {
  const plugin = cspMetaPlugin(env);
  plugin.configResolved();
  return plugin.transformIndexHtml.handler(html);
};

describe('buildCsp', () => {
  it('builds the exact policy from the resolved deploy config', () => {
    expect(buildCsp(CONFIG)).toBe(POLICY);
  });

  it('allows API and WS by origin, not by the stage path', () => {
    // A path-bearing source matches that path only: `https://api.example/prod`
    // would block `/prod/competitions`.
    const policy = buildCsp({
      ...CONFIG,
      VITE_APP_API_URL: 'https://api.example:8443/prod/',
      VITE_APP_WS_URL: 'wss://ws.example/prod?x=1',
    });
    expect(policy).toContain(' https://api.example:8443 wss://ws.example ');
  });

  it('accepts the upload origin with the trailing slash createPresignedPost returns', () => {
    expect(
      buildCsp({ ...CONFIG, WEB_CSP_PHOTO_UPLOAD_ORIGIN: 'https://photos.s3.example.com/' }),
    ).toContain(' https://photos.s3.example.com ');
  });

  it('lists a source shared by two inputs once', () => {
    const policy = buildCsp({
      ...CONFIG,
      VITE_APP_API_URL: 'https://shared.example/prod',
      VITE_APP_COGNITO_DOMAIN: 'shared.example',
      WEB_CSP_PHOTO_UPLOAD_ORIGIN: 'https://shared.example',
    });
    expect(policy).toContain(
      "connect-src 'self' https://shared.example wss://ws.example https://cognito-idp.",
    );
    expect(policy.match(/https:\/\/shared\.example/g)).toHaveLength(1);
  });

  it('keeps frame-ancestors out of the meta policy, which ignores it', () => {
    expect(buildCsp(CONFIG)).not.toContain('frame-ancestors');
  });

  it('refuses to build with an input missing, naming every one', () => {
    const { WEB_CSP_PHOTO_CDN_DOMAIN: _cdn, WEB_CSP_PHOTO_UPLOAD_ORIGIN: _up, ...partial } = CONFIG;
    const build = () => buildCsp(partial);
    expect(build).toThrow(/Refusing to build/);
    expect(build).toThrow(/WEB_CSP_PHOTO_CDN_DOMAIN, WEB_CSP_PHOTO_UPLOAD_ORIGIN/);
  });

  it('treats a blank input as missing', () => {
    expect(() => buildCsp({ ...CONFIG, VITE_APP_COGNITO_DOMAIN: ' ' })).toThrow(
      /VITE_APP_COGNITO_DOMAIN/,
    );
  });

  it('requires every input it lists', () => {
    for (const key of CSP_INPUTS) {
      expect(() => buildCsp({ ...CONFIG, [key]: undefined })).toThrow(new RegExp(key));
    }
  });

  it.each([
    ['VITE_APP_API_URL', 'http://api.example/prod'],
    ['VITE_APP_WS_URL', 'https://ws.example/prod'],
    ['VITE_APP_COGNITO_DOMAIN', 'https://auth.example.com'],
    ['VITE_APP_COGNITO_USER_POOL_ID', 'not-a-pool'],
    ['WEB_CSP_PHOTO_CDN_DOMAIN', "d111.cloudfront.net 'unsafe-eval'"],
    ['WEB_CSP_PHOTO_UPLOAD_ORIGIN', 'https://photos.s3.example.com/photos/'],
    ['WEB_CSP_PHOTO_UPLOAD_ORIGIN', 'https://*.s3.example.com'],
  ])('rejects a malformed %s (%s)', (key, value) => {
    expect(() => buildCsp({ ...CONFIG, [key]: value })).toThrow(new RegExp(key));
  });
});

describe('cspMetaPlugin', () => {
  it('only runs in `vite build`', () => {
    expect(cspMetaPlugin(CONFIG).apply).toBe('build');
  });

  it('places the policy directly after the charset declaration', () => {
    const html = transform(CONFIG);
    expect(html).toContain(
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${POLICY}" />\n    <link rel="icon"`,
    );
  });

  it('refuses at config time with an input missing', () => {
    const plugin = cspMetaPlugin({ ...CONFIG, WEB_CSP_PHOTO_CDN_DOMAIN: undefined });
    expect(() => plugin.configResolved()).toThrow(/WEB_CSP_PHOTO_CDN_DOMAIN/);
  });

  it('refuses an index.html without a charset declaration to anchor on', () => {
    expect(() => transform(CONFIG, '<html><head></head></html>')).toThrow(/charset/);
  });

  it('is wired into vite.config with the WEB_CSP_* inputs loaded', () => {
    // Read as source for the reason in constants.test.ts ("the production build guard").
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('cspMetaPlugin(env)');
    expect(viteConfig).toMatch(/loadEnv\(.*'WEB_CSP_'/);
  });
});
