// The whole web deploy, in order: resolve every environment-specific value from
// the stack that owns it (+ `.env.deploy`), build the bundle with those values
// baked in, sync dist/ to the resolved UI bucket, force index.html to no-cache,
// invalidate the resolved CloudFront distribution. Invoked by `npm run deploy`.
//
// Resolve-then-build is the required order: the bundle embeds VITE_APP_* at
// build time. `npm run build` therefore stays credential-free (CI builds it
// with no AWS access) and this is the only entrypoint that needs a session.
//
// Nothing falls back to a committed value (ADR 0048): with `--delete` on the
// sync, a stale bucket name is a destructive operation against whatever bucket
// now answers to that name.
//
// Requires an authenticated AWS CLI v2 session and $AWS_PROFILE (exported, or
// set in the ignored repo-root `.env.deploy`).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BACKEND_OUTPUTS, buildViteEnv, liveStack, loadDeployEnv } from './deployConfig.mjs';
import { requireOutputs, runAws, stackOutputs } from './stackOutputs.mjs';

// Anchored to the package root, not cwd: `node web/internals/deployToS3.mjs`
// from the repo root must upload the same dist/ as `npm run deploy` does.
// Spelled the long way for the Vite asset-rewrite reason in deployConfig.mjs.
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(WEB_ROOT, 'dist');

loadDeployEnv();

/** Run `aws <args>` inheriting stdio (so sync progress streams through). */
function aws(args, { profile, region } = {}) {
  const full = [...args];
  if (region) full.push('--region', region);
  if (profile) full.push('--profile', profile);
  execFileSync('aws', full, { stdio: 'inherit', windowsHide: true });
}

/** `npm run build` with the resolved VITE_APP_* env. Throws on a failed build. */
function buildBundle(viteEnv) {
  const res = spawnSync('npm', ['run', 'build'], {
    cwd: WEB_ROOT,
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32', // npm.cmd needs a shell on Windows
    env: { ...process.env, ...viteEnv },
  });
  if (res.status !== 0) throw new Error('`npm run build` failed — nothing was uploaded.');
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`the build produced no ${join(DIST, 'index.html')} — nothing was uploaded.`);
  }
}

/**
 * The gate on `s3 sync --delete`. The bucket name came from the stack, but this
 * run's credentials decide which ACCOUNT that name resolves in, and a dev box
 * with a default profile pointing at an unrelated account is the documented
 * hazard. head-bucket with --expected-bucket-owner fails on both "not there"
 * and "someone else's". Called before the build: same guarantee, minus a
 * wasted build.
 *
 * `account` is required, not optional — omitting the flag silently downgrades
 * this to "the bucket exists and I can reach it", the case it exists to reject.
 */
export function assertBucketIsOurs(bucket, { profile, region, account, run = runAws }) {
  try {
    run(['s3api', 'head-bucket', '--bucket', bucket, '--expected-bucket-owner', account], {
      profile,
      region,
    });
  } catch (err) {
    throw new Error(
      `refusing to sync: cannot confirm s3://${bucket} is owned by account ${account} — ${err.message}`,
      { cause: err },
    );
  }
}

function main() {
  const profile = process.env.AWS_PROFILE;
  if (!profile) {
    // Fatal rather than falling through to the CLI's default credential
    // resolution: the resolved bucket is only as trustworthy as the account the
    // credentials land in.
    throw new Error(
      'AWS_PROFILE is not set — put it in the repo-root `.env.deploy` ' +
        '(template: .env.deploy.example) or export it.',
    );
  }

  // The only thing separating our bucket from an identically-named one in
  // whatever account the credentials actually resolve to.
  const account = process.env.AWS_ACCOUNT_ID;
  if (!account) {
    throw Object.assign(
      new Error(
        'AWS_ACCOUNT_ID is not set — it gates the `--delete` sync against a ' +
          'wrong-account bucket. Put it in the repo-root `.env.deploy` ' +
          '(template: .env.deploy.example) or export it.',
      ),
      { code: 'CONFIG' },
    );
  }

  const backend = liveStack('backend');
  const web = liveStack('web');
  console.log(`Profile : ${profile}`);
  console.log(`Stacks  : ${backend.name} (${backend.region}), ${web.name} (${web.region})`);

  const backendOutputs = requireOutputs(
    stackOutputs(backend.name, { region: backend.region, profile }),
    BACKEND_OUTPUTS,
    { stackName: backend.name, region: backend.region },
  );
  const { WebBucketName: bucket, WebDistributionId: distributionId } = requireOutputs(
    stackOutputs(web.name, { region: web.region, profile }),
    ['WebBucketName', 'WebDistributionId'],
    { stackName: web.name, region: web.region },
  );
  const viteEnv = buildViteEnv({ outputs: backendOutputs, env: process.env, stack: backend });

  console.log(`Bucket  : ${bucket}`);
  console.log(`CF dist : ${distributionId}`);
  for (const [key, value] of Object.entries(viteEnv)) console.log(`   ${key.padEnd(30)} ${value}`);

  const awsOpts = { profile, region: web.region };
  assertBucketIsOurs(bucket, { ...awsOpts, account });

  console.log('\nBuilding...');
  buildBundle(viteEnv);

  console.log(`\nSyncing ${DIST} -> s3://${bucket} ...`);
  aws(
    ['s3', 'sync', DIST, `s3://${bucket}`, '--delete', '--cache-control', 'max-age=86400,public'],
    awsOpts,
  );

  console.log('Adjusting cache...');
  aws(
    // prettier-ignore
    ['s3', 'cp', `s3://${bucket}/index.html`, `s3://${bucket}/index.html`, '--metadata-directive', 'REPLACE', '--cache-control', 'max-age=0,no-cache,no-store,must-revalidate', '--content-type', 'text/html'],
    awsOpts,
  );

  console.log('Invalidating cloudfront cache...');
  // The leading-slash `--paths /*` is safe here: execFileSync passes argv
  // straight to the aws executable with NO intervening MSYS/Git-Bash shell, so
  // MSYS path-conversion never mangles `/*` into `C:/Program Files/Git/*`. The
  // old .sh needed MSYS_NO_PATHCONV=1 for this — do NOT reintroduce a shell
  // (sh/PowerShell) around the call.
  aws(
    // prettier-ignore
    ['cloudfront', 'create-invalidation', '--distribution-id', distributionId, '--paths', '/*', '--no-cli-pager'],
    { profile },
  );

  console.log('\nDeployed.');
}

// Only self-invoke as the CLI entrypoint, so the guards above stay importable
// by their tests (the idiom `server/infra/app.ts` uses for the same reason).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

function runCli() {
  try {
    main();
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    // A missing profile or config key is not an auth failure, and the hint
    // would send the operator down the wrong path. `CONFIG` matches the
    // convention in server/scripts/cognito/.
    if (process.env.AWS_PROFILE && err.code !== 'CONFIG') {
      console.error(`   (expired SSO? try: aws sso login --profile ${process.env.AWS_PROFILE})`);
    }
    process.exit(1);
  }
}
