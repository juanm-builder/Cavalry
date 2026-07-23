import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';

import {
  finalizeReleaseDmgs,
  releaseKeychainPath,
  refreshMacUpdateMetadata
} from '../../scripts/finalize-release-dmgs.mjs';

const require = createRequire(import.meta.url);
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');
const temporaryDirectories = [];
const signingIdentity = {
  name: 'Developer ID Application: Example (TEAMID)',
  hash: '1234567890ABCDEF1234567890ABCDEF12345678'
};

function releaseEnvironment() {
  return {
    APPLE_API_KEY: '/private/key.p8',
    APPLE_API_KEY_ID: 'KEY123',
    APPLE_API_ISSUER: '00000000-0000-0000-0000-000000000000',
    CSC_LINK: 'base64-encoded-p12',
    CSC_KEY_PASSWORD: 'p12-password'
  };
}

function signingDependencies({ identity = signingIdentity, keychainFactory } = {}) {
  const temporaryManager = { cleanup: vi.fn(async () => {}) };
  const dependencies = {
    keychainFactory: vi.fn(
      keychainFactory ||
        (async ({ currentDir }) => ({
          keychainFile: releaseKeychainPath(currentDir, process.env.APP_BUILDER_TMP_DIR)
        }))
    ),
    keychainRemover: vi.fn(async () => {}),
    identityFinder: vi.fn(async () => identity),
    temporaryManagerFactory: vi.fn(() => temporaryManager)
  };
  return { ...dependencies, temporaryManager };
}

async function sha512(path) {
  return createHash('sha512').update(readFileSync(path)).digest('base64');
}

async function createReleaseAssets(version = '1.0.20') {
  const directory = mkdtempSync(resolve(tmpdir(), 'cavalry-finalize-dmgs-'));
  temporaryDirectories.push(directory);
  const payloadNames = [
    `Cavalry-for-Mac-${version}-x64.zip`,
    `Cavalry-for-Mac-${version}-arm64.zip`,
    `Cavalry-for-Mac-${version}-x64.dmg`,
    `Cavalry-for-Mac-${version}-arm64.dmg`
  ];
  for (const name of payloadNames) {
    const payloadPath = resolve(directory, name);
    writeFileSync(payloadPath, `fixture:${name}`);
    await buildBlockMap(payloadPath, 'gzip', `${payloadPath}.blockmap`);
  }
  const files = await Promise.all(
    payloadNames.map(async (url) => ({
      url,
      sha512: await sha512(resolve(directory, url)),
      size: statSync(resolve(directory, url)).size
    }))
  );
  writeFileSync(
    resolve(directory, 'latest-mac.yml'),
    dumpYaml(
      {
        version,
        files,
        path: files[0].url,
        sha512: files[0].sha512,
        releaseDate: '2026-07-23T00:00:00.000Z'
      },
      { lineWidth: -1 }
    )
  );
  return { directory, payloadNames };
}

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('release DMG finalization', () => {
  it('notarizes and staples both DMGs before refreshing blockmaps and metadata', async () => {
    const { directory } = await createReleaseAssets();
    const commandCalls = [];
    const signing = signingDependencies();
    const previousTemporaryDirectory = process.env.APP_BUILDER_TMP_DIR;
    const commandRunner = async (command, argumentsList) => {
      commandCalls.push([command, ...argumentsList]);
      if (argumentsList[0] === '-dv') {
        return {
          stdout: '',
          stderr: `Authority=${signingIdentity.name}\nTimestamp=Jul 23, 2026 at 12:00:00`
        };
      }
      if (argumentsList[0] === 'notarytool') {
        appendFileSync(argumentsList[2], ':apple-ticket');
        return { stdout: JSON.stringify({ status: 'Accepted' }), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };

    await finalizeReleaseDmgs({
      assetDirectory: directory,
      versionArgument: 'v1.0.20',
      environment: releaseEnvironment(),
      platform: 'darwin',
      commandRunner,
      ...signing
    });

    const signingCalls = commandCalls.filter((call) => call[1] === '--force');
    expect(signingCalls).toHaveLength(2);
    for (const call of signingCalls) {
      expect(call).toContain('--timestamp');
      expect(call).toContain('--identifier');
      expect(call).toContain('com.local.cavalry.mac.dmg');
      expect(call).toContain(signingIdentity.hash);
    }
    const notaryCalls = commandCalls.filter((call) => call[1] === 'notarytool');
    expect(notaryCalls).toHaveLength(2);
    expect(notaryCalls.map((call) => call[3])).toEqual([
      resolve(directory, 'Cavalry-for-Mac-1.0.20-arm64.dmg'),
      resolve(directory, 'Cavalry-for-Mac-1.0.20-x64.dmg')
    ]);
    for (const dmgPath of notaryCalls.map((call) => call[3])) {
      const signIndex = commandCalls.findIndex(
        (call) => call[1] === '--force' && call.at(-1) === dmgPath
      );
      const notarizeIndex = commandCalls.findIndex(
        (call) => call[1] === 'notarytool' && call[3] === dmgPath
      );
      expect(signIndex).toBeGreaterThanOrEqual(0);
      expect(signIndex).toBeLessThan(notarizeIndex);
    }
    expect(commandCalls.filter((call) => call.includes('staple'))).toHaveLength(2);
    expect(commandCalls.filter((call) => call.includes('validate'))).toHaveLength(2);
    expect(signing.keychainFactory).toHaveBeenCalledOnce();
    expect(signing.identityFinder).toHaveBeenCalledWith(
      'Developer ID Application',
      undefined,
      expect.stringMatching(/\.keychain$/)
    );
    expect(signing.keychainRemover).toHaveBeenCalledWith(
      expect.stringMatching(/\.keychain$/),
      false
    );
    expect(signing.temporaryManager.cleanup).toHaveBeenCalledOnce();
    expect(process.env.APP_BUILDER_TMP_DIR).toBe(previousTemporaryDirectory);

    const metadata = loadYaml(readFileSync(resolve(directory, 'latest-mac.yml'), 'utf8'));
    for (const entry of metadata.files) {
      const payloadPath = resolve(directory, entry.url);
      expect(entry.size).toBe(statSync(payloadPath).size);
      expect(entry.sha512).toBe(await sha512(payloadPath));
    }
    expect(metadata.sha512).toBe(metadata.files.find((file) => file.url === metadata.path).sha512);

    for (const architecture of ['arm64', 'x64']) {
      const dmgPath = resolve(directory, `Cavalry-for-Mac-1.0.20-${architecture}.dmg`);
      const expectedBlockmap = `${dmgPath}.expected.blockmap`;
      await buildBlockMap(dmgPath, 'gzip', expectedBlockmap);
      expect(readFileSync(`${dmgPath}.blockmap`)).toEqual(readFileSync(expectedBlockmap));
    }
  });

  it('fails closed when Apple does not accept a DMG', async () => {
    const { directory } = await createReleaseAssets();
    const signing = signingDependencies();

    await expect(
      finalizeReleaseDmgs({
        assetDirectory: directory,
        versionArgument: '1.0.20',
        environment: releaseEnvironment(),
        platform: 'darwin',
        commandRunner: async (_command, argumentsList) => {
          if (argumentsList[0] === '-dv') {
            return {
              stdout: '',
              stderr: `Authority=${signingIdentity.name}\nTimestamp=Jul 23, 2026 at 12:00:00`
            };
          }
          return {
            stdout: argumentsList[0] === 'notarytool' ? JSON.stringify({ status: 'Invalid' }) : '',
            stderr: ''
          };
        },
        ...signing
      })
    ).rejects.toThrow('Apple did not accept');
    expect(signing.keychainRemover).toHaveBeenCalledOnce();
  });

  it('does not submit a DMG signed by a different authority to Apple', async () => {
    const { directory } = await createReleaseAssets();
    const commandCalls = [];
    const signing = signingDependencies();

    await expect(
      finalizeReleaseDmgs({
        assetDirectory: directory,
        versionArgument: '1.0.20',
        environment: releaseEnvironment(),
        platform: 'darwin',
        commandRunner: async (command, argumentsList) => {
          commandCalls.push([command, ...argumentsList]);
          return {
            stdout: '',
            stderr:
              argumentsList[0] === '-dv'
                ? 'Authority=Developer ID Application: Different (OTHERID)\nTimestamp=Jul 23, 2026 at 12:00:00'
                : ''
          };
        },
        ...signing
      })
    ).rejects.toThrow('not signed with the imported Developer ID Application identity');

    expect(commandCalls.some((call) => call.includes('notarytool'))).toBe(false);
    expect(signing.keychainRemover).toHaveBeenCalledOnce();
  });

  it('does not submit a DMG without a secure timestamp to Apple', async () => {
    const { directory } = await createReleaseAssets();
    const commandCalls = [];
    const signing = signingDependencies();

    await expect(
      finalizeReleaseDmgs({
        assetDirectory: directory,
        versionArgument: '1.0.20',
        environment: releaseEnvironment(),
        platform: 'darwin',
        commandRunner: async (command, argumentsList) => {
          commandCalls.push([command, ...argumentsList]);
          return {
            stdout: '',
            stderr: argumentsList[0] === '-dv' ? `Authority=${signingIdentity.name}` : ''
          };
        },
        ...signing
      })
    ).rejects.toThrow('does not contain a secure timestamp');

    expect(commandCalls.some((call) => call.includes('notarytool'))).toBe(false);
    expect(signing.keychainRemover).toHaveBeenCalledOnce();
  });

  it('rejects a non-Developer ID identity before signing or notarizing', async () => {
    const { directory } = await createReleaseAssets();
    const commandRunner = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const signing = signingDependencies({
      identity: {
        name: 'Mac Developer: Example (TEAMID)',
        hash: signingIdentity.hash
      }
    });

    await expect(
      finalizeReleaseDmgs({
        assetDirectory: directory,
        versionArgument: '1.0.20',
        environment: releaseEnvironment(),
        platform: 'darwin',
        commandRunner,
        ...signing
      })
    ).rejects.toThrow('not a Developer ID Application identity');

    expect(commandRunner).not.toHaveBeenCalled();
    expect(signing.keychainRemover).toHaveBeenCalledOnce();
  });

  it('cleans the known isolated keychain path when certificate import fails', async () => {
    const { directory } = await createReleaseAssets();
    let expectedKeychainPath;
    const signing = signingDependencies({
      keychainFactory: async ({ currentDir }) => {
        expectedKeychainPath = releaseKeychainPath(currentDir, process.env.APP_BUILDER_TMP_DIR);
        throw new Error('certificate import failed');
      }
    });

    await expect(
      finalizeReleaseDmgs({
        assetDirectory: directory,
        versionArgument: '1.0.20',
        environment: releaseEnvironment(),
        platform: 'darwin',
        commandRunner: vi.fn(),
        ...signing
      })
    ).rejects.toThrow('certificate import failed');

    expect(signing.keychainRemover).toHaveBeenCalledWith(expectedKeychainPath, false);
    expect(signing.temporaryManager.cleanup).toHaveBeenCalledOnce();
  });

  it('rejects incomplete metadata instead of silently dropping an architecture', async () => {
    const { directory } = await createReleaseAssets();
    const metadataPath = resolve(directory, 'latest-mac.yml');
    const metadata = loadYaml(readFileSync(metadataPath, 'utf8'));
    metadata.files = metadata.files.filter((file) => !file.url.endsWith('-x64.dmg'));
    writeFileSync(metadataPath, dumpYaml(metadata, { lineWidth: -1 }));

    await expect(refreshMacUpdateMetadata(directory, '1.0.20')).rejects.toThrow(
      'latest-mac.yml is missing payload Cavalry-for-Mac-1.0.20-x64.dmg'
    );
  });
});
