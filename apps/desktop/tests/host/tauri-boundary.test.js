import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = resolve(import.meta.dirname, '../..');
const readJson = (relativePath) =>
  JSON.parse(readFileSync(resolve(desktopRoot, relativePath), 'utf8'));

describe('Tauri desktop security and compatibility boundary', () => {
  it('bundles only the named Cavalry host sidecar', () => {
    const config = readJson('src-tauri/tauri.conf.json');
    const bundleConfig = readJson('src-tauri/tauri.bundle.conf.json');
    expect(bundleConfig.bundle.externalBin).toEqual(['binaries/cavalry-host']);
    expect(bundleConfig.bundle.resources).toContain(
      '../packaging/RUNTIME-DEPENDENCY-INVENTORY.txt'
    );
    expect(config.plugins['deep-link'].desktop.schemes).toEqual(['cavalry']);
  });

  it('does not grant renderer shell or process execution permissions', () => {
    const capability = readJson('src-tauri/capabilities/main.json');
    const permissions = capability.permissions.map(String);
    expect(permissions.some((permission) => permission.startsWith('shell:'))).toBe(false);
    expect(permissions.some((permission) => permission.startsWith('process:'))).toBe(false);
    expect(permissions).toContain('dialog:default');
    expect(permissions).toContain('updater:default');
  });

  it('preserves installed application identities on macOS and Windows', () => {
    expect(readJson('src-tauri/tauri.macos.conf.json')).toMatchObject({
      productName: 'Cavalry for Mac',
      identifier: 'com.local.cavalry.mac'
    });
    expect(readJson('src-tauri/tauri.windows.conf.json')).toMatchObject({
      productName: 'Cavalry for Windows',
      identifier: 'com.local.cavalry.windows'
    });
  });

  it('contains no Electron runtime dependency', () => {
    const packageJson = readJson('package.json');
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    expect(dependencies).not.toHaveProperty('electron');
    expect(dependencies).not.toHaveProperty('electron-builder');
    expect(dependencies).not.toHaveProperty('electron-updater');
  });
});
