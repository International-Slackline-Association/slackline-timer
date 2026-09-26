declare global {
  namespace NodeJS {
    interface ProcessEnv {
      SPEEDLINE_TIMER_TABLE: string;
      COMPETITION_TABLE: string;
      COGNITO_USER_POOL_ID: string;
      COGNITO_CLIENT_ID: string;
      COGNITO_TIMER_GROUP: string;
      /** The pool's home region (the backend may run elsewhere) — core/cognitoUsers.ts. */
      COGNITO_REGION?: string;
      /** WS management endpoint for db_update broadcasts (core/broadcast.ts). */
      WS_API_ENDPOINT?: string;
      PHOTOS_BUCKET?: string;
      /** Photo CDN config (not secret). */
      PHOTO_CDN_DOMAIN?: string;
      PHOTO_KEY_PAIR_ID?: string;
      /** RSA private key (PEM) — direct value offline/tests only; prod fetches via core/secrets.ts. */
      PHOTO_PRIVATE_KEY?: string;
      /** SSM SecureString parameter name for the photo private key (ADR 0025). */
      PHOTO_PRIVATE_KEY_PARAM?: string;
      /** Offline only (IS_OFFLINE): LocalStack S3 endpoint for the S3 client. */
      S3_ENDPOINT?: string;
      /** Offline only: browser-reachable base for unsigned S3 object URLs. */
      S3_PUBLIC_URL?: string;
      /** Offline only: LocalStack S3 credentials (default local / locallocal). */
      S3_ACCESS_KEY?: string;
      S3_SECRET_KEY?: string;
      /** HMAC secret for event read tokens — direct value offline/tests only; prod fetches via core/secrets.ts. */
      READ_TOKEN_SECRET?: string;
      /** SSM SecureString parameter name for the read-token secret (ADR 0025). */
      READ_TOKEN_SECRET_PARAM?: string;
    }
  }
}

export {};
