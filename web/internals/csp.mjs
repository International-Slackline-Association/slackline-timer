// The enforcing Content-Security-Policy, built at `vite build` from the same
// resolved deploy config the bundle is built with (ADR 0054, on top of ADR
// 0048): exact origins, nothing committed. Delivered as a <meta> because only
// the build knows the origins; frame-ancestors, which a <meta> CSP ignores,
// stays in the web stack's response header (server/infra/web-stack.ts).

// The VITE_APP_* ones are the bundle's own endpoints; the WEB_CSP_* ones never
// reach the bundle (vite exposes only VITE_*). `npm run deploy` resolves all of
// them (internals/deployConfig.mjs).
export const CSP_INPUTS = [
  'VITE_APP_API_URL',
  'VITE_APP_WS_URL',
  'VITE_APP_COGNITO_DOMAIN',
  'VITE_APP_COGNITO_USER_POOL_ID',
  'WEB_CSP_PHOTO_CDN_DOMAIN',
  'WEB_CSP_PHOTO_UPLOAD_ORIGIN',
];

// Lowercase DNS name with at least one dot: also what keeps a value from
// smuggling a wildcard, a keyword or a quote into the policy and the <meta>.
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// Amplify derives the cognito-idp endpoint (token refresh, revoke, sign-out)
// from the pool id's region prefix, so the policy does too.
const POOL_ID = /^([a-z]{2}(?:-[a-z]+)+-\d+)_[A-Za-z0-9]+$/;

const invalid = (key, value, expected) =>
  new Error(`Refusing to build: ${key}=${JSON.stringify(value)} is not ${expected}.`);

/** `scheme://host[:port]` of a URL; a path-bearing source would match that path only. */
const originOf = (key, value, protocol) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalid(key, value, `a ${protocol}// URL`);
  }
  if (url.protocol !== protocol || !HOST.test(url.hostname) || url.username || url.password) {
    throw invalid(key, value, `a ${protocol}// URL`);
  }
  return `${url.protocol}//${url.host}`;
};

/** An origin given as such: `https://host[:port]`, optionally with a bare `/`. */
const exactOrigin = (key, value) => {
  const origin = originOf(key, value, 'https:');
  if (value.replace(/\/$/, '') !== origin) throw invalid(key, value, 'a bare https:// origin');
  return origin;
};

const hostOrigin = (key, value) => {
  if (!HOST.test(value)) throw invalid(key, value, 'a bare host name');
  return `https://${value}`;
};

/**
 * The policy string, or a throw naming every missing input / the first
 * malformed one. No input has a default: a guessed origin either blocks the
 * live app or allows someone else's resource.
 */
export function buildCsp(env) {
  const value = (key) => (typeof env[key] === 'string' ? env[key].trim() : '');
  const missing = CSP_INPUTS.filter((key) => !value(key));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to build without ${missing.join(', ')} — the CSP has no fallbacks. ` +
        'Build through `npm run deploy` (stack outputs + .env.deploy), or export them.',
    );
  }

  const pool = POOL_ID.exec(value('VITE_APP_COGNITO_USER_POOL_ID'));
  if (!pool) {
    throw invalid(
      'VITE_APP_COGNITO_USER_POOL_ID',
      value('VITE_APP_COGNITO_USER_POOL_ID'),
      'a <region>_<id> pool id',
    );
  }

  const connect = [
    "'self'",
    originOf('VITE_APP_API_URL', value('VITE_APP_API_URL'), 'https:'),
    originOf('VITE_APP_WS_URL', value('VITE_APP_WS_URL'), 'wss:'),
    // Hosted-UI code exchange (/oauth2/token).
    hostOrigin('VITE_APP_COGNITO_DOMAIN', value('VITE_APP_COGNITO_DOMAIN')),
    `https://cognito-idp.${pool[1]}.amazonaws.com`,
    exactOrigin('WEB_CSP_PHOTO_UPLOAD_ORIGIN', value('WEB_CSP_PHOTO_UPLOAD_ORIGIN')),
    // The H2R bridge POSTs to H2R Graphics on the operator's own machine.
    'http://127.0.0.1:*',
    'http://localhost:*',
  ];

  const directives = [
    ['default-src', "'self'"],
    ['script-src', "'self'"],
    // Emotion (MUI) injects <style> at runtime; a static S3 bundle cannot carry
    // a per-response nonce.
    ['style-src', "'self'", "'unsafe-inline'"],
    // data: = Vite-inlined small assets, blob: = the admin photo preview.
    [
      'img-src',
      "'self'",
      'data:',
      'blob:',
      hostOrigin('WEB_CSP_PHOTO_CDN_DOMAIN', value('WEB_CSP_PHOTO_CDN_DOMAIN')),
    ],
    ['font-src', "'self'", 'data:'],
    // data: = the silent WAV that probes autoplay (useSignalAudio).
    ['media-src', "'self'", 'data:'],
    ['connect-src', ...connect],
    ['worker-src', "'none'"],
    // Also in the response header; repeated so the meta stands on its own.
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['object-src', "'none'"],
  ];

  // Inputs may share a host (e.g. API and Cognito on one domain).
  return directives.map(([name, ...sources]) => [name, ...new Set(sources)].join(' ')).join('; ');
}

// The meta must precede every resource it governs and leave the charset
// declaration inside the first 1024 bytes, so it goes right after it.
const CHARSET = /<meta charset="[^"]*"\s*\/?>/i;

/** Vite plugin injecting the policy into index.html; `vite build` only. */
export function cspMetaPlugin(env) {
  let policy;
  return {
    name: 'speedline-csp-meta',
    apply: 'build',
    configResolved() {
      policy = buildCsp(env);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!CHARSET.test(html)) {
          throw new Error('index.html has no <meta charset> to anchor the CSP <meta> after.');
        }
        return html.replace(
          CHARSET,
          (charset) =>
            `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}
