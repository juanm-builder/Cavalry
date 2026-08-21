import { describe, expect, it, vi } from 'vitest';

import { createDesktopRendererPorts } from '../../src/renderer/platform/desktop-ports.js';

describe('desktop advisor port', () => {
  it('forwards only attributable stream segments as transient advisor status', () => {
    let statusListener = () => {};
    const dispose = vi.fn();
    const ports = createDesktopRendererPorts(
      {
        advisor: {
          onStatus(listener) {
            statusListener = listener;
            return dispose;
          }
        }
      },
      {}
    );
    const listener = vi.fn();

    const unsubscribe = ports.advisor.subscribe(listener);
    statusListener({
      phase: 'stream',
      requestId: 'turn_1',
      delta: 'Public final text.',
      segment: 2,
      reset: true,
      final: true
    });
    statusListener({ phase: 'stream', requestId: '', delta: 'unattributed' });
    statusListener({
      phase: 'stream',
      requestId: 'turn_1',
      delta: '',
      segment: 2,
      reset: true,
      final: true
    });
    statusListener({ phase: 'running', requestId: 'turn_1', message: 'Cavalry is working.' });

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenNthCalledWith(1, {
      phase: 'stream',
      requestId: 'turn_1',
      delta: 'Public final text.',
      segment: 2,
      reset: true,
      final: true
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      phase: 'stream',
      requestId: 'turn_1',
      delta: '',
      segment: 2,
      reset: true,
      final: true
    });
    expect(listener).toHaveBeenNthCalledWith(3, {
      phase: 'running',
      requestId: 'turn_1',
      message: 'Cavalry is working.'
    });
    unsubscribe();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
