import { spawnSync } from 'node:child_process';

import {
  asString,
  ensureDirectory,
  packagePath,
  readText,
  repoPath,
  scanTextFilesForTokenLeaks,
  writeJson,
  writeText
} from './companion-beta-utils.mjs';
import { COMPANION_PACKAGE_ROOT, repoRelativePath } from './companion-paths.mjs';

function fail(message) {
  console.error('Companion checkpointed bundle failed:', message);
  process.exit(1);
}

function runOpenApi() {
  const result = spawnSync(
    process.execPath,
    [packagePath('scripts/companion-checkpointed-openapi.mjs')],
    {
      cwd: COMPANION_PACKAGE_ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        CAVALRY_COMPANION_PUBLIC_BASE_URL:
          process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL || 'https://checkpointed.example.com',
        CAVALRY_COMPANION_AI_ACTION_MODE: 'checkpointed_apply',
        CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED: '1'
      })
    }
  );
  if (result.status !== 0) {
    fail(asString(result.stderr || result.stdout) || 'checkpointed OpenAPI generation failed.');
  }
}

try {
  runOpenApi();
  const outDir = repoPath('test-artifacts/companion-checkpointed-beta-bundle');
  ensureDirectory(outDir);
  writeText(
    repoPath(
      'test-artifacts/companion-checkpointed-beta-bundle/custom-gpt-instructions-checkpointed.md'
    ),
    readText(packagePath('examples/custom-gpt-instructions-checkpointed.md'))
  );
  writeText(
    repoPath(
      'test-artifacts/companion-checkpointed-beta-bundle/cavalry-gpt-actions.checkpointed.openapi.yaml'
    ),
    readText(
      repoPath(
        'test-artifacts/companion-checkpointed-beta/openapi/cavalry-gpt-actions.checkpointed.openapi.yaml'
      )
    )
  );
  writeText(
    repoPath(
      'test-artifacts/companion-checkpointed-beta-bundle/cavalry-gpt-actions.checkpointed.openapi.json'
    ),
    readText(
      repoPath(
        'test-artifacts/companion-checkpointed-beta/openapi/cavalry-gpt-actions.checkpointed.openapi.json'
      )
    )
  );
  writeText(
    repoPath('test-artifacts/companion-checkpointed-beta-bundle/README.md'),
    [
      '# Cavalry Companion API Checkpointed Beta Bundle',
      '',
      'This bundle is experimental and power-user only. It applies supported changes under reversible Cavalry checkpoints. Production cloud ready: false.',
      '',
      'Use a test workbook first. Stop the tunnel and rotate the beta token after testing.',
      '',
      'Files:',
      '- `custom-gpt-instructions-checkpointed.md`',
      '- `cavalry-gpt-actions.checkpointed.openapi.yaml`',
      '- `cavalry-gpt-actions.checkpointed.openapi.json`',
      '- `manual-test-checklist.md`',
      '- `privacy-and-safety.md`',
      ''
    ].join('\n')
  );
  writeText(
    repoPath('test-artifacts/companion-checkpointed-beta-bundle/manual-test-checklist.md'),
    [
      '# Checkpointed Manual Test Checklist',
      '',
      '- [ ] Use a test workbook.',
      '- [ ] Enable `CAVALRY_COMPANION_AI_ACTION_MODE=checkpointed_apply`.',
      '- [ ] Enable `CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED=1`.',
      '- [ ] Enable checkpoint beta scopes with `CAVALRY_COMPANION_BETA_ENABLE_CHECKPOINTED_SCOPE=1`.',
      '- [ ] Import the checkpointed OpenAPI file into a Custom GPT Action.',
      '- [ ] Apply one reversible transaction checkpoint.',
      '- [ ] Open the checkpoint review URL.',
      '- [ ] Preview rollback.',
      '- [ ] Undo inside Cavalry or with a local rollback test only.',
      '- [ ] Confirm permanent delete requests are refused.',
      ''
    ].join('\n')
  );
  writeText(
    repoPath('test-artifacts/companion-checkpointed-beta-bundle/privacy-and-safety.md'),
    [
      '# Privacy And Safety',
      '',
      'Checkpointing can undo workbook edits, but it cannot undo financial data already sent to ChatGPT, a tunnel provider, logs, screenshots, or another external service.',
      '',
      'The checkpoint stores before/after values needed for review and rollback. Tokens, auth headers, and raw secrets must never be stored.',
      '',
      'Local/tunnel beta is not production cloud. OAuth, hosted HTTPS, durable stores, monitoring, and privacy/legal review remain Path B work.',
      ''
    ].join('\n')
  );
  const files = [
    'README.md',
    'custom-gpt-instructions-checkpointed.md',
    'cavalry-gpt-actions.checkpointed.openapi.yaml',
    'cavalry-gpt-actions.checkpointed.openapi.json',
    'manual-test-checklist.md',
    'privacy-and-safety.md'
  ].map((file) => repoPath('test-artifacts/companion-checkpointed-beta-bundle', file));
  const leaks = scanTextFilesForTokenLeaks(files);
  if (leaks.length) {
    fail('Token-like secret found in checkpointed bundle: ' + leaks.join(', '));
  }
  writeJson(repoPath('test-artifacts/companion-checkpointed-beta-bundle/bundle-manifest.json'), {
    generated_at: new Date().toISOString(),
    production_cloud_ready: false,
    files: files.map(repoRelativePath)
  });
  console.log('Companion checkpointed beta bundle generated:');
  console.log(outDir);
} catch (error) {
  fail(error && error.message ? error.message : asString(error));
}
