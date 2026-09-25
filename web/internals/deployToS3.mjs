// Deploy the built web app: sync dist/ to the UI S3 bucket, force index.html to
// no-cache, and invalidate CloudFront. Invoked by `npm run deploy` (after
// `npm run build`) from the web package root, so dist/ resolves relative to cwd.
//
// Requires an authenticated AWS CLI v2 session and $AWS_PROFILE (exported, or
// set in the ignored repo-root `.env.deploy`). Standalone (no
// shared glue — the web package carries no @aws-sdk / cognito helpers), so runAws
// is inlined here.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Deployment config (AWS_PROFILE) from the ignored repo-root `.env.deploy` —
// template: `.env.deploy.example`. An already-exported AWS_PROFILE still wins.
const DEPLOY_ENV = fileURLToPath(new URL('../../.env.deploy', import.meta.url));
if (existsSync(DEPLOY_ENV)) process.loadEnvFile(DEPLOY_ENV);

// slackline-timer-v1-web (eu-central-1) stack outputs: WebBucketName / WebDistributionId.
const S3_BUCKET = 'slackline-timer-v1-ui-prod';
const CF_ID = 'E26TGYRA112XLM';

const awsProfile = process.env.AWS_PROFILE;

console.log(`Profile: ${awsProfile ?? ''}`);
console.log(`S3_Bucket: ${S3_BUCKET}`);
console.log(`CloudFront Distribution: ${CF_ID}`);

if (!awsProfile) {
  console.log('AWS_PROFILE not found');
  process.exit(0);
}

/** Run `aws <args>` inheriting stdio (so progress/output stream through). */
function aws(args) {
  execFileSync('aws', args, { stdio: 'inherit', windowsHide: true });
}

console.log(`Synching Build Folder: ${S3_BUCKET}...`);
aws([
  's3',
  'sync',
  'dist/',
  `s3://${S3_BUCKET}`,
  '--delete',
  '--cache-control',
  'max-age=86400,public',
]);

console.log('Adjusting cache...');
aws([
  's3',
  'cp',
  `s3://${S3_BUCKET}/index.html`,
  `s3://${S3_BUCKET}/index.html`,
  '--metadata-directive',
  'REPLACE',
  '--cache-control',
  'max-age=0,no-cache,no-store,must-revalidate',
  '--content-type',
  'text/html',
]);

if (CF_ID) {
  console.log('Invalidating cloudfront cache');
  // The leading-slash `--paths /*` is safe here: execFileSync passes argv
  // straight to the aws executable with NO intervening MSYS/Git-Bash shell, so
  // MSYS path-conversion never mangles `/*` into `C:/Program Files/Git/*`. This
  // is why the old .sh needed MSYS_NO_PATHCONV=1 and this .mjs does not — do NOT
  // reintroduce a shell pipe (sh/PowerShell) around this call.
  aws([
    'cloudfront',
    'create-invalidation',
    '--distribution-id',
    CF_ID,
    '--paths',
    '/*',
    '--no-cli-pager',
  ]);
}
