import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '../..');
const SOURCE_PATTERN = /\.(?:cjs|mjs|js|jsx|rs)$/;
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'out',
  'target',
  'test-artifacts'
]);

const PACKAGE_RULES = Object.freeze({
  '@cavalry/finance-core': [],
  '@cavalry/action-review': ['@cavalry/finance-core'],
  '@cavalry/advisor': ['@cavalry/finance-core', '@cavalry/action-review'],
  '@cavalry/companion-api': ['@cavalry/finance-core', '@cavalry/action-review', '@cavalry/advisor'],
  '@cavalry/sync-foundation': ['@cavalry/finance-core', '@cavalry/action-review']
});

const PACKAGE_PATHS = Object.freeze({
  '@cavalry/finance-core': 'packages/finance-core/src/',
  '@cavalry/action-review': 'packages/action-review/src/',
  '@cavalry/advisor': 'packages/advisor/src/',
  '@cavalry/companion-api': 'packages/companion-api/src/',
  '@cavalry/sync-foundation': 'packages/sync-foundation/src/'
});

function posix(value) {
  return String(value || '').replace(/\\/g, '/');
}

export function readText(root, filePath) {
  return readFileSync(path.resolve(root, filePath), 'utf8');
}

function listFilesBelow(root, relativeDirectory) {
  const absoluteDirectory = path.resolve(root, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const relativePath = posix(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) return listFilesBelow(root, relativePath);
    return entry.isFile() ? [relativePath] : [];
  });
}

export function listTrackedFiles(root = WORKSPACE_ROOT) {
  const result = spawnSync('git', ['ls-files', '--full-name'], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) {
    return result.stdout.split(/\r?\n/).map(posix).filter(Boolean).sort();
  }
  return listFilesBelow(root, '.')
    .map((file) => file.replace(/^\.\//, ''))
    .sort();
}

export function listSourceFiles(root = WORKSPACE_ROOT, prefixes = ['apps/', 'packages/']) {
  return prefixes
    .flatMap((prefix) => listFilesBelow(root, prefix))
    .filter((file) => SOURCE_PATTERN.test(file))
    .sort();
}

export function extractImportSpecifiers(source) {
  const values = [];
  const patterns = [
    /\bimport\s+(?:[^'";]+?\s+from\s*)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'";]+?\s+from\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match) {
      values.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return [...new Set(values)];
}

function executableSource(source) {
  return String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '');
}

function packageForFile(file) {
  return Object.entries(PACKAGE_PATHS).find(([, prefix]) => file.startsWith(prefix))?.[0] || '';
}

function importedWorkspacePackage(specifier) {
  return (
    Object.keys(PACKAGE_RULES).find(
      (name) => specifier === name || specifier.startsWith(`${name}/`)
    ) || ''
  );
}

export function getWorkspaceBoundaryViolations(root = WORKSPACE_ROOT) {
  const violations = [];
  for (const file of listSourceFiles(root, ['packages/'])) {
    const owner = packageForFile(file);
    if (!owner) continue;
    const source = readText(root, file);
    for (const specifier of extractImportSpecifiers(source)) {
      const dependency = importedWorkspacePackage(specifier);
      if (dependency && dependency !== owner && !PACKAGE_RULES[owner].includes(dependency)) {
        violations.push({
          file,
          owner,
          dependency,
          specifier,
          reason: 'forbidden-package-direction'
        });
      }
      const nodeImport = BUILTINS.has(specifier) || BUILTINS.has(specifier.replace(/^node:/, ''));
      const nodeAllowed =
        owner === '@cavalry/companion-api' || file.includes('/infrastructure/node/');
      if (nodeImport && !nodeAllowed) {
        violations.push({ file, owner, dependency: 'node', specifier, reason: 'platform-import' });
      }
      if (['@tauri-apps/api', 'react', 'react-dom', 'electron'].includes(specifier)) {
        violations.push({
          file,
          owner,
          dependency: specifier,
          specifier,
          reason: 'ui-platform-import'
        });
      }
    }
    if (/\b(?:window|document|localStorage|indexedDB)\b/.test(executableSource(source))) {
      violations.push({
        file,
        owner,
        dependency: 'browser-global',
        specifier: '',
        reason: 'browser-global'
      });
    }
  }
  return violations.sort((a, b) =>
    `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`)
  );
}

export function getRendererBoundaryViolations(root = WORKSPACE_ROOT) {
  const violations = [];
  for (const file of listSourceFiles(root, ['apps/desktop/src/renderer/features/'])) {
    const source = readText(root, file);
    for (const specifier of extractImportSpecifiers(source)) {
      const bareBuiltin = specifier.replace(/^node:/, '');
      const resolved = specifier.startsWith('.')
        ? posix(path.relative(root, path.resolve(root, path.dirname(file), specifier)))
        : '';
      if (BUILTINS.has(specifier) || BUILTINS.has(bareBuiltin) || specifier === 'electron') {
        violations.push({ file, specifier, reason: 'platform-import' });
      }
      if (
        /(?:^|\/)src\/(?:host|preload|server|src-tauri)(?:\/|$)/.test(specifier) ||
        /^apps\/desktop\/src\/(?:host|preload|server|src-tauri)(?:\/|$)/.test(resolved) ||
        specifier.startsWith('@cavalry/companion-api/server/')
      ) {
        violations.push({ file, specifier, reason: 'privileged-layer-import' });
      }
    }
    if (/\b(?:window\.__TAURI__|window\.cavalry\w*)\b/.test(source)) {
      violations.push({ file, specifier: 'desktop platform global', reason: 'platform-global' });
    }
  }
  return violations.sort((a, b) =>
    `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`)
  );
}

export function getTrackedGeneratedFiles(root = WORKSPACE_ROOT) {
  const allowed = new Set([
    'package-lock.json',
    'packages/companion-api/openapi/cavalry-gpt-actions.openapi.yaml'
  ]);
  return listTrackedFiles(root).filter((file) => {
    if (allowed.has(file)) return false;
    return (
      /(^|\/)(?:dist|coverage|out|target|test-artifacts|node_modules)\//.test(file) ||
      /apps\/desktop\/src-tauri\/binaries\/cavalry-host-/.test(file) ||
      /apps\/desktop\/src-tauri\/tauri\.release\.conf\.json$/.test(file) ||
      /\.(?:gguf|safetensors|onnx|pt|pth|mlmodel|log)$/.test(file)
    );
  });
}

function countLines(root, file) {
  if (!existsSync(path.resolve(root, file))) return 0;
  return readText(root, file).split(/\r?\n/).length;
}

function largestFile(root, files) {
  return files.reduce(
    (largest, file) => {
      const loc = countLines(root, file);
      return loc > largest.loc ? { file, loc } : largest;
    },
    { file: '', loc: 0 }
  );
}

export function collectArchitectureReport(root = WORKSPACE_ROOT) {
  const rendererFiles = listSourceFiles(root, ['apps/desktop/src/renderer/']);
  const featureFiles = rendererFiles.filter((file) => file.includes('/features/'));
  const hostFiles = listSourceFiles(root, ['apps/desktop/src/host/']);
  const maintainedSourceFiles = listSourceFiles(root, ['apps/', 'packages/', 'tools/', 'tests/']);
  return {
    boundaryViolations: getWorkspaceBoundaryViolations(root),
    rendererBoundaryViolations: getRendererBoundaryViolations(root),
    trackedGeneratedFiles: getTrackedGeneratedFiles(root),
    desktopHostLoc: countLines(root, 'apps/desktop/src/host/index.cjs'),
    rustHostLoc: countLines(root, 'apps/desktop/src-tauri/src/lib.rs'),
    largestHostModule: largestFile(root, hostFiles),
    largestRendererModule: largestFile(root, rendererFiles),
    cwdDependentFiles: maintainedSourceFiles.filter((file) =>
      /\bprocess\.cwd\s*\(/.test(readText(root, file))
    ),
    reactRootCalls: rendererFiles.reduce(
      (count, file) => count + (readText(root, file).match(/\bcreateRoot\s*\(/g) || []).length,
      0
    ),
    routeRegistryFiles: rendererFiles.filter((file) =>
      /\bNAVIGATION_ROUTES\s*=/.test(readText(root, file))
    ),
    rawPlatformGlobalFiles: featureFiles.filter((file) =>
      /\b(?:window\.__TAURI__|window\.cavalry\w*)\b/.test(readText(root, file))
    ),
    unsafeHtmlSites: rendererFiles.reduce(
      (count, file) =>
        count + (readText(root, file).match(/dangerouslySetInnerHTML/g) || []).length,
      0
    ),
    tauriBridgeFiles: rendererFiles.filter((file) => file.includes('/platform/tauri-')),
    sidecarProtocolFiles: hostFiles.filter((file) => file.includes('/runtime/'))
  };
}

export function formatArchitectureReport(report) {
  return [
    '# Cavalry Workspace Architecture Report',
    '',
    `workspace boundary violations: ${report.boundaryViolations.length}`,
    ...report.boundaryViolations.map(
      (entry) => `  - ${entry.file}: ${entry.reason} (${entry.specifier || entry.dependency})`
    ),
    `renderer boundary violations: ${report.rendererBoundaryViolations.length}`,
    ...report.rendererBoundaryViolations.map(
      (entry) => `  - ${entry.file}: ${entry.reason} (${entry.specifier})`
    ),
    `Node desktop host LOC: ${report.desktopHostLoc}`,
    `Rust Tauri host LOC: ${report.rustHostLoc}`,
    `largest host module: ${report.largestHostModule.file} (${report.largestHostModule.loc} LOC)`,
    `largest renderer module: ${report.largestRendererModule.file} (${report.largestRendererModule.loc} LOC)`,
    `Tauri renderer bridge modules: ${report.tauriBridgeFiles.length}`,
    `sidecar protocol modules: ${report.sidecarProtocolFiles.length}`,
    `cwd-dependent source files: ${report.cwdDependentFiles.length}`,
    `React root calls: ${report.reactRootCalls}`,
    `renderer route registries: ${report.routeRegistryFiles.length}`,
    `feature platform-global imports: ${report.rawPlatformGlobalFiles.length}`,
    `unsafe HTML sites: ${report.unsafeHtmlSites}`,
    `tracked generated files: ${report.trackedGeneratedFiles.length}`
  ].join('\n');
}

export function main(root = WORKSPACE_ROOT) {
  process.stdout.write(`${formatArchitectureReport(collectArchitectureReport(root))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
