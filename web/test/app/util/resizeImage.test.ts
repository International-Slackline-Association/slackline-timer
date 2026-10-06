import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type DecodedImage,
  type ImageCodec,
  ImageTooLargeError,
  MAX_PHOTO_BYTES,
  browserCodec,
  resizeImage,
  targetSize,
} from 'app/util/resizeImage';

const blobOf = (size: number) => ({ size, type: 'image/jpeg' }) as Blob;

const fakeCodec = (width: number, height: number, sizes: number[]) => {
  const image: DecodedImage = { width, height, close: vi.fn() };
  const codec: ImageCodec<DecodedImage> = {
    decode: vi.fn(async () => image),
    encodeJpeg: vi.fn(async () => blobOf(sizes.shift() ?? 0)),
  };
  return { image, codec };
};

describe('targetSize', () => {
  it('fits the long edge to 1280, keeping the aspect ratio', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(targetSize(3024, 4032)).toEqual({ width: 960, height: 1280 });
  });

  it('never upscales', () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('keeps extreme ratios at least one pixel wide', () => {
    expect(targetSize(100_000, 10)).toEqual({ width: 1280, height: 1 });
  });
});

describe('resizeImage', () => {
  it('encodes at 0.85 at the target size and closes the decoded image', async () => {
    const { image, codec } = fakeCodec(4000, 3000, [300_000]);
    const file = blobOf(5_000_000);

    const out = await resizeImage(file, codec);

    expect(out.size).toBe(300_000);
    expect(codec.decode).toHaveBeenCalledWith(file);
    expect(codec.encodeJpeg).toHaveBeenCalledExactlyOnceWith(image, 1280, 960, 0.85);
    expect(image.close).toHaveBeenCalledOnce();
  });

  it('steps quality down until the JPEG fits under 1 MiB', async () => {
    const { codec } = fakeCodec(1280, 1280, [2_000_000, MAX_PHOTO_BYTES + 1, MAX_PHOTO_BYTES]);

    const out = await resizeImage(blobOf(1), codec);

    expect(out.size).toBe(MAX_PHOTO_BYTES);
    expect(vi.mocked(codec.encodeJpeg).mock.calls.map((c) => c[3])).toEqual([0.85, 0.75, 0.65]);
  });

  it('throws when no quality step fits, still closing the image', async () => {
    const { image, codec } = fakeCodec(1280, 1280, Array(10).fill(MAX_PHOTO_BYTES * 2));

    await expect(resizeImage(blobOf(1), codec)).rejects.toBeInstanceOf(ImageTooLargeError);
    expect(image.close).toHaveBeenCalledOnce();
  });
});

describe('browserCodec', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('decodes with the EXIF orientation applied', async () => {
    const bitmap = { width: 1, height: 1, close: vi.fn() };
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    const file = blobOf(1);

    await expect(browserCodec.decode(file)).resolves.toBe(bitmap);
    expect(createImageBitmapMock).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
  });

  it('draws onto an OffscreenCanvas and encodes a JPEG at the given quality', async () => {
    const drawImage = vi.fn();
    const convertToBlob = vi.fn().mockResolvedValue(blobOf(42));
    const canvases: { width: number; height: number }[] = [];
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          canvases.push(this);
        }
        getContext = () => ({ drawImage });
        convertToBlob = convertToBlob;
      },
    );
    const bitmap = {} as ImageBitmap;

    const out = await browserCodec.encodeJpeg(bitmap, 640, 480, 0.75);

    expect(out.size).toBe(42);
    expect(canvases).toEqual([expect.objectContaining({ width: 640, height: 480 })]);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 640, 480);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.75 });
  });
});
