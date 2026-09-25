import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from 'aws-lambda';
import { s3 } from 'core/aws/clients';
import {
  AuthContext,
  HttpError,
  errorResponse,
  getAuth,
  json,
  loadCompetitionOrThrow,
  parseJsonBody,
  requireCompAccess,
  requireWrite,
} from 'core/http';

/**
 * POST /competitions/{compId}/photo-uploads → S3 presigned POST.
 *
 * Keys are content-hashed (photos/<compId>/<sha256>.<ext>): immutable,
 * unguessable, deduplicating. The browser computes the SHA-256, uploads via
 * the presigned POST (FormData against `url` + `fields`), then PUTs the athlete
 * with the returned photoKey. Reads never touch S3 directly — they go through
 * the CloudFront signed-URL pipeline (core/photoUrl.ts).
 *
 * POST (not PUT) so the policy can carry a `content-length-range` — a presigned
 * PUT cannot bound the body size, so the only cap would be the client check.
 */

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const UPLOAD_URL_TTL_SECONDS = 300;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const main: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext> = async (event) => {
  try {
    const auth = getAuth(event);
    const compId = event.pathParameters!.compId!;
    await requireCompAccess(auth, compId);
    requireWrite(auth);
    await loadCompetitionOrThrow(compId);

    const bucket = process.env.PHOTOS_BUCKET;
    if (!bucket) throw new HttpError(503, 'photo uploads are not configured');

    const body = parseJsonBody(event) as { contentType?: unknown; sha256?: unknown };
    const contentType = body.contentType;
    if (typeof contentType !== 'string' || !(contentType in EXTENSIONS)) {
      throw new HttpError(400, `contentType must be one of: ${Object.keys(EXTENSIONS).join(', ')}`);
    }
    if (typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)) {
      throw new HttpError(400, 'sha256 must be the lowercase hex SHA-256 of the file');
    }

    const photoKey = `photos/${compId}/${body.sha256}.${EXTENSIONS[contentType]}`;
    const { url, fields } = await createPresignedPost(s3, {
      Bucket: bucket,
      Key: photoKey,
      Fields: { 'Content-Type': contentType },
      // Server-enforced bounds the browser can't lie about: bytes ≤ 8 MB and
      // the content type must match (a presigned PUT could express neither).
      Conditions: [
        ['content-length-range', 0, MAX_PHOTO_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Expires: UPLOAD_URL_TTL_SECONDS,
    });

    return json(200, { url, fields, photoKey, expiresIn: UPLOAD_URL_TTL_SECONDS });
  } catch (e) {
    return errorResponse(e);
  }
};
