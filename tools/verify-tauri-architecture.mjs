import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = resolve(root, 'apps/desktop');
const failures = [];
const execFileAsync = promisify(execFile);

async function text(file) {
  return readFile(resolve(root, file), 'utf8');
}
function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}
async function walk(directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'target', '.git', 'gen'].includes(entry.name)) continue;
    const filePath = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(filePath, results);
    else results.push(filePath);
  }
  return results;
}
function permissionName(value) {
  return String(
    typeof value === 'string' ? value : value && value.identifier ? value.identifier : ''
  );
}

const rootPackage = JSON.parse(await text('package.json'));
const appPackage = JSON.parse(await text('apps/desktop/package.json'));
const lockfile = JSON.parse(await text('package-lock.json'));
const tauriConfig = JSON.parse(await text('apps/desktop/src-tauri/tauri.conf.json'));
const bundleConfig = JSON.parse(await text('apps/desktop/src-tauri/tauri.bundle.conf.json'));
const releaseTemplate = JSON.parse(
  await text('apps/desktop/src-tauri/tauri.release.template.json')
);
const macConfig = JSON.parse(await text('apps/desktop/src-tauri/tauri.macos.conf.json'));
const entitlements = await text('apps/desktop/src-tauri/entitlements.plist');
const releaseEntitlements = await text('apps/desktop/src-tauri/entitlements.release.plist');
const sidecarEntitlements = await text('apps/desktop/src-tauri/entitlements.sidecar.plist');
const codesignShim = await text('apps/desktop/scripts/macos-codesign-shim/codesign');
const capability = JSON.parse(await text('apps/desktop/src-tauri/capabilities/main.json'));
const cargo = await text('apps/desktop/src-tauri/Cargo.toml');
const rustHost = await text('apps/desktop/src-tauri/src/lib.rs');
const hostIndex = await text('apps/desktop/src/host/index.cjs');
const rendererMain = await text('apps/desktop/src/renderer/main.jsx');
const rendererBroker = await text('apps/desktop/src/renderer/platform/tauri-host-broker.js');

requireCondition(
  rootPackage.scripts.dev.includes('@cavalry/desktop'),
  'Root dev script must target @cavalry/desktop.'
);
requireCondition(appPackage.name === '@cavalry/desktop', 'Desktop workspace name is incorrect.');
requireCondition(
  lockfile.packages?.['apps/desktop']?.name === '@cavalry/desktop',
  'package-lock.json is not aligned with apps/desktop.'
);
requireCondition(!lockfile.packages?.['apps/mac'], 'The legacy apps/mac lockfile entry remains.');

for (const name of [
  ...Object.keys(appPackage.dependencies || {}),
  ...Object.keys(appPackage.devDependencies || {})
]) {
  requireCondition(
    !['electron', 'electron-builder', 'electron-updater'].includes(name),
    `Electron package remains declared: ${name}`
  );
}
for (const lockPath of Object.keys(lockfile.packages || {})) {
  requireCondition(
    !/^node_modules\/(?:electron|electron-builder|electron-updater)$/.test(lockPath),
    `Electron lock entry remains: ${lockPath}`
  );
}

requireCondition(
  tauriConfig.app?.withGlobalTauri === true,
  'Tauri global APIs must be explicitly enabled for the renderer bridge.'
);
requireCondition(
  Array.isArray(bundleConfig.bundle?.externalBin) &&
    bundleConfig.bundle.externalBin.includes('binaries/cavalry-host'),
  'Tauri bundle config must include the named Cavalry host sidecar.'
);
requireCondition(
  releaseTemplate.bundle?.createUpdaterArtifacts === true &&
    releaseTemplate.plugins?.updater?.pubkey === '__CAVALRY_UPDATER_PUBLIC_KEY__',
  'The signed updater release template is missing or unsafe.'
);
requireCondition(
  releaseTemplate.bundle?.macOS?.entitlements === 'entitlements.release.plist' &&
    releaseTemplate.bundle?.macOS?.infoPlist === 'Info.release.plist' &&
    releaseTemplate.bundle?.macOS?.files?.['embedded.provisionprofile'] ===
      'Cavalry.provisionprofile',
  'The signed release must embed its CloudKit provisioning profile.'
);
requireCondition(
  tauriConfig.plugins?.['deep-link']?.desktop?.schemes?.includes('cavalry'),
  'cavalry:// deep-link scheme is missing.'
);
requireCondition(
  macConfig.identifier === 'com.juanmbuilder.cavalry.mac' &&
    tauriConfig.identifier === 'com.juanmbuilder.cavalry.mac',
  "The macOS bundle identity is not in Cavalry's Apple namespace."
);
requireCondition(
  entitlements.includes('iCloud.com.juanmbuilder.cavalry') &&
    entitlements.includes('U8H23USGUJ.com.juanmbuilder.cavalry.mac') &&
    entitlements.includes('com.apple.developer.team-identifier') &&
    entitlements.includes(
      'com.apple.developer.icloud-container-development-container-identifiers'
    ) &&
    entitlements.includes('com.apple.developer.icloud-services') &&
    entitlements.includes('<string>Development</string>') &&
    releaseEntitlements.includes('U8H23USGUJ.com.juanmbuilder.cavalry.mac') &&
    releaseEntitlements.includes('com.apple.developer.team-identifier') &&
    releaseEntitlements.includes('iCloud.com.juanmbuilder.cavalry') &&
    releaseEntitlements.includes('<string>Production</string>') &&
    releaseEntitlements.includes('<string>production</string>'),
  'The shared Cavalry CloudKit container entitlement is missing.'
);
requireCondition(
  sidecarEntitlements.includes('com.apple.security.cs.allow-jit') &&
    sidecarEntitlements.includes('com.apple.security.cs.allow-unsigned-executable-memory') &&
    !sidecarEntitlements.includes('com.apple.developer.icloud'),
  'The host sidecar must have only its dedicated JIT entitlements.'
);
requireCondition(
  codesignShim.includes('entitlements.sidecar.plist') &&
    codesignShim.includes('is_signing') &&
    codesignShim.includes('"--sign"') &&
    appPackage.scripts['tauri:build:mac'].includes('macos-codesign-shim') &&
    appPackage.scripts['tauri:release:mac'].includes('macos-codesign-shim'),
  'Mac packaging must sign the host sidecar with its dedicated entitlements.'
);
requireCondition(
  rustHost.includes('cavalry_cloudkit_request') &&
    existsSync(resolve(root, 'apps/desktop/src-tauri/src/cloudkit/CavalryCloudKitStore.swift')),
  'The native CloudKit bridge is missing.'
);
requireCondition(
  cargo.includes('tauri-plugin-shell'),
  'Rust shell plugin is required for the trusted host sidecar.'
);
requireCondition(
  rustHost.includes('host_invoke'),
  'Rust does not expose the bounded host command.'
);
requireCondition(
  rustHost.includes('CAVALRY_IPC_V1:'),
  'Rust and the Node host are not using the versioned protocol.'
);
requireCondition(
  hostIndex.includes('Cavalry desktop host sidecar'),
  'Node host composition root is missing.'
);
requireCondition(
  rendererMain.includes('createTauriBridge'),
  'Renderer is not connected to the Tauri bridge.'
);
requireCondition(
  rendererBroker.includes("core.invoke('host_invoke'"),
  'Renderer bypasses the Rust-owned host boundary.'
);
requireCondition(
  !rendererBroker.includes('Command.sidecar'),
  'Renderer must not launch the host sidecar directly.'
);
requireCondition(
  !capability.permissions.some((permission) => permissionName(permission).startsWith('shell:')),
  'Renderer capabilities must not grant shell execution.'
);
requireCondition(
  !capability.permissions.some((permission) => permissionName(permission).startsWith('process:')),
  'Renderer capabilities must not grant process execution.'
);

for (const removedPath of [
  'apps/mac',
  'apps/desktop/src/preload',
  'apps/desktop/electron-builder.yml',
  'apps/desktop/electron-builder.release.yml',
  'apps/desktop/electron-builder.windows.yml',
  'apps/desktop/src-tauri/tauri.windows.conf.json',
  'apps/desktop/vite.main.config.mjs',
  'apps/desktop/vite.preload.config.mjs'
]) {
  requireCondition(
    !existsSync(resolve(root, removedPath)),
    `Legacy Electron artifact remains: ${removedPath}`
  );
}

const files = await walk(desktop);
for (const file of files) {
  const rel = relative(root, file);
  if (!/\.(?:c?js|mjs|jsx|json|md|toml|yml|yaml)$/.test(file)) continue;
  const body = await readFile(file, 'utf8').catch(() => '');
  requireCondition(
    !/require\(['"]electron['"]\)|from ['"]electron['"]/.test(body),
    `Electron runtime import remains in ${rel}.`
  );
}

const generatedArtifacts = [
  'apps/desktop/dist',
  'apps/desktop/src-tauri/target',
  'apps/desktop/src-tauri/gen',
  'apps/desktop/src-tauri/tauri.release.generated.json'
];
const { stdout: trackedGeneratedOutput } = await execFileAsync('git', [
  'ls-files',
  '--',
  ...generatedArtifacts
]);
const trackedGenerated = trackedGeneratedOutput.split('\n').filter(Boolean);

for (const generated of generatedArtifacts) {
  requireCondition(
    !trackedGenerated.some((file) => file === generated || file.startsWith(`${generated}/`)),
    `Generated build artifact is tracked: ${generated}`
  );
}

if (failures.length) {
  console.error('Tauri architecture verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Tauri architecture verification passed (${files.length} desktop files inspected).`);
}
