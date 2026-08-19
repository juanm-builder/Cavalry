import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FeedbackSettingsPanel } from '../../src/renderer/features/feedback/FeedbackSettingsPanel.jsx';

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
);

function feedbackFixture(sessionKey, userId) {
  return {
    downloadAttachment: vi.fn(),
    ensureLoaded: vi.fn(async () => ({ ok: true, reports: [] })),
    model: {
      configured: true,
      error: '',
      reportsError: '',
      submitError: '',
      loaded: true,
      notice: '',
      pendingOperation: '',
      reports: [],
      sessionKey,
      signedIn: true,
      status: 'signed_in',
      userId,
      warning: false
    },
    refresh: vi.fn(),
    submit: vi.fn()
  };
}

describe('feedback settings privacy', () => {
  it('reuses the same idempotency key when a failed submission is retried unchanged', async () => {
    const user = userEvent.setup();
    const feedback = feedbackFixture('user-a:1', 'user-a');
    feedback.submit
      .mockResolvedValueOnce({ ok: false, error: 'The Cloud session changed.' })
      .mockResolvedValueOnce({ ok: true, report: { id: 'report-1' } });
    render(<FeedbackSettingsPanel feedback={feedback} />);

    await user.type(screen.getByLabelText('Description'), 'Retry this exact report once.');
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('The Cloud session changed.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    expect(feedback.submit).toHaveBeenCalledTimes(2);
    const firstRequestId = feedback.submit.mock.calls[0][0].clientRequestId;
    const secondRequestId = feedback.submit.mock.calls[1][0].clientRequestId;
    expect(firstRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(secondRequestId).toBe(firstRequestId);
  });

  it('rejects WebP instead of advertising an image format the desktop host cannot validate', async () => {
    const feedback = feedbackFixture('user-a:1', 'user-a');
    render(<FeedbackSettingsPanel feedback={feedback} />);

    fireEvent.change(screen.getByLabelText('Choose feedback image'), {
      target: {
        files: [new File([Uint8Array.from([0, 1, 2])], 'unsupported.webp', { type: 'image/webp' })]
      }
    });

    expect(await screen.findByText('Choose a PNG or JPEG image.')).not.toBeNull();
    expect(feedback.submit).not.toHaveBeenCalled();
  });

  it('clears an unsent description and image when the Cloud session changes', async () => {
    const user = userEvent.setup();
    const firstFeedback = feedbackFixture('user-a:1', 'user-a');
    const { rerender } = render(<FeedbackSettingsPanel feedback={firstFeedback} />);

    const description = screen.getByLabelText('Description');
    await user.type(description, 'Private draft from user A');
    const image = new File([PNG_BYTES], 'private-a.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose feedback image'), {
      target: { files: [image] }
    });
    await waitFor(() => {
      expect(screen.getByText('private-a.png')).not.toBeNull();
    });

    rerender(<FeedbackSettingsPanel feedback={feedbackFixture('user-b:2', 'user-b')} />);

    expect(screen.getByLabelText('Description').value).toBe('');
    expect(screen.queryByText('private-a.png')).toBeNull();
    expect(screen.getByText('Attach screenshot')).not.toBeNull();
  });

  it('labels an unconfigured Cloud connection as unavailable', () => {
    const feedback = feedbackFixture('signed-out:0', '');
    feedback.model = {
      ...feedback.model,
      configured: false,
      sessionKey: 'signed-out:0',
      signedIn: false,
      status: 'unconfigured'
    };

    render(<FeedbackSettingsPanel feedback={feedback} />);

    expect(screen.getByText('Cloud unavailable')).not.toBeNull();
    expect(screen.queryByText('Sign in required')).toBeNull();
  });
});
