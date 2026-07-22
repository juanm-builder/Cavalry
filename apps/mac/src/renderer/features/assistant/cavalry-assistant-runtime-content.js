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
    const normalizedContent = contentText(rawContent);
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
    const normalizedImages = normalizeImages(imageSources);
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
