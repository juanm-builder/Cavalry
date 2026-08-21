import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createAdvisorMemoryStorage,
  parseAdvisorMemoryDocument,
  selectRelevantAdvisorMemoryBlocks,
  selectRelevantAdvisorMemoryItems,
  serializeAdvisorMemoryDocument,
  withAdvisorMemoryContext
} = require('../../src/host/advisor-memory-storage.cjs');

function createMemoryFs() {
  const files = new Map();
  return {
    files,
    async mkdir() {},
    async readFile(filePath) {
      if (!files.has(filePath)) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(filePath);
    },
    async writeFile(filePath, contents) {
      files.set(filePath, String(contents));
    },
    async chmod() {},
    async unlink(filePath) {
      files.delete(filePath);
    },
    async rename(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
    }
  };
}

describe('Companion local memory', () => {
  it('keeps preferences and user context in one human-readable Markdown document', () => {
    const document = serializeAdvisorMemoryDocument({
      memoryEnabled: true,
      allowAutomaticMemory: false,
      content: '# About me\n\nI prefer concise answers.'
    });

    expect(document).toContain('memoryEnabled: true');
    expect(document).toContain('allowAutomaticMemory: false');
    expect(document).toContain('# About me');
    expect(parseAdvisorMemoryDocument(document)).toEqual({
      memoryEnabled: true,
      allowAutomaticMemory: false,
      content: '# About me\n\nI prefer concise answers.'
    });
  });

  it('creates memory.md locally, preserves controls, and rereads external edits', async () => {
    const fs = createMemoryFs();
    const filePath = '/local/Cavalry/memory.md';
    const storage = createAdvisorMemoryStorage({
      fs,
      path,
      getMemoryPath: () => filePath
    });

    const initial = await storage.load();
    expect(initial).toMatchObject({
      path: filePath,
      fileName: 'memory.md',
      memoryEnabled: false,
      allowAutomaticMemory: false,
      empty: true
    });
    const saved = await storage.save({
      expectedRevision: initial.revision,
      memoryEnabled: true,
      allowAutomaticMemory: true,
      content: 'My emergency fund comes first.'
    });
    expect(fs.files.get(filePath)).toContain('My emergency fund comes first.');

    fs.files.set(filePath, 'I manually changed this outside Cavalry.');
    await expect(storage.load()).resolves.toMatchObject({
      content: 'I manually changed this outside Cavalry.',
      memoryEnabled: false,
      allowAutomaticMemory: false
    });

    const external = await storage.load();
    expect(
      withAdvisorMemoryContext(
        { messages: [{ role: 'user', content: 'Use my preferences.' }] },
        external,
        'chat_completions'
      )
    ).toEqual({ messages: [{ role: 'user', content: 'Use my preferences.' }] });
    await storage.clear({
      expectedRevision: external.revision,
      memoryEnabled: false,
      allowAutomaticMemory: false
    });
    await expect(storage.load()).resolves.toMatchObject({
      content: '',
      memoryEnabled: false,
      empty: true
    });
  });

  it('injects enabled memory as relevance-scoped context for both provider APIs', () => {
    const memory = {
      memoryEnabled: true,
      content: 'I prefer a six-month emergency fund.'
    };
    const chatPayload = withAdvisorMemoryContext(
      { messages: [{ role: 'user', content: 'How am I doing?' }] },
      memory,
      'chat_completions'
    );
    expect(chatPayload.messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('I prefer a six-month emergency fund.')
    });
    expect(chatPayload.messages[0].content).toContain(
      'Use this background only when it is relevant'
    );
    expect(
      chatPayload.messages.filter((message) =>
        String(message.content || '').includes('I prefer a six-month emergency fund.')
      )
    ).toHaveLength(1);

    const responsePayload = withAdvisorMemoryContext(
      { instructions: 'Stay grounded.', input: 'Review my plan.' },
      memory,
      'responses'
    );
    expect(responsePayload.instructions).toContain('Stay grounded.');
    expect(responsePayload.instructions).toContain('I prefer a six-month emergency fund.');
    expect(
      responsePayload.instructions.match(/I prefer a six-month emergency fund\./g)
    ).toHaveLength(1);

    expect(
      withAdvisorMemoryContext(
        { instructions: 'Original' },
        { memoryEnabled: false, content: 'Do not include me.' },
        'responses'
      )
    ).toEqual({ instructions: 'Original' });
  });

  it('provides stable item CRUD, atomic revisions, and stale-write conflicts', async () => {
    const fs = createMemoryFs();
    const filePath = '/local/Cavalry/memory.md';
    let sequence = 0;
    const storage = createAdvisorMemoryStorage({
      fs,
      path,
      getMemoryPath: () => filePath,
      createId: () => `memory-${++sequence}`,
      now: () => `2026-08-21T00:00:0${sequence}.000Z`
    });

    const initial = await storage.load();
    const created = await storage.createItem({
      expectedRevision: initial.revision,
      item: { text: 'My emergency fund comes first.', tags: ['savings'] }
    });
    expect(created.items).toEqual([
      expect.objectContaining({ id: 'memory-1', text: 'My emergency fund comes first.' })
    ]);
    expect(created.revision).not.toBe(initial.revision);
    expect([...fs.files.keys()].filter((key) => key.endsWith('.tmp'))).toEqual([]);

    const updated = await storage.updateItem({
      expectedRevision: created.revision,
      itemId: 'memory-1',
      item: { text: 'Keep a six-month emergency fund.', tags: ['savings', 'goal'] }
    });
    expect(updated.items[0]).toMatchObject({
      id: 'memory-1',
      text: 'Keep a six-month emergency fund.',
      tags: ['savings', 'goal']
    });

    fs.files.set(filePath, fs.files.get(filePath).replace('six-month', 'nine-month'));
    const external = await storage.refresh();
    expect(external.revision).not.toBe(updated.revision);
    await expect(
      storage.deleteItem({ expectedRevision: updated.revision, itemId: 'memory-1' })
    ).rejects.toMatchObject({
      code: 'ADVISOR_MEMORY_REVISION_CONFLICT',
      conflict: true,
      memory: { revision: external.revision }
    });
    const removed = await storage.deleteItem({
      expectedRevision: external.revision,
      itemId: 'memory-1'
    });
    expect(removed.items).toEqual([]);
  });

  it('quarantines malformed front matter and refuses to overwrite it implicitly', async () => {
    const malformed = '---\nmemoryEnabled: true\nallowAutomaticMemory: false\nSecret note';
    expect(parseAdvisorMemoryDocument(malformed)).toMatchObject({
      memoryEnabled: false,
      malformed: true,
      diagnostics: [{ code: 'memory_front_matter_unclosed' }]
    });
    expect(
      withAdvisorMemoryContext(
        { messages: [{ role: 'user', content: 'Tell me the note.' }] },
        parseAdvisorMemoryDocument(malformed),
        'chat_completions'
      )
    ).toEqual({ messages: [{ role: 'user', content: 'Tell me the note.' }] });

    const fs = createMemoryFs();
    const filePath = '/local/Cavalry/memory.md';
    fs.files.set(filePath, malformed);
    const storage = createAdvisorMemoryStorage({ fs, path, getMemoryPath: () => filePath });
    const loaded = await storage.load();
    await expect(
      storage.save({ expectedRevision: loaded.revision, content: 'Replacement' })
    ).rejects.toMatchObject({ code: 'ADVISOR_MEMORY_DOCUMENT_INVALID' });
    expect(fs.files.get(filePath)).toBe(malformed);
  });

  it('quarantines malformed and duplicate managed item blocks', () => {
    const valid = serializeAdvisorMemoryDocument({
      memoryEnabled: true,
      content: 'Visible legacy preference.',
      items: [
        {
          id: 'stable-item',
          text: 'Keep answers concise.',
          createdAt: '2026-08-21T00:00:00.000Z',
          updatedAt: '2026-08-21T00:00:00.000Z'
        }
      ]
    });
    const itemBlock = valid.match(
      /<!-- cavalry-memory-item \{[^\n]+\} -->\n[\s\S]*?\n<!-- \/cavalry-memory-item -->/
    )[0];
    const cases = [
      {
        document: valid.replace(
          '<!-- cavalry-memory-items:end -->',
          `${itemBlock}\n\n<!-- cavalry-memory-items:end -->`
        ),
        code: 'memory_item_duplicate_id'
      },
      {
        document: valid.replace(
          /<!-- cavalry-memory-item \{[^\n]+\} -->/,
          '<!-- cavalry-memory-item {bad json} -->'
        ),
        code: 'memory_item_metadata_invalid'
      },
      {
        document: valid.replace(
          /<!-- cavalry-memory-item \{"id":"stable-item"/,
          '<!-- cavalry-memory-item {"id":"other-item","id":"stable-item"'
        ),
        code: 'memory_item_metadata_duplicate'
      },
      {
        document: valid.replace('<!-- cavalry-memory-items:end -->', ''),
        code: 'memory_items_region_malformed'
      },
      {
        document: valid.replace('<!-- /cavalry-memory-item -->', ''),
        code: 'memory_item_block_malformed'
      }
    ];

    cases.forEach(({ document, code }) => {
      const parsed = parseAdvisorMemoryDocument(document);
      expect(parsed).toMatchObject({ memoryEnabled: false, malformed: true });
      expect(parsed.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code })])
      );
      expect(
        withAdvisorMemoryContext(
          { messages: [{ role: 'user', content: 'How should you answer?' }] },
          parsed,
          'chat_completions'
        )
      ).toEqual({ messages: [{ role: 'user', content: 'How should you answer?' }] });
    });
  });

  it('quarantines duplicate aliases for the same front-matter preference', () => {
    const parsed = parseAdvisorMemoryDocument(
      '---\nenabled: true\nmemoryEnabled: false\nallowAutomaticMemory: false\n---\n\nDo not inject.'
    );
    expect(parsed).toMatchObject({
      memoryEnabled: false,
      malformed: true,
      diagnostics: [expect.objectContaining({ code: 'memory_front_matter_duplicate_key' })]
    });
  });

  it('requires a current revision before mutating an existing memory file', async () => {
    const fs = createMemoryFs();
    const filePath = '/local/Cavalry/memory.md';
    const storage = createAdvisorMemoryStorage({ fs, path, getMemoryPath: () => filePath });
    const initial = await storage.load();

    await expect(storage.save({ content: 'An unbound overwrite.' })).rejects.toMatchObject({
      code: 'ADVISOR_MEMORY_REVISION_REQUIRED',
      conflict: true,
      memory: { revision: initial.revision }
    });
    expect(fs.files.get(filePath)).not.toContain('An unbound overwrite.');
  });

  it('rechecks the destination revision before rename and preserves a racing external edit', async () => {
    const fs = createMemoryFs();
    const filePath = '/local/Cavalry/memory.md';
    const storage = createAdvisorMemoryStorage({ fs, path, getMemoryPath: () => filePath });
    const initial = await storage.load();
    const externalDocument = serializeAdvisorMemoryDocument({
      memoryEnabled: true,
      content: 'An external editor saved this during Cavalry’s write.'
    });
    const writeFile = fs.writeFile.bind(fs);
    let injectExternalWrite = true;
    fs.writeFile = async (target, contents, options) => {
      await writeFile(target, contents, options);
      if (injectExternalWrite && target.endsWith('.tmp')) {
        injectExternalWrite = false;
        fs.files.set(filePath, externalDocument);
      }
    };

    await expect(
      storage.save({
        expectedRevision: initial.revision,
        memoryEnabled: true,
        content: 'Cavalry’s now-stale draft.'
      })
    ).rejects.toMatchObject({
      code: 'ADVISOR_MEMORY_REVISION_CONFLICT',
      conflict: true,
      memory: {
        content: 'An external editor saved this during Cavalry’s write.',
        memoryEnabled: true
      }
    });
    expect(fs.files.get(filePath)).toBe(externalDocument);
    expect([...fs.files.keys()].filter((key) => key.endsWith('.tmp'))).toEqual([]);
  });

  it('selects relevant structured items and legacy blocks without sending unrelated memory', () => {
    const memory = {
      memoryEnabled: true,
      items: [
        { id: 'fund', text: 'My emergency fund target is six months.', tags: ['savings'] },
        { id: 'travel', text: 'I want to visit Kyoto next spring.', tags: ['travel'] },
        { id: 'style', text: 'Keep answers concise.', scope: 'always' }
      ]
    };
    expect(
      selectRelevantAdvisorMemoryItems(memory, 'How is my savings fund looking?').map(
        (item) => item.id
      )
    ).toEqual(['style', 'fund']);
    expect(selectRelevantAdvisorMemoryItems(memory, '').map((item) => item.id)).toEqual(['style']);
    expect(
      selectRelevantAdvisorMemoryBlocks(
        'I prefer concise explanations.\n\nMy emergency fund target is six months.\n\nI like science fiction.',
        'Review my emergency fund.'
      )
    ).toEqual(['My emergency fund target is six months.', 'I prefer concise explanations.']);

    const contextual = withAdvisorMemoryContext(
      { messages: [{ role: 'user', content: 'Review my emergency fund.' }] },
      {
        ...memory,
        content:
          'I prefer concise explanations.\n\nMy emergency fund target is six months.\n\nI like science fiction.'
      },
      'chat_completions'
    );
    const injected = contextual.messages[0].content;
    expect(injected).toContain('emergency fund target');
    expect(injected).toContain('Keep answers concise.');
    expect(injected).not.toContain('Kyoto');
    expect(injected).not.toContain('science fiction');
  });

  it('reuses the original Responses query for tool continuations and never broadens an empty query', () => {
    const memory = {
      memoryEnabled: true,
      content: 'My emergency fund target is six months.\n\nI want to visit Kyoto next spring.'
    };
    const first = withAdvisorMemoryContext(
      {
        _cavalryMemoryQuery: 'Review my emergency fund.',
        instructions: 'Stay grounded.',
        input: [{ role: 'user', content: 'Review my emergency fund.' }]
      },
      memory,
      'responses'
    );
    const continuation = withAdvisorMemoryContext(
      {
        _cavalryMemoryQuery: 'Review my emergency fund.',
        instructions: 'Stay grounded.',
        input: [
          {
            type: 'function_call_output',
            call_id: 'call-1',
            output: '{"note":"Kyoto travel plans"}'
          }
        ]
      },
      memory,
      'responses'
    );

    expect(first.instructions).toContain('emergency fund target');
    expect(continuation.instructions).toContain('emergency fund target');
    expect(first.instructions).not.toContain('Kyoto');
    expect(continuation.instructions).not.toContain('Kyoto');
    expect(first).not.toHaveProperty('_cavalryMemoryQuery');
    expect(continuation).not.toHaveProperty('_cavalryMemoryQuery');
    expect(
      withAdvisorMemoryContext(
        {
          instructions: 'Stay grounded.',
          input: [
            {
              type: 'function_call_output',
              call_id: 'call-1',
              content: 'Kyoto travel plans'
            }
          ]
        },
        memory,
        'responses'
      )
    ).toEqual({
      instructions: 'Stay grounded.',
      input: [
        {
          type: 'function_call_output',
          call_id: 'call-1',
          content: 'Kyoto travel plans'
        }
      ]
    });
  });

  it('escapes every reserved managed marker in free-form and item text before round trip', () => {
    const reservedMarkers = [
      '<!-- cavalry-memory-items:start -->',
      '<!-- cavalry-memory-items:end -->',
      '<!-- cavalry-memory-item {"id":"not-a-real-item"} -->',
      '<!-- /cavalry-memory-item -->'
    ];
    const document = serializeAdvisorMemoryDocument({
      memoryEnabled: true,
      content: `Literal examples:\n${reservedMarkers.join('\n')}`,
      items: [
        {
          id: 'safe-item',
          text: `Keep these literal examples:\n${reservedMarkers.join('\n')}`,
          createdAt: '2026-08-21T00:00:00.000Z',
          updatedAt: '2026-08-21T00:00:00.000Z'
        }
      ]
    });
    const parsed = parseAdvisorMemoryDocument(document);

    expect(document.match(/<!-- cavalry-memory-items:start -->/g)).toHaveLength(1);
    expect(document.match(/<!-- cavalry-memory-items:end -->/g)).toHaveLength(1);
    expect(document).toContain('&lt;!-- cavalry-memory-items:start --&gt;');
    expect(document).toContain('&lt;!-- cavalry-memory-item {"id":"not-a-real-item"} --&gt;');
    expect(parsed).not.toHaveProperty('malformed');
    expect(parsed.content).toContain('&lt;!-- cavalry-memory-items:start --&gt;');
    expect(parsed.items).toEqual([
      expect.objectContaining({
        id: 'safe-item',
        text: expect.stringContaining('&lt;!-- /cavalry-memory-item --&gt;')
      })
    ]);
    expect(parseAdvisorMemoryDocument(serializeAdvisorMemoryDocument(parsed))).toEqual(parsed);
  });

  it('preserves unknown valid front-matter fields across an ordinary save', async () => {
    const fs = createMemoryFs();
    const filePath = '/local/Cavalry/memory.md';
    fs.files.set(
      filePath,
      '---\nmemoryEnabled: true\nallowAutomaticMemory: false\neditor: external\n---\n\nA note.'
    );
    const storage = createAdvisorMemoryStorage({ fs, path, getMemoryPath: () => filePath });
    const loaded = await storage.load();
    await storage.save({ expectedRevision: loaded.revision, content: 'Updated note.' });
    expect(fs.files.get(filePath)).toContain('editor: external');
    expect(fs.files.get(filePath)).toContain('Updated note.');
  });
});
