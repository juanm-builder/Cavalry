import { describe, expect, it, vi } from 'vitest';

import {
  COMPANION_IMAGE_ATTACHMENT_ACCEPT,
  COMPANION_IMAGE_ATTACHMENT_MAX_COUNT,
  COMPANION_IMAGE_ATTACHMENT_MAX_EDGE,
  COMPANION_IMAGE_ATTACHMENT_MAX_PROCESSED_BYTES,
  COMPANION_IMAGE_ATTACHMENT_MIME_TYPES,
  COMPANION_IMAGE_ATTACHMENT_SUPPORTED_TYPES,
  estimateCompanionImageDataUrlBytes,
  getCompanionGifFrameCount,
  inferCompanionImageMimeType,
  isCompanionAnimatedGif,
  prepareCompanionImageAttachment,
  processCompanionImageAttachments,
  readCompanionImageAsDataUrl,
  validateCompanionImageAttachmentMeta
} from '../../src/renderer/features/assistant/companion-image-attachments.js';

function dataUrl(mimeType, bytes) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function image(name, mimeType, bytes) {
  return {
    name,
    type: mimeType,
    size: bytes.length,
    dataUrl: dataUrl(mimeType, bytes)
  };
}

function gifBytes(frameCount) {
  const header = Array.from(Buffer.from('GIF89a', 'ascii'));
  const logicalScreenDescriptor = [1, 0, 1, 0, 0, 0, 0];
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0];
  return Uint8Array.from([
    ...header,
    ...logicalScreenDescriptor,
    ...Array.from({ length: frameCount }, () => frame).flat(),
    0x3b
  ]);
}

describe('Companion image attachments', () => {
  it('exports UI-ready supported types and validates actionable file metadata', () => {
    expect(COMPANION_IMAGE_ATTACHMENT_MAX_COUNT).toBe(50);
    expect(COMPANION_IMAGE_ATTACHMENT_MAX_EDGE).toBe(1536);
    expect(COMPANION_IMAGE_ATTACHMENT_MAX_PROCESSED_BYTES).toBe(48 * 1024 * 1024);
    expect(COMPANION_IMAGE_ATTACHMENT_ACCEPT).toContain('.gif');
    expect(COMPANION_IMAGE_ATTACHMENT_MIME_TYPES).toContain('image/webp');
    expect(COMPANION_IMAGE_ATTACHMENT_SUPPORTED_TYPES).toContain('non-animated GIF');
    expect(inferCompanionImageMimeType({ name: 'receipt.jpeg' })).toBe('image/jpeg');

    expect(
      validateCompanionImageAttachmentMeta({ name: 'receipt.png', type: 'image/png', size: 400 })
    ).toMatchObject({ ok: true, filename: 'receipt.png', mimeType: 'image/png', size: 400 });
    expect(
      validateCompanionImageAttachmentMeta({
        name: 'receipt.svg',
        type: 'image/svg+xml',
        size: 400
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'unsupported_image_type',
        message: expect.stringMatching(/Choose PNG, JPEG, WebP, or a non-animated GIF/)
      }
    });
    expect(
      validateCompanionImageAttachmentMeta({ name: 'empty.png', type: 'image/png', size: 0 })
    ).toMatchObject({
      ok: false,
      error: { code: 'empty_image', message: expect.stringMatching(/empty or could not be read/) }
    });
  });

  it('reads browser File objects as data URLs and can accept an existing data URL', async () => {
    const expected = dataUrl('image/png', [1, 2, 3]);
    class FakeFileReader {
      readAsDataURL(file) {
        this.result = file.result;
        this.onload();
      }
    }

    await expect(
      readCompanionImageAsDataUrl(
        { name: 'receipt.png', type: 'image/png', size: 3, result: expected },
        { FileReader: FakeFileReader }
      )
    ).resolves.toBe(expected);
    await expect(readCompanionImageAsDataUrl({ dataUrl: expected })).resolves.toBe(expected);
    expect(estimateCompanionImageDataUrlBytes(expected)).toBe(3);
  });

  it('accepts at least 40 images, preserves input order, and caps a message at 50', async () => {
    const forty = Array.from({ length: 40 }, (_value, index) =>
      image(`receipt-${String(index).padStart(2, '0')}.png`, 'image/png', [index])
    );
    const result = await processCompanionImageAttachments(forty);

    expect(result.attachments).toHaveLength(40);
    expect(result.errors).toEqual([]);
    expect(result.attachments.map((attachment) => attachment.name)).toEqual(
      forty.map((item) => item.name)
    );
    expect(result.processedBytes).toBe(40);

    const fiftyOne = Array.from({ length: 51 }, (_value, index) =>
      image(`scan-${index}.jpg`, 'image/jpeg', [index])
    );
    const capped = await processCompanionImageAttachments(fiftyOne);

    expect(capped.attachments).toHaveLength(50);
    expect(capped.errors).toEqual([
      expect.objectContaining({
        code: 'too_many_images',
        message: 'Cavalry can attach up to 50 images per message. Remove 1 image and try again.'
      })
    ]);
  });

  it('enforces aggregate processed size while continuing to consider later images', async () => {
    const result = await processCompanionImageAttachments(
      [
        image('first.png', 'image/png', [1, 2, 3, 4, 5, 6]),
        image('too-large.png', 'image/png', [1, 2, 3, 4, 5, 6]),
        image('small.png', 'image/png', [1, 2, 3])
      ],
      { maxProcessedBytes: 10 }
    );

    expect(result.attachments.map((attachment) => attachment.name)).toEqual([
      'first.png',
      'small.png'
    ]);
    expect(result.processedBytes).toBe(9);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'processed_images_too_large',
        filename: 'too-large.png',
        message: expect.stringMatching(/over the 10 B processed-image limit/)
      })
    ]);
  });

  it('resizes and re-encodes with createImageBitmap and canvas when available', async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toDataURL: vi.fn(() => dataUrl('image/jpeg', [9, 8, 7, 6]))
    };
    const createImageBitmap = vi.fn(async () => ({ width: 4000, height: 2000, close }));
    const createCanvas = vi.fn(() => canvas);

    const result = await prepareCompanionImageAttachment(
      image('wide.png', 'image/png', [1, 2, 3, 4, 5]),
      0,
      { createImageBitmap, createCanvas }
    );

    expect(result.ok).toBe(true);
    expect(result.attachment).toMatchObject({
      mimeType: 'image/jpeg',
      originalMimeType: 'image/png',
      width: 4000,
      height: 2000,
      modelWidth: 1536,
      modelHeight: 768,
      resized: true,
      reencoded: true,
      processedSize: 4
    });
    expect(createCanvas).toHaveBeenCalledWith(1536, 768);
    expect(canvas.width).toBe(1536);
    expect(canvas.height).toBe(768);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1536, 768);
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps the original image with a warning when browser optimization fails', async () => {
    const original = image('fallback.webp', 'image/webp', [1, 2, 3, 4]);
    const result = await prepareCompanionImageAttachment(original, 0, {
      createImageBitmap: vi.fn(async () => {
        throw new Error('Decoder unavailable');
      }),
      createCanvas: vi.fn()
    });

    expect(result.ok).toBe(true);
    expect(result.attachment).toMatchObject({
      mimeType: 'image/webp',
      dataUrl: original.dataUrl,
      resized: false,
      reencoded: false
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'image_optimization_skipped',
        message: expect.stringMatching(/kept the original image/)
      })
    ]);
  });

  it('accepts still GIFs and rejects animated GIFs with a conversion instruction', async () => {
    const stillBytes = gifBytes(1);
    const animatedBytes = gifBytes(2);
    const stillDataUrl = dataUrl('image/gif', stillBytes);
    const animatedDataUrl = dataUrl('image/gif', animatedBytes);

    expect(getCompanionGifFrameCount(stillDataUrl)).toBe(1);
    expect(getCompanionGifFrameCount(animatedDataUrl)).toBe(2);
    expect(isCompanionAnimatedGif(stillDataUrl)).toBe(false);
    expect(isCompanionAnimatedGif(animatedDataUrl)).toBe(true);

    const still = await prepareCompanionImageAttachment(
      { name: 'still.gif', type: 'image/gif', size: stillBytes.length, dataUrl: stillDataUrl },
      0
    );
    const animated = await prepareCompanionImageAttachment(
      {
        name: 'animated.gif',
        type: 'image/gif',
        size: animatedBytes.length,
        dataUrl: animatedDataUrl
      },
      0
    );

    expect(still).toMatchObject({ ok: true, attachment: { mimeType: 'image/gif' } });
    expect(animated).toMatchObject({
      ok: false,
      error: {
        code: 'animated_gif_not_supported',
        message: expect.stringMatching(/Export one frame as PNG, JPEG, or WebP/)
      }
    });
  });
});
