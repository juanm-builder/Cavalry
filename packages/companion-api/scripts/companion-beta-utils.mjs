import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import yaml from 'js-yaml';

import { validateCompanionPublicBaseUrl } from '../src/server/cavalry-api/runtime.js';
import {
  COMPANION_PACKAGE_ROOT,
  packagePath,
  repoPath,
  resolvePackageInput
} from './companion-paths.mjs';

export { packagePath, repoPath } from './companion-paths.mjs';

export const BETA_OPENAPI_DIR = 'test-artifacts/companion-beta/openapi';
export const BETA_OPENAPI_YAML = BETA_OPENAPI_DIR + '/cavalry-gpt-actions.beta.openapi.yaml';
export const BETA_OPENAPI_JSON = BETA_OPENAPI_DIR + '/cavalry-gpt-actions.beta.openapi.json';
export const BETA_BUNDLE_DIR = 'test-artifacts/companion-beta-bundle';

export function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}

export function writeText(path, text) {
  ensureDirectory(resolve(path, '..'));
  writeFileSync(path, text, 'utf8');
  return path;
}

export function writeJson(path, value) {
  return writeText(path, JSON.stringify(value, null, 2) + '\n');
}

export function isReadableFile(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch (_error) {
    return false;
  }
}

export function chmodExecutable(path) {
  try {
    chmodSync(path, 0o755);
  } catch (_error) {
    // Best-effort for checked-in/generated helper scripts.
  }
}

export function tokenLikePattern() {
  return /(?:cavb_|sk-|pat_|ghp_|xox[baprs]-|ya29\.|eyJ)[A-Za-z0-9_.-]{8,}/;
}

export function containsTokenLikeSecret(value) {
  return tokenLikePattern().test(asString(value));
}

export function redactSecrets(value) {
  return asString(value)
    .replace(tokenLikePattern(), '[redacted-token]')
    .replace(/(Bearer\s+)[A-Za-z0-9_.:-]+/gi, '$1[redacted-token]');
}

export function validatePublicBaseUrlFromEnv(options = {}) {
  return validateCompanionPublicBaseUrl(process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL, {
    allowInsecureTunnel:
      options.allowInsecureTunnel === true ||
      process.env.CAVALRY_COMPANION_ALLOW_INSECURE_TUNNEL === '1',
    allowPrivateBaseUrl: options.allowPrivateBaseUrl
  });
}

export function runNodeScript(scriptPath, args = [], options = {}) {
  return spawnSync(process.execPath, [resolvePackageInput(scriptPath), ...args], {
    cwd: COMPANION_PACKAGE_ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, options.env || {})
  });
}

export function assertNoForbiddenGptEndpoints(specText) {
  const spec = asString(specText);
  const forbidden = [];
  if (
    /operationId:\s*.*(?:Apply|Delete|Archive|PostTransaction|CreatePostedTransaction)/i.test(spec)
  ) {
    forbidden.push('apply/delete/archive/post-like operationId');
  }
  if (/\/v1\/workbooks\/\{workbook_id\}\/transactions\s*:/m.test(spec)) {
    forbidden.push('direct transaction mutation path');
  }
  if (/\/apply\s*:/i.test(spec)) {
    forbidden.push('apply path');
  }
  if (/\/delete\s*:/i.test(spec) || /\/archive\s*:/i.test(spec)) {
    forbidden.push('delete/archive path');
  }
  return forbidden;
}

export function generateBetaOpenApiArtifacts(options = {}) {
  const publicBaseUrl = options.publicBaseUrl || validatePublicBaseUrlFromEnv(options);
  const sourcePath = packagePath('openapi/cavalry-gpt-actions.openapi.yaml');
  const outDir = repoPath(options.outDir || BETA_OPENAPI_DIR);
  const yamlPath = resolve(outDir, 'cavalry-gpt-actions.beta.openapi.yaml');
  const jsonPath = resolve(outDir, 'cavalry-gpt-actions.beta.openapi.json');
  const source = readText(sourcePath);
  const rewritten = source.replace(
    /servers:\n\s+- url:\s*.+\n/,
    'servers:\n  - url: ' + publicBaseUrl + '\n'
  );
  if (!rewritten.includes('servers:\n  - url: ' + publicBaseUrl)) {
    throw new Error('Could not rewrite OpenAPI server URL.');
  }
  const parsed = yaml.load(rewritten);
  if (!parsed || parsed.openapi !== '3.1.0') {
    throw new Error('Generated beta OpenAPI could not be parsed as OpenAPI 3.1.0.');
  }
  ensureDirectory(outDir);
  writeText(yamlPath, rewritten);
  writeJson(jsonPath, parsed);
  return {
    publicBaseUrl,
    sourcePath,
    outDir,
    yamlPath,
    jsonPath,
    yaml: rewritten,
    json: parsed
  };
}

export function validateGeneratedOpenApi(yamlPath) {
  const validate = runNodeScript(packagePath('scripts/validate-openapi.mjs'), [yamlPath]);
  if (validate.status !== 0) {
    throw new Error(asString(validate.stderr || validate.stdout) || 'OpenAPI validation failed.');
  }
  const sanity = runNodeScript(packagePath('scripts/openapi-action-sanity.mjs'), [yamlPath]);
  if (sanity.status !== 0) {
    throw new Error(asString(sanity.stderr || sanity.stdout) || 'OpenAPI action sanity failed.');
  }
  return { validate, sanity };
}

export function scanTextFilesForTokenLeaks(paths) {
  const leaks = [];
  paths.forEach((path) => {
    if (!isReadableFile(path)) {
      return;
    }
    const text = readText(path);
    if (containsTokenLikeSecret(text)) {
      leaks.push(path);
    }
  });
  return leaks;
}

export function markdownCheckList(title, checks, extras = []) {
  const lines = ['# ' + title, '', 'Generated at: `' + new Date().toISOString() + '`', ''];
  checks.forEach((check) => {
    const status =
      check.status === 'pass'
        ? 'PASS'
        : check.status === 'warn'
          ? 'WARN'
          : check.status === 'skip'
            ? 'SKIP'
            : 'FAIL';
    lines.push(
      '- ' + status + ': ' + check.label + (check.detail ? ' - ' + redactSecrets(check.detail) : '')
    );
  });
  if (extras.length) {
    lines.push('', '## Next Steps', '');
    extras.forEach((step, index) => {
      lines.push(String(index + 1) + '. ' + step);
    });
  }
  lines.push('');
  return lines.join('\n');
}
