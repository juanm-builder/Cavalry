import { describe, expect, it } from 'vitest';
import {
  boundedToolOutput,
  fitChatHistoryToContext,
  truncateOlderToolOutputs
} from '../../src/renderer/features/assistant/cavalry-assistant-model-io.js';

describe('assistant local context budgeting', () => {
  const connection = { provider: 'custom', contextWindowTokens: 2048 };

  it('accounts for tool schemas and removes complete old exchanges', () => {
    const messages = [
      { role: 'system', content: 'Use the available evidence.' },
      { role: 'user', content: 'Old question. '.repeat(60) },
      { role: 'assistant', content: 'Old answer. '.repeat(80) },
      { role: 'user', content: 'Company Cash belongs to my business.' },
      { role: 'assistant', content: 'I will keep that separate from personal money.' },
      { role: 'user', content: 'What can I spend personally?' }
    ];
    const tools = [{ name: 'read_accounts', description: 'Tool documentation. '.repeat(60) }];
    const fitted = fitChatHistoryToContext(messages, 4, connection, tools);

    expect(fitted.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(fitted[1].content).toBe('Company Cash belongs to my business.');
    expect(fitted.at(-1).content).toBe('What can I spend personally?');
    expect(fitted[0].content).toContain('Some earlier conversation messages were omitted');
    expect(fitted[0].content).toContain('do not assume missing details were never shared');
  });

  it('preserves the current request and system contract even when the fixed context is large', () => {
    const messages = [
      { role: 'system', content: 'System instruction. '.repeat(500) },
      { role: 'user', content: 'Old request.' },
      { role: 'assistant', content: 'Old answer.' },
      { role: 'user', content: 'Use the current request.' }
    ];
    const fitted = fitChatHistoryToContext(messages, 2, connection);

    expect(fitted).toHaveLength(2);
    expect(fitted[0].content).toContain('System instruction.');
    expect(fitted[1].content).toBe('Use the current request.');
  });

  it('bounds large local tool responses and compacts only older outputs during continuation', () => {
    const output = JSON.stringify({ transactions: ['transaction evidence '.repeat(1000)] });
    const bounded = boundedToolOutput(output, connection);
    expect(bounded.length).toBeLessThan(output.length);
    expect(bounded).toContain('Narrow the query or paginate');

    const messages = [
      { role: 'system', content: 'System instruction.' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'old' }] },
      { role: 'tool', tool_call_id: 'old', content: output },
      { role: 'assistant', content: null, tool_calls: [{ id: 'latest' }] },
      { role: 'tool', tool_call_id: 'latest', content: 'The latest verified evidence.' }
    ];
    truncateOlderToolOutputs(messages, connection);

    expect(messages[2].content).toContain('Call the tool again if you need the full data');
    expect(messages.at(-1).content).toBe('The latest verified evidence.');
    expect(messages[2].tool_call_id).toBe('old');
    expect(messages).toHaveLength(5);
  });

  it('leaves history intact when no context limit is configured', () => {
    const messages = [
      { role: 'system', content: 'System instruction.' },
      { role: 'user', content: 'My target is PHP 200,000.' },
      { role: 'assistant', content: 'Understood.' },
      { role: 'user', content: 'What is my target?' }
    ];
    expect(fitChatHistoryToContext(structuredClone(messages), 2, { provider: 'custom' })).toEqual(
      messages
    );
  });
});
