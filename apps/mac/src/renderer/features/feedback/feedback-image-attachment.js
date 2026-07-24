import { prepareCompanionImageAttachment } from '../assistant/companion-image-attachments.js';

export const FEEDBACK_IMAGE_ACCEPT = ['.png', '.jpg', '.jpeg', 'image/png', 'image/jpeg'].join(',');
export const FEEDBACK_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const FEEDBACK_IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);

export async function prepareFeedbackImageAttachment(file, options = {}) {
  const mimeType = String((file && file.type) || '').toLowerCase();
  if (!FEEDBACK_IMAGE_TYPES.has(mimeType)) {
    return {
      ok: false,
      error: {
        code: 'unsupported_feedback_image',
        message: 'Choose a PNG or JPEG image.'
      }
    };
  }
  const result = await prepareCompanionImageAttachment(file, 0, {
    createId: options.createId,
    maxEdge: 1536,
    maxSourceBytes: FEEDBACK_IMAGE_MAX_BYTES
  });
  if (!result.ok) return result;
  if (Number(result.attachment.processedSize || 0) > FEEDBACK_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: 'feedback_image_too_large',
        message: 'The prepared image is larger than 8 MB. Choose a smaller screenshot.'
      }
    };
  }
  return result;
}
