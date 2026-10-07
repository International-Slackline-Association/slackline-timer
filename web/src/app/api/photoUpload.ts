import { ApiError, apiFetch } from 'app/api/client';
import { ImageTooLargeError, browserCodec, resizeImage } from 'app/util/resizeImage';

/**
 * Athlete photo upload. The picked image is resized to a ≤ 1 MiB JPEG in the
 * browser (app/util/resizeImage.ts); the server never proxies bytes: it hands
 * back an S3 presigned POST keyed by that JPEG's content hash (S3 verifies the
 * bytes against it), the browser uploads directly, then saves the returned
 * `photoKey` on the athlete. Reads later embed a CloudFront-signed `photoUrl`.
 */

/** Source formats the picker accepts; every upload is re-encoded as JPEG. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Human label per accepted MIME type, so the UI hint stays in sync with the guard. */
const IMAGE_TYPE_LABELS: Record<(typeof ACCEPTED_IMAGE_TYPES)[number], string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

/**
 * Source-file cap before decoding: the resize bounds what is uploaded, this
 * bounds the memory a full-resolution decode takes.
 */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_SOURCE_MB = MAX_SOURCE_BYTES / (1024 * 1024);

/** "JPG, PNG or WebP, max 30 MB" — the operator-facing accepted-formats line. */
export const acceptedFormatsHint = (): string => {
  const labels = ACCEPTED_IMAGE_TYPES.map((t) => IMAGE_TYPE_LABELS[t]);
  const formats =
    labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}` : labels[0];
  return `${formats}, max ${MAX_SOURCE_MB} MB`;
};

interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  photoKey: string;
  expiresIn: number;
}

const sha256Hex = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const toJpeg = async (file: File): Promise<Blob> => {
  try {
    return await resizeImage(file, browserCodec);
  } catch (e) {
    throw new ApiError(
      400,
      e instanceof ImageTooLargeError ? e.message : 'could not read this image — try another file',
    );
  }
};

/**
 * Upload an athlete photo and resolve to the `photoKey` to store on the
 * athlete. Throws ApiError on an unsupported type, an oversize or unreadable
 * file, or a failed S3 POST — all validated before the network where possible.
 */
export const uploadAthletePhoto = async (compId: string, file: File): Promise<string> => {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    const labels = ACCEPTED_IMAGE_TYPES.map((t) => IMAGE_TYPE_LABELS[t]).join(', ');
    throw new ApiError(400, `unsupported image type (use ${labels})`);
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ApiError(400, `image too large (max ${MAX_SOURCE_MB} MB)`);
  }

  const jpeg = await toJpeg(file);
  const sha256 = await sha256Hex(jpeg);
  const { url, fields, photoKey } = await apiFetch<PresignedUpload>(
    `/competitions/${compId}/photo-uploads`,
    { method: 'POST', body: { contentType: 'image/jpeg', sha256 } },
  );

  // Direct-to-S3 multipart POST: plain fetch, no Authorization header. Every
  // returned field is a policy condition (key, content type, checksum, size
  // range), so all go in verbatim; the file part must come last (S3 ignores
  // fields after it). The browser sets the multipart Content-Type + boundary.
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append('file', jpeg);

  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) {
    throw new ApiError(response.status, 'photo upload failed — check your connection and retry');
  }

  return photoKey;
};
