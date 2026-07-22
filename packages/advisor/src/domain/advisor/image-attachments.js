export const ADVISOR_IMAGE_ATTACHMENT_ACCEPT = ['.png', '.jpg', '.jpeg', '.webp'];
export const ADVISOR_IMAGE_ATTACHMENT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const ADVISOR_IMAGE_ATTACHMENT_MAX_COUNT = 3;
export const ADVISOR_IMAGE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ADVISOR_IMAGE_ATTACHMENT_MAX_EDGE = 1536;
export const ADVISOR_IMAGE_ATTACHMENT_MODEL_MIME_TYPE = 'image/jpeg';
export const ADVISOR_IMAGE_ATTACHMENT_MODEL_QUALITY = 0.92;
export const ADVISOR_IMAGE_INTAKE_DEFAULT_PROMPT = 'Create transaction draft from this image.';
export const ADVISOR_IMAGE_INTAKE_VISION_REQUIRED_MESSAGE =
  'Image transaction intake requires a vision-capable advisor model.';
export const ADVISOR_DOCUMENT_ATTACHMENT_ACCEPT = [
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.csv',
  '.xls',
  '.xlsx'
];
export const ADVISOR_DOCUMENT_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];
export const ADVISOR_DOCUMENT_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const ADVISOR_ATTACHMENT_ACCEPT = ADVISOR_IMAGE_ATTACHMENT_ACCEPT.concat(
  ADVISOR_DOCUMENT_ATTACHMENT_ACCEPT
);
export const ADVISOR_ATTACHMENT_MAX_COUNT = 6;

function cleanFilename(value) {
  const name = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return name || 'image';
}

function getExtension(filename) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(filename || '').trim());
  return match ? '.' + match[1].toLowerCase() : '';
}

function inferImageMimeType(filename, mimeType) {
  const type = String(mimeType || '')
    .trim()
    .toLowerCase();
  if (ADVISOR_IMAGE_ATTACHMENT_MIME_TYPES.includes(type)) {
    return type;
  }
  const extension = getExtension(filename);
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return type;
}

function inferDocumentMimeType(filename, mimeType) {
  const type = String(mimeType || '')
    .trim()
    .toLowerCase();
  if (ADVISOR_DOCUMENT_ATTACHMENT_MIME_TYPES.includes(type)) {
    return type;
  }
  const extension = getExtension(filename);
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.doc') return 'application/msword';
  if (extension === '.docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === '.txt') return 'text/plain';
  if (extension === '.csv') return 'text/csv';
  if (extension === '.xls') return 'application/vnd.ms-excel';
  if (extension === '.xlsx')
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return type || 'application/octet-stream';
}

function isImageAttachmentInput(input) {
  const source = input && typeof input === 'object' ? input : {};
  const filename = cleanFilename(source.filename || source.name);
  const extension = getExtension(filename);
  const mimeType = inferImageMimeType(filename, source.mimeType || source.type);
  return (
    source.type === 'image' ||
    ADVISOR_IMAGE_ATTACHMENT_ACCEPT.includes(extension) ||
    ADVISOR_IMAGE_ATTACHMENT_MIME_TYPES.includes(mimeType) ||
    String(source.dataUrl || source.data_url || '').indexOf('data:image/') === 0
  );
}

export function formatAdvisorImageAttachmentSize(bytes) {
  const numeric = Number(bytes) || 0;
  if (numeric >= 1024 * 1024) {
    return (numeric / (1024 * 1024)).toFixed(numeric >= 10 * 1024 * 1024 ? 0 : 1) + ' MB';
  }
  if (numeric >= 1024) {
    return Math.round(numeric / 1024) + ' KB';
  }
  return String(Math.max(0, Math.round(numeric))) + ' B';
}

export function getAdvisorImageIntakePrompt(text) {
  return String(text || '').trim() || ADVISOR_IMAGE_INTAKE_DEFAULT_PROMPT;
}

export function validateAdvisorImageAttachmentMeta(input, options = {}) {
  const filename = cleanFilename(input && (input.filename || input.name));
  const mimeType = inferImageMimeType(filename, input && (input.mimeType || input.type));
  const size = Number(input && (input.size || input.byteSize || input.originalSize)) || 0;
  const existingCount = Math.max(0, Number(options.existingCount || 0) || 0);
  const selectedIndex = Math.max(0, Number(options.selectedIndex || 0) || 0);
  if (existingCount + selectedIndex >= ADVISOR_IMAGE_ATTACHMENT_MAX_COUNT) {
    return {
      ok: false,
      error:
        'You can attach up to ' +
        String(ADVISOR_IMAGE_ATTACHMENT_MAX_COUNT) +
        ' images per Advisor message.'
    };
  }
  if (
    !ADVISOR_IMAGE_ATTACHMENT_MIME_TYPES.includes(mimeType) ||
    !ADVISOR_IMAGE_ATTACHMENT_ACCEPT.includes(getExtension(filename))
  ) {
    return {
      ok: false,
      error: 'Advisor image attachments must be PNG, JPG, JPEG, or WEBP files.'
    };
  }
  if (!(size > 0)) {
    return {
      ok: false,
      error: 'Advisor image attachments must include a file size.'
    };
  }
  if (size > ADVISOR_IMAGE_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      error: filename + ' is larger than the 5 MB image limit.'
    };
  }
  return {
    ok: true,
    error: '',
    filename,
    mimeType,
    size
  };
}

export function validateAdvisorDocumentAttachmentMeta(input, options = {}) {
  const filename = cleanFilename(input && (input.filename || input.name));
  const mimeType = inferDocumentMimeType(filename, input && (input.mimeType || input.type));
  const size = Number(input && (input.size || input.byteSize || input.originalSize)) || 0;
  const existingCount = Math.max(0, Number(options.existingCount || 0) || 0);
  const selectedIndex = Math.max(0, Number(options.selectedIndex || 0) || 0);
  if (existingCount + selectedIndex >= ADVISOR_ATTACHMENT_MAX_COUNT) {
    return {
      ok: false,
      error:
        'You can attach up to ' +
        String(ADVISOR_ATTACHMENT_MAX_COUNT) +
        ' files per Advisor message.'
    };
  }
  if (!ADVISOR_DOCUMENT_ATTACHMENT_ACCEPT.includes(getExtension(filename))) {
    return {
      ok: false,
      error: 'Advisor document attachments must be PDF, Word, text, CSV, or Excel files.'
    };
  }
  if (!(size > 0)) {
    return {
      ok: false,
      error: 'Advisor document attachments must include a file size.'
    };
  }
  if (size > ADVISOR_DOCUMENT_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      error: filename + ' is larger than the 15 MB document limit.'
    };
  }
  return {
    ok: true,
    error: '',
    filename,
    mimeType,
    size
  };
}

export function validateAdvisorAttachmentMeta(input, options = {}) {
  const existingCount = Math.max(0, Number(options.existingCount || 0) || 0);
  const selectedIndex = Math.max(0, Number(options.selectedIndex || 0) || 0);
  if (existingCount + selectedIndex >= ADVISOR_ATTACHMENT_MAX_COUNT) {
    return {
      ok: false,
      error:
        'You can attach up to ' +
        String(ADVISOR_ATTACHMENT_MAX_COUNT) +
        ' files per Advisor message.'
    };
  }
  if (isImageAttachmentInput(input)) {
    return validateAdvisorImageAttachmentMeta(input, {
      existingCount: Math.max(0, Number(options.existingImageCount || 0) || 0),
      selectedIndex: Math.max(0, Number(options.selectedImageIndex || 0) || 0)
    });
  }
  return validateAdvisorDocumentAttachmentMeta(input, {
    existingCount,
    selectedIndex
  });
}

export function normalizeAdvisorImageAttachment(input, index = 0, options = {}) {
  const validation = validateAdvisorImageAttachmentMeta(input, {
    existingCount: 0,
    selectedIndex: Math.min(index, ADVISOR_IMAGE_ATTACHMENT_MAX_COUNT - 1)
  });
  if (!validation.ok && !options.allowInvalid) {
    return null;
  }
  const source = input && typeof input === 'object' ? input : {};
  const filename = validation.filename || cleanFilename(source.filename || source.name);
  const mimeType =
    validation.mimeType || inferImageMimeType(filename, source.mimeType || source.type);
  const width = Math.max(0, Math.round(Number(source.width || 0) || 0));
  const height = Math.max(0, Math.round(Number(source.height || 0) || 0));
  const modelWidth = Math.max(
    0,
    Math.round(Number(source.modelWidth || source.model_width || width) || 0)
  );
  const modelHeight = Math.max(
    0,
    Math.round(Number(source.modelHeight || source.model_height || height) || 0)
  );
  return {
    id: String(source.id || 'advisor_image_' + String(index)),
    type: 'image',
    filename,
    mimeType,
    size:
      validation.size || Number(source.size || source.byteSize || source.originalSize || 0) || 0,
    width,
    height,
    modelWidth,
    modelHeight,
    modelQuality: Math.max(
      0,
      Math.min(
        1,
        Number(
          source.modelQuality || source.model_quality || ADVISOR_IMAGE_ATTACHMENT_MODEL_QUALITY
        ) || ADVISOR_IMAGE_ATTACHMENT_MODEL_QUALITY
      )
    ),
    modelMaxEdge: Math.max(
      0,
      Math.round(
        Number(source.modelMaxEdge || source.model_max_edge || ADVISOR_IMAGE_ATTACHMENT_MAX_EDGE) ||
          ADVISOR_IMAGE_ATTACHMENT_MAX_EDGE
      )
    ),
    dataUrl: String(source.dataUrl || source.data_url || ''),
    resized: source.resized === true,
    originalSize: Math.max(
      0,
      Math.round(Number(source.originalSize || source.original_size || source.size || 0) || 0)
    ),
    resizedSize: Math.max(
      0,
      Math.round(Number(source.resizedSize || source.resized_size || 0) || 0)
    )
  };
}

export function normalizeAdvisorDocumentAttachment(input, index = 0, options = {}) {
  const validation = validateAdvisorDocumentAttachmentMeta(input, {
    existingCount: 0,
    selectedIndex: Math.min(index, ADVISOR_ATTACHMENT_MAX_COUNT - 1)
  });
  if (!validation.ok && !options.allowInvalid) {
    return null;
  }
  const source = input && typeof input === 'object' ? input : {};
  const filename = validation.filename || cleanFilename(source.filename || source.name);
  const mimeType =
    validation.mimeType || inferDocumentMimeType(filename, source.mimeType || source.type);
  return {
    id: String(source.id || 'advisor_document_' + String(index)),
    type: 'document',
    filename,
    mimeType,
    size:
      validation.size || Number(source.size || source.byteSize || source.originalSize || 0) || 0,
    text: String(
      source.text ||
        source.extractedText ||
        source.extracted_text ||
        source.dataText ||
        source.data_text ||
        ''
    ).trim(),
    extractionStatus: String(source.extractionStatus || source.extraction_status || '').trim(),
    extractionError: String(source.extractionError || source.extraction_error || '').trim()
  };
}

export function normalizeAdvisorAttachment(input, index = 0, options = {}) {
  if (isImageAttachmentInput(input)) {
    return normalizeAdvisorImageAttachment(input, index, options);
  }
  return normalizeAdvisorDocumentAttachment(input, index, options);
}

export function normalizeAdvisorImageAttachments(value, options = {}) {
  const maxCount = Math.max(
    0,
    Math.min(
      ADVISOR_IMAGE_ATTACHMENT_MAX_COUNT,
      Number(options.maxCount || ADVISOR_IMAGE_ATTACHMENT_MAX_COUNT) ||
        ADVISOR_IMAGE_ATTACHMENT_MAX_COUNT
    )
  );
  const attachments = [];
  const errors = [];
  (Array.isArray(value) ? value : []).forEach((item) => {
    if (attachments.length >= maxCount) {
      errors.push('Only the first ' + String(maxCount) + ' images were attached.');
      return;
    }
    const normalized = normalizeAdvisorImageAttachment(item, attachments.length, options);
    if (normalized && normalized.dataUrl) {
      attachments.push(normalized);
    } else {
      const validation = validateAdvisorImageAttachmentMeta(item, {
        existingCount: attachments.length,
        selectedIndex: 0
      });
      errors.push(validation.error || 'One image attachment could not be used.');
    }
  });
  return {
    attachments,
    errors
  };
}

export function normalizeAdvisorAttachments(value, options = {}) {
  const maxCount = Math.max(
    0,
    Math.min(
      ADVISOR_ATTACHMENT_MAX_COUNT,
      Number(options.maxCount || ADVISOR_ATTACHMENT_MAX_COUNT) || ADVISOR_ATTACHMENT_MAX_COUNT
    )
  );
  const attachments = [];
  const errors = [];
  (Array.isArray(value) ? value : []).forEach((item) => {
    if (attachments.length >= maxCount) {
      errors.push('Only the first ' + String(maxCount) + ' files were attached.');
      return;
    }
    const imageCount = attachments.filter((attachment) => attachment.type === 'image').length;
    const validation = validateAdvisorAttachmentMeta(item, {
      existingCount: attachments.length,
      selectedIndex: 0,
      existingImageCount: imageCount,
      selectedImageIndex: 0
    });
    if (!validation.ok && !options.allowInvalid) {
      errors.push(validation.error);
      return;
    }
    const normalized = isImageAttachmentInput(item)
      ? normalizeAdvisorImageAttachment(item, imageCount, options)
      : normalizeAdvisorDocumentAttachment(item, attachments.length, options);
    if (normalized && (normalized.type === 'document' || normalized.dataUrl)) {
      attachments.push(normalized);
    } else {
      errors.push(validation.error || 'One attachment could not be used.');
    }
  });
  return {
    attachments,
    errors
  };
}

export function getAdvisorImageAttachmentExportLabel(attachment) {
  const item = normalizeAdvisorImageAttachment(attachment, 0, { allowInvalid: true });
  if (!item) {
    return '';
  }
  const dimensions =
    item.width && item.height ? String(item.width) + 'x' + String(item.height) : '';
  return [item.filename, formatAdvisorImageAttachmentSize(item.size), dimensions]
    .filter(Boolean)
    .join(' - ');
}

export function getAdvisorDocumentAttachmentExportLabel(attachment) {
  const item = normalizeAdvisorDocumentAttachment(attachment, 0, { allowInvalid: true });
  if (!item) {
    return '';
  }
  return [item.filename, formatAdvisorImageAttachmentSize(item.size)].filter(Boolean).join(' - ');
}

export function getAdvisorAttachmentExportLabel(attachment) {
  return attachment && attachment.type === 'document'
    ? getAdvisorDocumentAttachmentExportLabel(attachment)
    : getAdvisorImageAttachmentExportLabel(attachment);
}

export function getAdvisorImageAttachmentMetadata(attachments) {
  return normalizeAdvisorImageAttachments(attachments, { allowInvalid: true }).attachments.map(
    (attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      modelWidth: attachment.modelWidth,
      modelHeight: attachment.modelHeight,
      modelQuality: attachment.modelQuality,
      modelMaxEdge: attachment.modelMaxEdge
    })
  );
}

export function getAdvisorAttachmentMetadata(attachments) {
  return normalizeAdvisorAttachments(attachments, { allowInvalid: true }).attachments.map(
    (attachment) => {
      const metadata = {
        id: attachment.id,
        type: attachment.type,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size
      };
      if (attachment.type === 'image') {
        metadata.width = attachment.width;
        metadata.height = attachment.height;
        metadata.modelWidth = attachment.modelWidth;
        metadata.modelHeight = attachment.modelHeight;
        metadata.modelQuality = attachment.modelQuality;
        metadata.modelMaxEdge = attachment.modelMaxEdge;
      } else {
        metadata.extractionStatus = attachment.extractionStatus || '';
        metadata.hasText = !!String(attachment.text || '').trim();
      }
      return metadata;
    }
  );
}
