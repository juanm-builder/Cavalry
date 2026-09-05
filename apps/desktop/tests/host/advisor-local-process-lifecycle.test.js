import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createAdvisorLocalProcessLifecycle,
  getManagedAdvisorProcessStatus
} = require('../../src/host/advisor-local-process-lifecycle.cjs');

describe('Advisor local process lifecycle', () => {
  it('keeps force-stop deadlines independent when multiple model children are stopping', async () => {
    vi.useFakeTimers();
    try {
      const lifecycle = createAdvisorLocalProcessLifecycle({ process: { kill: vi.fn() } });
      const child = () => ({ exitCode: null, signalCode: null, kill: vi.fn(() => true) });
      const previous = child();
      const current = child();

      await lifecycle.stopChild(previous, { forceAfterMs: 25 });
      await lifecycle.stopChild(current, { forceAfterMs: 50 });
      await vi.advanceTimersByTimeAsync(25);
      expect(previous.kill).toHaveBeenLastCalledWith('SIGKILL');
      expect(current.kill).toHaveBeenCalledTimes(1);

      lifecycle.markChildExited(previous);
      await vi.advanceTimersByTimeAsync(25);
      expect(current.kill).toHaveBeenLastCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels only the exited child’s force-stop deadline', async () => {
    vi.useFakeTimers();
    try {
      const lifecycle = createAdvisorLocalProcessLifecycle({ process: { kill: vi.fn() } });
      const previous = { exitCode: null, signalCode: null, kill: vi.fn(() => true) };
      const current = { exitCode: null, signalCode: null, kill: vi.fn(() => true) };
      await lifecycle.stopChild(previous, { forceAfterMs: 25 });
      await lifecycle.stopChild(current, { forceAfterMs: 25 });

      lifecycle.markChildExited(previous);
      await vi.advanceTimersByTimeAsync(25);
      expect(previous.kill).toHaveBeenCalledTimes(1);
      expect(current.kill).toHaveBeenLastCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails Stop when a live adopted process cannot be signalled', async () => {
    const process = {
      kill: vi.fn((_pid, signal) => {
        if (signal === 0) return;
        const error = new Error('operation not permitted');
        error.code = 'EPERM';
        throw error;
      })
    };
    const lifecycle = createAdvisorLocalProcessLifecycle({ process });

    await expect(lifecycle.stopPid(4321, { wait: true, forceAfterMs: 25 })).rejects.toThrow(
      'Could not signal local model server process 4321 to stop'
    );
  });

  it('treats a process that disappears during SIGTERM as successfully stopped', async () => {
    let alive = true;
    const process = {
      kill: vi.fn((_pid, signal) => {
        if (signal === 0) {
          if (alive) return;
          throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
        }
        alive = false;
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      })
    };
    const lifecycle = createAdvisorLocalProcessLifecycle({ process });

    await expect(lifecycle.stopPid(4321, { wait: true, forceAfterMs: 25 })).resolves.toBe(true);
  });

  it('reports pre-spawn startup and cancellation as manageable authoritative states', async () => {
    const common = {
      managedChild: null,
      managedProcessKey: '',
      adoptedPid: 0,
      adoptedProcessKey: '',
      getBaseUrl: () => 'http://127.0.0.1:8080',
      isChildRunning: () => false,
      isPidAlive: () => false,
      isHealthy: vi.fn(async () => false)
    };

    await expect(
      getManagedAdvisorProcessStatus({
        ...common,
        startOperation: {
          serverKey: 'http://127.0.0.1:8080|model',
          child: null,
          cancelled: false
        }
      })
    ).resolves.toMatchObject({
      running: false,
      starting: true,
      stopping: false,
      manageable: true,
      message: 'Local model server is starting.'
    });

    await expect(
      getManagedAdvisorProcessStatus({
        ...common,
        startOperation: {
          serverKey: 'http://127.0.0.1:8080|model',
          child: null,
          cancelled: true
        }
      })
    ).resolves.toMatchObject({
      running: false,
      starting: false,
      stopping: true,
      manageable: true,
      message: 'Local model server is stopping.'
    });
  });
});
