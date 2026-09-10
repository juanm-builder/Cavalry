import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssistantSettings } from '../../src/renderer/features/assistant/CavalryAssistantSettings.jsx';
import { CavalryAssistant } from '../../src/renderer/features/assistant/CavalryAssistant.jsx';

function SettingsHarness({ advisor, initialStyle = 'brief' }) {
  const [replyStyle, setReplyStyle] = useState(initialStyle);
  return (
    <AssistantSettings
      advisor={advisor}
      replyStyle={replyStyle}
      onReplyStyleChange={setReplyStyle}
    />
  );
}

function memoryResult() {
  return {
    ok: true,
    memory: {
      content: 'My emergency fund comes first.',
      items: [],
      revision: 'fixture-1',
      memoryEnabled: true,
      allowAutomaticMemory: true,
      path: '/fixtures/memory.md'
    }
  };
}

describe('assistant reply style settings', () => {
  it.each(['chat', 'responses'])(
    'uses newly saved presets on the next %s message without restarting',
    async (mode) => {
      const user = userEvent.setup();
      const advisor = {
        subscribe: () => () => {},
        invoke: vi.fn(async (command, payload) => {
          if (command === 'saveSettings')
            return { ok: true, settings: { replyStyle: payload.replyStyle } };
          if (command === 'chat')
            return { ok: true, message: { role: 'assistant', content: 'Ready to help.' } };
          if (command === 'runAgentTurn')
            return { ok: true, response: { id: 'style-response', output_text: 'Ready to help.' } };
          return memoryResult();
        })
      };
      render(
        <CavalryAssistant
          advisor={advisor}
          isOpen={true}
          settings={{
            provider: mode === 'responses' ? 'openai' : 'custom',
            apiMode: mode,
            hasApiKey: true,
            replyStyle: 'brief'
          }}
          workbook={{ id: 'style-fixture', name: 'Test plan' }}
          conversationStorage={{ getItem: () => null, setItem: () => {} }}
          today={() => '2026-09-10'}
        />
      );
      const modelCommand = mode === 'responses' ? 'runAgentTurn' : 'chat';
      for (const [index, style] of ['Detailed', 'Brief'].entries()) {
        await user.click(screen.getByRole('button', { name: 'More options' }));
        await user.click(screen.getByRole('menuitem', { name: 'Assistant settings' }));
        await user.click(screen.getByRole('radio', { name: style }));
        await waitFor(() => expect(screen.getByRole('radio', { name: style }).checked).toBe(true));
        await user.click(screen.getByRole('button', { name: 'Back to chat' }));
        await user.type(
          screen.getByRole('textbox', { name: 'Message Cavalry' }),
          index === 0
            ? 'What should I focus on financially?'
            : 'PHP 10,000 feels too high. What should I do first?'
        );
        await user.click(screen.getByRole('button', { name: 'Send message' }));
        await waitFor(() => expect(screen.getAllByText('Ready to help.')).toHaveLength(index + 1));
        const [, payload] = advisor.invoke.mock.calls.filter(
          ([command]) => command === modelCommand
        )[index];
        const instructions =
          mode === 'responses' ? payload.instructions : payload.messages[0].content;
        expect(instructions).toContain(`Reply style — ${style}:`);
        expect(instructions).not.toContain(
          `Reply style — ${style === 'Brief' ? 'Detailed' : 'Brief'}:`
        );
      }
    }
  );

  it('shows three simple presets and saves only the chosen style', async () => {
    const user = userEvent.setup();
    const advisor = {
      invoke: vi.fn(async (command, payload) =>
        command === 'saveSettings'
          ? { ok: true, settings: { replyStyle: payload.replyStyle } }
          : memoryResult()
      )
    };
    render(<SettingsHarness advisor={advisor} />);

    expect(screen.getByRole('radio', { name: 'Brief' }).checked).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(await screen.findByRole('switch', { name: 'Use memory' })).not.toBeNull();
    expect(screen.getByText('Memory details').closest('details').open).toBe(false);
    await user.click(screen.getByRole('radio', { name: 'Detailed' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Detailed' }).checked).toBe(true));
    expect(advisor.invoke).toHaveBeenCalledWith('saveSettings', { replyStyle: 'detailed' });
    expect(screen.getByRole('switch', { name: 'Use memory' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(
      screen.getByRole('switch', { name: 'Remember from chats' }).getAttribute('aria-checked')
    ).toBe('true');
    await user.click(screen.getByText('Memory details'));
    expect(screen.getByRole('textbox', { name: 'What should Cavalry know about you?' }).value).toBe(
      'My emergency fund comes first.'
    );
  });

  it('keeps the saved selection when persistence fails', async () => {
    const user = userEvent.setup();
    const advisor = {
      invoke: vi.fn(async (command) =>
        command === 'saveSettings' ? { ok: false, error: 'fixture failure' } : memoryResult()
      )
    };
    render(<SettingsHarness advisor={advisor} initialStyle="balanced" />);
    await user.click(screen.getByRole('radio', { name: 'Detailed' }));
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'Balanced' }).checked).toBe(true);
    expect(screen.getByRole('radio', { name: 'Detailed' }).checked).toBe(false);
  });
});
