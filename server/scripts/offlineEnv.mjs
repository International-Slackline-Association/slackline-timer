// The offline env the data-plane + relay handlers read directly — no SSM/STS,
// no AWS account. Injected by the dev scripts (devApi.mjs) and the in-process
// harnesses (localHttpHarness.mjs / localWsHarness.mjs), which run the handlers
// in the host process, so 127.0.0.1 reaches the LocalStack container directly.
// CDK resolves {{resolve:ssm:…}} only at deploy, never locally (ADR 0023).
export const OFFLINE_ENV = {
  IS_OFFLINE: 'true',
  READ_TOKEN_SECRET: 'local-dev-read-token-secret-change-me',
  AWS_REGION: 'eu-central-1',
  AWS_ACCESS_KEY_ID: 'local',
  AWS_SECRET_ACCESS_KEY: 'local',
  AWS_ACCOUNT_ID: '000000000000',
  // Must match the deployed CloudFormation TableName (Stage=prod) / createLocalTables.
  SPEEDLINE_TIMER_TABLE: 'slackline-timer-v1-relay-prod',
  COMPETITION_TABLE: 'slackline-timer-v1-competition-prod',
  // Cognito (non-secret IDs) — the same values the CDK stack sets (infra/slackline-stack.ts).
  COGNITO_USER_POOL_ID: 'eu-central-1_iGaYGKeyJ',
  COGNITO_CLIENT_ID: 'ds5av12gno4uf6vktmml11pll',
  COGNITO_TIMER_GROUP: 'timeradmin',
  // db_update broadcast endpoint — the local WS harness management API on :3001 (IPv4).
  WS_API_ENDPOINT: 'http://127.0.0.1:3001',
  // Photos run against LocalStack S3 (ADR 0023 §2): the S3 client points here
  // (core/aws/clients.ts), PHOTOS_BUCKET clears photoUpload's 503 guard, and
  // reads emit the direct unsigned object URL via S3_PUBLIC_URL (core/photoUrl.ts,
  // path-style: {S3_PUBLIC_URL}/{bucket}/{key}). The CloudFront keys stay empty
  // so the offline signer branch wins.
  PHOTO_PRIVATE_KEY: '',
  PHOTO_PUBLIC_KEY: '',
  PHOTOS_BUCKET: 'slackline-timer-v1-photos-local',
  // LocalStack exposes every service on the single edge port :4566.
  S3_ENDPOINT: 'http://127.0.0.1:4566',
  S3_PUBLIC_URL: 'http://127.0.0.1:4566',
  S3_ACCESS_KEY: 'local',
  S3_SECRET_KEY: 'locallocal',
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:4566',
};

/** Apply OFFLINE_ENV onto process.env without clobbering anything already set. */
export const applyOfflineEnv = () => {
  for (const [k, v] of Object.entries(OFFLINE_ENV)) process.env[k] ??= v;
};
