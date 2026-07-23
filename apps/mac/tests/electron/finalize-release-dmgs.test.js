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

import { afterEach, describe, expect, it } from 'vitest';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';

import {
  finalizeReleaseDmgs,
  refreshMacUpdateMetadata
} from '../../scripts/finalize-release-dmgs.mjs';

const require = createRequire(import.meta.url);
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');
const temporaryDirectories = [];

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
    const commandRunner = async (command, argumentsList) => {
      commandCalls.push([command, ...argumentsList]);
      if (argumentsList[0] === 'notarytool') {
        appendFileSync(argumentsList[2], ':apple-ticket');
        return { stdout: JSON.stringify({ status: 'Accepted' }), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };

    await finalizeReleaseDmgs({
      assetDirectory: directory,
      versionArgument: 'v1.0.20',
      environment: {
        APPLE_API_KEY: '/private/key.p8',
        APPLE_API_KEY_ID: 'KEY123',
        APPLE_API_ISSUER: '00000000-0000-0000-0000-000000000000'
      },
      platform: 'darwin',
      commandRunner
    });

    const notaryCalls = commandCalls.filter((call) => call[1] === 'notarytool');
    expect(notaryCalls).toHaveLength(2);
    expect(notaryCalls.map((call) => call[3])).toEqual([
      resolve(directory, 'Cavalry-for-Mac-1.0.20-arm64.dmg'),
      resolve(directory, 'Cavalry-for-Mac-1.0.20-x64.dmg')
    ]);
    expect(commandCalls.filter((call) => call.includes('staple'))).toHaveLength(2);
    expect(commandCalls.filter((call) => call.includes('validate'))).toHaveLength(2);

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

    await expect(
      finalizeReleaseDmgs({
        assetDirectory: directory,
        versionArgument: '1.0.20',
        environment: {
          APPLE_API_KEY: '/private/key.p8',
          APPLE_API_KEY_ID: 'KEY123',
          APPLE_API_ISSUER: '00000000-0000-0000-0000-000000000000'
        },
        platform: 'darwin',
        commandRunner: async (_command, argumentsList) => ({
          stdout: argumentsList[0] === 'notarytool' ? JSON.stringify({ status: 'Invalid' }) : '',
          stderr: ''
        })
      })
    ).rejects.toThrow('Apple did not accept');
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
