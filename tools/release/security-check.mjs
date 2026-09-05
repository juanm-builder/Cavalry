import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reviewedDevelopmentAdvisories = new Map([
  [
    1124334,
    Object.freeze({
      packageName: 'brace-expansion',
      expiresAt: '2026-10-01T00:00:00.000Z'
    })
  ]
]);

export const knownReceiptSha256 =
  '0f0a805b2c93e3c82ebb0c00c91de6ff8a20eb23a3665b74390b1a48f611d9b3';

const allowedEmbeddedImages = new Map([
  [
    'apps/mac/src/renderer/assets/institution-logos/cimb.svg',
    new Set([
      'e7d21436a34f67320ca9d858feb15a4bb7338bb639b9ff7f2108e5432e4c4ad9',
      'f49f3b51d87aa0c3b2d2390896f23b0b8093771f3927f2151ef56410c01e45d1',
      '0a6ce91fe9ce0194d4aa1f8523dd27e822d7b6c43d10989aff2da35fe387974c',
      '55f96ade00ea28523f8641db0b8dbc3acbfbbc5774969f059e7b59e758bb899f'
    ])
  ],
  [
    'apps/desktop/src/renderer/assets/institution-logos/cimb.svg',
    new Set([
      'e7d21436a34f67320ca9d858feb15a4bb7338bb639b9ff7f2108e5432e4c4ad9',
      'f49f3b51d87aa0c3b2d2390896f23b0b8093771f3927f2151ef56410c01e45d1',
      '0a6ce91fe9ce0194d4aa1f8523dd27e822d7b6c43d10989aff2da35fe387974c',
      '55f96ade00ea28523f8641db0b8dbc3acbfbbc5774969f059e7b59e758bb899f'
    ])
  ],
  [
    'apps/mac/scripts/advisor-live-smoke.mjs',
    new Set(['88ae895f28730657472360cf14da61edf6d2d54a81043a58e983f0db160423e4'])
  ],
  [
    'apps/desktop/scripts/advisor-live-smoke.mjs',
    new Set(['88ae895f28730657472360cf14da61edf6d2d54a81043a58e983f0db160423e4'])
  ]
]);

const allowedFindingFingerprints = new Map([
  // Historical negative URL tests used synthetic user/pass placeholders. Keep
  // their exact file/content fingerprints; history scanning includes old tests.
  [
    'apps/desktop/tests/host/cloudkit-web-api.test.js',
    new Set(['credential-bearing URL:sha256:d982d6437e0badda'])
  ],
  [
    'apps/desktop/tests/host/cloudkit-web-library.test.js',
    new Set(['credential-bearing URL:sha256:1010b1c24b1f7b22'])
  ],
  [
    // Historical callback rejection fixture containing synthetic credentials.
    'apps/desktop/tests/host/cloudkit-browser-page.test.js',
    new Set(['credential-bearing URL:sha256:21fb3e3e18b78c9d'])
  ],
  [
    'apps/mac/tests/electron/in-app-advisor-ipc.test.js',
    new Set(['OpenAI secret key:sha256:d0037c92ccd6857f'])
  ],
  [
    'apps/desktop/tests/host/in-app-advisor-ipc.test.js',
    new Set(['OpenAI secret key:sha256:d0037c92ccd6857f'])
  ],
  [
    'apps/mac/tests/electron/advisor-runtime-controller.test.js',
    new Set([
      'local user path:sha256:5754d5fb68617b6a',
      'local user path:sha256:c8805d1b7d27eda1',
      'local user path:sha256:a95ed35b26f48abb'
    ])
  ],
  [
    'apps/desktop/tests/host/advisor-runtime-controller.test.js',
    new Set([
      'local user path:sha256:5754d5fb68617b6a',
      'local user path:sha256:c8805d1b7d27eda1',
      'local user path:sha256:a95ed35b26f48abb'
    ])
  ]
]);

const secretPatterns = [
  {
    name: 'private key',
    pattern: /-----BEGIN (?:ENCRYPTED |RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g
  },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    name: 'GitHub token',
    pattern: /\b(?:github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{36,})\b/g
  },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  {
    name: 'OpenAI secret key',
    pattern: /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,}\b/g
  },
  { name: 'Anthropic secret key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'npm access token', pattern: /\bnpm_[A-Za-z0-9]{36,}\b/g },
  { name: 'Stripe live key', pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}\b/g },
  {
    name: 'SendGrid API key',
    pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g
  },
  { name: 'Twilio API key', pattern: /\bSK[0-9a-fA-F]{32}\b/g },
  {
    name: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
  },
  {
    name: 'Basic authorization credential',
    pattern: /\bBasic\s+([A-Za-z0-9+/]{12,}={0,2})(?=$|[\s"'`,;)}\]])/gi,
    validator(match) {
      const encoded = match[1];
      const decoded = Buffer.from(encoded, 'base64');
      const canonical = decoded.toString('base64').replace(/=+$/, '');
      if (canonical !== encoded.replace(/=+$/, '')) return false;
      return /^[\x20-\x7e]+:[\x20-\x7e]+$/.test(decoded.toString('utf8'));
    }
  },
  {
    name: 'credential-bearing URL',
    pattern:
      /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi
  },
  {
    name: 'Discord webhook credential',
    pattern:
      /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi
  }
];

const hardCodedCredentialPattern =
  /\b(api[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key|service[_-]?role[_-]?key|signing[_-]?key)\b\s*(?:=|:)\s*(["'])([^"'\r\n]{8,256})\2/gi;

const placeholderPattern =
  /(?:example|placeholder|change-?me|your[_-]|insert|replace|dummy|fake|fixture|test|mock|sample|redacted|masked|not[-_ ]set|api[-_ ]?key|secret[-_ ]?key|access[-_ ]?token|process\.env|import\.meta\.env|\$\{|<[^>]+>)/i;

const localPathPatterns = [
  /\/Users\/[A-Za-z0-9._-]+(?:\/|$)/g,
  /\/home\/[A-Za-z0-9._-]+(?:\/|$)/g,
  /[A-Za-z]:\\{1,2}Users\\{1,2}[A-Za-z0-9._-]+(?:\\{1,2}|$)/g
];

const historyCandidatePattern = [
  'BEGIN (ENCRYPTED |RSA |EC |OPENSSH |DSA )?PRIVATE KEY',
  '(AKIA|ASIA)[0-9A-Z]{16}',
  'github_pat_[A-Za-z0-9_]{40,}',
  'gh[pousr]_[A-Za-z0-9]{36,}',
  'AIza[0-9A-Za-z_-]{35}',
  'xox[baprs]-[A-Za-z0-9-]{20,}',
  'sk-((proj|svcacct)-)?[A-Za-z0-9_-]{20,}',
  'sk-ant-[A-Za-z0-9_-]{20,}',
  'npm_[A-Za-z0-9]{36,}',
  '[rs]k_live_[A-Za-z0-9]{16,}',
  'SG\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}',
  'SK[0-9a-fA-F]{32}',
  'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}',
  'Basic[[:space:]]+[A-Za-z0-9+/]{12,}',
  '(https?|postgres(ql)?|mysql|mongodb(\\+srv)?|redis)://[^[:space:]/:@]+:[^[:space:]/@]+@',
  'discord(app)?\\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+',
  `(api[_-]?key|secret([_-]?key)?|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key|service[_-]?role[_-]?key|signing[_-]?key)[[:space:]]*(=|:)[[:space:]]*["']`,
  'data:image/[A-Za-z0-9.+-]+;base64,',
  '/Users/[A-Za-z0-9._-]+/',
  '/home/[A-Za-z0-9._-]+/',
  '[A-Za-z]:\\\\Users\\\\[A-Za-z0-9._-]+\\\\'
].join('|');

function normalizePath(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function redactedFingerprint(value) {
  return `sha256:${sha256(value).slice(0, 16)}`;
}

function lineNumberAt(contents, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (contents.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

export function calculateEntropy(value) {
  if (!value.length) return 0;
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isTestOrFixturePath(relativePath) {
  return /(?:^|\/)(?:tests?|fixtures?|__tests__)(?:\/|$)/i.test(relativePath);
}

function isAllowedFinding(relativePath, rule, fingerprint) {
  return allowedFindingFingerprints.get(relativePath)?.has(`${rule}:${fingerprint}`);
}

function makeFinding(relativePath, rule, value, line) {
  const fingerprint = redactedFingerprint(value);
  if (isAllowedFinding(relativePath, rule, fingerprint)) return null;
  return { path: relativePath, rule, line, fingerprint };
}

function hasImageSignature(bytes, mediaType) {
  const type = mediaType.toLowerCase();
  if (type === 'png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (type === 'jpg' || type === 'jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === 'gif') {
    const signature = bytes.subarray(0, 6).toString('ascii');
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  if (type === 'webp') {
    return (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

export function scanEmbeddedImages(relativePath, contents) {
  const findings = [];
  const pattern = /data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\r\n]{32,})/gi;
  for (const match of contents.matchAll(pattern)) {
    const encoded = match[2].replace(/\s/g, '');
    if (encoded.length % 4 !== 0) continue;
    let bytes;
    try {
      bytes = Buffer.from(encoded, 'base64');
    } catch (_error) {
      continue;
    }
    if (!hasImageSignature(bytes, match[1])) continue;
    const digest = sha256(bytes);
    const line = lineNumberAt(contents, match.index);
    const classification = classifyEmbeddedImage(relativePath, digest);
    if (!classification) continue;
    findings.push({
      path: relativePath,
      rule: classification,
      line,
      fingerprint: `sha256:${digest.slice(0, 16)}`
    });
  }
  return findings;
}

export function classifyEmbeddedImage(relativePath, digest) {
  if (digest === knownReceiptSha256) return 'known sensitive receipt image';
  if (allowedEmbeddedImages.get(normalizePath(relativePath))?.has(digest)) return null;
  return 'unreviewed embedded data image';
}

export function scanText(relativePath, contents) {
  const normalizedPath = normalizePath(relativePath);
  const findings = [];
  for (const { name, pattern, validator } of secretPatterns) {
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      if (validator && !validator(match)) continue;
      const finding = makeFinding(
        normalizedPath,
        name,
        match[0],
        lineNumberAt(contents, match.index)
      );
      if (finding) findings.push(finding);
    }
  }

  hardCodedCredentialPattern.lastIndex = 0;
  for (const match of contents.matchAll(hardCodedCredentialPattern)) {
    const value = match[3].trim();
    if (placeholderPattern.test(value)) continue;
    const strictFixtureThreshold = isTestOrFixturePath(normalizedPath);
    if (strictFixtureThreshold && (value.length < 24 || calculateEntropy(value) < 4.25)) continue;
    const finding = makeFinding(
      normalizedPath,
      'hard-coded credential',
      value,
      lineNumberAt(contents, match.index)
    );
    if (finding) findings.push(finding);
  }

  for (const pattern of localPathPatterns) {
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      const finding = makeFinding(
        normalizedPath,
        'local user path',
        match[0],
        lineNumberAt(contents, match.index)
      );
      if (finding) findings.push(finding);
    }
  }

  findings.push(...scanEmbeddedImages(normalizedPath, contents));
  return findings;
}

export function isHighRiskPath(relativePath) {
  const normalizedPath = normalizePath(relativePath);
  const basename = normalizedPath.split('/').at(-1).toLowerCase();
  if (/^\.env(?:\.|$)/i.test(basename)) {
    return !/\.(?:example|sample|template)$/i.test(basename);
  }
  if (/^(?:\.npmrc|\.netrc|\.pypirc|credentials(?:\.json)?|id_rsa|id_ed25519)$/i.test(basename)) {
    return true;
  }
  if (/\.(?:pem|key|p8|p12|pfx|jks|keystore|mobileprovision)$/i.test(basename)) return true;
  if (/\.(?:db|sqlite|sqlite3|dump|dmp|rdb|sql\.gz)$/i.test(basename)) return true;
  if (/\.(?:log|har|crash|ips|stackdump)$/i.test(basename)) return true;
  if (/\.(?:bak|backup|orig|rej|swp|swo)$/i.test(basename)) return true;
  if (/\.(?:zip|7z|rar|tar|tgz|gz|dmg|exe|asar)$/i.test(basename)) return true;
  if (/\.cavalry-(?:workbook|backup)\.html$/i.test(basename)) return true;
  return /(?:^|\/)(?:\.secrets|secrets\.local|crashpad)(?:\/|$)/i.test(normalizedPath);
}

function fail(message) {
  throw new Error(`Release security check failed: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  return result;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(workspaceRoot, relativePath), 'utf8'));
}

function checkDesktopRuntime() {
  const manifest = readJson('apps/desktop/package.json');
  const lockfile = readJson('package-lock.json');
  const forbidden = new Set(['electron', 'electron-builder', 'electron-updater']);
  for (const name of [
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {})
  ]) {
    if (forbidden.has(name)) fail(`legacy Electron dependency remains: ${name}.`);
  }
  for (const lockPath of Object.keys(lockfile.packages || {})) {
    if (/^node_modules\/(?:electron|electron-builder|electron-updater)$/.test(lockPath)) {
      fail(`legacy Electron lock entry remains: ${lockPath}.`);
    }
  }
  if (lockfile.packages?.['apps/desktop']?.name !== '@cavalry/desktop') {
    fail('package-lock.json does not contain the Tauri desktop workspace.');
  }

  const capability = readJson('apps/desktop/src-tauri/capabilities/main.json');
  const permissionNames = (capability.permissions || []).map((permission) =>
    String(typeof permission === 'string' ? permission : permission && permission.identifier)
  );
  if (permissionNames.some((permission) => permission.startsWith('shell:'))) {
    fail('the renderer capability grants direct shell access.');
  }
  if (permissionNames.some((permission) => permission.startsWith('process:'))) {
    fail('the renderer capability grants direct process access.');
  }

  const releaseTemplate = readJson('apps/desktop/src-tauri/tauri.release.template.json');
  if (releaseTemplate.plugins?.updater?.pubkey !== '__CAVALRY_UPDATER_PUBLIC_KEY__') {
    fail('the tracked release template must not contain a real updater key.');
  }
  if (releaseTemplate.bundle?.createUpdaterArtifacts !== true) {
    fail('production Tauri releases must create signed updater artifacts.');
  }
  process.stdout.write('Tauri runtime, capabilities, and signed-updater template are secure.\n');
}

function listWorkspaceFiles() {
  const result = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (result.status !== 0) fail(`git ls-files failed: ${result.stderr.trim()}`);
  return result.stdout.split('\0').filter(Boolean).map(normalizePath).filter(workspacePathExists);
}

function workspacePathExists(relativePath) {
  try {
    lstatSync(resolve(workspaceRoot, relativePath));
    return true;
  } catch (_error) {
    return false;
  }
}

function readWorkspaceText(relativePath) {
  const absolutePath = resolve(workspaceRoot, relativePath);
  try {
    const metadata = lstatSync(absolutePath);
    if (metadata.isSymbolicLink()) return readlinkSync(absolutePath, 'utf8');
    if (!metadata.isFile()) return null;
    const bytes = readFileSync(absolutePath);
    if (bytes.subarray(0, 8192).includes(0)) return null;
    return bytes.toString('utf8');
  } catch (_error) {
    return null;
  }
}

function formatFindings(findings) {
  return findings
    .map(
      ({ path, rule, line, fingerprint }) =>
        `${path}${line ? `:${line}` : ''} (${rule}, ${fingerprint || 'filename-only'})`
    )
    .join(', ');
}

export function checkWorkspaceContent() {
  const ignoredTracked = run('git', [
    'ls-files',
    '-z',
    '--cached',
    '--ignored',
    '--exclude-standard'
  ]);
  if (ignoredTracked.status !== 0) {
    fail(`could not check tracked ignored files: ${ignoredTracked.stderr.trim()}`);
  }
  const ignoredTrackedPaths = ignoredTracked.stdout
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter(workspacePathExists);
  if (ignoredTrackedPaths.length) {
    fail(`tracked files are hidden by .gitignore: ${ignoredTrackedPaths.join(', ')}.`);
  }

  const findings = [];
  for (const relativePath of listWorkspaceFiles()) {
    if (isHighRiskPath(relativePath)) {
      findings.push({ path: relativePath, rule: 'high-risk filename', line: 0 });
    }
    const contents = readWorkspaceText(relativePath);
    if (contents !== null) findings.push(...scanText(relativePath, contents));
  }
  if (findings.length) fail(`workspace findings: ${formatFindings(findings)}.`);
  process.stdout.write('Workspace secret, privacy, and filename checks passed.\n');
}

function checkFullClone() {
  const shallowResult = run('git', ['rev-parse', '--is-shallow-repository']);
  if (shallowResult.status !== 0) {
    fail(`could not determine Git history depth: ${shallowResult.stderr.trim()}`);
  }
  if (shallowResult.stdout.trim() === 'true') {
    fail('the history scan requires a full clone (set checkout fetch-depth to 0).');
  }
}

function revisionList() {
  const result = run('git', ['rev-list', '--all', 'HEAD']);
  if (result.status !== 0) fail(`could not enumerate Git revisions: ${result.stderr.trim()}`);
  return [...new Set(result.stdout.split(/\s+/).filter(Boolean))];
}

export function candidateHistoryFiles(revisions, runGit = run) {
  const candidates = new Map();
  const chunkSize = 64;
  for (let index = 0; index < revisions.length; index += chunkSize) {
    const chunk = revisions.slice(index, index + chunkSize);
    const result = runGit('git', [
      'grep',
      '-I',
      '-l',
      '-z',
      '-E',
      historyCandidatePattern,
      ...chunk,
      '--'
    ]);
    if (![0, 1].includes(result.status)) {
      fail(`Git history candidate scan failed: ${result.stderr.trim()}`);
    }
    const references = result.stdout.split('\0').filter(Boolean);
    for (let offset = 0; offset < references.length; offset += chunkSize) {
      const batch = references.slice(offset, offset + chunkSize);
      // Resolve multiple immutable commit:path references in one Git process.
      const objectResult = runGit('git', ['rev-parse', ...batch]);
      const objectIds = objectResult.stdout.trim().split(/\r?\n/);
      if (
        objectResult.status !== 0 ||
        objectIds.length !== batch.length ||
        objectIds.some((objectId) => !/^[0-9a-f]{40}$/.test(objectId))
      ) {
        fail('could not resolve Git history candidate objects.');
      }
      batch.forEach((reference, position) => {
        const match = /^([0-9a-f]{40}):([\s\S]+)$/.exec(reference);
        if (!match) fail('Git returned an invalid history candidate reference.');
        const [, commit, path] = match;
        const objectId = objectIds[position];
        if (!candidates.has(objectId)) candidates.set(objectId, new Map());
        const paths = candidates.get(objectId);
        const normalizedPath = normalizePath(path);
        // Allowances are path-specific, even when identical blobs are reused.
        if (!paths.has(normalizedPath)) paths.set(normalizedPath, commit);
      });
    }
  }
  return candidates;
}

export function checkGitHistory() {
  checkFullClone();
  const historicalPaths = run('git', [
    'log',
    '--all',
    '--format=',
    '--name-only',
    '--no-renames',
    '-z'
  ]);
  if (historicalPaths.status !== 0) {
    fail(`could not enumerate historical paths: ${historicalPaths.stderr.trim()}`);
  }
  const riskyHistoricalPaths = [
    ...new Set(
      historicalPaths.stdout.split('\0').filter(Boolean).map(normalizePath).filter(isHighRiskPath)
    )
  ];

  const findings = riskyHistoricalPaths.map((path) => ({
    path,
    rule: 'high-risk historical filename',
    line: 0
  }));
  const revisions = revisionList();
  for (const [objectId, paths] of candidateHistoryFiles(revisions)) {
    const blob = run('git', ['cat-file', 'blob', objectId], { encoding: null });
    if (blob.status !== 0) fail('could not read a Git history candidate object.');
    if (blob.stdout.subarray(0, 8192).includes(0)) continue;
    const contents = blob.stdout.toString('utf8');
    for (const [path, commit] of paths) {
      findings.push(
        ...scanText(path, contents).map((finding) => ({
          ...finding,
          path: `${finding.path}@${commit.slice(0, 12)}`
        }))
      );
    }
  }

  const messages = run('git', ['log', '--all', '--format=%B%x00']);
  if (messages.status !== 0) fail(`could not scan commit messages: ${messages.stderr.trim()}`);
  for (const message of messages.stdout.split('\0').filter(Boolean)) {
    findings.push(...scanText('<commit-message>', message));
  }

  if (findings.length) fail(`Git history findings: ${formatFindings(findings)}.`);
  process.stdout.write(`Git history checks passed across ${revisions.length} reachable commits.\n`);
}

export function findWorkflowPinViolations(contents, relativePath = '<workflow>') {
  const violations = [];
  contents.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#\s*(v[^\s]+))?\s*$/.exec(line);
    if (!match || match[1].startsWith('./')) return;
    const reference = match[1].split('@')[1] || '';
    if (!/^[0-9a-f]{40}$/.test(reference)) {
      violations.push(`${relativePath}:${index + 1} must pin uses: to a full commit SHA`);
    }
    if (!match[2]) {
      violations.push(`${relativePath}:${index + 1} must retain an inline version comment`);
    }
  });
  return violations;
}

function checkWorkflowSecurity() {
  const workflowsDirectory = resolve(workspaceRoot, '.github/workflows');
  const violations = [];
  for (const name of readdirSync(workflowsDirectory)) {
    if (!['.yml', '.yaml'].includes(extname(name))) continue;
    const path = resolve(workflowsDirectory, name);
    const relativePath = normalizePath(relative(workspaceRoot, path));
    const contents = readFileSync(path, 'utf8');
    violations.push(...findWorkflowPinViolations(contents, relativePath));
    if (/^\s*pull_request_target\s*:/m.test(contents)) {
      violations.push(`${relativePath} must not use pull_request_target`);
    }
    if (/^\s*permissions\s*:\s*write-all\s*$/m.test(contents)) {
      violations.push(`${relativePath} must not grant write-all permissions`);
    }
  }
  if (violations.length) fail(`workflow hardening violations: ${violations.join(', ')}.`);
  process.stdout.write('GitHub Actions use immutable pins and safe permission defaults.\n');
}

function parseAuditReport(auditResult, label) {
  try {
    return JSON.parse(auditResult.stdout || '{}');
  } catch (_error) {
    fail(`${label} returned invalid output: ${auditResult.stderr.trim()}`);
  }
}

function auditNodeIsDevelopmentOnly(node, lockfile) {
  return lockfile.packages?.[node]?.dev === true;
}

export function reviewDependencyAudit(report, lockfile, now = Date.now()) {
  const vulnerabilities =
    report?.vulnerabilities && typeof report.vulnerabilities === 'object'
      ? report.vulnerabilities
      : {};
  const blocked = [];
  const reviewedSources = new Set();

  function reviewVulnerability(name, ancestors = new Set()) {
    if (ancestors.has(name)) {
      return { ok: true, sources: new Set() };
    }
    const vulnerability = vulnerabilities[name];
    const nodes = Array.isArray(vulnerability?.nodes) ? vulnerability.nodes : [];
    const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
    if (
      !vulnerability ||
      !nodes.length ||
      !nodes.every((node) => auditNodeIsDevelopmentOnly(node, lockfile)) ||
      !via.length
    ) {
      return { ok: false, sources: new Set() };
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(name);
    const sources = new Set();
    for (const dependency of via) {
      if (typeof dependency === 'string') {
        const nested = reviewVulnerability(dependency, nextAncestors);
        if (!nested.ok) return { ok: false, sources: new Set() };
        for (const source of nested.sources) sources.add(source);
        continue;
      }
      const source = Number(dependency?.source);
      const reviewed = reviewedDevelopmentAdvisories.get(source);
      if (
        !reviewed ||
        dependency?.name !== reviewed.packageName ||
        now >= Date.parse(reviewed.expiresAt)
      ) {
        return { ok: false, sources: new Set() };
      }
      sources.add(source);
    }
    return { ok: true, sources };
  }

  for (const name of Object.keys(vulnerabilities)) {
    const result = reviewVulnerability(name);
    if (!result.ok || result.sources.size === 0) {
      blocked.push(name);
      continue;
    }
    for (const source of result.sources) reviewedSources.add(source);
  }

  return {
    ok: blocked.length === 0,
    blocked,
    reviewedSources: [...reviewedSources].sort((left, right) => left - right),
    vulnerabilityCount: Object.keys(vulnerabilities).length
  };
}

function checkDependencyAudit() {
  const auditResult = run('npm', ['audit', '--audit-level=low', '--json']);
  const report = parseAuditReport(auditResult, 'npm audit');
  const vulnerabilities = report.metadata?.vulnerabilities || {};
  const total = Number(vulnerabilities.total || 0);
  if (auditResult.status === 0 && total === 0) {
    process.stdout.write('npm audit found no dependency advisories.\n');
    return;
  }
  if (auditResult.status !== 1 || total === 0) {
    fail(
      `npm audit reported ${total} vulnerabilities ` +
        `(critical ${Number(vulnerabilities.critical || 0)}, high ${Number(vulnerabilities.high || 0)}, ` +
        `moderate ${Number(vulnerabilities.moderate || 0)}, low ${Number(vulnerabilities.low || 0)}).`
    );
  }

  const lockfile = readJson('package-lock.json');
  const review = reviewDependencyAudit(report, lockfile);
  if (!review.ok) {
    fail(
      `npm audit reported unreviewed dependency findings in: ${review.blocked.join(', ') || 'unknown packages'}.`
    );
  }

  const productionResult = run('npm', ['audit', '--omit=dev', '--audit-level=low', '--json']);
  const productionReport = parseAuditReport(productionResult, 'production npm audit');
  const productionVulnerabilities = productionReport.metadata?.vulnerabilities || {};
  if (productionResult.status !== 0 || Number(productionVulnerabilities.total || 0) > 0) {
    fail(
      `production npm audit reported ${Number(productionVulnerabilities.total || 0)} vulnerabilities.`
    );
  }
  process.stdout.write(
    `npm audit found zero production advisories and only reviewed, development-only ` +
      `advisory sources ${review.reviewedSources.join(', ')} across ${review.vulnerabilityCount} affected packages.\n`
  );
}

export function runSecurityChecks({ contentOnly = false } = {}) {
  checkWorkspaceContent();
  checkWorkflowSecurity();
  if (contentOnly) return;
  checkGitHistory();
  checkDesktopRuntime();
  checkDependencyAudit();
  process.stdout.write('Release security checks passed.\n');
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  try {
    runSecurityChecks({ contentOnly: process.argv.includes('--content-only') });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
