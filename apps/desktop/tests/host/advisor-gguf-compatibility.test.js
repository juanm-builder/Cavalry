import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  GgufMetadataError,
  assertGgufCompatibility,
  inspectGgufCompatibility,
  readGgufMetadata
} = require('../../src/host/advisor-gguf-compatibility.cjs');

const GGUF_TYPE = Object.freeze({
  uint32: 4,
  string: 8,
  array: 9
});

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function uint64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function ggufString(value) {
  const contents = Buffer.from(value, 'utf8');
  return Buffer.concat([uint64(contents.length), contents]);
}

function encodeValue(type, value) {
  if (type === GGUF_TYPE.uint32) return uint32(value);
  if (type === GGUF_TYPE.string) return ggufString(value);
  if (type === GGUF_TYPE.array) {
    const contents = value.values.map((item) => encodeValue(value.elementType, item));
    return Buffer.concat([uint32(value.elementType), uint64(value.values.length), ...contents]);
  }
  throw new Error(`Unsupported fixture type ${type}.`);
}

function gguf(entries, { version = 3, metadataCount = entries.length } = {}) {
  const header = Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    uint32(version),
    uint64(0),
    uint64(metadataCount)
  ]);
  const metadata = entries.flatMap(({ key, type, value }) => [
    ggufString(key),
    uint32(type),
    encodeValue(type, value)
  ]);
  return Buffer.concat([header, ...metadata]);
}

async function createFixtureFiles() {
  const directory = await mkdtemp(path.join(tmpdir(), 'cavalry-gguf-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    modelPath: path.join(directory, 'model.gguf'),
    mmprojPath: path.join(directory, 'mmproj.gguf')
  };
}

function qwenModelEntries({ name = 'Qwen3.5-4B', dimension = 2560, dimensionFirst = false } = {}) {
  const identity = [
    { key: 'general.architecture', type: GGUF_TYPE.string, value: 'qwen35' },
    { key: 'general.type', type: GGUF_TYPE.string, value: 'model' },
    { key: 'general.name', type: GGUF_TYPE.string, value: name }
  ];
  const embedding = {
    key: 'qwen35.embedding_length',
    type: GGUF_TYPE.uint32,
    value: dimension
  };
  return dimensionFirst ? [embedding, ...identity] : [...identity, embedding];
}

function qwenProjectorEntries({ name = 'Qwen3.5-4B', dimension = 2560 } = {}) {
  return [
    { key: 'general.architecture', type: GGUF_TYPE.string, value: 'clip' },
    { key: 'general.type', type: GGUF_TYPE.string, value: 'mmproj' },
    { key: 'general.name', type: GGUF_TYPE.string, value: name },
    {
      key: 'clip.vision.projection_dim',
      type: GGUF_TYPE.uint32,
      value: dimension
    }
  ];
}

describe('Advisor GGUF compatibility inspection', () => {
  it('rejects the reported Qwen3.5 4B model and 9B projector dimension mismatch', async () => {
    const { modelPath, mmprojPath } = await createFixtureFiles();
    await Promise.all([
      writeFile(modelPath, gguf(qwenModelEntries())),
      writeFile(mmprojPath, gguf(qwenProjectorEntries({ name: 'Qwen3.5-9B', dimension: 4096 })))
    ]);

    const outcome = await inspectGgufCompatibility({ modelPath, mmprojPath });

    expect(outcome).toMatchObject({
      status: 'incompatible',
      compatible: false,
      reason: 'dimension-mismatch',
      model: {
        role: 'model',
        name: 'Qwen3.5-4B',
        embeddingDimension: 2560,
        embeddingDimensionKey: 'qwen35.embedding_length'
      },
      projector: {
        role: 'projector',
        name: 'Qwen3.5-9B',
        projectionDimension: 4096,
        projectionDimensionKey: 'clip.vision.projection_dim'
      },
      errors: []
    });
    expect(outcome.message).toMatch(/4096-dimension text model/i);
    expect(outcome.message).toMatch(/Qwen3\.5-4B uses 2560/i);
    await expect(assertGgufCompatibility({ modelPath, mmprojPath })).rejects.toMatchObject({
      code: 'ADVISOR_PROJECTOR_MISMATCH',
      message: expect.stringMatching(/4096-dimension text model/i),
      detail: expect.stringContaining('Model dimension: 2560')
    });
  });

  it('accepts matching dimensions and normalized base-model identities', async () => {
    const { modelPath, mmprojPath } = await createFixtureFiles();
    await Promise.all([
      writeFile(modelPath, gguf(qwenModelEntries())),
      writeFile(mmprojPath, gguf(qwenProjectorEntries({ name: 'Qwen3.5 4B', dimension: 2560 })))
    ]);

    await expect(inspectGgufCompatibility({ modelPath, mmprojPath })).resolves.toMatchObject({
      status: 'compatible',
      compatible: true,
      reason: 'metadata-match'
    });
  });

  it('rejects a text-model GGUF selected as the vision projector', async () => {
    const { modelPath, mmprojPath } = await createFixtureFiles();
    await Promise.all([
      writeFile(modelPath, gguf(qwenModelEntries())),
      writeFile(mmprojPath, gguf(qwenModelEntries({ name: 'Qwen3.5-9B', dimension: 4096 })))
    ]);

    await expect(inspectGgufCompatibility({ modelPath, mmprojPath })).resolves.toMatchObject({
      status: 'incompatible',
      compatible: false,
      reason: 'projector-role-mismatch',
      message: expect.stringMatching(/identifies itself as a text model/i)
    });
  });

  it('validates the text model even when no vision projector is selected', async () => {
    const { modelPath } = await createFixtureFiles();
    await writeFile(modelPath, gguf(qwenModelEntries()));

    await expect(inspectGgufCompatibility({ modelPath, mmprojPath: '' })).resolves.toMatchObject({
      status: 'compatible',
      compatible: true,
      reason: 'text-only',
      message: 'No vision projector is selected, so projector compatibility is not required.',
      model: {
        role: 'model',
        name: 'Qwen3.5-4B',
        embeddingDimension: 2560
      },
      projector: null,
      errors: []
    });
  });

  it('rejects a vision projector selected as the text model in text-only mode', async () => {
    const { modelPath } = await createFixtureFiles();
    await writeFile(modelPath, gguf(qwenProjectorEntries()));

    await expect(assertGgufCompatibility({ modelPath, mmprojPath: '' })).rejects.toMatchObject({
      code: 'ADVISOR_MODEL_ROLE_MISMATCH',
      message: expect.stringMatching(/identifies itself as a vision projector/i)
    });
  });

  it('rejects unreadable or malformed selected GGUF files before launch', async () => {
    const { modelPath } = await createFixtureFiles();
    await writeFile(modelPath, Buffer.from('not a GGUF file', 'utf8'));

    await expect(assertGgufCompatibility({ modelPath, mmprojPath: '' })).rejects.toMatchObject({
      code: 'ADVISOR_GGUF_METADATA_UNAVAILABLE',
      message: expect.stringMatching(/could not validate the selected local model/i),
      detail: expect.stringMatching(/not a GGUF file/i)
    });
    await expect(
      assertGgufCompatibility({ modelPath: `${modelPath}.missing`, mmprojPath: '' })
    ).rejects.toMatchObject({
      code: 'ADVISOR_GGUF_METADATA_UNAVAILABLE',
      detail: expect.stringMatching(/could not inspect/i)
    });
  });

  it('returns unknown instead of rejecting valid GGUF files with incomplete metadata', async () => {
    const { modelPath, mmprojPath } = await createFixtureFiles();
    await Promise.all([
      writeFile(
        modelPath,
        gguf([
          { key: 'general.architecture', type: GGUF_TYPE.string, value: 'future-model' },
          { key: 'general.name', type: GGUF_TYPE.string, value: 'Future Model' }
        ])
      ),
      writeFile(
        mmprojPath,
        gguf([
          { key: 'general.architecture', type: GGUF_TYPE.string, value: 'future-vision' },
          { key: 'general.name', type: GGUF_TYPE.string, value: 'Future Projector' }
        ])
      )
    ]);

    await expect(inspectGgufCompatibility({ modelPath, mmprojPath })).resolves.toMatchObject({
      status: 'unknown',
      compatible: null,
      reason: 'insufficient-metadata',
      errors: []
    });
  });

  it('returns a structured unknown result when either file is malformed', async () => {
    const { modelPath, mmprojPath } = await createFixtureFiles();
    const truncatedModel = Buffer.concat([
      Buffer.from('GGUF', 'ascii'),
      uint32(3),
      uint64(0),
      uint64(1),
      uint64(20),
      Buffer.from('short', 'ascii')
    ]);
    await Promise.all([
      writeFile(modelPath, truncatedModel),
      writeFile(mmprojPath, gguf(qwenProjectorEntries()))
    ]);

    const outcome = await inspectGgufCompatibility({ modelPath, mmprojPath });

    expect(outcome).toMatchObject({
      status: 'unknown',
      compatible: null,
      reason: 'metadata-unavailable',
      errors: [{ filePath: modelPath, code: 'truncated' }]
    });
    await expect(assertGgufCompatibility({ modelPath, mmprojPath })).rejects.toMatchObject({
      code: 'ADVISOR_GGUF_METADATA_UNAVAILABLE',
      detail: expect.stringMatching(/ends before its declared values/i)
    });
  });

  it('skips unrelated arrays and finds dimensions regardless of metadata ordering', async () => {
    const { modelPath } = await createFixtureFiles();
    const entries = [
      {
        key: 'general.tags',
        type: GGUF_TYPE.array,
        value: { elementType: GGUF_TYPE.string, values: ['vision', 'chat'] }
      },
      ...qwenModelEntries({ dimensionFirst: true })
    ];
    await writeFile(modelPath, gguf(entries));

    await expect(readGgufMetadata(modelPath)).resolves.toMatchObject({
      format: 'GGUF',
      version: 3,
      role: 'model',
      name: 'Qwen3.5-4B',
      architecture: 'qwen35',
      embeddingDimension: 2560,
      entriesScanned: entries.length,
      metadataComplete: true
    });
  });

  it('fails safely on excessive metadata counts and unsupported versions', async () => {
    const { modelPath, mmprojPath } = await createFixtureFiles();
    await Promise.all([
      writeFile(modelPath, gguf([], { metadataCount: 16_385 })),
      writeFile(mmprojPath, gguf([], { version: 99 }))
    ]);

    await expect(readGgufMetadata(modelPath)).rejects.toMatchObject({
      name: 'GgufMetadataError',
      code: 'metadata-count-limit'
    });
    await expect(readGgufMetadata(mmprojPath)).rejects.toMatchObject({
      name: 'GgufMetadataError',
      code: 'unsupported-version'
    });
    await expect(
      assertGgufCompatibility({ modelPath: mmprojPath, mmprojPath: '' })
    ).resolves.toMatchObject({
      status: 'unknown',
      reason: 'metadata-unavailable',
      errors: [{ code: 'unsupported-version' }]
    });
  });

  it('does not allocate buffers for unsafe declared string lengths', async () => {
    const { modelPath } = await createFixtureFiles();
    const unsafeKey = Buffer.concat([
      Buffer.from('GGUF', 'ascii'),
      uint32(3),
      uint64(0),
      uint64(1),
      uint64(BigInt(Number.MAX_SAFE_INTEGER) + 1n)
    ]);
    await writeFile(modelPath, unsafeKey);

    const error = await readGgufMetadata(modelPath).catch((caught) => caught);

    expect(error).toBeInstanceOf(GgufMetadataError);
    expect(error).toMatchObject({ code: 'unsafe-length' });
  });
});
