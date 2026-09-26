/**
 * Backend endpoints and Cognito identifiers, supplied by the build.
 *
 * Nothing here has a fallback (ADR 0048): an env var backed by a production
 * literal means a build with no env ships *our* backend, and a fork ships
 * someone else's. `vite build` already refuses to emit a bundle with one
 * missing (`web/vite.config.ts`), so this throw is the backstop, not the gate.
 *
 * Local dev reads `web/.env.development` (copy the `.example` beside it);
 * deploys get the URLs from the CDK stack outputs and the Cognito identifiers
 * from `.env.deploy`.
 */
const required = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(
      `${name} is not set. Local dev: copy web/.env.development.example to ` +
        `web/.env.development. Builds: supply it through the deploy tooling ` +
        `(CDK stack outputs + .env.deploy).`,
    );
  }
  return value;
};

// Offline escape hatch (VITE_APP_LOCAL_DEV=true in web/.env.development): skips
// Cognito sign-in / group checks and connects to the relay with a dummy token,
// so the UI can be driven against the local backend (harnesses + LocalStack).
// The real security boundary is the $connect authorizer, but this removes the
// UI gate and sends a fake Authorization token — `vite build` refuses a bundle
// with it set.
export const LOCAL_DEV = import.meta.env.VITE_APP_LOCAL_DEV === 'true';

/**
 * LOCAL_DEV swaps out the whole Cognito path (`PassthroughGate` + a dummy
 * token — see `app/auth`), so a local run has no pool to name. The exemption
 * cannot reach a deployed bundle: `vite build` refuses both
 * VITE_APP_LOCAL_DEV=true and any missing key, so a real bundle always takes
 * the `required` branch.
 */
const cognitoConfig = (name: string, value: string | undefined): string =>
  LOCAL_DEV ? (value ?? '') : required(name, value);

// The CDK `WebsocketUrl` output in a deploy; the local WS relay harness
// (ws://127.0.0.1:3001) in dev.
export const WS_URL = required('VITE_APP_WS_URL', import.meta.env.VITE_APP_WS_URL);

// Competition data (athletes / times / matches / rankings) — the CDK
// `HttpApiUrl` output in a deploy, the local HTTP harness (:3002) in dev.
export const HTTP_API_URL = required('VITE_APP_API_URL', import.meta.env.VITE_APP_API_URL);

// Must match COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID on the server.
export const COGNITO_USER_POOL_ID = cognitoConfig(
  'VITE_APP_COGNITO_USER_POOL_ID',
  import.meta.env.VITE_APP_COGNITO_USER_POOL_ID,
);
export const COGNITO_CLIENT_ID = cognitoConfig(
  'VITE_APP_COGNITO_CLIENT_ID',
  import.meta.env.VITE_APP_COGNITO_CLIENT_ID,
);

// The Hosted-UI domain the sign-in redirect goes to.
export const COGNITO_DOMAIN = cognitoConfig(
  'VITE_APP_COGNITO_DOMAIN',
  import.meta.env.VITE_APP_COGNITO_DOMAIN,
);

// The group allowed to operate the timer. Must match COGNITO_TIMER_GROUP on the server.
export const TIMER_GROUP = cognitoConfig(
  'VITE_APP_COGNITO_TIMER_GROUP',
  import.meta.env.VITE_APP_COGNITO_TIMER_GROUP,
);
