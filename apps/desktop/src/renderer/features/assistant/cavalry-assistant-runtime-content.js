export const CAVALRY_ASSISTANT_MAX_IMAGES = 50;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

const PRIVATE_ASSISTANT_CONTENT_TYPES = new Set([
  'analysis',
  'analysis_text',
  'function_call',
  'reasoning',
  'reasoning_text',
  'scratchpad',
  'thinking',
  'thought',
  'tool_call'
]);

const PRIVATE_ASSISTANT_BLOCK_PATTERN =
  /<(analysis|reasoning|scratchpad|think|thinking|tool_call|function_call)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi;
const PRIVATE_ASSISTANT_OPEN_TAIL_PATTERN =
  /<(?:analysis|reasoning|scratchpad|think|thinking|tool_call|function_call)(?:\s[^>]*)?>[\s\S]*$/i;
const PRIVATE_ASSISTANT_HEADING_PATTERN =
  /(^|\n)\s{0,3}(?:#{1,6}\s*)?(?:chain[- ]of[- ]thought|citation scratch(?:pad)?|drafting notes?|internal (?:analysis|notes?|reasoning)|scratchpad|tool scratch(?:pad)?)\s*:?\s*(?:\n|$)/i;
const ORPHAN_PRIVATE_TOKEN_PATTERN =
  /<\|(?:assistant|channel|end|message|start)\|>|<\|(?:analysis|final|reasoning)\|>/gi;

const SCRATCH_TAIL_PATTERNS = Object.freeze([
  /(^|[.!?]\s+|\n+\s*)wait[,;:]?\s+(?:citation|reference)\s+(?:failed|invalid|missing|problem|unavailable|wrong)\b/i,
  /(^|[.!?]\s+|\n+\s*)need\s+(?:cite|citation)\b/i,
  /(^|[.!?]\s+|\n+\s*)need\s+no\s+cite\b/i,
  /(^|[.!?]\s+|\n+\s*)need\s+(?:to\s+)?ask\s+(?:one|a)\s+focused\s+question\b/i,
  /(^|[.!?]\s+|\n+\s*)need\s+maybe\s+(?:ask|cite|mention|verify)\b/i,
  /(^|[.!?]\s+|\n+\s*)(?:citation\s+rule|tool-backed\s+claim)\b/i,
  /(^|[.!?]\s+|\n+\s*)can(?:not|'t)?\s+cite\s+only\s+direct\s+records\b/i,
  /(^|[.!?]\s+|\n+\s*)no\s+citation\s+marker\s+(?:available|possible)\b/i,
  /(^|\n+)\s*(?:let(?:'s| us))\s+(?:craft|compose|draft)\s+(?:a|the|this)\s+(?:answer|reply|response)\b/i,
  /(^|\n+)\s*(?:assistant\s+to=|to=(?:functions|python|web)\.)/i
]);

function stripHarmonyReasoning(value) {
  const text = String(value || '');
  const harmonyAnalysis = '<|channel|>analysis<|message|>';
  const harmonyFinal = '<|channel|>final<|message|>';
  const shortAnalysis = '<|analysis|>';
  const shortFinal = '<|final|>';
  const finalIndex = Math.max(text.lastIndexOf(harmonyFinal), text.lastIndexOf(shortFinal));
  if (finalIndex >= 0) {
    const marker = text.startsWith(harmonyFinal, finalIndex) ? harmonyFinal : shortFinal;
    return text.slice(finalIndex + marker.length);
  }
  if (text.includes(harmonyAnalysis) || text.includes(shortAnalysis)) return '';
  return text;
}

function stripPrivateBlocks(value) {
  let text = stripHarmonyReasoning(value);
  let previous = '';
  while (text !== previous) {
    previous = text;
    text = text.replace(PRIVATE_ASSISTANT_BLOCK_PATTERN, '');
  }
  text = text.replace(PRIVATE_ASSISTANT_OPEN_TAIL_PATTERN, '');
  const privateHeading = PRIVATE_ASSISTANT_HEADING_PATTERN.exec(text);
  if (privateHeading) text = text.slice(0, privateHeading.index);
  return text.replace(ORPHAN_PRIVATE_TOKEN_PATTERN, '');
}

function stripScratchTail(value) {
  const text = String(value || '');
  let tailStart = text.length;
  SCRATCH_TAIL_PATTERNS.forEach((pattern) => {
    const match = pattern.exec(text);
    if (!match) return;
    tailStart = Math.min(tailStart, match.index + String(match[1] || '').length);
  });
  return text.slice(0, tailStart);
}

function publicContentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    const source = asObject(content);
    if (PRIVATE_ASSISTANT_CONTENT_TYPES.has(asString(source.type).toLowerCase())) return '';
    if (typeof source.text === 'string') return source.text;
    if (source.text && typeof source.text.value === 'string') return source.text.value;
    return typeof source.content === 'string' ? source.content : '';
  }
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      const source = asObject(item);
      if (PRIVATE_ASSISTANT_CONTENT_TYPES.has(asString(source.type).toLowerCase())) return '';
      if (typeof source.text === 'string') return source.text;
      if (source.text && typeof source.text.value === 'string') return source.text.value;
      return typeof source.content === 'string' ? source.content : '';
    })
    .filter(Boolean)
    .join('\n');
}

// Provider output is untrusted at this boundary. Models occasionally place reasoning, draft
// notes, or tool/citation scratch text in the same content field as the final answer. Keep this
// filter provider-independent so neither Responses nor local Chat Completions can bypass it.
export function assistantVisibleText(content) {
  return stripScratchTail(stripPrivateBlocks(publicContentText(content)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Persisted v1/v2 conversations may contain provider-private blocks or old technical event
// records. Migration intentionally omits the live scratch-tail heuristics so ordinary historic
// prose is preserved verbatim while known private tag formats are quarantined.
export function projectLegacyAssistantText(content) {
  return stripPrivateBlocks(publicContentText(content))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function imageUrlFromSource(source) {
  const nestedImageUrl = asObject(source.image_url || source.imageUrl);
  return asString(
    source.dataUrl ||
      source.data_url ||
      nestedImageUrl.url ||
      (typeof source.imageUrl === 'string' ? source.imageUrl : '') ||
      (typeof source.image_url === 'string' ? source.image_url : '') ||
      source.url
  );
}

export function normalizeImages(value) {
  const sources = asArray(value);
  if (sources.length > CAVALRY_ASSISTANT_MAX_IMAGES) {
    return {
      images: [],
      error: `You can attach up to ${CAVALRY_ASSISTANT_MAX_IMAGES} images per message.`
    };
  }
  const images = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = asObject(sources[index]);
    const url = imageUrlFromSource(source);
    if (!url) {
      return {
        images: [],
        error: `Attached image ${index + 1} does not include image data.`
      };
    }
    const detail = asString(source.detail).toLowerCase();
    images.push({
      id: asString(source.id) || `assistant_image_${index + 1}`,
      filename: asString(source.filename || source.fileName || source.name) || `Image ${index + 1}`,
      mimeType: asString(source.mimeType || source.mime_type || source.type),
      url,
      ...(detail && ['auto', 'high', 'low', 'original'].includes(detail) ? { detail } : {})
    });
  }
  return { images, error: '' };
}

function compactImageLabel(image, index) {
  const id = asString(image.id).replace(/\s+/g, ' ').slice(0, 160);
  const filename = asString(image.filename).replace(/\s+/g, ' ').slice(0, 240);
  return `Attachment ${index + 1}: id=${id}; filename=${filename}.`;
}

export function buildResponsesUserContent(question, images) {
  if (!images.length) return question;
  return [
    { type: 'input_text', text: question },
    ...images.flatMap((image, index) => {
      const imagePart = {
        type: 'input_image',
        image_url: image.url
      };
      if (image.detail) imagePart.detail = image.detail;
      return [{ type: 'input_text', text: compactImageLabel(image, index) }, imagePart];
    })
  ];
}

export function buildChatUserContent(question, images) {
  if (!images.length) return question;
  return [
    { type: 'text', text: question },
    ...images.flatMap((image, index) => {
      const imageUrl = { url: image.url };
      if (image.detail) imageUrl.detail = image.detail;
      return [
        { type: 'text', text: compactImageLabel(image, index) },
        { type: 'image_url', image_url: imageUrl }
      ];
    })
  ];
}

export function buildResponsesHistory(history) {
  return history.map((message) => ({
    role: message.role,
    content:
      message.role === 'user'
        ? buildResponsesUserContent(message.content, asArray(message.images))
        : message.content
  }));
}

export function buildChatHistory(history) {
  return history.map((message) => ({
    role: message.role,
    content:
      message.role === 'user'
        ? buildChatUserContent(message.content, asArray(message.images))
        : message.content
  }));
}

export function uniqueContextImages(context) {
  const images = [];
  const seen = new Set();
  const add = (image) => {
    const key = `${asString(image && image.id)}\n${asString(image && image.url)}`;
    if (!asString(image && image.url) || seen.has(key)) return;
    seen.add(key);
    images.push(image);
  };
  context.history.forEach((message) => asArray(message.images).forEach(add));
  context.images.forEach(add);
  return images;
}

export function contentText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return asString(content && (content.text || content.content));
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!(item && typeof item === 'object')) return '';
      if (typeof item.text === 'string') return item.text;
      if (item.text && typeof item.text.value === 'string') return item.text.value;
      return typeof item.content === 'string' ? item.content : '';
    })
    .map(asString)
    .filter(Boolean)
    .join('\n');
}

function withoutCavalryCitationAnchors(value) {
  return asString(value)
    .replace(/\s*\[source\]\(#cavalry-source-[a-z0-9_-]+\)/gi, '')
    .trim();
}

function imageSourcesFromContent(content) {
  return asArray(content)
    .filter((item) => {
      const type = asString(item && item.type);
      return type === 'input_image' || type === 'image_url';
    })
    .map((item, index) => {
      const source = asObject(item);
      const nested = asObject(source.image_url || source.imageUrl);
      return {
        id: asString(source.id) || `history_image_${index + 1}`,
        filename: asString(source.filename || source.name) || `History image ${index + 1}`,
        imageUrl:
          nested.url ||
          (typeof source.image_url === 'string' ? source.image_url : '') ||
          (typeof source.imageUrl === 'string' ? source.imageUrl : ''),
        detail: source.detail || nested.detail
      };
    });
}

export function normalizeHistory(history) {
  const messages = [];
  let imageCount = 0;
  for (const message of asArray(history)) {
    const source = asObject(message);
    const role = asString(source.role).toLowerCase();
    if (!['user', 'assistant'].includes(role)) continue;
    const rawContent =
      typeof source.content !== 'undefined'
        ? source.content
        : typeof source.text !== 'undefined'
          ? source.text
          : source.message;
    const normalizedContent =
      role === 'assistant' ? projectLegacyAssistantText(rawContent) : contentText(rawContent);
    const content =
      role === 'assistant' ? withoutCavalryCitationAnchors(normalizedContent) : normalizedContent;
    const imageSources =
      role === 'user'
        ? asArray(source.images).length
          ? source.images
          : asArray(source.attachments).length
            ? source.attachments
            : imageSourcesFromContent(rawContent)
        : [];
    const availableImageSources = asArray(imageSources).filter(
      (image) => asObject(image).storageUnavailable !== true
    );
    const normalizedImages = normalizeImages(availableImageSources);
    if (normalizedImages.error)
      return { messages: [], imageCount: 0, error: normalizedImages.error };
    imageCount += normalizedImages.images.length;
    if (!content && !normalizedImages.images.length) continue;
    messages.push({
      role,
      content:
        content ||
        (normalizedImages.images.length === 1
          ? 'Analyze the attached image.'
          : 'Analyze the attached images.'),
      ...(normalizedImages.images.length ? { images: normalizedImages.images } : {})
    });
  }
  return { messages, imageCount, error: '' };
}
