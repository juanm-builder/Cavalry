'use strict';

const { createHash } = require('node:crypto');

const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;
const ZONE_ID = Object.freeze({ zoneName: 'CavalryWorkbooksV1' });
const RECORD_TYPE = 'CavalryWorkbook';
const CONFLICT_FIELDS = [
  'conflictId',
  'conflictSourceDevice',
  'conflictDetectedAt',
  'conflictBaseRevision',
  'conflictRemoteRevision',
  'conflictSummary',
  'conflictReport',
  'conflictPackageNoticeId',
  'conflictPayloadHash',
  'conflictPayloadAsset',
  'conflictBasePayloadHash',
  'conflictBasePayloadAsset'
];

function fail(code = 'cloud_snapshot_invalid') {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function workbookId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw fail('invalid_workbook_id');
  }
  return value;
}

function recordName(id) {
  return `workbook_${sha256(workbookId(id))}`;
}

function text(value, maximum) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw fail();
  }
  return value.trim();
}

function date(value) {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw fail();
  return result;
}

function positiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw fail('invalid_revision');
  return value;
}

function field(record, name) {
  return record?.fields?.[name]?.value;
}

function encrypted(value) {
  return { value: value ?? null, isEncrypted: true };
}

function payloadBytes(value) {
  if (typeof value !== 'string' || !value) throw fail();
  const data = Buffer.from(value, 'utf8');
  if (data.length > MAX_PAYLOAD_BYTES) throw fail('cloud_quota_exceeded');
  return data;
}

function conflictNotice(raw, id) {
  if (!raw || typeof raw !== 'object') throw fail('invalid_conflict_notice');
  const report = typeof raw.report === 'string' ? raw.report : JSON.stringify(raw.report);
  if (!report || Buffer.byteLength(report, 'utf8') > 128 * 1024)
    throw fail('invalid_conflict_notice');
  let parsed;
  try {
    parsed = JSON.parse(report);
  } catch {
    throw fail('invalid_conflict_notice');
  }
  if (parsed?.version !== 1 || parsed?.workbookId !== id || !Array.isArray(parsed.entries)) {
    throw fail('invalid_conflict_notice');
  }
  return {
    id: workbookId(raw.id),
    sourceDevice: text(raw.sourceDevice, 40),
    detectedAt: date(raw.detectedAt),
    baseRevision: raw.baseRevision == null ? null : positiveInteger(raw.baseRevision),
    remoteRevision: positiveInteger(raw.remoteRevision),
    summary: text(raw.summary, 240),
    report
  };
}

function metadata(record) {
  if (!record || record.recordType !== RECORD_TYPE || record.deleted === true) throw fail();
  const id = workbookId(field(record, 'workbookId'));
  if (record.recordName !== recordName(id)) throw fail('cloud_workbook_identity_mismatch');
  const year = field(record, 'year');
  if (year != null && !Number.isSafeInteger(year)) throw fail();
  const currency = text(field(record, 'currency'), 12).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw fail();
  const result = {
    id,
    name: text(field(record, 'name'), 160),
    year: year ?? null,
    currency,
    revision: positiveInteger(field(record, 'revision')),
    updatedAt: date(field(record, 'sourceUpdatedAt')),
    inCloud: true
  };
  if (field(record, 'conflictId') != null) {
    const notice = conflictNotice(
      {
        id: field(record, 'conflictId'),
        sourceDevice: field(record, 'conflictSourceDevice'),
        detectedAt: field(record, 'conflictDetectedAt'),
        baseRevision: field(record, 'conflictBaseRevision'),
        remoteRevision: field(record, 'conflictRemoteRevision'),
        summary: field(record, 'conflictSummary'),
        report: field(record, 'conflictReport')
      },
      id
    );
    result.conflictNotice = {
      ...notice,
      resolutionAvailable:
        field(record, 'conflictPackageNoticeId') === notice.id &&
        Boolean(field(record, 'conflictPayloadHash')) &&
        Boolean(field(record, 'conflictPayloadAsset'))
    };
  }
  return result;
}

function workbookFields(request, revision, asset) {
  const fields = {
    schemaVersion: { value: 1 },
    workbookId: encrypted(workbookId(request.workbookId)),
    name: encrypted(text(request.name, 160)),
    year: encrypted(request.year),
    currency: encrypted(text(request.currency, 12).toUpperCase()),
    revision: encrypted(positiveInteger(revision)),
    sourceUpdatedAt: encrypted(date(request.updatedAt)),
    payloadHash: encrypted(sha256(payloadBytes(request.portableHtml))),
    payloadAsset: { value: asset, type: 'ASSET' }
  };
  // Validate the exact metadata that a native client will read before uploading.
  metadata({ recordName: recordName(request.workbookId), recordType: RECORD_TYPE, fields });
  return fields;
}

function conflictFields(notice, source, base) {
  if (!notice)
    return Object.fromEntries(
      CONFLICT_FIELDS.map((name) => [
        name,
        name.endsWith('Asset') ? { value: null } : encrypted(null)
      ])
    );
  return {
    conflictId: encrypted(notice.id),
    conflictSourceDevice: encrypted(notice.sourceDevice),
    conflictDetectedAt: encrypted(notice.detectedAt),
    conflictBaseRevision: encrypted(notice.baseRevision),
    conflictRemoteRevision: encrypted(notice.remoteRevision),
    conflictSummary: encrypted(notice.summary),
    conflictReport: encrypted(notice.report),
    conflictPackageNoticeId: encrypted(notice.id),
    conflictPayloadHash: encrypted(source.hash),
    conflictPayloadAsset: { value: source.asset, type: 'ASSET' },
    conflictBasePayloadHash: encrypted(base?.hash),
    conflictBasePayloadAsset: { value: base?.asset ?? null, type: 'ASSET' }
  };
}

module.exports = {
  MAX_PAYLOAD_BYTES,
  ZONE_ID,
  RECORD_TYPE,
  fail,
  sha256,
  workbookId,
  recordName,
  field,
  payloadBytes,
  metadata,
  positiveInteger,
  workbookFields,
  conflictNotice,
  conflictFields
};
