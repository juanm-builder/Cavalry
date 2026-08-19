'use strict';

const COMPANION_MAX_IMAGE_INPUTS = 50;
const COMPANION_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const COMPANION_MAX_TOTAL_IMAGE_BYTES = 256 * 1024 * 1024;
const COMPANION_IMAGE_DATA_URL_PATTERN =
  /^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/]+={0,2})$/i;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function imageUrlFromPart(part) {
  if (!(part && typeof part === 'object')) return '';
  if (part.type === 'input_image') return String(part.image_url || '');
  if (part.type !== 'image_url') return '';
  return String(
    part.image_url && typeof part.image_url === 'object'
      ? part.image_url.url || ''
      : part.image_url || ''
  );
}

function decodedBase64Bytes(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function collectCompanionImageDataUrls(messages) {
  return asArray(messages).flatMap((message) =>
    asArray(message && message.content)
      .map(imageUrlFromPart)
      .filter(Boolean)
  );
}

function assertCompanionMultimodalInput(messages) {
  const imageUrls = collectCompanionImageDataUrls(messages);
  if (imageUrls.length > COMPANION_MAX_IMAGE_INPUTS) {
    throw new Error(`A Companion request can include up to ${COMPANION_MAX_IMAGE_INPUTS} images.`);
  }

  let totalBytes = 0;
  imageUrls.forEach((dataUrl) => {
    const match = COMPANION_IMAGE_DATA_URL_PATTERN.exec(dataUrl);
    if (!match) {
      throw new Error('Companion image inputs must be PNG, JPEG, WebP, or GIF data URLs.');
    }
    const bytes = decodedBase64Bytes(match[2]);
    if (!bytes || bytes > COMPANION_MAX_IMAGE_BYTES) {
      throw new Error(
        `Each Companion image must be no larger than ${COMPANION_MAX_IMAGE_BYTES / 1024 / 1024} MB.`
      );
    }
    totalBytes += bytes;
  });

  if (totalBytes > COMPANION_MAX_TOTAL_IMAGE_BYTES) {
    throw new Error(
      `Companion images must total no more than ${COMPANION_MAX_TOTAL_IMAGE_BYTES / 1024 / 1024} MB per request.`
    );
  }
  return { count: imageUrls.length, totalBytes };
}

module.exports = {
  COMPANION_MAX_IMAGE_BYTES,
  COMPANION_MAX_IMAGE_INPUTS,
  COMPANION_MAX_TOTAL_IMAGE_BYTES,
  assertCompanionMultimodalInput,
  collectCompanionImageDataUrls
};
