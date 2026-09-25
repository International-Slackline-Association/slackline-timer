// Provision the athlete-photo bucket in the LocalStack container
// (docker/docker-compose.yml → S3). Idempotent: an existing bucket is left
// alone, the policy + CORS are re-applied. Mirrors the photos bucket in
// infra/slackline-stack.ts at the level local dev needs — minus the OAC/signing
// edge (no local analogue, the bucket is public-read offline; see
// doc/dev/decisions.md 0023 §2). Wired into `npm run db:init` next to
// createLocalTables. See doc/dev/local-dev.md.

import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:4566';
const BUCKET = process.env.PHOTOS_BUCKET ?? 'slackline-timer-v1-photos-local';

const client = new S3Client({
  endpoint: ENDPOINT,
  // LocalStack S3 rejects a bogus region on CreateBucket (unlike DynamoDB); use a
  // real one. The dev:api flow sets AWS_REGION=eu-central-1 via offlineEnv anyway.
  region: process.env.AWS_REGION ?? 'eu-central-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'local',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'locallocal',
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until LocalStack S3 answers (it can lag the container start). */
const waitForS3 = async (attempts = 30) => {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
      return true; // bucket already exists
    } catch (err) {
      // A 404 (NotFound/NoSuchBucket) means S3 is up but the bucket is absent.
      const status = err?.$metadata?.httpStatusCode;
      if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchBucket') return false;
      if (i === attempts) throw err;
      if (i === 1) console.log(`⏳ Waiting for LocalStack S3 at ${ENDPOINT} …`);
      await sleep(1000);
    }
  }
  return false;
};

const publicReadPolicy = (bucket) =>
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });

export const ensureLocalBucket = async () => {
  const exists = await waitForS3();
  if (exists) {
    console.log(`✅ ${BUCKET} already exists`);
  } else {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`🆕 created ${BUCKET}`);
  }

  // Public-read so reads serve the direct, unsigned object URL offline (ADR 0023 §2).
  await client.send(
    new PutBucketPolicyCommand({ Bucket: BUCKET, Policy: publicReadPolicy(BUCKET) }),
  );
  console.log(`✅ ${BUCKET} public-read policy applied`);

  // Per-bucket CORS for the browser presigned POST (:5173 → :4566) and the
  // overlay/admin <img> GET. LocalStack S3 honours the bucket CORS config. `*`
  // is fine for a throwaway dev container.
  await client.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ['*'],
            AllowedMethods: ['GET', 'POST'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log(`✅ ${BUCKET} CORS applied`);
};

// Run directly: `node scripts/createLocalBucket.mjs`
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('createLocalBucket.mjs')
) {
  ensureLocalBucket()
    .then(() => console.log('✨ Local LocalStack S3 photo bucket ready'))
    .catch((err) => {
      console.error('❌ Failed to create local bucket:', err.message);
      console.error(`   Is the container up? Try: npm run db:up`);
      process.exit(1);
    });
}
