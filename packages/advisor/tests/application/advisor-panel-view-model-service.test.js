// Tests for the display-only Advisor panel view model.

import { describe, expect, it } from 'vitest';

import {
  buildAdvisorVoiceButtonViewModel,
  buildAdvisorVoiceStatusViewModel,
  getAdvisorVoiceStatusCopy
} from '@cavalry/advisor/application/advisor/advisor-panel-view-model-service.js';

describe('advisor panel view-model service', () => {
  it('preserves Advisor voice status copy', () => {
    expect(getAdvisorVoiceStatusCopy({ status: 'requesting_permission' })).toBe(
      'Requesting microphone access...'
    );
    expect(getAdvisorVoiceStatusCopy({ status: 'recording' })).toBe(
      'Listening... tap the mic to stop.'
    );
    expect(getAdvisorVoiceStatusCopy({ status: 'transcribing' })).toBe(
      'Transcribing voice input...'
    );
    expect(
      getAdvisorVoiceStatusCopy({ status: 'error', error: 'Microphone access was denied.' })
    ).toBe('Microphone access was denied.');
    expect(getAdvisorVoiceStatusCopy({ status: 'error', error: '  Keep exact copy  ' })).toBe(
      '  Keep exact copy  '
    );
    expect(getAdvisorVoiceStatusCopy({ status: '', error: 'Ignored' })).toBe('');
    expect(getAdvisorVoiceStatusCopy({ status: 'idle' })).toBe('');
  });

  it('builds the voice button state without calling browser or provider APIs', () => {
    expect(
      buildAdvisorVoiceButtonViewModel({
        status: 'idle',
        availability: { available: true, message: '' }
      })
    ).toEqual({
      status: 'idle',
      icon: 'mic',
      title: 'Dictate to Advisor',
      ariaLabel: 'Dictate to Advisor',
      disabled: false,
      className: ''
    });

    expect(
      buildAdvisorVoiceButtonViewModel({
        status: 'recording',
        availability: { available: false, message: 'Unavailable' }
      })
    ).toMatchObject({
      icon: 'stop_circle',
      title: 'Stop voice input',
      disabled: false,
      className: 'is-recording'
    });

    expect(
      buildAdvisorVoiceButtonViewModel({
        status: 'transcribing',
        availability: { available: true }
      })
    ).toMatchObject({
      icon: 'hourglass_top',
      title: 'Transcribing voice input',
      disabled: true
    });

    expect(
      buildAdvisorVoiceButtonViewModel({
        status: 'idle',
        availability: {
          available: false,
          message: 'Voice input needs the OpenAI/API Advisor provider.'
        }
      })
    ).toMatchObject({
      title: 'Voice input needs the OpenAI/API Advisor provider.',
      disabled: true
    });

    expect(
      buildAdvisorVoiceButtonViewModel({
        status: 'idle',
        availability: { available: 'yes', message: 'Ignored' }
      })
    ).toMatchObject({
      title: 'Dictate to Advisor',
      disabled: false
    });
  });

  it('builds visible voice status rows and microphone settings actions', () => {
    expect(buildAdvisorVoiceStatusViewModel({ status: 'idle' })).toMatchObject({
      visible: false,
      status: 'idle'
    });

    expect(
      buildAdvisorVoiceStatusViewModel({
        status: 'recording',
        timerCopy: '3s recorded / 60s max'
      })
    ).toMatchObject({
      visible: true,
      icon: 'radio_button_checked',
      copy: 'Listening... tap the mic to stop.',
      timerCopy: '3s recorded / 60s max',
      settingsAction: null
    });

    expect(
      buildAdvisorVoiceStatusViewModel({
        status: 'error',
        error: 'Enable Cavalry for Mac in Microphone settings.',
        permission: { needsSystemSettings: true },
        canOpenMicrophoneSettings: true
      })
    ).toMatchObject({
      visible: true,
      icon: 'error',
      copy: 'Enable Cavalry for Mac in Microphone settings.',
      settingsAction: true
    });
  });

  it('does not mutate availability or permission inputs', () => {
    const availability = { available: true, message: '' };
    const permission = { needsSystemSettings: true };
    const beforeAvailability = JSON.stringify(availability);
    const beforePermission = JSON.stringify(permission);

    buildAdvisorVoiceButtonViewModel({ status: 'idle', availability });
    buildAdvisorVoiceStatusViewModel({
      status: 'error',
      permission,
      canOpenMicrophoneSettings: true
    });

    expect(JSON.stringify(availability)).toBe(beforeAvailability);
    expect(JSON.stringify(permission)).toBe(beforePermission);
  });
});
