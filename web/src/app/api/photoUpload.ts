import { ApiError, apiFetch } from 'app/api/client';

/**
 * Athlete photo upload. The server never proxies bytes: it hands back an S3
 * presigned POST keyed by the file's content hash (immutable, deduplicating),
 * the browser uploads directly, then saves the returned `photoKey` on the
 * athlete. Reads later embed a CloudFront-signed `photoUrl`.
 */

/** Image types the photoUpload Lambda will presign (keep in sync with it). */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Human label per accepted MIME type, so the UI hint stays in sync with the guard. */
const IMAGE_TYPE_LABELS: Record<(typeof ACCEPTED_IMAGE_TYPES)[number], string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

/**
 * Upload size cap. The server presign now enforces this too via a
 * `content-length-range` POST-policy condition (keep the two in sync); this
 * client check just fails fast with a legible message instead of a late S3
 * 403. Stated to the operator via `acceptedFormatsHint`.
 */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_MB = Math.round(MAX_PHOTO_BYTES / (1024 * 1024));

/** "JPG, PNG or WebP, max 8 MB" — the operator-facing accepted-formats line. */
export const acceptedFormatsHint = (): string => {
  const labels = ACCEPTED_IMAGE_TYPES.map((t) => IMAGE_TYPE_LABELS[t]);
  const formats =
    labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}` : labels[0];
  return `${formats}, max ${MAX_PHOTO_MB} MB`;
};

interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  photoKey: string;
  expiresIn: number;
}

const sha256Hex = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Upload an athlete photo and resolve to the `photoKey` to store on the
 * athlete. Throws ApiError on an unsupported type, an oversize file, or a
 * failed S3 POST — all validated before the network where possible.
 */
export const uploadAthletePhoto = async (compId: string, file: File): Promise<string> => {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    const labels = ACCEPTED_IMAGE_TYPES.map((t) => IMAGE_TYPE_LABELS[t]).join(', ');
    throw new ApiError(400, `unsupported image type (use ${labels})`);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new ApiError(400, `image too large (max ${MAX_PHOTO_MB} MB)`);
  }

  const sha256 = await sha256Hex(file);
  const { url, fields, photoKey } = await apiFetch<PresignedUpload>(
    `/competitions/${compId}/photo-uploads`,
    { method: 'POST', body: { contentType: file.type, sha256 } },
  );

  // Direct-to-S3 multipart POST: plain fetch, no Authorization header. The
  // policy fields carry the credentials/signature and pin the key, content
  // type, and size range; the file part must come last (S3 ignores fields
  // after it). The browser sets the multipart Content-Type + boundary.
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append('file', file);

  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) {
    throw new ApiError(response.status, 'photo upload failed — check your connection and retry');
  }

  return photoKey;
};
