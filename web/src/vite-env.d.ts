/// <reference types="vite/client" />

/**
 * Optional because `import.meta.env` genuinely may not carry them —
 * `src/app/constants.ts` is what turns a missing one into a hard failure.
 */
interface ImportMetaEnv {
  /** WebSocket backend URL — CDK `WebsocketUrl` output (ws://127.0.0.1:3001 for the local relay harness). */
  readonly VITE_APP_WS_URL?: string;
  /** Competition-data HTTP API URL — CDK `HttpApiUrl` output (http://127.0.0.1:3002 for the local harness). */
  readonly VITE_APP_API_URL?: string;
  /** Cognito user pool holding the operators. */
  readonly VITE_APP_COGNITO_USER_POOL_ID?: string;
  /** Public SPA app client (no secret) on that pool. */
  readonly VITE_APP_COGNITO_CLIENT_ID?: string;
  /** Cognito Hosted-UI domain the sign-in redirect goes to. */
  readonly VITE_APP_COGNITO_DOMAIN?: string;
  /** Cognito group allowed to operate the timer; mirrors the server's COGNITO_TIMER_GROUP. */
  readonly VITE_APP_COGNITO_TIMER_GROUP?: string;
  /** "true" to bypass Cognito auth for local development. Never set in production builds. */
  readonly VITE_APP_LOCAL_DEV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
