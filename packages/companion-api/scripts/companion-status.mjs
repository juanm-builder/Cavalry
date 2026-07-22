import { hasCompanionBetaTokenConfig } from '../src/server/cavalry-api/beta-token.js';
import {
  getCompanionApiRuntimeConfig,
  getCompanionRuntimeStatus
} from '../src/server/cavalry-api/runtime.js';
import { asString, repoPath, writeJson, writeText } from './companion-beta-utils.mjs';

let runtime = null;
let error = '';
try {
  runtime = getCompanionApiRuntimeConfig();
} catch (runtimeError) {
  error = runtimeError && runtimeError.message ? runtimeError.message : String(runtimeError);
}

const status = runtime
  ? getCompanionRuntimeStatus(runtime)
  : {
      api_enabled: process.env.CAVALRY_COMPANION_API_ENABLED === '1',
      api_mode: asString(process.env.CAVALRY_COMPANION_API_MODE || 'unknown'),
      error
    };

const report = Object.assign({}, status, {
  generated_at: new Date().toISOString(),
  beta_token_configured: hasCompanionBetaTokenConfig(),
  public_base_url_configured: !!asString(process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL),
  public_base_url: asString(process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL)
    ? '[configured-redacted]'
    : '',
  production_cloud_ready: false,
  ai_action_mode: runtime
    ? runtime.aiActionMode
    : asString(process.env.CAVALRY_COMPANION_AI_ACTION_MODE || 'draft_only'),
  checkpointed_apply_enabled: runtime
    ? runtime.checkpointedApplyEnabled === true
    : process.env.CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED === '1',
  max_checkpoint_actions: runtime
    ? runtime.maxCheckpointActions
    : Number(process.env.CAVALRY_COMPANION_MAX_CHECKPOINT_ACTIONS || 25),
  docs: 'docs/integrations/companion-api-power-user-beta.md',
  doctor_report_path: 'test-artifacts/companion-beta-doctor/report.md',
  beta_bundle_path: 'test-artifacts/companion-beta-bundle',
  beta_certification_report_path: 'test-artifacts/companion-beta-certification/report.md'
});

writeJson(repoPath('test-artifacts/companion-status/report.json'), report);
writeText(
  repoPath('test-artifacts/companion-status/report.md'),
  [
    '# Companion API Status',
    '',
    '- Generated at: `' + report.generated_at + '`',
    '- Status: `' + String(report.api_mode) + '`',
    '- Local URL: `http://' +
      String(report.bind_host || '127.0.0.1') +
      ':' +
      String(report.bind_port || 8787) +
      '`',
    '- Public base URL configured: `' + String(report.public_base_url_configured) + '`',
    '- Auth required: `' + String(report.auth_required !== false) + '`',
    '- AI action mode: `' + String(report.ai_action_mode) + '`',
    '- Checkpointed apply enabled: `' + String(report.checkpointed_apply_enabled) + '`',
    '- Max checkpoint actions: `' + String(report.max_checkpoint_actions) + '`',
    '- Draft-only guarantee: `true`',
    '- Production cloud ready: `false`',
    '- Beta token configured: `' + String(report.beta_token_configured) + '`',
    error ? '- Runtime error: `' + error.replace(/`/g, "'") + '`' : '',
    '',
    'Raw tokens, token hashes, auth headers, and workbook data are not printed by this command.',
    ''
  ]
    .filter(Boolean)
    .join('\n')
);

console.log('Cavalry Companion API status');
console.log('Mode: ' + String(report.api_mode));
console.log('Enabled: ' + String(report.api_enabled));
console.log(
  'Local URL: http://' +
    String(report.bind_host || '127.0.0.1') +
    ':' +
    String(report.bind_port || 8787)
);
console.log('Public base URL configured: ' + String(report.public_base_url_configured));
console.log('Auth required: ' + String(report.auth_required !== false));
console.log('AI action mode: ' + String(report.ai_action_mode));
console.log('Checkpointed apply enabled: ' + String(report.checkpointed_apply_enabled));
console.log('Draft-only guarantee: true');
console.log('Production cloud ready: false');
console.log('Report: test-artifacts/companion-status/report.md');
if (error) {
  console.log('Runtime error: ' + error);
  process.exit(1);
}
