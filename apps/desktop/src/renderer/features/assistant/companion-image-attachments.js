export const COMPANION_IMAGE_ATTACHMENT_EXTENSIONS = Object.freeze([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif'
]);
export const COMPANION_IMAGE_ATTACHMENT_MIME_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);
export const COMPANION_IMAGE_ATTACHMENT_ACCEPT = COMPANION_IMAGE_ATTACHMENT_EXTENSIONS.concat(
  COMPANION_IMAGE_ATTACHMENT_MIME_TYPES
).join(',');
export const COMPANION_IMAGE_ATTACHMENT_SUPPORTED_TYPES = 'PNG, JPEG, WebP, or a non-animated GIF';
export const COMPANION_IMAGE_ATTACHMENT_MAX_COUNT = 50;
export const COMPANION_IMAGE_ATTACHMENT_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const COMPANION_IMAGE_ATTACHMENT_MAX_PROCESSED_BYTES = 48 * 1024 * 1024;
export const COMPANION_IMAGE_ATTACHMENT_MAX_EDGE = 1536;
export const COMPANION_IMAGE_ATTACHMENT_OUTPUT_MIME_TYPE = 'image/jpeg';
export const COMPANION_IMAGE_ATTACHMENT_OUTPUT_QUALITY = 0.86;

const MIME_TYPE_BY_EXTENSION = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
}

function boundedPositiveInteger(value, maximum) {
  return Math.min(maximum, positiveInteger(value, maximum));
}

function boundedQuality(value) {
  const quality = Number(value);
  return Number.isFinite(quality) && quality > 0
    ? Math.min(1, quality)
    : COMPANION_IMAGE_ATTACHMENT_OUTPUT_QUALITY;
}

function getExtension(value) {
  const match = /\.([a-z0-9]+)$/i.exec(asText(value));
  return match ? `.${match[1].toLowerCase()}` : '';
}

function filenameForMimeType(mimeType, index) {
  const extension =
    mimeType === 'image/jpeg'
      ? '.jpg'
      : Object.keys(MIME_TYPE_BY_EXTENSION).find(
          (candidate) => MIME_TYPE_BY_EXTENSION[candidate] === mimeType
        ) || '.jpg';
  return `image-${index + 1}${extension}`;
}

export function cleanCompanionImageFilename(value, index = 0, mimeType = '') {
  const filename = asText(value)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return filename || filenameForMimeType(mimeType, index);
}

function dataUrlMimeType(value) {
  const match = /^data:([^;,\s]+)(?:;[^,]*)?,/i.exec(asText(value));
  return match ? match[1].toLowerCase() : '';
}

export function inferCompanionImageMimeType(input) {
  const source = asObject(input);
  const explicitType = asText(source.mimeType || source.type).toLowerCase();
  if (COMPANION_IMAGE_ATTACHMENT_MIME_TYPES.includes(explicitType)) return explicitType;
  const fromDataUrl = dataUrlMimeType(
    typeof input === 'string' ? input : source.dataUrl || source.data_url
  );
  if (COMPANION_IMAGE_ATTACHMENT_MIME_TYPES.includes(fromDataUrl)) return fromDataUrl;
  return MIME_TYPE_BY_EXTENSION[getExtension(source.filename || source.name)] || explicitType;
}

export function formatCompanionImageBytes(value) {
  const bytes = Math.max(0, Math.round(Number(value) || 0));
  if (bytes >= 1024 * 1024) {
    const megabytes = bytes / (1024 * 1024);
    return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function estimateCompanionImageDataUrlBytes(value) {
  const dataUrl = asText(value);
  const commaIndex = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || commaIndex < 0) return 0;
  const metadata = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (!metadata.includes(';base64')) {
    try {
      return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
    } catch (_error) {
      return 0;
    }
  }
  const compact = payload.replace(/\s+/g, '');
  if (!compact) return 0;
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

function issue(code, message, input = {}, index = -1) {
  const source = asObject(input);
  return {
    code,
    message,
    ...(index >= 0 ? { index } : {}),
    ...(asText(source.filename || source.name)
      ? { filename: cleanCompanionImageFilename(source.filename || source.name, index) }
      : {})
  };
}

function inputDataUrl(input) {
  if (typeof input === 'string') return asText(input);
  const source = asObject(input);
  return asText(source.dataUrl || source.data_url);
}

export function validateCompanionImageAttachmentMeta(input, options = {}) {
  const source = asObject(input);
  const index = Math.max(0, Number(options.index) || 0);
  const mimeType = inferCompanionImageMimeType(input);
  const filename = cleanCompanionImageFilename(source.filename || source.name, index, mimeType);
  const extension = getExtension(filename);
  const dataUrl = inputDataUrl(input);
  const size =
    Math.max(0, Number(source.size || source.byteSize || source.originalSize) || 0) ||
    estimateCompanionImageDataUrlBytes(dataUrl);
  const maxSourceBytes = boundedPositiveInteger(
    options.maxSourceBytes,
    COMPANION_IMAGE_ATTACHMENT_MAX_SOURCE_BYTES
  );
  if (
    !COMPANION_IMAGE_ATTACHMENT_MIME_TYPES.includes(mimeType) ||
    (!COMPANION_IMAGE_ATTACHMENT_EXTENSIONS.includes(extension) && !dataUrl)
  ) {
    return {
      ok: false,
      error: issue(
        'unsupported_image_type',
        `${filename} is not a supported image. Choose ${COMPANION_IMAGE_ATTACHMENT_SUPPORTED_TYPES}.`,
        { filename },
        index
      )
    };
  }
  if (!(size > 0) && !dataUrl) {
    return {
      ok: false,
      error: issue(
        'empty_image',
        `${filename} is empty or could not be read. Choose a different image.`,
        { filename },
        index
      )
    };
  }
  if (size > maxSourceBytes) {
    return {
      ok: false,
      error: issue(
        'source_image_too_large',
        `${filename} is ${formatCompanionImageBytes(size)}. Each image must be ${formatCompanionImageBytes(maxSourceBytes)} or smaller.`,
        { filename },
        index
      )
    };
  }
  return { ok: true, error: null, filename, mimeType, size };
}

function bytesToBase64(bytes, dependencies = {}) {
  const encode = dependencies.btoa || globalThis.btoa;
  if (typeof encode === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return encode(binary);
  }
  const BufferConstructor = dependencies.Buffer || globalThis.Buffer;
  if (BufferConstructor) return BufferConstructor.from(bytes).toString('base64');
  throw new Error('This browser cannot encode the selected image.');
}

function base64ToBytes(value, dependencies = {}) {
  const decode = dependencies.atob || globalThis.atob;
  if (typeof decode === 'function') {
    const binary = decode(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  const BufferConstructor = dependencies.Buffer || globalThis.Buffer;
  if (BufferConstructor) return new Uint8Array(BufferConstructor.from(value, 'base64'));
  throw new Error('This browser cannot decode the selected image.');
}

function dataUrlToBytes(value, dependencies = {}) {
  const dataUrl = asText(value);
  const commaIndex = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || commaIndex < 0) {
    throw new Error('The image data URL is invalid.');
  }
  const metadata = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (metadata.includes(';base64')) return base64ToBytes(payload.replace(/\s+/g, ''), dependencies);
  try {
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch (_error) {
    throw new Error('The image data URL could not be decoded.');
  }
}

function bytesToDataUrl(bytes, mimeType, dependencies = {}) {
  return `data:${mimeType};base64,${bytesToBase64(bytes, dependencies)}`;
}

export async function readCompanionImageAsDataUrl(input, options = {}) {
  const existing = inputDataUrl(input);
  if (existing) {
    if (!dataUrlMimeType(existing).startsWith('image/')) {
      throw new Error('The selected file did not contain a valid image data URL.');
    }
    return existing;
  }
  const source = asObject(input);
  const Reader = options.FileReader || globalThis.FileReader;
  if (typeof Reader === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new Reader();
      reader.onload = () => {
        const result = asText(reader.result);
        if (result.startsWith('data:image/')) resolve(result);
        else reject(new Error('The selected file did not decode as an image.'));
      };
      reader.onerror = () => reject(new Error('The selected image could not be read.'));
      reader.onabort = () => reject(new Error('Reading the selected image was cancelled.'));
      reader.readAsDataURL(input);
    });
  }
  if (typeof source.arrayBuffer === 'function') {
    const mimeType = inferCompanionImageMimeType(input);
    return bytesToDataUrl(new Uint8Array(await source.arrayBuffer()), mimeType, options);
  }
  throw new Error('This browser cannot read the selected image. Try choosing it again.');
}

function skipGifSubBlocks(bytes, startIndex) {
  let index = startIndex;
  while (index < bytes.length) {
    const blockSize = bytes[index];
    index += 1;
    if (blockSize === 0) return index;
    index += blockSize;
    if (index > bytes.length) return -1;
  }
  return -1;
}

export function getCompanionGifFrameCount(value, dependencies = {}) {
  let bytes;
  try {
    bytes = value instanceof Uint8Array ? value : dataUrlToBytes(value, dependencies);
  } catch (_error) {
    return 0;
  }
  if (bytes.length < 13) return 0;
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (!['GIF87a', 'GIF89a'].includes(signature)) return 0;
  let index = 13;
  const globalColorTableFlag = (bytes[10] & 0x80) !== 0;
  if (globalColorTableFlag) index += 3 * 2 ** ((bytes[10] & 0x07) + 1);
  let frames = 0;
  while (index < bytes.length) {
    const marker = bytes[index];
    index += 1;
    if (marker === 0x3b) return frames;
    if (marker === 0x21) {
      if (index >= bytes.length) return 0;
      index += 1;
      index = skipGifSubBlocks(bytes, index);
      if (index < 0) return 0;
      continue;
    }
    if (marker !== 0x2c || index + 9 > bytes.length) return 0;
    frames += 1;
    const localColorTableFlag = (bytes[index + 8] & 0x80) !== 0;
    const localColorTableSize = 3 * 2 ** ((bytes[index + 8] & 0x07) + 1);
    index += 9;
    if (localColorTableFlag) index += localColorTableSize;
    if (index >= bytes.length) return 0;
    index += 1;
    index = skipGifSubBlocks(bytes, index);
    if (index < 0) return 0;
  }
  return 0;
}

export function isCompanionAnimatedGif(value, dependencies = {}) {
  return getCompanionGifFrameCount(value, dependencies) > 1;
}

function sourceForImageBitmap(input, dataUrl, mimeType, dependencies = {}) {
  const BlobConstructor = dependencies.Blob || globalThis.Blob;
  if (BlobConstructor && input instanceof BlobConstructor) return input;
  if (!BlobConstructor) return input;
  return new BlobConstructor([dataUrlToBytes(dataUrl, dependencies)], { type: mimeType });
}

function defaultCreateCanvas() {
  if (!(globalThis.document && typeof globalThis.document.createElement === 'function'))
    return null;
  return globalThis.document.createElement('canvas');
}

async function canvasToDataUrl(canvas, mimeType, quality, dependencies = {}) {
  if (canvas && typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
    if (blob) return readCompanionImageAsDataUrl(blob, dependencies);
  }
  if (canvas && typeof canvas.toDataURL === 'function') {
    const dataUrl = asText(canvas.toDataURL(mimeType, quality));
    if (dataUrl.startsWith('data:image/')) return dataUrl;
  }
  throw new Error('Canvas image export is unavailable.');
}

async function optimizeCompanionImage(input, dataUrl, mimeType, options = {}) {
  const createBitmap = options.createImageBitmap || globalThis.createImageBitmap;
  const createCanvas = options.createCanvas || defaultCreateCanvas;
  if (typeof createBitmap !== 'function' || typeof createCanvas !== 'function') {
    return { dataUrl, width: 0, height: 0, modelWidth: 0, modelHeight: 0, resized: false };
  }
  let bitmap;
  try {
    bitmap = await createBitmap(sourceForImageBitmap(input, dataUrl, mimeType, options));
    const width = positiveInteger(bitmap && bitmap.width, 0);
    const height = positiveInteger(bitmap && bitmap.height, 0);
    if (!(width && height)) throw new Error('The decoded image did not include dimensions.');
    const maxEdge = boundedPositiveInteger(options.maxEdge, COMPANION_IMAGE_ATTACHMENT_MAX_EDGE);
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const modelWidth = Math.max(1, Math.round(width * scale));
    const modelHeight = Math.max(1, Math.round(height * scale));
    const canvas = createCanvas(modelWidth, modelHeight);
    if (!canvas) throw new Error('Canvas image processing is unavailable.');
    canvas.width = modelWidth;
    canvas.height = modelHeight;
    const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!context || typeof context.drawImage !== 'function') {
      throw new Error('Canvas image processing is unavailable.');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, modelWidth, modelHeight);
    const optimizedDataUrl = await canvasToDataUrl(
      canvas,
      COMPANION_IMAGE_ATTACHMENT_OUTPUT_MIME_TYPE,
      boundedQuality(options.quality),
      options
    );
    return {
      dataUrl: optimizedDataUrl,
      width,
      height,
      modelWidth,
      modelHeight,
      resized: modelWidth !== width || modelHeight !== height
    };
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

function processedAttachment(input, metadata, optimized, dataUrl, index, options = {}) {
  const source = asObject(input);
  const processedDataUrl = optimized.dataUrl || dataUrl;
  const processedMimeType = dataUrlMimeType(processedDataUrl) || metadata.mimeType;
  const originalSize = metadata.size || estimateCompanionImageDataUrlBytes(dataUrl);
  const processedSize = estimateCompanionImageDataUrlBytes(processedDataUrl) || originalSize;
  const sourceWidth = positiveInteger(source.width, 0);
  const sourceHeight = positiveInteger(source.height, 0);
  const width = optimized.width || sourceWidth;
  const height = optimized.height || sourceHeight;
  const modelWidth = optimized.modelWidth || width;
  const modelHeight = optimized.modelHeight || height;
  const createId = options.createId;
  return {
    id:
      asText(source.id) ||
      (typeof createId === 'function'
        ? asText(createId('companion_image'))
        : `companion_image_${index + 1}`),
    kind: 'image',
    type: 'image',
    name: metadata.filename,
    filename: metadata.filename,
    mimeType: processedMimeType,
    originalMimeType: metadata.mimeType,
    size: processedSize,
    byteSize: processedSize,
    originalSize,
    processedSize,
    width,
    height,
    modelWidth,
    modelHeight,
    modelMaxEdge: boundedPositiveInteger(options.maxEdge, COMPANION_IMAGE_ATTACHMENT_MAX_EDGE),
    resized: optimized.resized === true,
    reencoded: processedDataUrl !== dataUrl,
    dataUrl: processedDataUrl
  };
}

export async function prepareCompanionImageAttachment(input, index = 0, options = {}) {
  const validation = validateCompanionImageAttachmentMeta(input, { ...options, index });
  if (!validation.ok) return { ok: false, attachment: null, warnings: [], error: validation.error };
  let dataUrl;
  try {
    dataUrl = await readCompanionImageAsDataUrl(input, options);
  } catch (error) {
    return {
      ok: false,
      attachment: null,
      warnings: [],
      error: issue(
        'image_read_failed',
        `${validation.filename} could not be read. ${asText(error && error.message) || 'Choose a different image.'}`,
        { filename: validation.filename },
        index
      )
    };
  }
  const decodedMimeType = dataUrlMimeType(dataUrl);
  if (!COMPANION_IMAGE_ATTACHMENT_MIME_TYPES.includes(decodedMimeType)) {
    return {
      ok: false,
      attachment: null,
      warnings: [],
      error: issue(
        'unsupported_image_data',
        `${validation.filename} did not decode as ${COMPANION_IMAGE_ATTACHMENT_SUPPORTED_TYPES}.`,
        { filename: validation.filename },
        index
      )
    };
  }
  const originalSize = estimateCompanionImageDataUrlBytes(dataUrl);
  const maxSourceBytes = boundedPositiveInteger(
    options.maxSourceBytes,
    COMPANION_IMAGE_ATTACHMENT_MAX_SOURCE_BYTES
  );
  if (originalSize > maxSourceBytes) {
    return {
      ok: false,
      attachment: null,
      warnings: [],
      error: issue(
        'source_image_too_large',
        `${validation.filename} is ${formatCompanionImageBytes(originalSize)}. Each image must be ${formatCompanionImageBytes(maxSourceBytes)} or smaller.`,
        { filename: validation.filename },
        index
      )
    };
  }
  if (decodedMimeType === 'image/gif') {
    const frameCount = getCompanionGifFrameCount(dataUrl, options);
    if (frameCount > 1) {
      return {
        ok: false,
        attachment: null,
        warnings: [],
        error: issue(
          'animated_gif_not_supported',
          `${validation.filename} is animated. Export one frame as PNG, JPEG, or WebP and attach it again.`,
          { filename: validation.filename },
          index
        )
      };
    }
    if (!frameCount) {
      return {
        ok: false,
        attachment: null,
        warnings: [],
        error: issue(
          'invalid_gif',
          `${validation.filename} is not a valid GIF. Export it as PNG, JPEG, or WebP and try again.`,
          { filename: validation.filename },
          index
        )
      };
    }
  }
  let optimized;
  const warnings = [];
  try {
    optimized = await optimizeCompanionImage(input, dataUrl, decodedMimeType, options);
  } catch (_error) {
    optimized = { dataUrl, width: 0, height: 0, modelWidth: 0, modelHeight: 0, resized: false };
    warnings.push(
      issue(
        'image_optimization_skipped',
        `${validation.filename} could not be resized in this browser, so Cavalry kept the original image.`,
        { filename: validation.filename },
        index
      )
    );
  }
  return {
    ok: true,
    attachment: processedAttachment(
      input,
      { ...validation, mimeType: decodedMimeType, size: originalSize || validation.size },
      optimized,
      dataUrl,
      index,
      options
    ),
    warnings,
    error: null
  };
}

function normalizedExistingProcessedBytes(options) {
  const explicit = Math.max(0, Number(options.existingProcessedBytes) || 0);
  if (explicit) return explicit;
  return (Array.isArray(options.existingAttachments) ? options.existingAttachments : []).reduce(
    (total, attachment) =>
      total +
      Math.max(
        0,
        Number(
          attachment && (attachment.processedSize || attachment.byteSize || attachment.size || 0)
        ) || 0
      ),
    0
  );
}

export async function processCompanionImageAttachments(value, options = {}) {
  const inputs = Array.from(value || []);
  const existingAttachments = Array.isArray(options.existingAttachments)
    ? options.existingAttachments
    : [];
  const existingCount = Math.max(
    existingAttachments.length,
    Math.max(0, Number(options.existingCount) || 0)
  );
  const maxCount = boundedPositiveInteger(options.maxCount, COMPANION_IMAGE_ATTACHMENT_MAX_COUNT);
  const availableCount = Math.max(0, maxCount - existingCount);
  const maxProcessedBytes = boundedPositiveInteger(
    options.maxProcessedBytes,
    COMPANION_IMAGE_ATTACHMENT_MAX_PROCESSED_BYTES
  );
  const attachments = [];
  const errors = [];
  const warnings = [];
  let processedBytes = normalizedExistingProcessedBytes(options);
  const selected = inputs.slice(0, availableCount);
  for (let index = 0; index < selected.length; index += 1) {
    const prepared = await prepareCompanionImageAttachment(
      selected[index],
      existingCount + index,
      options
    );
    if (!prepared.ok) {
      errors.push(prepared.error);
      continue;
    }
    const nextSize = Math.max(0, Number(prepared.attachment.processedSize) || 0);
    if (processedBytes + nextSize > maxProcessedBytes) {
      errors.push(
        issue(
          'processed_images_too_large',
          `${prepared.attachment.filename} would put this message over the ${formatCompanionImageBytes(maxProcessedBytes)} processed-image limit. Remove some images or attach a smaller batch.`,
          prepared.attachment,
          index
        )
      );
      continue;
    }
    attachments.push(prepared.attachment);
    warnings.push(...prepared.warnings);
    processedBytes += nextSize;
  }
  if (inputs.length > availableCount) {
    const rejected = inputs.length - availableCount;
    errors.push(
      issue(
        'too_many_images',
        `Cavalry can attach up to ${maxCount} images per message. Remove ${rejected} ${rejected === 1 ? 'image' : 'images'} and try again.`,
        {},
        availableCount
      )
    );
  }
  return {
    attachments,
    errors,
    warnings,
    processedBytes,
    maxCount,
    maxProcessedBytes
  };
}
