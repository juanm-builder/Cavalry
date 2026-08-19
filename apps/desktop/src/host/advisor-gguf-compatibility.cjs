'use strict';

const { open } = require('node:fs/promises');

const GGUF_MAGIC = 'GGUF';
const SUPPORTED_GGUF_VERSIONS = new Set([2, 3]);
const MAX_METADATA_ENTRIES = 16_384;
const MAX_METADATA_BYTES = 64 * 1024 * 1024;
const MAX_KEY_BYTES = 4 * 1024;
const MAX_RELEVANT_STRING_BYTES = 64 * 1024;
const MAX_ARRAY_ELEMENTS = 2_000_000;
const MAX_ARRAY_NESTING = 4;

const GGUF_VALUE_TYPE = Object.freeze({
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
  INT64: 11,
  FLOAT64: 12
});

const FIXED_VALUE_BYTES = new Map([
  [GGUF_VALUE_TYPE.UINT8, 1],
  [GGUF_VALUE_TYPE.INT8, 1],
  [GGUF_VALUE_TYPE.UINT16, 2],
  [GGUF_VALUE_TYPE.INT16, 2],
  [GGUF_VALUE_TYPE.UINT32, 4],
  [GGUF_VALUE_TYPE.INT32, 4],
  [GGUF_VALUE_TYPE.FLOAT32, 4],
  [GGUF_VALUE_TYPE.BOOL, 1],
  [GGUF_VALUE_TYPE.UINT64, 8],
  [GGUF_VALUE_TYPE.INT64, 8],
  [GGUF_VALUE_TYPE.FLOAT64, 8]
]);

class GgufMetadataError extends Error {
  constructor(code, message, filePath, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GgufMetadataError';
    this.code = code;
    this.filePath = filePath;
  }
}

function metadataError(code, message, filePath, cause) {
  return new GgufMetadataError(code, message, filePath, cause);
}

function asSafeLength(value, label, filePath) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw metadataError(
      'unsafe-length',
      `The GGUF ${label} is too large to inspect safely.`,
      filePath
    );
  }
  return Number(value);
}

function countForResult(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

class BoundedFileCursor {
  constructor(handle, filePath, fileSize, maximumPosition) {
    this.handle = handle;
    this.filePath = filePath;
    this.fileSize = fileSize;
    this.maximumPosition = maximumPosition;
    this.position = 0;
  }

  assertRange(length) {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw metadataError(
        'unsafe-length',
        'The GGUF file declares an unsafe value length.',
        this.filePath
      );
    }
    const nextPosition = this.position + length;
    if (!Number.isSafeInteger(nextPosition) || nextPosition > this.fileSize) {
      throw metadataError(
        'truncated',
        'The GGUF metadata ends before its declared values are complete.',
        this.filePath
      );
    }
    if (nextPosition > this.maximumPosition) {
      throw metadataError(
        'metadata-limit',
        `The GGUF metadata exceeds Cavalry's ${MAX_METADATA_BYTES / 1024 / 1024} MB inspection limit.`,
        this.filePath
      );
    }
    return nextPosition;
  }

  async read(length) {
    const nextPosition = this.assertRange(length);
    const buffer = Buffer.allocUnsafe(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const result = await this.handle.read(
        buffer,
        bytesRead,
        length - bytesRead,
        this.position + bytesRead
      );
      if (!result.bytesRead) {
        throw metadataError(
          'truncated',
          'The GGUF metadata could not be read completely.',
          this.filePath
        );
      }
      bytesRead += result.bytesRead;
    }
    this.position = nextPosition;
    return buffer;
  }

  skip(length) {
    this.position = this.assertRange(length);
  }

  async uint32() {
    return (await this.read(4)).readUInt32LE(0);
  }

  async uint64() {
    return (await this.read(8)).readBigUInt64LE(0);
  }

  async string({ maximumBytes, label, decode }) {
    const byteLength = asSafeLength(await this.uint64(), `${label} length`, this.filePath);
    if (byteLength > maximumBytes) {
      throw metadataError(
        'string-limit',
        `The GGUF ${label} exceeds Cavalry's safe inspection limit.`,
        this.filePath
      );
    }
    if (!decode) {
      this.skip(byteLength);
      return undefined;
    }
    return (await this.read(byteLength)).toString('utf8');
  }
}

function assertKnownValueType(type, filePath) {
  if (!Number.isInteger(type) || type < GGUF_VALUE_TYPE.UINT8 || type > GGUF_VALUE_TYPE.FLOAT64) {
    throw metadataError(
      'unsupported-value-type',
      `The GGUF metadata contains unsupported value type ${type}.`,
      filePath
    );
  }
}

async function skipValue(cursor, type, state, nesting = 0) {
  assertKnownValueType(type, cursor.filePath);
  const fixedBytes = FIXED_VALUE_BYTES.get(type);
  if (fixedBytes) {
    cursor.skip(fixedBytes);
    return;
  }
  if (type === GGUF_VALUE_TYPE.STRING) {
    const byteLength = asSafeLength(await cursor.uint64(), 'string value length', cursor.filePath);
    cursor.skip(byteLength);
    return;
  }
  if (type !== GGUF_VALUE_TYPE.ARRAY) return;
  if (nesting >= MAX_ARRAY_NESTING) {
    throw metadataError(
      'array-nesting-limit',
      'The GGUF metadata contains excessively nested arrays.',
      cursor.filePath
    );
  }

  const elementType = await cursor.uint32();
  assertKnownValueType(elementType, cursor.filePath);
  const elementCount = asSafeLength(await cursor.uint64(), 'array length', cursor.filePath);
  if (elementCount > MAX_ARRAY_ELEMENTS) {
    throw metadataError(
      'array-limit',
      `The GGUF metadata array exceeds Cavalry's ${MAX_ARRAY_ELEMENTS.toLocaleString('en-US')}-element inspection limit.`,
      cursor.filePath
    );
  }

  const elementBytes = FIXED_VALUE_BYTES.get(elementType);
  if (elementBytes) {
    const totalBytes = elementCount * elementBytes;
    if (!Number.isSafeInteger(totalBytes)) {
      throw metadataError(
        'unsafe-length',
        'The GGUF metadata array is too large to inspect safely.',
        cursor.filePath
      );
    }
    cursor.skip(totalBytes);
    return;
  }

  for (let index = 0; index < elementCount; index += 1) {
    state.arrayElementsVisited += 1;
    if (state.arrayElementsVisited > MAX_ARRAY_ELEMENTS) {
      throw metadataError(
        'array-limit',
        `The GGUF metadata arrays exceed Cavalry's ${MAX_ARRAY_ELEMENTS.toLocaleString('en-US')}-element inspection limit.`,
        cursor.filePath
      );
    }
    await skipValue(cursor, elementType, state, nesting + 1);
  }
}

async function readScalarValue(cursor, type) {
  assertKnownValueType(type, cursor.filePath);
  if (type === GGUF_VALUE_TYPE.STRING) {
    return cursor.string({
      maximumBytes: MAX_RELEVANT_STRING_BYTES,
      label: 'relevant string value',
      decode: true
    });
  }

  const byteLength = FIXED_VALUE_BYTES.get(type);
  if (!byteLength) return undefined;
  const buffer = await cursor.read(byteLength);
  switch (type) {
    case GGUF_VALUE_TYPE.UINT8:
      return buffer.readUInt8(0);
    case GGUF_VALUE_TYPE.INT8:
      return buffer.readInt8(0);
    case GGUF_VALUE_TYPE.UINT16:
      return buffer.readUInt16LE(0);
    case GGUF_VALUE_TYPE.INT16:
      return buffer.readInt16LE(0);
    case GGUF_VALUE_TYPE.UINT32:
      return buffer.readUInt32LE(0);
    case GGUF_VALUE_TYPE.INT32:
      return buffer.readInt32LE(0);
    case GGUF_VALUE_TYPE.FLOAT32:
      return buffer.readFloatLE(0);
    case GGUF_VALUE_TYPE.BOOL:
      return buffer.readUInt8(0) !== 0;
    case GGUF_VALUE_TYPE.UINT64: {
      const value = buffer.readBigUInt64LE(0);
      return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
    }
    case GGUF_VALUE_TYPE.INT64: {
      const value = buffer.readBigInt64LE(0);
      return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : value;
    }
    case GGUF_VALUE_TYPE.FLOAT64:
      return buffer.readDoubleLE(0);
    default:
      return undefined;
  }
}

function isRelevantMetadataKey(key) {
  return (
    key === 'general.architecture' ||
    key === 'general.type' ||
    key === 'general.name' ||
    key === 'general.basename' ||
    key === 'general.base_model.0.name' ||
    key === 'general.size_label' ||
    key === 'clip.projector_type' ||
    key.endsWith('.embedding_length') ||
    key.endsWith('.projection_dim') ||
    key.endsWith('.projection_dimension')
  );
}

function asDimension(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function pickModelDimension(values, architecture) {
  const architectureKey = architecture ? `${architecture}.embedding_length` : '';
  const exactDimension = architectureKey ? asDimension(values.get(architectureKey)) : null;
  if (exactDimension) return { dimension: exactDimension, key: architectureKey };

  const candidates = [...values.entries()]
    .filter(
      ([key]) =>
        key.endsWith('.embedding_length') &&
        key !== 'clip.vision.embedding_length' &&
        !key.startsWith('clip.')
    )
    .map(([key, value]) => ({ dimension: asDimension(value), key }))
    .filter((candidate) => candidate.dimension);
  return candidates.length === 1 ? candidates[0] : { dimension: null, key: '' };
}

function pickProjectionDimension(values) {
  const keys = [
    'clip.vision.projection_dim',
    'clip.vision.projection_dimension',
    'clip.projector.output_dim',
    'clip.projector.output_dimension'
  ];
  for (const key of keys) {
    const dimension = asDimension(values.get(key));
    if (dimension) return { dimension, key };
  }
  const candidates = [...values.entries()]
    .filter(([key]) => key.endsWith('.projection_dim') || key.endsWith('.projection_dimension'))
    .map(([key, value]) => ({ dimension: asDimension(value), key }))
    .filter((candidate) => candidate.dimension);
  return candidates.length === 1 ? candidates[0] : { dimension: null, key: '' };
}

function hasEnoughMetadata(values) {
  const architecture = String(values.get('general.architecture') || '').trim();
  const type = String(values.get('general.type') || '')
    .trim()
    .toLowerCase();
  const hasIdentity = Boolean(
    String(
      values.get('general.name') ||
        values.get('general.basename') ||
        values.get('general.base_model.0.name') ||
        ''
    ).trim()
  );
  const projection = pickProjectionDimension(values);
  if ((type === 'mmproj' || architecture === 'clip') && projection.dimension && hasIdentity) {
    return true;
  }
  return Boolean(architecture && pickModelDimension(values, architecture).dimension && hasIdentity);
}

function summarizeMetadata({
  filePath,
  version,
  tensorCount,
  metadataCount,
  values,
  entriesScanned
}) {
  const architecture = String(values.get('general.architecture') || '').trim();
  const type = String(values.get('general.type') || '').trim();
  const name = String(values.get('general.name') || '').trim();
  const basename = String(values.get('general.basename') || '').trim();
  const baseModelName = String(values.get('general.base_model.0.name') || '').trim();
  const sizeLabel = String(values.get('general.size_label') || '').trim();
  const projectorType = String(values.get('clip.projector_type') || '').trim();
  const modelDimension = pickModelDimension(values, architecture);
  const projectionDimension = pickProjectionDimension(values);
  const role =
    type.toLowerCase() === 'mmproj' || (architecture === 'clip' && projectionDimension.dimension)
      ? 'projector'
      : modelDimension.dimension
        ? 'model'
        : 'unknown';

  return Object.freeze({
    format: GGUF_MAGIC,
    version,
    tensorCount: countForResult(tensorCount),
    metadataCount,
    entriesScanned,
    metadataComplete: entriesScanned === metadataCount,
    filePath,
    role,
    type,
    architecture,
    name,
    basename,
    baseModelName,
    sizeLabel,
    projectorType,
    embeddingDimension: modelDimension.dimension,
    embeddingDimensionKey: modelDimension.key,
    projectionDimension: projectionDimension.dimension,
    projectionDimensionKey: projectionDimension.key
  });
}

async function readGgufMetadata(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw metadataError('invalid-path', 'A GGUF file path is required.', String(filePath || ''));
  }

  let handle;
  try {
    handle = await open(filePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw metadataError('not-file', 'The selected GGUF path is not a regular file.', filePath);
    }
    const maximumPosition = Math.min(stat.size, MAX_METADATA_BYTES);
    const cursor = new BoundedFileCursor(handle, filePath, stat.size, maximumPosition);
    const magic = (await cursor.read(4)).toString('ascii');
    if (magic !== GGUF_MAGIC) {
      throw metadataError('invalid-magic', 'The selected file is not a GGUF file.', filePath);
    }

    const version = await cursor.uint32();
    if (!SUPPORTED_GGUF_VERSIONS.has(version)) {
      throw metadataError(
        'unsupported-version',
        `GGUF version ${version} is not supported for compatibility inspection.`,
        filePath
      );
    }

    const tensorCount = await cursor.uint64();
    const metadataCount = asSafeLength(await cursor.uint64(), 'metadata entry count', filePath);
    if (metadataCount > MAX_METADATA_ENTRIES) {
      throw metadataError(
        'metadata-count-limit',
        `The GGUF file declares more than ${MAX_METADATA_ENTRIES.toLocaleString('en-US')} metadata entries.`,
        filePath
      );
    }

    const values = new Map();
    const state = { arrayElementsVisited: 0 };
    let entriesScanned = 0;
    for (; entriesScanned < metadataCount; entriesScanned += 1) {
      const key = await cursor.string({
        maximumBytes: MAX_KEY_BYTES,
        label: 'metadata key',
        decode: true
      });
      const type = await cursor.uint32();
      assertKnownValueType(type, filePath);
      if (isRelevantMetadataKey(key) && type !== GGUF_VALUE_TYPE.ARRAY) {
        values.set(key, await readScalarValue(cursor, type));
      } else {
        await skipValue(cursor, type, state);
      }
      if (hasEnoughMetadata(values)) {
        entriesScanned += 1;
        break;
      }
    }

    return summarizeMetadata({
      filePath,
      version,
      tensorCount,
      metadataCount,
      values,
      entriesScanned
    });
  } catch (error) {
    if (error instanceof GgufMetadataError) throw error;
    throw metadataError(
      error && typeof error === 'object' && 'code' in error
        ? `file-${String(error.code).toLowerCase()}`
        : 'read-failed',
      `Cavalry could not inspect the GGUF metadata: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
      error
    );
  } finally {
    if (handle) await handle.close();
  }
}

function modelDisplayName(metadata, fallback) {
  return (metadata && (metadata.name || metadata.basename || metadata.baseModelName)) || fallback;
}

function normalizedIdentities(metadata) {
  return new Set(
    [metadata && metadata.name, metadata && metadata.basename, metadata && metadata.baseModelName]
      .map((value) =>
        String(value || '')
          .normalize('NFKD')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '')
      )
      .filter((value) => value.length >= 4 && value !== 'model' && value !== 'mmproj')
  );
}

function identitiesMatch(model, projector) {
  const modelIdentities = normalizedIdentities(model);
  const projectorIdentities = normalizedIdentities(projector);
  return [...modelIdentities].some((identity) => projectorIdentities.has(identity));
}

function result({ status, reason, message, model, projector, errors = [] }) {
  return Object.freeze({
    status,
    compatible: status === 'compatible' ? true : status === 'incompatible' ? false : null,
    reason,
    message,
    model: model || null,
    projector: projector || null,
    errors: Object.freeze(errors)
  });
}

function assessGgufCompatibility(model, projector) {
  if (!model) {
    return result({
      status: 'unknown',
      reason: 'model-metadata-unavailable',
      message:
        'The text model metadata was unavailable, so projector compatibility was not checked.',
      projector
    });
  }
  if (model.role === 'projector') {
    return result({
      status: 'incompatible',
      reason: 'text-model-role-mismatch',
      message:
        'The selected text-model file identifies itself as a vision projector. Choose a GGUF language model for the text-model field.',
      model,
      projector
    });
  }
  if (!projector) {
    return result({
      status: 'compatible',
      reason: 'text-only',
      message: 'No vision projector is selected, so projector compatibility is not required.',
      model
    });
  }
  if (projector.role === 'model') {
    return result({
      status: 'incompatible',
      reason: 'projector-role-mismatch',
      message:
        'The selected vision-projector file identifies itself as a text model. Choose the matching mmproj GGUF file or leave the projector empty.',
      model,
      projector
    });
  }

  const modelDimension = asDimension(model.embeddingDimension);
  const projectorDimension = asDimension(projector.projectionDimension);
  const modelName = modelDisplayName(model, 'the selected text model');
  const projectorName = modelDisplayName(projector, 'the selected vision projector');
  if (modelDimension && projectorDimension && modelDimension !== projectorDimension) {
    return result({
      status: 'incompatible',
      reason: 'dimension-mismatch',
      message: `${projectorName} expects a ${projectorDimension}-dimension text model, but ${modelName} uses ${modelDimension}. Choose a matching vision projector or leave the projector empty.`,
      model,
      projector
    });
  }

  if (modelDimension && projectorDimension && identitiesMatch(model, projector)) {
    return result({
      status: 'compatible',
      reason: 'metadata-match',
      message: `${projectorName} matches ${modelName} (${modelDimension} dimensions).`,
      model,
      projector
    });
  }

  if (modelDimension && projectorDimension) {
    return result({
      status: 'unknown',
      reason: 'identity-unverified',
      message: `The model and projector both use ${modelDimension} dimensions, but their model identities could not be verified as the same.`,
      model,
      projector
    });
  }

  if (identitiesMatch(model, projector)) {
    return result({
      status: 'compatible',
      reason: 'identity-match',
      message: `${projectorName} identifies the same base model as ${modelName}.`,
      model,
      projector
    });
  }

  return result({
    status: 'unknown',
    reason: 'insufficient-metadata',
    message:
      'The GGUF files do not expose enough metadata to verify projector compatibility. Cavalry will not reject them based on incomplete metadata.',
    model,
    projector
  });
}

function readFailure(error, filePath) {
  return Object.freeze({
    filePath,
    code:
      error && typeof error === 'object' && 'code' in error ? String(error.code) : 'read-failed',
    message: error instanceof Error ? error.message : String(error)
  });
}

async function inspectGgufCompatibility({ modelPath, mmprojPath } = {}) {
  const reads = [readGgufMetadata(modelPath)];
  if (mmprojPath) reads.push(readGgufMetadata(mmprojPath));
  const [modelRead, projectorRead] = await Promise.allSettled(reads);
  const errors = [];
  const model =
    modelRead.status === 'fulfilled'
      ? modelRead.value
      : (errors.push(readFailure(modelRead.reason, modelPath)), null);
  const projector = mmprojPath
    ? projectorRead.status === 'fulfilled'
      ? projectorRead.value
      : (errors.push(readFailure(projectorRead.reason, mmprojPath)), null)
    : null;

  if (errors.length) {
    return result({
      status: 'unknown',
      reason: 'metadata-unavailable',
      message:
        'Cavalry could not read enough GGUF metadata to validate the selected local-model files.',
      model,
      projector,
      errors
    });
  }
  return assessGgufCompatibility(model, projector);
}

function isBlockingMetadataFailure(failure) {
  const code = String((failure && failure.code) || '');
  return (
    code === 'invalid-path' ||
    code === 'not-file' ||
    code === 'invalid-magic' ||
    code === 'truncated' ||
    code === 'unsafe-length' ||
    code === 'unsupported-value-type' ||
    code === 'read-failed' ||
    code.startsWith('file-')
  );
}

async function assertGgufCompatibility(
  { modelPath, mmprojPath } = {},
  inspect = inspectGgufCompatibility
) {
  const compatibility = await inspect({ modelPath, mmprojPath });
  if (!compatibility) return compatibility;

  const blockingFailures = Array.isArray(compatibility.errors)
    ? compatibility.errors.filter(isBlockingMetadataFailure)
    : [];
  if (blockingFailures.length) {
    const failedModel = blockingFailures.some(
      (failure) => String(failure.filePath || '') === String(modelPath || '')
    );
    const failedProjector =
      Boolean(mmprojPath) &&
      blockingFailures.some(
        (failure) => String(failure.filePath || '') === String(mmprojPath || '')
      );
    const selection =
      failedModel && failedProjector
        ? 'local model and vision projector'
        : failedModel
          ? 'local model'
          : 'vision projector';
    const error = new Error(
      `Cavalry could not validate the selected ${selection}. Choose a readable GGUF file${
        failedProjector ? ' that matches the text model' : ''
      }.`
    );
    error.code = 'ADVISOR_GGUF_METADATA_UNAVAILABLE';
    error.userMessage = error.message;
    error.detail = blockingFailures
      .map((failure) => String(failure.message || failure.code || 'GGUF metadata read failed.'))
      .join(' ');
    throw error;
  }

  if (compatibility.status !== 'incompatible') return compatibility;

  const error = new Error(
    compatibility.message ||
      'The selected vision projector is incompatible with the local text model.'
  );
  error.code =
    compatibility.reason === 'text-model-role-mismatch'
      ? 'ADVISOR_MODEL_ROLE_MISMATCH'
      : 'ADVISOR_PROJECTOR_MISMATCH';
  error.userMessage = error.message;
  error.detail = [
    compatibility.reason ? `Reason: ${compatibility.reason}.` : '',
    compatibility.model && compatibility.model.embeddingDimension
      ? `Model dimension: ${compatibility.model.embeddingDimension}.`
      : '',
    compatibility.projector && compatibility.projector.projectionDimension
      ? `Projector dimension: ${compatibility.projector.projectionDimension}.`
      : ''
  ]
    .filter(Boolean)
    .join(' ');
  throw error;
}

module.exports = {
  GgufMetadataError,
  assessGgufCompatibility,
  assertGgufCompatibility,
  inspectGgufCompatibility,
  readGgufMetadata
};
