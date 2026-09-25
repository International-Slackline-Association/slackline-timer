// Production API Gateway WebSocket endpoint (CDK slackline-timer-v1 WebsocketUrl
// output, eu-central-2). Used unless VITE_APP_WS_URL overrides it (set in
// web/.env.development to point at the local WS relay harness, e.g.
// ws://localhost:3001).
export const WS_URL =
  import.meta.env.VITE_APP_WS_URL ?? 'wss://6v1p3rr8eb.execute-api.eu-central-2.amazonaws.com/prod';

// Competition-data HTTP API (athletes / times / matches / rankings) — the CDK
// slackline-timer-v1 HttpApiUrl output (eu-central-2). VITE_APP_API_URL overrides it
// (web/.env.development → local HTTP harness on :3002).
export const HTTP_API_URL =
  import.meta.env.VITE_APP_API_URL ??
  'https://16e1mgulu0.execute-api.eu-central-2.amazonaws.com/prod';

// Local-dev escape hatch. When set (VITE_APP_LOCAL_DEV=true in
// web/.env.development) the app skips Cognito sign-in / group checks and
// connects to the relay with a dummy token, so the UI can be driven offline
// against the local backend (harnesses + LocalStack). NEVER enable this for a
// production build — the real security boundary is the $connect authorizer,
// but this removes the UI gate and sends a fake Authorization token.
export const LOCAL_DEV = import.meta.env.VITE_APP_LOCAL_DEV === 'true';

// ISA shared Cognito user pool (same pool isa-users/SportHub use). Public SPA
// app client (no secret); must match COGNITO_CLIENT_ID in the server (COGNITO
// in infra/slackline-stack.ts).
export const COGNITO_USER_POOL_ID = 'eu-central-1_iGaYGKeyJ';
export const COGNITO_CLIENT_ID = 'ds5av12gno4uf6vktmml11pll';

// Shared ISA Cognito Hosted-UI domain — the same login isa-users uses.
export const COGNITO_DOMAIN = 'auth.slacklineinternational.org';

// Cognito group allowed to operate the timer. Must match COGNITO_TIMER_GROUP in the server.
export const TIMER_GROUP = 'timeradmin';
