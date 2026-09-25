/// <reference types="vite/client" />

declare const __APP_VERSION__: string; // injected by vite.config.ts

interface ImportMetaEnv {
  /** Override the WebSocket backend URL (e.g. ws://localhost:3001 for the local WS relay harness). */
  readonly VITE_APP_WS_URL?: string;
  /** Override the competition-data HTTP API URL (e.g. http://localhost:3002 for the local HTTP harness). */
  readonly VITE_APP_API_URL?: string;
  /** "true" to bypass Cognito auth for local development. Never set in production builds. */
  readonly VITE_APP_LOCAL_DEV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
