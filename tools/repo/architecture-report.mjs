import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '../..');
const SOURCE_PATTERN = /\.(?:cjs|mjs|js|jsx)$/;
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

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

export function listTrackedFiles(root = WORKSPACE_ROOT) {
  const result = spawnSync('git', ['ls-files', '--full-name'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      String(result.stderr || result.stdout || 'Unable to list tracked files.').trim()
    );
  }
  return result.stdout.split(/\r?\n/).map(posix).filter(Boolean).sort();
}

function listFilesBelow(root, relativeDirectory) {
  const absoluteDirectory = path.resolve(root, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];

  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = posix(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage', 'out', 'test-artifacts'].includes(entry.name)) {
        return [];
      }
      return listFilesBelow(root, relativePath);
    }
    return entry.isFile() ? [relativePath] : [];
  });
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
  patterns.forEach((pattern) => {
    let match = pattern.exec(source);
    while (match) {
      values.push(match[1]);
      match = pattern.exec(source);
    }
  });
  return Array.from(new Set(values));
}

function executableSource(source) {
  let result = '';
  let state = 'code';
  let quote = '';
  let escaping = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || '';
    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
        result += '\n';
      } else result += ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  ';
        index += 1;
        state = 'code';
      } else result += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'string') {
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === quote) state = 'code';
      result += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (char === '/' && next === '/') {
      result += '  ';
      index += 1;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      result += '  ';
      index += 1;
      state = 'block-comment';
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
      state = 'string';
      result += ' ';
    } else {
      result += char;
    }
  }
  return result;
}

function packageForFile(file) {
  return Object.entries(PACKAGE_PATHS).find(([, prefix]) => file.startsWith(prefix))?.[0] || '';
}

function importedWorkspacePackage(specifier) {
  return (
    Object.keys(PACKAGE_RULES).find(
      (packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`)
    ) || ''
  );
}

export function getWorkspaceBoundaryViolations(root = WORKSPACE_ROOT) {
  const violations = [];
  listSourceFiles(root, ['packages/']).forEach((file) => {
    const owner = packageForFile(file);
    if (!owner) return;
    const source = readText(root, file);
    extractImportSpecifiers(source).forEach((specifier) => {
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
      if (specifier === 'electron' || specifier === 'react' || specifier === 'react-dom') {
        violations.push({
          file,
          owner,
          dependency: specifier,
          specifier,
          reason: 'ui-platform-import'
        });
      }
    });
    if (/\b(?:window|document|localStorage|indexedDB)\b/.test(executableSource(source))) {
      violations.push({
        file,
        owner,
        dependency: 'browser-global',
        specifier: '',
        reason: 'browser-global'
      });
    }
  });
  return violations.sort((a, b) =>
    `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`)
  );
}

export function getRendererBoundaryViolations(root = WORKSPACE_ROOT) {
  const violations = [];
  listSourceFiles(root, ['apps/mac/src/renderer/features/']).forEach((file) => {
    const source = readText(root, file);
    extractImportSpecifiers(source).forEach((specifier) => {
      const bareBuiltin = specifier.replace(/^node:/, '');
      const resolvedRelative = specifier.startsWith('.')
        ? posix(path.relative(root, path.resolve(root, path.dirname(file), specifier)))
        : '';
      if (BUILTINS.has(specifier) || BUILTINS.has(bareBuiltin) || specifier === 'electron') {
        violations.push({ file, specifier, reason: 'platform-import' });
      }
      if (
        /(?:^|\/)src\/(?:main|preload|server)(?:\/|$)/.test(specifier) ||
        /^apps\/mac\/src\/(?:main|preload|server)(?:\/|$)/.test(resolvedRelative) ||
        specifier.startsWith('@cavalry/companion-api/server/')
      ) {
        violations.push({ file, specifier, reason: 'privileged-layer-import' });
      }
    });
    if (/\bwindow\.cavalry(?:Files|Advisor|Companion)\b/.test(source)) {
      violations.push({ file, specifier: 'window.cavalry*', reason: 'platform-global' });
    }
  });
  return violations.sort((a, b) =>
    `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`)
  );
}

function extractBalancedObject(source, objectStart) {
  let depth = 0;
  let quote = '';
  let escaping = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return source.slice(objectStart, index + 1);
  }
  return '';
}

export function getPreloadApiSurface(root = WORKSPACE_ROOT) {
  const preloadPath = 'apps/mac/src/preload/index.cjs';
  const source = readText(root, preloadPath);
  const exposures = [];
  const pattern = /contextBridge\.exposeInMainWorld\(\s*['"]([^'"]+)['"]\s*,/g;
  let match = pattern.exec(source);
  while (match) {
    const objectStart = source.indexOf('{', match.index);
    const objectSource = extractBalancedObject(source, objectStart);
    const methods = Array.from(objectSource.matchAll(/(?:^|[\n,{])\s*([A-Za-z_$][\w$]*)\s*:/g))
      .map((entry) => entry[1])
      .filter((name) => name !== 'type')
      .sort();
    exposures.push({ namespace: match[1], methods });
    match = pattern.exec(source);
  }
  return exposures.sort((a, b) => a.namespace.localeCompare(b.namespace));
}

export function getTrackedGeneratedFiles(root = WORKSPACE_ROOT) {
  const allowed = new Set([
    'package-lock.json',
    'packages/companion-api/openapi/cavalry-gpt-actions.openapi.yaml'
  ]);
  return listTrackedFiles(root).filter((file) => {
    if (allowed.has(file)) return false;
    return (
      /(^|\/)(?:dist|dist-renderer|coverage|test-artifacts|node_modules)\//.test(file) ||
      /(^|\/)app\.bundle\.js$/.test(file) ||
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
  const rendererFiles = listSourceFiles(root, ['apps/mac/src/renderer/']);
  const featureFiles = rendererFiles.filter((file) => file.includes('/features/'));
  const mainFiles = listSourceFiles(root, ['apps/mac/src/main/']);
  const maintainedSourceFiles = listSourceFiles(root, ['apps/', 'packages/', 'tools/', 'tests/']);
  return {
    boundaryViolations: getWorkspaceBoundaryViolations(root),
    rendererBoundaryViolations: getRendererBoundaryViolations(root),
    preloadApiSurface: getPreloadApiSurface(root),
    trackedGeneratedFiles: getTrackedGeneratedFiles(root),
    legacyAppLoc: countLines(root, 'apps/mac/src/renderer/legacy/legacy-app.js'),
    electronMainLoc: countLines(root, 'apps/mac/src/main/index.cjs'),
    largestMainModule: largestFile(root, mainFiles),
    largestNonLegacyRendererModule: largestFile(
      root,
      rendererFiles.filter((file) => !file.includes('/legacy/'))
    ),
    mountAdapters: rendererFiles.filter((file) => /-mount\.jsx$/.test(file)),
    compatibilityFiles: rendererFiles.filter((file) => file.includes('/compatibility/')),
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
      /\bwindow\.cavalry(?:Files|Advisor|Companion)\b/.test(readText(root, file))
    ),
    delegatedActionAttributeFiles: rendererFiles
      .filter((file) => !file.includes('/legacy/') && !file.includes('/compatibility/'))
      .filter((file) => /\bdata-(?:action|route)\b/.test(readText(root, file))),
    unsafeHtmlSites: rendererFiles.reduce(
      (count, file) =>
        count + (readText(root, file).match(/dangerouslySetInnerHTML/g) || []).length,
      0
    )
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
    `legacy renderer LOC: ${report.legacyAppLoc}`,
    `Electron main LOC: ${report.electronMainLoc}`,
    `largest main module: ${report.largestMainModule.file} (${report.largestMainModule.loc} LOC)`,
    `largest non-legacy renderer module: ${report.largestNonLegacyRendererModule.file} (${report.largestNonLegacyRendererModule.loc} LOC)`,
    `renderer mount adapters: ${report.mountAdapters.length}`,
    `renderer compatibility files: ${report.compatibilityFiles.length}`,
    `cwd-dependent source files: ${report.cwdDependentFiles.length}`,
    `React root calls: ${report.reactRootCalls}`,
    `renderer route registries: ${report.routeRegistryFiles.length}`,
    `feature platform-global imports: ${report.rawPlatformGlobalFiles.length}`,
    `feature delegated action attributes: ${report.delegatedActionAttributeFiles.length}`,
    `unsafe HTML sites: ${report.unsafeHtmlSites}`,
    `tracked generated files: ${report.trackedGeneratedFiles.length}`,
    'preload namespaces: ' + report.preloadApiSurface.map((entry) => entry.namespace).join(', ')
  ].join('\n');
}

export function main(root = WORKSPACE_ROOT) {
  process.stdout.write(`${formatArchitectureReport(collectArchitectureReport(root))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
