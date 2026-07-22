import React, { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chooseCompanionVoiceMimeType,
  COMPANION_VOICE_MAX_AUDIO_BYTES,
  COMPANION_VOICE_TRANSCRIPTION_PROMPT,
  normalizeCompanionMicrophonePermission,
  useCompanionVoice
} from '../../src/renderer/features/assistant/useCompanionVoice.js';

class FakeMediaRecorder {
  static instances = [];

  static isTypeSupported(mimeType) {
    return mimeType === 'audio/webm';
  }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || 'audio/webm';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onerror = null;
    this.onstop = null;
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob(['recorded voice'], { type: this.mimeType })
    });
    this.onstop?.();
  }
}

function VoiceHarness({
  advisor,
  environment,
  initialComposer = 'Existing note',
  onSubmit = vi.fn(),
  onTranscript = vi.fn(),
  settings = { provider: 'custom', hasApiKey: true }
}) {
  const [composer, setComposer] = useState(initialComposer);
  const voice = useCompanionVoice({
    advisor,
    createId: () => 'companion_voice_test',
    environment,
    onTranscript,
    setComposer,
    settings
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea aria-label="Composer" onChange={() => {}} value={composer} />
      <span data-testid="voice-status">{voice.status}</span>
      <span data-testid="voice-error">{voice.error}</span>
      <button disabled={voice.button.disabled} onClick={() => void voice.toggle()} type="button">
        {voice.button.ariaLabel}
      </button>
      <button onClick={() => void voice.cancel()} type="button">
        Cancel voice
      </button>
      {voice.canOpenMicrophoneSettings ? (
        <button onClick={() => void voice.openMicrophoneSettings()} type="button">
          Open Microphone Settings
        </button>
      ) : null}
      <button type="submit">Submit</button>
    </form>
  );
}

function makeEnvironment(overrides = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  return {
    track,
    stream,
    getUserMedia,
    environment: {
      Blob,
      FileReader,
      MediaRecorder: FakeMediaRecorder,
      navigator: { mediaDevices: { getUserMedia } },
      ...overrides
    }
  };
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
});

describe('Companion voice input', () => {
  it('records with MIME fallback, transcribes, and appends without submitting', async () => {
    const user = userEvent.setup();
    const { environment, getUserMedia, track } = makeEnvironment();
    const onSubmit = vi.fn();
    const onTranscript = vi.fn();
    const advisor = {
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getMicrophoneStatus') {
          return {
            ok: true,
            status: 'not-determined',
            granted: false,
            requestable: true
          };
        }
        if (command === 'requestMicrophoneAccess') {
          return { ok: true, status: 'granted', granted: true };
        }
        if (command === 'transcribeAudio') {
          return { ok: true, text: 'Add lunch for 325 pesos.', requestId: payload.requestId };
        }
        return { ok: true };
      })
    };

    render(
      <VoiceHarness
        advisor={advisor}
        environment={environment}
        onSubmit={onSubmit}
        onTranscript={onTranscript}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Start voice input' }));
    expect(await screen.findByText('recording')).not.toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(advisor.invoke.mock.calls.slice(0, 2).map(([command]) => command)).toEqual([
      'getMicrophoneStatus',
      'requestMicrophoneAccess'
    ]);
    expect(FakeMediaRecorder.instances[0].mimeType).toBe('audio/webm');

    await user.click(screen.getByRole('button', { name: 'Stop voice input' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Composer').value).toBe(
        'Existing note Add lunch for 325 pesos.'
      );
    });
    expect(screen.getByTestId('voice-status').textContent).toBe('idle');
    expect(onTranscript).toHaveBeenCalledWith('Add lunch for 325 pesos.');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    const transcriptionCall = advisor.invoke.mock.calls.find(
      ([command]) => command === 'transcribeAudio'
    );
    expect(transcriptionCall[1]).toMatchObject({
      requestId: 'companion_voice_test',
      mimeType: 'audio/webm',
      prompt: COMPANION_VOICE_TRANSCRIPTION_PROMPT
    });
    expect(transcriptionCall[1].audioBase64).toEqual(expect.any(String));
    expect(transcriptionCall[1].audioBase64.length).toBeGreaterThan(0);
  });

  it('cancels an in-flight transcription and ignores its stale result', async () => {
    const user = userEvent.setup();
    const { environment } = makeEnvironment();
    let resolveTranscription;
    const transcription = new Promise((resolve) => {
      resolveTranscription = resolve;
    });
    const advisor = {
      invoke: vi.fn(async (command) => {
        if (command === 'getMicrophoneStatus') {
          return { ok: true, status: 'granted', granted: true };
        }
        if (command === 'transcribeAudio') return transcription;
        return { ok: true };
      })
    };

    render(<VoiceHarness advisor={advisor} environment={environment} />);
    await user.click(screen.getByRole('button', { name: 'Start voice input' }));
    await user.click(await screen.findByRole('button', { name: 'Stop voice input' }));
    expect(await screen.findByText('transcribing')).not.toBeNull();
    await waitFor(() =>
      expect(advisor.invoke).toHaveBeenCalledWith(
        'transcribeAudio',
        expect.objectContaining({ requestId: 'companion_voice_test' })
      )
    );

    await user.click(screen.getByRole('button', { name: 'Cancel voice' }));
    expect(advisor.invoke).toHaveBeenCalledWith('cancel', {
      requestId: 'companion_voice_test'
    });
    await act(async () => {
      resolveTranscription({ ok: true, text: 'This must be ignored.' });
      await transcription;
    });

    expect(screen.getByLabelText('Composer').value).toBe('Existing note');
    expect(screen.getByTestId('voice-status').textContent).toBe('idle');
  });

  it('stops active microphone tracks without transcribing when unmounted', async () => {
    const user = userEvent.setup();
    const { environment, track } = makeEnvironment();
    const advisor = {
      invoke: vi.fn(async () => ({ ok: true, status: 'granted', granted: true }))
    };
    const view = render(<VoiceHarness advisor={advisor} environment={environment} />);

    await user.click(screen.getByRole('button', { name: 'Start voice input' }));
    expect(await screen.findByText('recording')).not.toBeNull();
    view.unmount();

    expect(track.stop).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
    expect(advisor.invoke).not.toHaveBeenCalledWith('transcribeAudio', expect.anything());
  });

  it('surfaces blocked permission and opens system microphone settings', async () => {
    const user = userEvent.setup();
    const { environment, getUserMedia } = makeEnvironment();
    const advisor = {
      invoke: vi.fn(async (command) => {
        if (command === 'getMicrophoneStatus') {
          return {
            ok: true,
            status: 'denied',
            granted: false,
            requestable: false,
            needsSystemSettings: true,
            message: 'Enable Cavalry in Microphone settings.'
          };
        }
        if (command === 'openMicrophoneSettings') return { ok: true, opened: true };
        return { ok: true };
      })
    };

    render(<VoiceHarness advisor={advisor} environment={environment} />);
    await user.click(screen.getByRole('button', { name: 'Start voice input' }));

    expect(await screen.findByText('Enable Cavalry in Microphone settings.')).not.toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open Microphone Settings' }));
    expect(advisor.invoke).toHaveBeenCalledWith('openMicrophoneSettings');
  });

  it('normalizes direct and nested permissions and rejects oversized capture before upload', async () => {
    expect(
      normalizeCompanionMicrophonePermission({ ok: true, status: 'granted', granted: true })
    ).toMatchObject({ status: 'granted', granted: true });
    expect(
      normalizeCompanionMicrophonePermission({
        ok: true,
        status: { status: 'denied', needsSystemSettings: true }
      })
    ).toMatchObject({ status: 'denied', granted: false, needsSystemSettings: true });
    expect(chooseCompanionVoiceMimeType(FakeMediaRecorder)).toBe('audio/webm');

    class OversizedBlob {
      constructor(_chunks, options = {}) {
        this.size = COMPANION_VOICE_MAX_AUDIO_BYTES + 1;
        this.type = options.type || '';
      }
    }
    const user = userEvent.setup();
    const { environment } = makeEnvironment({ Blob: OversizedBlob });
    const advisor = {
      invoke: vi.fn(async () => ({ ok: true, status: 'granted', granted: true }))
    };
    render(<VoiceHarness advisor={advisor} environment={environment} />);

    await user.click(screen.getByRole('button', { name: 'Start voice input' }));
    await user.click(await screen.findByRole('button', { name: 'Stop voice input' }));

    expect(
      await screen.findByText('That voice recording is too large to transcribe.')
    ).not.toBeNull();
    expect(advisor.invoke).not.toHaveBeenCalledWith('transcribeAudio', expect.anything());
  });
});
