// Owns durable Cavalry Cloud feedback and private image attachments in Electron main.
'use strict';

const FEEDBACK_ATTACHMENT_BUCKET = 'feedback-attachments';
const MAX_FEEDBACK_DESCRIPTION_CHARACTERS = 10000;
const MAX_FEEDBACK_DESCRIPTION_BYTES = 40000;
const MAX_FEEDBACK_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const FEEDBACK_KINDS = new Set(['bug', 'feedback']);
const FEEDBACK_SOURCES = new Set(['assistant', 'settings']);
const FEEDBACK_STATUSES = new Set(['received', 'reviewing', 'resolved', 'closed']);
const FEEDBACK_MIME_EXTENSIONS = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg'
});

function text(value, maximum = 512) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maximum);
}

function normalizeDescription(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim();
}

function publicFailure(code, message) {
  return { ok: false, code, error: message };
}

function firstRecord(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data && typeof data === 'object' ? data : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function normalizeContext(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const routeId = text(source.routeId || source.route_id, 64).toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(routeId) ? { routeId } : {};
}

function safeFileName(value, mimeType) {
  const leaf = String(value == null ? '' : value)
    .split(/[\\/]/)
    .at(-1);
  const extension = FEEDBACK_MIME_EXTENSIONS[mimeType] || 'png';
  const stem = text(leaf, 240).replace(/\.[a-z0-9]{1,12}$/i, '');
  const maximumStemLength = 240 - extension.length - 1;
  return `${(stem || 'cavalry-feedback').slice(0, maximumStemLength)}.${extension}`;
}

function isExpectedAttachmentPath(ownerId, reportId, attachmentId, mimeType, storagePath) {
  const extension = FEEDBACK_MIME_EXTENSIONS[mimeType];
  return !!(
    extension &&
    isUuid(ownerId) &&
    isUuid(reportId) &&
    isUuid(attachmentId) &&
    storagePath === `${ownerId}/${reportId}/${attachmentId}.${extension}`
  );
}

function bufferFromBytes(value) {
  try {
    if (Buffer.isBuffer(value)) {
      return value.length <= MAX_FEEDBACK_ATTACHMENT_BYTES ? Buffer.from(value) : null;
    }
    if (value instanceof ArrayBuffer) {
      return value.byteLength <= MAX_FEEDBACK_ATTACHMENT_BYTES ? Buffer.from(value) : null;
    }
    if (ArrayBuffer.isView(value)) {
      return value.byteLength <= MAX_FEEDBACK_ATTACHMENT_BYTES
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : null;
    }
    if (Array.isArray(value)) {
      return value.length <= MAX_FEEDBACK_ATTACHMENT_BYTES ? Buffer.from(value) : null;
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function decodeImageDataUrl(value) {
  const dataUrl = typeof value === 'string' ? value.trim() : '';
  const maximumLength = Math.ceil((MAX_FEEDBACK_ATTACHMENT_BYTES * 4) / 3) + 256;
  if (!dataUrl || dataUrl.length > maximumLength) return null;
  const match = /^data:(image\/(?:png|jpeg));base64,([a-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) return null;
  return { bytes, mimeType: match[1].toLowerCase() };
}

async function bufferFromDownload(value) {
  const direct = bufferFromBytes(value);
  if (direct) return direct;
  if (value && typeof value.arrayBuffer === 'function') {
    return Buffer.from(await value.arrayBuffer());
  }
  return null;
}

function hasJpegImageMarkers(bytes) {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  let hasStartOfFrame = false;
  let hasStartOfScan = false;
  for (let index = 2; index < bytes.length - 2; index += 1) {
    if (bytes[index] !== 0xff) continue;
    const marker = bytes[index + 1];
    if (marker === 0xda) hasStartOfScan = true;
    if (startOfFrameMarkers.has(marker)) hasStartOfFrame = true;
    if (hasStartOfFrame && hasStartOfScan) return true;
  }
  return false;
}

function detectImageMimeType(bytes) {
  if (!Buffer.isBuffer(bytes)) return '';
  if (
    bytes.length >= 45 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString('ascii', 12, 16) === 'IHDR' &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.readUInt32BE(bytes.length - 12) === 0 &&
    bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND'
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 20 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9 &&
    hasJpegImageMarkers(bytes)
  ) {
    return 'image/jpeg';
  }
  return '';
}

function isDecodableImage(bytes, nativeImage) {
  if (!(nativeImage && typeof nativeImage.createFromBuffer === 'function')) return false;
  try {
    const image = nativeImage.createFromBuffer(bytes);
    const size = image && typeof image.getSize === 'function' ? image.getSize() : {};
    return !!(
      image &&
      typeof image.isEmpty === 'function' &&
      !image.isEmpty() &&
      Number(size.width) > 0 &&
      Number(size.height) > 0
    );
  } catch (_error) {
    return false;
  }
}

function validateAttachment(value, dependencies = {}) {
  if (value == null) return { ok: true, attachment: null };
  if (!(value && typeof value === 'object' && !Array.isArray(value))) {
    return publicFailure('invalid_feedback_attachment', 'Choose a PNG or JPEG image.');
  }
  const decodedDataUrl = decodeImageDataUrl(value.dataUrl || value.data_url);
  const bytes =
    bufferFromBytes(value.bytes || value.data) || (decodedDataUrl && decodedDataUrl.bytes);
  if (!bytes || bytes.length < 1 || bytes.length > MAX_FEEDBACK_ATTACHMENT_BYTES) {
    return publicFailure(
      'invalid_feedback_attachment_size',
      'Feedback images must be no larger than 8 MB.'
    );
  }
  const detectedMimeType = detectImageMimeType(bytes);
  const declaredMimeType = text(
    value.mimeType || value.type || (decodedDataUrl && decodedDataUrl.mimeType),
    80
  ).toLowerCase();
  if (
    !FEEDBACK_MIME_EXTENSIONS[detectedMimeType] ||
    !isDecodableImage(bytes, dependencies.nativeImage) ||
    (declaredMimeType && declaredMimeType !== detectedMimeType) ||
    (decodedDataUrl && decodedDataUrl.mimeType !== detectedMimeType)
  ) {
    return publicFailure('invalid_feedback_attachment_type', 'Choose a valid PNG or JPEG image.');
  }
  const declaredSize = Number(value.size);
  if (Number.isFinite(declaredSize) && declaredSize > 0 && declaredSize !== bytes.length) {
    return publicFailure(
      'invalid_feedback_attachment_size',
      'The selected image could not be verified.'
    );
  }
  return {
    ok: true,
    attachment: {
      bytes,
      fileName: safeFileName(value.fileName || value.filename || value.name, detectedMimeType),
      mimeType: detectedMimeType,
      sizeBytes: bytes.length
    }
  };
}

function normalizeAttachmentMetadata(value) {
  const source = value && typeof value === 'object' ? value : {};
  const id = text(source.id, 64);
  const uploadedAt = text(source.uploaded_at || source.uploadedAt, 64);
  if (!isUuid(id) || !uploadedAt) return null;
  const sizeBytes = Number(source.size_bytes ?? source.sizeBytes);
  const mimeType = text(source.mime_type || source.mimeType, 80).toLowerCase();
  if (
    !FEEDBACK_MIME_EXTENSIONS[mimeType] ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > MAX_FEEDBACK_ATTACHMENT_BYTES
  ) {
    return null;
  }
  return {
    id,
    fileName: safeFileName(source.file_name || source.fileName, mimeType),
    mimeType,
    sizeBytes,
    createdAt: text(source.created_at || source.createdAt, 64)
  };
}

function normalizeFeedbackReport(value) {
  const source = value && typeof value === 'object' ? value : {};
  const id = text(source.id || source.report_id, 64);
  const kind = text(source.kind, 32).toLowerCase();
  const description = normalizeDescription(source.description);
  const reportSource = text(source.source, 32).toLowerCase();
  const status = text(source.status || 'received', 32).toLowerCase();
  if (
    !isUuid(id) ||
    !FEEDBACK_KINDS.has(kind) ||
    !description ||
    !FEEDBACK_SOURCES.has(reportSource)
  ) {
    return null;
  }
  const rawAttachments = Array.isArray(source.feedback_attachments)
    ? source.feedback_attachments
    : source.attachment
      ? [source.attachment]
      : [];
  const attachment = rawAttachments.map(normalizeAttachmentMetadata).find(Boolean) || null;
  return {
    id,
    kind,
    description,
    source: reportSource,
    status: FEEDBACK_STATUSES.has(status) ? status : 'received',
    context: normalizeContext(source.context),
    createdAt: text(source.created_at || source.createdAt, 64),
    updatedAt: text(source.updated_at || source.updatedAt, 64),
    attachment
  };
}

function isDatabaseContractError(error) {
  const code = String((error && error.code) || '');
  const message = String((error && error.message) || '');
  return (
    ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code) ||
    /create_feedback_report|feedback_reports|feedback_attachments|schema cache/i.test(message)
  );
}

function isQuotaError(error) {
  return !!(
    error &&
    (String(error.code || '') === '54000' ||
      /feedback_(?:report|storage)_quota/i.test(error.message))
  );
}

function isSessionChangedError(error) {
  return !!(error && /cloud_session_changed/i.test(String(error.message || '')));
}

function createCloudFeedbackController(dependencies = {}) {
  const auth = dependencies.auth;
  const app = dependencies.app;
  const nativeImage = dependencies.nativeImage;
  const getSessionBinding = dependencies.getSessionBinding;
  const platform = text(dependencies.platform || process.platform, 40).toLowerCase();

  function sessionChangedFailure() {
    return publicFailure(
      'cloud_session_changed',
      'The Cavalry Cloud account changed. Try the feedback request again.'
    );
  }

  function currentSessionBinding(authState) {
    const supplied =
      typeof getSessionBinding === 'function' ? getSessionBinding() : authState || {};
    const generation = Number(supplied && supplied.generation);
    return {
      userId: text(
        (supplied && (supplied.userId || supplied.user_id)) ||
          (authState && authState.user && authState.user.id),
        64
      ),
      generation: Number.isSafeInteger(generation) && generation >= 0 ? generation : 0
    };
  }

  function sessionMatches(context) {
    const authState = auth && typeof auth.getState === 'function' ? auth.getState() : {};
    const binding = currentSessionBinding(authState);
    return !!(
      context &&
      auth &&
      typeof auth.isSignedIn === 'function' &&
      auth.isSignedIn() &&
      authState.status === 'signed_in' &&
      authState.user &&
      authState.user.id === context.user.id &&
      binding.userId === context.binding.userId &&
      binding.generation === context.binding.generation
    );
  }

  async function signedInContext(payload = {}) {
    const authState = auth && typeof auth.getState === 'function' ? auth.getState() : {};
    if (
      authState.configured === false ||
      ['unconfigured', 'unavailable', 'error'].includes(String(authState.status || ''))
    ) {
      return {
        failure: publicFailure(
          'cloud_unavailable',
          'Cavalry Cloud is unavailable, so this report was not sent or queued.'
        )
      };
    }
    const expectedUserId = text(payload.expectedUserId || payload.expected_user_id, 64);
    const expectedGeneration =
      payload.expectedSessionGeneration ?? payload.expected_session_generation;
    const liveClient = auth && typeof auth.getClient === 'function' ? auth.getClient() : null;
    const user = authState && authState.user;
    if (!(
      auth &&
      typeof auth.isSignedIn === 'function' &&
      auth.isSignedIn() &&
      liveClient &&
      user &&
      isUuid(user.id)
    )) {
      return {
        failure: publicFailure(
          'not_signed_in',
          'Sign in to Cavalry Cloud to send and sync feedback across devices.'
        )
      };
    }
    const binding = currentSessionBinding(authState);
    if (
      !isUuid(expectedUserId) ||
      expectedUserId !== user.id ||
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 ||
      expectedGeneration !== binding.generation ||
      binding.userId !== user.id
    ) {
      return { failure: sessionChangedFailure() };
    }
    const client =
      auth && typeof auth.createSessionBoundClient === 'function'
        ? await auth.createSessionBoundClient(user.id)
        : liveClient;
    if (!client || !sessionMatches({ binding, user })) {
      return { failure: sessionChangedFailure() };
    }
    return { binding, client, user };
  }

  async function listReports(payload = {}) {
    const context = await signedInContext(payload);
    if (context.failure) return context.failure;
    try {
      const recovery = await context.client.rpc('recover_feedback_attachments');
      if (!sessionMatches(context)) return sessionChangedFailure();
      if (recovery.error) throw recovery.error;
      for (const pending of Array.isArray(recovery.data) ? recovery.data : []) {
        const reportId = text(pending && pending.report_id, 64);
        const attachmentId = text(pending && pending.attachment_id, 64);
        const storagePath = text(pending && pending.storage_path, 512);
        const mimeType = text(pending && pending.mime_type, 80).toLowerCase();
        if (
          !isExpectedAttachmentPath(context.user.id, reportId, attachmentId, mimeType, storagePath)
        ) {
          continue;
        }
        if (await removeStoredAttachment(context.client, storagePath)) {
          await discardPendingAttachment(context.client, reportId, attachmentId);
        }
      }
      if (!sessionMatches(context)) return sessionChangedFailure();
      const result = await context.client
        .from('feedback_reports')
        .select(
          'id,kind,description,source,status,context,created_at,updated_at,feedback_attachments(id,file_name,mime_type,size_bytes,uploaded_at,created_at)'
        )
        .order('created_at', { ascending: false })
        .limit(100);
      if (!sessionMatches(context)) return sessionChangedFailure();
      if (result.error) throw result.error;
      return {
        ok: true,
        sessionGeneration: context.binding.generation,
        userId: context.user.id,
        reports: (Array.isArray(result.data) ? result.data : [])
          .map(normalizeFeedbackReport)
          .filter(Boolean)
      };
    } catch (error) {
      if (!sessionMatches(context)) return sessionChangedFailure();
      if (isDatabaseContractError(error)) {
        return publicFailure(
          'cloud_database_update_required',
          'Cavalry Cloud needs the feedback database update before reports can sync.'
        );
      }
      return publicFailure(
        'feedback_unavailable',
        'Your feedback reports could not be loaded from Cavalry Cloud.'
      );
    }
  }

  async function discardPendingAttachment(client, reportId, attachmentId) {
    try {
      const result = await client.rpc('discard_feedback_attachment', {
        p_report_id: reportId,
        p_attachment_id: attachmentId
      });
      return !(result && result.error) && result.data === true;
    } catch (_error) {
      // A later database cleanup can remove a stale pending metadata row.
      return false;
    }
  }

  async function removeStoredAttachment(client, storagePath) {
    try {
      const result = await client.storage.from(FEEDBACK_ATTACHMENT_BUCKET).remove([storagePath]);
      return !!result && !result.error;
    } catch (_error) {
      return false;
    }
  }

  async function submitReport(payload = {}) {
    const context = await signedInContext(payload);
    if (context.failure) return context.failure;
    const kind = text(payload.kind, 32).toLowerCase();
    const description = normalizeDescription(payload.description);
    const source = text(payload.source || 'settings', 32).toLowerCase();
    const clientRequestId = text(
      payload.clientRequestId || payload.client_request_id,
      64
    ).toLowerCase();
    if (!isUuid(clientRequestId)) {
      return publicFailure(
        'invalid_feedback_request_id',
        'This feedback request could not be identified. Try again.'
      );
    }
    if (!FEEDBACK_KINDS.has(kind)) {
      return publicFailure('invalid_feedback_kind', 'Choose Bug report or Feedback.');
    }
    if (
      !description ||
      Array.from(description).length > MAX_FEEDBACK_DESCRIPTION_CHARACTERS ||
      Buffer.byteLength(description, 'utf8') > MAX_FEEDBACK_DESCRIPTION_BYTES
    ) {
      return publicFailure(
        'invalid_feedback_description',
        `Describe what happened in ${MAX_FEEDBACK_DESCRIPTION_CHARACTERS.toLocaleString('en-US')} characters or fewer.`
      );
    }
    if (!FEEDBACK_SOURCES.has(source)) {
      return publicFailure('invalid_feedback_source', 'The feedback source is invalid.');
    }
    const attachmentResult = validateAttachment(payload.attachment, { nativeImage });
    if (!attachmentResult.ok) return attachmentResult;
    const attachment = attachmentResult.attachment;
    const reportContext = normalizeContext(payload.context);
    const appVersion =
      app && typeof app.getVersion === 'function' ? text(app.getVersion(), 80) : '';
    try {
      const created = await context.client.rpc('create_feedback_report', {
        p_expected_owner_id: context.user.id,
        p_client_request_id: clientRequestId,
        p_kind: kind,
        p_description: description,
        p_source: source,
        p_context: reportContext,
        p_app_version: appVersion,
        p_platform: platform,
        p_attachment_file_name: attachment ? attachment.fileName : null,
        p_attachment_mime_type: attachment ? attachment.mimeType : null,
        p_attachment_size_bytes: attachment ? attachment.sizeBytes : null
      });
      if (created.error) throw created.error;
      const record = firstRecord(created.data);
      const reportId = text(record && record.report_id, 64);
      const attachmentId = text(record && record.attachment_id, 64);
      const storagePath = text(record && record.storage_path, 512);
      const createdAt = text(record && record.created_at, 64);
      const attachmentUploadedAt = text(record && record.attachment_uploaded_at, 64);
      const requestReplayed = !!(record && record.request_replayed === true);
      if (!isUuid(reportId)) throw new Error('invalid_feedback_report_result');

      let attachmentMetadata = null;
      let attachmentRetryRequired = false;
      let warning = '';
      if (attachment) {
        const expectedPath = `${context.user.id}/${reportId}/${attachmentId}.${FEEDBACK_MIME_EXTENSIONS[attachment.mimeType]}`;
        if (!isUuid(attachmentId) || storagePath !== expectedPath) {
          attachmentRetryRequired = !(await discardPendingAttachment(
            context.client,
            reportId,
            attachmentId
          ));
          warning = 'Your report was saved, but its image metadata could not be verified.';
        } else if (attachmentUploadedAt) {
          attachmentMetadata = {
            id: attachmentId,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            createdAt
          };
        } else if (requestReplayed) {
          let finalized;
          try {
            finalized = await context.client.rpc('finalize_feedback_attachment', {
              p_report_id: reportId,
              p_attachment_id: attachmentId
            });
          } catch (_error) {
            finalized = { data: false, error: new Error('recovery_finalize_failed') };
          }
          if (!finalized.error && finalized.data === true) {
            attachmentMetadata = {
              id: attachmentId,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              createdAt
            };
          }
        }
        if (!attachmentMetadata && !warning) {
          let uploaded = null;
          try {
            uploaded = await context.client.storage
              .from(FEEDBACK_ATTACHMENT_BUCKET)
              .upload(storagePath, attachment.bytes, {
                cacheControl: '3600',
                contentType: attachment.mimeType,
                upsert: false
              });
          } catch (_error) {
            uploaded = { error: new Error('upload_failed') };
          }
          if (uploaded && !uploaded.error) {
            let finalized;
            try {
              finalized = await context.client.rpc('finalize_feedback_attachment', {
                p_report_id: reportId,
                p_attachment_id: attachmentId
              });
            } catch (_error) {
              finalized = { data: false, error: new Error('finalize_failed') };
            }
            if (!finalized.error && finalized.data === true) {
              attachmentMetadata = {
                id: attachmentId,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                createdAt
              };
            } else {
              const removed = await removeStoredAttachment(context.client, storagePath);
              const discarded =
                removed && (await discardPendingAttachment(context.client, reportId, attachmentId));
              attachmentRetryRequired = !discarded;
              warning = 'Your report was saved, but its image could not be finalized.';
            }
          } else {
            const removed = await removeStoredAttachment(context.client, storagePath);
            const discarded =
              removed && (await discardPendingAttachment(context.client, reportId, attachmentId));
            attachmentRetryRequired = !discarded;
            warning = 'Your report was saved, but its image could not be uploaded.';
          }
        }
      }

      if (!sessionMatches(context)) return sessionChangedFailure();
      if (attachmentRetryRequired) {
        return {
          ok: false,
          code: 'feedback_attachment_retry_required',
          error:
            'Your report was saved, but its image still needs attention. Keep this form open and send it again to finish safely.',
          reportSaved: true
        };
      }
      return {
        ok: true,
        sessionGeneration: context.binding.generation,
        userId: context.user.id,
        report: {
          id: reportId,
          kind,
          description,
          source,
          status: 'received',
          context: reportContext,
          createdAt,
          updatedAt: createdAt,
          attachment: attachmentMetadata
        },
        ...(warning ? { warning } : {})
      };
    } catch (error) {
      if (!sessionMatches(context)) return sessionChangedFailure();
      if (isSessionChangedError(error)) return sessionChangedFailure();
      if (isQuotaError(error)) {
        return publicFailure(
          'feedback_quota_exceeded',
          'This Cavalry Cloud account has reached its feedback storage limit.'
        );
      }
      if (isDatabaseContractError(error)) {
        return publicFailure(
          'cloud_database_update_required',
          'Cavalry Cloud needs the feedback database update before reports can sync.'
        );
      }
      return publicFailure(
        'feedback_submit_failed',
        'Your report could not be sent. Nothing was queued on this Mac.'
      );
    }
  }

  async function getAttachment(payload = {}) {
    const context = await signedInContext(payload);
    if (context.failure) return context.failure;
    const attachmentId = text(payload.attachmentId || payload.id, 64);
    if (!isUuid(attachmentId)) {
      return publicFailure('invalid_feedback_attachment', 'Choose a valid report image.');
    }
    try {
      const metadataResult = await context.client
        .from('feedback_attachments')
        .select('id,file_name,mime_type,size_bytes,storage_path,uploaded_at')
        .eq('id', attachmentId)
        .maybeSingle();
      if (!sessionMatches(context)) return sessionChangedFailure();
      if (metadataResult.error) throw metadataResult.error;
      const metadata = metadataResult.data;
      if (!(metadata && metadata.uploaded_at)) {
        return publicFailure('feedback_attachment_not_found', 'That report image is unavailable.');
      }
      const storagePath = text(metadata.storage_path, 512);
      const mimeType = text(metadata.mime_type, 80).toLowerCase();
      const expectedSize = Number(metadata.size_bytes);
      if (
        !storagePath ||
        !FEEDBACK_MIME_EXTENSIONS[mimeType] ||
        !Number.isSafeInteger(expectedSize) ||
        expectedSize < 1 ||
        expectedSize > MAX_FEEDBACK_ATTACHMENT_BYTES
      ) {
        throw new Error('invalid_feedback_attachment_metadata');
      }
      const downloaded = await context.client.storage
        .from(FEEDBACK_ATTACHMENT_BUCKET)
        .download(storagePath);
      if (!sessionMatches(context)) return sessionChangedFailure();
      if (downloaded.error) throw downloaded.error;
      const bytes = await bufferFromDownload(downloaded.data);
      if (!sessionMatches(context)) return sessionChangedFailure();
      if (
        !bytes ||
        bytes.length !== expectedSize ||
        bytes.length > MAX_FEEDBACK_ATTACHMENT_BYTES ||
        detectImageMimeType(bytes) !== mimeType ||
        !isDecodableImage(bytes, nativeImage)
      ) {
        throw new Error('invalid_feedback_attachment_bytes');
      }
      return {
        ok: true,
        sessionGeneration: context.binding.generation,
        userId: context.user.id,
        attachment: {
          id: attachmentId,
          fileName: safeFileName(metadata.file_name, mimeType),
          mimeType,
          dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`
        }
      };
    } catch (error) {
      if (!sessionMatches(context)) return sessionChangedFailure();
      if (isDatabaseContractError(error)) {
        return publicFailure(
          'cloud_database_update_required',
          'Cavalry Cloud needs the feedback database update before report images can load.'
        );
      }
      return publicFailure(
        'feedback_attachment_load_failed',
        'That private report image could not be loaded.'
      );
    }
  }

  return { getAttachment, listReports, submitReport };
}

module.exports = {
  FEEDBACK_ATTACHMENT_BUCKET,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_DESCRIPTION_CHARACTERS,
  createCloudFeedbackController,
  detectImageMimeType,
  normalizeFeedbackReport,
  validateAttachment
};
