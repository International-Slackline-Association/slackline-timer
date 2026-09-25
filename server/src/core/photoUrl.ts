import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { getPhotoPrivateKey } from 'core/secrets';

/**
 * CloudFront-signed photo URLs.
 *
 * The photo bucket is never public — it is only reachable through a
 * CloudFront behavior restricted to a trusted key group, so every read needs
 * a signed URL. Read Lambdas embed these in their responses (athletes,
 * rankings, vs-cards); signing is a local RSA operation, no S3 round trip.
 *
 * Why CloudFront signing instead of S3 presigned GETs: presigned URLs from a
 * Lambda role are capped at the role-session lifetime (hours); CloudFront
 * signed URLs have no expiry cap, so they can live until the competition's
 * endDate (≤ ~10 days, see core/eventWindow.ts).
 */

export interface PhotoUrlSigner {
  (photoKey: string, expiresAtMs: number): string;
}

/** The private key is a SecureString fetched at runtime (core/secrets.ts, ADR 0025). */
export const createPhotoUrlSigner = (config: {
  /** CloudFront distribution domain, e.g. dxxxxxxxx.cloudfront.net */
  cdnDomain: string;
  /** Id of the AWS::CloudFront::PublicKey in the trusted key group. */
  keyPairId: string;
  /** RSA private key (PEM) matching that public key. */
  privateKeyPem: string;
}): PhotoUrlSigner => {
  return (photoKey, expiresAtMs) =>
    getSignedUrl({
      url: `https://${config.cdnDomain}/${photoKey}`,
      keyPairId: config.keyPairId,
      privateKey: config.privateKeyPem,
      dateLessThan: new Date(expiresAtMs).toISOString(),
    });
};

/**
 * Offline (LocalStack S3) signer: the local S3 emulator bucket is public-read, so there
 * is no signing — emit the direct path-style object URL. CloudFront signing has
 * no local analogue (it is an edge operation over a private origin), so this is
 * the one accepted prod-vs-local divergence (see doc/dev/decisions.md 0023 §2). The
 * `expiresAtMs` arg is kept for signature parity with the prod signer and ignored.
 */
const createOfflinePhotoUrlSigner = (config: {
  bucket: string;
  publicBaseUrl: string;
}): PhotoUrlSigner => {
  const base = config.publicBaseUrl.replace(/\/$/, '');
  return (photoKey) => `${base}/${config.bucket}/${photoKey}`;
};

/** Signer wired from the Lambda environment; null when photos are not configured. */
export const photoUrlSignerFromEnv = async (): Promise<PhotoUrlSigner | null> => {
  const cdnDomain = process.env.PHOTO_CDN_DOMAIN;
  const keyPairId = process.env.PHOTO_KEY_PAIR_ID;
  const privateKeyPem = await getPhotoPrivateKey();
  if (cdnDomain && keyPairId && privateKeyPem) {
    return createPhotoUrlSigner({ cdnDomain, keyPairId, privateKeyPem });
  }

  if (process.env.IS_OFFLINE === 'true' && process.env.PHOTOS_BUCKET) {
    return createOfflinePhotoUrlSigner({
      bucket: process.env.PHOTOS_BUCKET,
      publicBaseUrl:
        process.env.S3_PUBLIC_URL ?? process.env.S3_ENDPOINT ?? 'http://localhost:4566',
    });
  }

  return null;
};

/**
 * Embed a signed `photoUrl` next to an entity's `photoKey` — timertimer's
 * "never ship picture bytes when listing" rule, ported: responses carry a
 * short-lived URL, not the photo and not a public location.
 */
export const attachPhotoUrl = <T extends { photoKey?: string }>(
  entity: T,
  signer: PhotoUrlSigner | null,
  expiresAtMs: number,
): T & { photoUrl?: string } => {
  if (!entity.photoKey || !signer) return entity;
  return { ...entity, photoUrl: signer(entity.photoKey, expiresAtMs) };
};
