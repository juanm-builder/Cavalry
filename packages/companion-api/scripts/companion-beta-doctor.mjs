import {
  BETA_OPENAPI_JSON,
  BETA_OPENAPI_YAML,
  asString,
  assertNoForbiddenGptEndpoints,
  containsTokenLikeSecret,
  ensureDirectory,
  isReadableFile,
  markdownCheckList,
  packagePath,
  readText,
  redactSecrets,
  repoPath,
  scanTextFilesForTokenLeaks,
  validatePublicBaseUrlFromEnv,
  writeJson,
  writeText
} from './companion-beta-utils.mjs';
import { hasCompanionBetaTokenConfig } from '../src/server/cavalry-api/beta-token.js';
import {
  getCompanionApiRuntimeConfig,
  validateCompanionPublicBaseUrl
} from '../src/server/cavalry-api/runtime.js';

const reportDirRelative = asString(
  process.env.CAVALRY_COMPANION_DOCTOR_OUT_DIR || 'test-artifacts/companion-beta-doctor'
);
const outDir = repoPath(reportDirRelative);
const checks = [];

function add(status, id, label, detail = '', next = '') {
  checks.push({ status, id, label, detail: redactSecrets(detail), next });
}

function pass(id, label, detail = '') {
  add('pass', id, label, detail);
}

function warn(id, label, detail = '', next = '') {
  add('warn', id, label, detail, next);
}

function fail(id, label, detail = '', next = '') {
  add('fail', id, label, detail, next);
}

function skip(id, label, detail = '') {
  add('skip', id, label, detail);
}

async function fetchJson(baseUrl, token, path = '/v1/capabilities') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(baseUrl.replace(/\/+$/g, '') + path, {
      signal: controller.signal,
      headers: token ? { authorization: 'Bearer ' + token } : {}
    });
    let body = null;
    try {
      body = await response.json();
    } catch (_error) {
      body = null;
    }
    return { status: response.status, ok: response.status >= 200 && response.status < 300, body };
  } finally {
    clearTimeout(timer);
  }
}

function existingText(path) {
  return isReadableFile(path) ? readText(path) : '';
}

const implementationFiles = [
  {
    label: '@cavalry/action-review/domain/cavalry-action-plan/schema.js',
    path: repoPath('packages/action-review/src/domain/cavalry-action-plan/schema.js')
  },
  {
    label: '@cavalry/action-review/application/drafts/external-draft-service.js',
    path: repoPath('packages/action-review/src/application/drafts/external-draft-service.js')
  },
  {
    label: 'src/application/api/cavalry-api-controller.js',
    path: packagePath('src/application/api/cavalry-api-controller.js')
  },
  {
    label: 'src/server/cavalry-api/server.js',
    path: packagePath('src/server/cavalry-api/server.js')
  },
  {
    label: 'src/server/cavalry-api/runtime.js',
    path: packagePath('src/server/cavalry-api/runtime.js')
  },
  { label: 'src/server/cavalry-api/auth.js', path: packagePath('src/server/cavalry-api/auth.js') },
  {
    label: 'src/server/cavalry-api/beta-token.js',
    path: packagePath('src/server/cavalry-api/beta-token.js')
  }
];

implementationFiles.forEach((file) => {
  if (isReadableFile(file.path)) {
    pass('file:' + file.label, 'Implementation file exists: ' + file.label);
  } else {
    fail('file:' + file.label, 'Implementation file missing: ' + file.label);
  }
});

const openApiPath = packagePath('openapi/cavalry-gpt-actions.openapi.yaml');
if (isReadableFile(openApiPath)) {
  pass('openapi-source', 'GPT OpenAPI spec exists', 'openapi/cavalry-gpt-actions.openapi.yaml');
  const forbidden = assertNoForbiddenGptEndpoints(readText(openApiPath));
  if (forbidden.length) {
    fail(
      'openapi-forbidden-endpoints',
      'GPT-facing OpenAPI exposes forbidden endpoints',
      forbidden.join(', ')
    );
  } else {
    pass('openapi-draft-only', 'GPT-facing OpenAPI exposes draft-only write endpoints');
  }
} else {
  fail('openapi-source', 'GPT OpenAPI spec missing');
}

if (
  isReadableFile(repoPath('docs/integrations/cavalry-companion-gpt.md')) ||
  isReadableFile(packagePath('examples/custom-gpt-instructions.md'))
) {
  pass('gpt-instructions', 'GPT instruction file exists');
} else {
  fail('gpt-instructions', 'GPT instruction file missing');
}

const defaultEnabled =
  process.env.CAVALRY_COMPANION_API_ENABLED === '1' || process.env.CAVALRY_API_ENABLED === '1';
if (!defaultEnabled) {
  pass('disabled-default', 'Server is disabled by default');
} else {
  warn(
    'disabled-default',
    'Server env currently enables Companion API',
    'Unset CAVALRY_COMPANION_API_ENABLED when not testing.'
  );
}

try {
  const localRuntime = getCompanionApiRuntimeConfig({ enabled: true, mode: 'local_dev' });
  if (localRuntime.mode === 'local_dev') pass('mode-local-dev', 'local_dev mode is available');
  const betaRuntime = getCompanionApiRuntimeConfig({
    enabled: true,
    mode: 'beta_tunnel',
    publicBaseUrl: process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL || undefined,
    allowPrivateBaseUrl: true
  });
  if (betaRuntime.mode === 'beta_tunnel') pass('mode-beta-tunnel', 'beta_tunnel mode is available');
} catch (error) {
  warn(
    'mode-beta-tunnel',
    'beta_tunnel mode exists but current env is incomplete or invalid',
    error && error.message ? error.message : String(error)
  );
}

const cloudRuntime = getCompanionApiRuntimeConfig({ enabled: true, mode: 'cloud_stub' });
if (cloudRuntime.productionCloudReady === false) {
  pass('mode-cloud-stub', 'cloud_stub remains non-production');
} else {
  fail('mode-cloud-stub', 'cloud_stub must not claim production readiness');
}

const tokenConfigured = hasCompanionBetaTokenConfig();
if (tokenConfigured) {
  pass('beta-token', 'Beta token configuration is present');
} else {
  warn(
    'beta-token',
    'No beta token configured',
    'Run npm run token --workspace @cavalry/companion-api.'
  );
}

let publicBaseUrl = '';
const rawPublicBaseUrl = asString(process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL);
if (!rawPublicBaseUrl) {
  warn(
    'public-url',
    'No public HTTPS tunnel URL configured',
    'Set CAVALRY_COMPANION_PUBLIC_BASE_URL=https://...'
  );
} else if (containsTokenLikeSecret(rawPublicBaseUrl)) {
  fail(
    'public-url-secret',
    'Public base URL contains a token-like secret',
    'Remove tokens/secrets from CAVALRY_COMPANION_PUBLIC_BASE_URL.'
  );
} else {
  try {
    publicBaseUrl = validatePublicBaseUrlFromEnv({
      allowPrivateBaseUrl: process.env.NODE_ENV === 'test'
    });
    pass('public-url', 'Public base URL is valid', publicBaseUrl);
  } catch (error) {
    fail(
      'public-url',
      'Public base URL is invalid',
      error && error.message ? error.message : String(error)
    );
  }
}

if (isReadableFile(repoPath(BETA_OPENAPI_YAML)) && isReadableFile(repoPath(BETA_OPENAPI_JSON))) {
  pass(
    'beta-openapi-generated',
    'Beta OpenAPI artifacts exist',
    BETA_OPENAPI_YAML + ', ' + BETA_OPENAPI_JSON
  );
} else {
  warn(
    'beta-openapi-generated',
    'Beta OpenAPI artifacts are missing',
    'Run npm run beta:openapi --workspace @cavalry/companion-api after setting the public URL.'
  );
}

const localHost =
  asString(
    process.env.CAVALRY_COMPANION_BIND_HOST || process.env.CAVALRY_API_HOST || '127.0.0.1'
  ) || '127.0.0.1';
const localPort = Number(
  process.env.CAVALRY_COMPANION_BIND_PORT || process.env.CAVALRY_API_PORT || 8787
);
const localBaseUrl = 'http://' + localHost + ':' + String(localPort);
const rawToken = asString(
  process.env.CAVALRY_COMPANION_BETA_API_KEY ||
    process.env.CAVALRY_COMPANION_DEV_TOKEN ||
    process.env.CAVALRY_API_DEV_TOKEN
);

try {
  const local = await fetchJson(localBaseUrl, rawToken);
  if (local.ok || local.status === 401 || local.status === 403) {
    pass('local-api-reachable', 'Local API is reachable', 'status ' + String(local.status));
  } else {
    warn(
      'local-api-reachable',
      'Local API responded unexpectedly',
      'status ' + String(local.status)
    );
  }
} catch (_error) {
  warn(
    'local-api-reachable',
    'Local API is not reachable',
    'Start with npm run serve:local --workspace @cavalry/companion-api or npm run serve:beta --workspace @cavalry/companion-api.'
  );
}

if (publicBaseUrl) {
  try {
    const unauth = await fetchJson(publicBaseUrl, '', '/v1/capabilities');
    if (unauth.status === 401 || unauth.status === 403) {
      pass(
        'public-auth-required',
        'Public/tunnel API requires auth',
        'status ' + String(unauth.status)
      );
    } else {
      fail(
        'public-auth-required',
        'Public/tunnel API did not reject unauthenticated capabilities call',
        'status ' + String(unauth.status)
      );
    }
    if (rawToken) {
      const authed = await fetchJson(publicBaseUrl, rawToken, '/v1/capabilities');
      if (authed.ok) {
        pass('public-token-accepted', 'Configured token is accepted by public/tunnel API');
      } else {
        warn(
          'public-token-accepted',
          'Configured token was not accepted by public/tunnel API',
          'status ' + String(authed.status)
        );
      }
    } else {
      skip('public-token-accepted', 'Raw token not available for live public/tunnel auth check');
    }
  } catch (_error) {
    warn(
      'public-api-reachable',
      'Public/tunnel API is not reachable from this process',
      'Start the API and tunnel, then rerun doctor.'
    );
  }
} else {
  skip(
    'public-api-reachable',
    'Public/tunnel API reachability skipped until a public base URL is configured'
  );
}

try {
  const betaUrl = rawPublicBaseUrl
    ? validateCompanionPublicBaseUrl(rawPublicBaseUrl, {
        allowPrivateBaseUrl: process.env.NODE_ENV === 'test'
      })
    : '';
  if (
    !betaUrl ||
    /^https:\/\//i.test(betaUrl) ||
    process.env.CAVALRY_COMPANION_ALLOW_INSECURE_TUNNEL === '1'
  ) {
    pass('public-url-https', 'Public base URL HTTPS rule is enforced');
  }
} catch (error) {
  if (/https/i.test(error && error.message ? error.message : String(error))) {
    fail('public-url-https', 'Public base URL must use HTTPS unless insecure override is set');
  }
}

const routeText = existingText(packagePath('src/server/cavalry-api/routes.js'));
if (!/\/apply/.test(routeText) && !/delete|archive/.test(routeText)) {
  pass(
    'route-draft-only',
    'Server routes expose no apply/delete/archive direct mutation endpoints'
  );
} else {
  fail('route-draft-only', 'Server route text contains apply/delete/archive-like route names');
}

const reviewUrlText = existingText(
  repoPath('packages/action-review/src/application/drafts/review-url.js')
);
if (reviewUrlText.includes('cavalry://draft-groups/')) {
  pass('deep-link-scheme', 'Review URL deep-link scheme is available');
} else {
  fail('deep-link-scheme', 'Review URL deep-link scheme is missing');
}

if (
  isReadableFile(
    repoPath('packages/action-review/src/application/import-export/chatgpt-action-plan-import.js')
  )
) {
  pass('manual-import', 'Manual import fallback is available');
} else {
  fail('manual-import', 'Manual import fallback is missing');
}

const reviewUiText = existingText(
  repoPath('apps/mac/src/renderer/features/drafts/DraftReviewRoute.jsx')
);
if (/Nothing changes until you apply a draft/.test(reviewUiText)) {
  pass('review-ui', 'Review UI warns that drafts have not changed the workbook yet');
} else {
  warn('review-ui', 'Review UI trust copy could not be found');
}

const docsText = [
  'docs/integrations/companion-api-custom-gpt-beta-test.md',
  'docs/operations/companion-api-beta-release-checklist.md',
  'docs/integrations/companion-api-overview.md'
]
  .map((path) => existingText(repoPath(path)))
  .join('\n')
  .toLowerCase();
if (docsText.includes('test workbook')) {
  pass('test-workbook-docs', 'Test workbook recommendation is visible in docs');
} else {
  warn('test-workbook-docs', 'Docs should recommend a test workbook first');
}

const leakPaths = [
  repoPath(BETA_OPENAPI_YAML),
  repoPath(BETA_OPENAPI_JSON),
  repoPath('docs/integrations/cavalry-companion-gpt.md'),
  packagePath('examples/custom-gpt-instructions.md')
];
const leaks = scanTextFilesForTokenLeaks(leakPaths);
if (leaks.length) {
  fail('token-leaks', 'Generated/docs files contain token-like secrets', leaks.join(', '));
} else {
  pass('token-leaks', 'No token-like secrets found in checked docs/spec artifacts');
}

const nextSteps = [];
if (!tokenConfigured) {
  nextSteps.push('Generate a beta token: npm run token --workspace @cavalry/companion-api');
}
if (!publicBaseUrl) {
  nextSteps.push('Start a tunnel and set CAVALRY_COMPANION_PUBLIC_BASE_URL=https://...');
}
if (!isReadableFile(repoPath(BETA_OPENAPI_YAML))) {
  nextSteps.push('Generate beta OpenAPI: npm run beta:openapi --workspace @cavalry/companion-api');
}
nextSteps.push(
  'Generate the Custom GPT beta bundle: npm run beta:bundle --workspace @cavalry/companion-api'
);
nextSteps.push(
  'Run beta certification when the API/tunnel is configured: npm run beta:certify --workspace @cavalry/companion-api'
);

const ready = checks.filter((check) => check.status === 'pass').map((check) => check.label);
const missing = checks
  .filter((check) => check.status === 'warn' || check.status === 'skip')
  .map((check) => check.label);
const failures = checks.filter((check) => check.status === 'fail').map((check) => check.label);
const report = {
  generated_at: new Date().toISOString(),
  ready,
  missing,
  failures,
  checks,
  next_steps: nextSteps,
  local_dev_ready: failures.length === 0,
  beta_tunnel_dogfood_ready:
    failures.length === 0 &&
    tokenConfigured &&
    !!publicBaseUrl &&
    isReadableFile(repoPath(BETA_OPENAPI_YAML)),
  production_cloud_ready: false
};

ensureDirectory(outDir);
writeJson(repoPath(reportDirRelative, 'report.json'), report);
writeText(
  repoPath(reportDirRelative, 'report.md'),
  markdownCheckList('Companion Beta Doctor', checks, nextSteps)
);

console.log('Companion Beta Doctor');
console.log('');
console.log('Ready:');
ready.slice(0, 12).forEach((item) => console.log('- ' + item));
if (ready.length > 12) console.log('- ' + String(ready.length - 12) + ' more checks passed');
console.log('');
console.log('Missing / Needs Attention:');
(missing.length ? missing : ['None']).forEach((item) => console.log('- ' + item));
console.log('');
console.log('Next:');
nextSteps.forEach((step, index) => console.log(String(index + 1) + '. ' + step));
console.log('');
console.log('Report: ' + reportDirRelative + '/report.md');

if (failures.length) {
  process.exit(1);
}
