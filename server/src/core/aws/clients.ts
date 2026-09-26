import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

// Under local dev (IS_OFFLINE) point at the LocalStack endpoint (:4566) with
// throwaway credentials, so the data plane runs with no AWS account. In a real
// deployment the config is empty and the SDK resolves region/creds itself.
// See doc/dev/local-dev.md and docker/docker-compose.yml (localstack).
const clientConfig: DynamoDBClientConfig =
  process.env.IS_OFFLINE === 'true' || process.env.DYNAMODB_ENDPOINT
    ? {
        endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:4566',
        region: process.env.AWS_REGION ?? 'local',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {};

const dynamoDB = new DynamoDBClient(clientConfig);

export const ddb = DynamoDBDocumentClient.from(dynamoDB, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
ddb.middlewareStack.add(
  (next, context) => async (args) => {
    try {
      return await next(args);
    } catch (error) {
      console.error(`DynamoDB Error`, {
        command: context.commandName || args.constructor.name,
        input: args.input,
        error: (error as any).message,
      });
      throw error;
    }
  },
  {
    step: 'initialize',
    name: 'ddbErrorLogger',
  },
);

// Same offline swap as the DynamoDB config above, plus path-style addressing —
// the LocalStack endpoint serves no virtual-host buckets — so the real
// photoUpload POST-policy presign runs with no AWS account (ADR 0023 §2).
const s3Config: S3ClientConfig =
  process.env.IS_OFFLINE === 'true'
    ? {
        endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:4566',
        region: process.env.AWS_REGION ?? 'local',
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY ?? 'local',
          secretAccessKey: process.env.S3_SECRET_KEY ?? 'locallocal',
        },
        forcePathStyle: true,
      }
    : {};

export const s3 = new S3Client(s3Config);
