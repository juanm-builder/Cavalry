import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getAdvisorLlamaLaunchFailure,
  getAdvisorLlamaRootCause
} = require('../../src/host/advisor-llama-server-launch.cjs');

function processLog(text) {
  return {
    getCollectedText() {
      return text;
    }
  };
}

describe('Advisor llama-server launch errors', () => {
  it('finds an incompatible projector before a later native backtrace', () => {
    const log = [
      'clip_model_loader: model name: Qwen3.5-9B',
      'mtmd_init_from_file: error: mismatch between text model (n_embd = 2560) and mmproj (n_embd = 4096)',
      'mtmd_init_from_file: hint: you may be using wrong mmproj',
      'main: exiting due to model loading error',
      'GGML_ASSERT([rsets->data count] == 0) failed',
      '0 libggml-metal.dylib 0x0000000100000000 ggml_abort + 156'
    ].join('\n');

    expect(getAdvisorLlamaRootCause(log)).toEqual({
      code: 'ADVISOR_PROJECTOR_MISMATCH',
      message:
        'The selected vision projector is incompatible with this text model ' +
        '(model dimension 2560, projector dimension 4096). ' +
        'Choose the projector published for the same model, or clear the optional projector.'
    });

    const error = getAdvisorLlamaLaunchFailure(
      { signal: 'SIGABRT' },
      processLog(log),
      '/private/cavalry-llama-server.log'
    );
    expect(error).toMatchObject({
      code: 'ADVISOR_PROJECTOR_MISMATCH',
      logPath: '/private/cavalry-llama-server.log',
      message: expect.stringContaining('vision projector is incompatible'),
      detail: expect.stringContaining('SIGABRT')
    });
    expect(error.message).not.toContain('ggml-metal');
    expect(error.message).not.toContain('Error invoking remote method');
  });

  it('keeps asynchronous spawn failures concise and structured', () => {
    const error = getAdvisorLlamaLaunchFailure(
      { error: Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }) },
      processLog(''),
      '/private/cavalry-llama-server.log'
    );

    expect(error).toMatchObject({
      code: 'ADVISOR_LOCAL_MODEL_LAUNCH_FAILED',
      message: 'Could not launch llama-server (spawn EACCES).',
      detail: 'llama-server could not be launched: spawn EACCES',
      logPath: '/private/cavalry-llama-server.log'
    });
  });

  it('uses a high-signal load error instead of the final stack frames', () => {
    const error = getAdvisorLlamaLaunchFailure(
      { code: 1 },
      processLog(
        [
          'llama_model_load: error loading model: invalid model architecture',
          'main: exiting due to model loading error',
          '0 libsystem_c.dylib 0x0000000000000000 abort + 156'
        ].join('\n')
      ),
      '/private/cavalry-llama-server.log'
    );

    expect(error).toMatchObject({
      code: 'ADVISOR_LOCAL_MODEL_LOAD_FAILED',
      message: 'llama_model_load: error loading model: invalid model architecture',
      detail: expect.stringContaining('exit code 1')
    });
  });
});
