/**
 * In-browser downscale + JPEG re-encode before an athlete photo upload. Bounds
 * the stored size (the photoUpload presign caps the POST at `MAX_PHOTO_BYTES`),
 * applies the EXIF orientation and drops the metadata (GPS included) with it.
 */

/** Keep in sync with MAX_PHOTO_BYTES in server/src/functions/photoUpload/handler.ts. */
export const MAX_PHOTO_BYTES = 1024 * 1024;

export const MAX_EDGE_PX = 1280;

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45];

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** Decode + encode seam; jsdom has neither `createImageBitmap` nor a canvas. */
export interface ImageCodec<T extends DecodedImage> {
  decode(file: Blob): Promise<T>;
  encodeJpeg(image: T, width: number, height: number, quality: number): Promise<Blob>;
}

/** Fit inside `maxEdge` × `maxEdge`, keeping the aspect ratio; never upscales. */
export const targetSize = (
  width: number,
  height: number,
  maxEdge = MAX_EDGE_PX,
): { width: number; height: number } => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const draw = (
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null,
  image: ImageBitmap,
  width: number,
  height: number,
) => {
  if (!ctx) throw new Error('canvas 2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
};

export const browserCodec: ImageCodec<ImageBitmap> = {
  decode: (file) => createImageBitmap(file, { imageOrientation: 'from-image' }),
  encodeJpeg: async (image, width, height, quality) => {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      draw(canvas.getContext('2d'), image, width, height);
      return canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), image, width, height);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed'))),
        'image/jpeg',
        quality,
      ),
    );
  },
};

export class ImageTooLargeError extends Error {
  constructor() {
    super(`image still exceeds ${MAX_PHOTO_BYTES / (1024 * 1024)} MB after resizing`);
    this.name = 'ImageTooLargeError';
  }
}

/** JPEG of at most `MAX_EDGE_PX` on the long edge, stepping quality down until ≤ `MAX_PHOTO_BYTES`. */
export const resizeImage = async <T extends DecodedImage>(
  file: Blob,
  codec: ImageCodec<T>,
): Promise<Blob> => {
  const image = await codec.decode(file);
  try {
    const { width, height } = targetSize(image.width, image.height);
    for (const quality of QUALITY_STEPS) {
      const jpeg = await codec.encodeJpeg(image, width, height, quality);
      if (jpeg.size <= MAX_PHOTO_BYTES) return jpeg;
    }
  } finally {
    image.close();
  }
  throw new ImageTooLargeError();
};
