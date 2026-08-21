import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REQUIRED_PLATFORMS = Object.freeze(['darwin-aarch64', 'darwin-x86_64']);
const OPTIONAL_PLATFORM_ALIASES = Object.freeze({
  'darwin-aarch64-app': 'darwin-aarch64',
  'darwin-x86_64-app': 'darwin-x86_64'
});

function fail(message) {
  throw new Error(`Release asset verification failed: ${message}`);
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function versionFromTag(value) {
  const argument = asText(value);
  const version = argument.startsWith('v') ? argument.slice(1) : argument;
  if (!STABLE_VERSION.test(version)) fail(`"${argument}" must identify MAJOR.MINOR.PATCH.`);
  return version;
}

function expectedAssetNames(version) {
  const assets = {};
  [
    ['darwin-aarch64', 'aarch64'],
    ['darwin-x86_64', 'x64']
  ].forEach(([platform, architecture]) => {
    const prefix = `Cavalry.for.Mac_${version}_${architecture}`;
    assets[platform] = {
      archive: `${prefix}.app.tar.gz`,
      signature: `${prefix}.app.tar.gz.sig`,
      dmg: `${prefix}.dmg`
    };
  });
  return Object.freeze(assets);
}

function parseMetadata(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!(parsed && typeof parsed === 'object' && !Array.isArray(parsed))) {
      fail('latest.json must contain an object.');
    }
    return parsed;
  } catch (error) {
    if (asText(error?.message).startsWith('Release asset verification failed:')) throw error;
    fail('latest.json is not valid JSON.');
  }
}

function assertManifestShape(metadata, version, requiredPlatforms) {
  const metadataVersion = asText(metadata.version).replace(/^v/, '');
  if (metadataVersion !== version) {
    fail(`latest.json declares ${metadata.version || '(missing)'}, expected ${version}.`);
  }
  if (!metadata.platforms || typeof metadata.platforms !== 'object') {
    fail('latest.json has no platforms map.');
  }
  const allowedPlatforms = new Set([
    ...requiredPlatforms,
    ...Object.keys(OPTIONAL_PLATFORM_ALIASES)
  ]);
  const unexpected = Object.keys(metadata.platforms).filter(
    (platform) => !allowedPlatforms.has(platform)
  );
  if (unexpected.length) fail(`latest.json has unexpected platforms: ${unexpected.join(', ')}.`);
  requiredPlatforms.forEach((platform) => {
    if (!(metadata.platforms[platform] && typeof metadata.platforms[platform] === 'object')) {
      fail(`latest.json is missing ${platform}.`);
    }
  });
  Object.entries(OPTIONAL_PLATFORM_ALIASES).forEach(([alias, primary]) => {
    if (!metadata.platforms[alias]) return;
    if (JSON.stringify(metadata.platforms[alias]) !== JSON.stringify(metadata.platforms[primary])) {
      fail(`${alias} must exactly match ${primary}.`);
    }
  });
  if (!metadata.pub_date || Number.isNaN(Date.parse(metadata.pub_date))) {
    fail('latest.json must contain a valid pub_date.');
  }
}

function urlAssetReference(url, repository = '') {
  let parsed;
  try {
    parsed = new URL(asText(url));
  } catch {
    fail(`invalid update URL: ${url || '(missing)'}`);
  }
  if (parsed.protocol !== 'https:') fail(`update URL must use HTTPS: ${url}`);
  const apiMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/releases\/assets\/(\d+)$/);
  if (parsed.hostname === 'api.github.com' && apiMatch) {
    const urlRepository = `${decodeURIComponent(apiMatch[1])}/${decodeURIComponent(apiMatch[2])}`;
    if (repository && urlRepository.toLowerCase() !== repository.toLowerCase()) {
      fail(`update URL belongs to ${urlRepository}, expected ${repository}.`);
    }
    return { kind: 'github-asset-id', id: Number(apiMatch[3]), repository: urlRepository };
  }
  return {
    kind: 'name',
    name: decodeURIComponent(parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1))
  };
}

function validatePlatformEntries({
  metadata,
  version,
  requiredPlatforms,
  resolveAsset,
  signatureContents
}) {
  const expected = expectedAssetNames(version);
  requiredPlatforms.forEach((platform) => {
    const entry = metadata.platforms[platform];
    const asset = resolveAsset(entry.url, platform);
    if (!asset || asset.name !== expected[platform].archive) {
      fail(
        `${platform} URL resolves to ${asset?.name || '(missing)'}, expected ${expected[platform].archive}.`
      );
    }
    const signature = asText(entry.signature);
    if (!signature) fail(`${platform} has no updater signature.`);
    const fileSignature = asText(signatureContents(expected[platform].signature));
    if (!fileSignature) fail(`missing or empty asset: ${expected[platform].signature}`);
    if (fileSignature !== signature) {
      fail(`${platform} signature does not match ${expected[platform].signature}.`);
    }
  });
}

function requiredAssetSet(version) {
  const expected = expectedAssetNames(version);
  return new Set([
    'latest.json',
    ...REQUIRED_PLATFORMS.flatMap((platform) => Object.values(expected[platform]))
  ]);
}

export function verifyGitHubReleaseSnapshot({
  release,
  repository,
  tag,
  commit,
  tagCommit,
  metadata,
  downloadedAssetText = {}
} = {}) {
  if (!REPOSITORY_PATTERN.test(asText(repository))) {
    fail(`invalid GitHub repository: ${repository || '(missing)'}.`);
  }
  const version = versionFromTag(tag);
  if (!(release && typeof release === 'object')) fail(`no GitHub release exists for ${tag}.`);
  if (asText(release.tag_name) !== asText(tag)) {
    fail(`release tag is ${release.tag_name || '(missing)'}, expected ${tag}.`);
  }
  if (release.draft !== true) fail('the release must remain a draft during asset verification.');
  if (asText(commit) && asText(tagCommit) !== asText(commit)) {
    fail(`tag ${tag} points to ${tagCommit || '(missing)'}, expected ${commit}.`);
  }
  if (/^[0-9a-f]{40}$/i.test(asText(release.target_commitish)) && asText(commit)) {
    if (asText(release.target_commitish) !== asText(commit)) {
      fail(`release targets ${release.target_commitish}, expected ${commit}.`);
    }
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const byName = new Map();
  const byId = new Map();
  assets.forEach((asset) => {
    const name = asText(asset?.name);
    const id = Number(asset?.id);
    if (!name || !Number.isFinite(id))
      fail('release contains an asset without a stable name or ID.');
    if (byName.has(name)) fail(`release contains duplicate asset name: ${name}.`);
    if (byId.has(id)) fail(`release contains duplicate asset ID: ${id}.`);
    if (asText(asset.state) !== 'uploaded' || Number(asset.size) <= 0) {
      fail(`release asset is not completely uploaded: ${name}.`);
    }
    byName.set(name, asset);
    byId.set(id, asset);
  });
  const required = requiredAssetSet(version);
  const missing = [...required].filter((name) => !byName.has(name));
  const unexpected = [...byName.keys()].filter((name) => !required.has(name));
  if (missing.length) fail(`release is missing assets: ${missing.join(', ')}.`);
  if (unexpected.length) fail(`release has unexpected assets: ${unexpected.join(', ')}.`);
  if (byName.size !== required.size) fail('release asset inventory is incomplete.');

  const parsedMetadata = parseMetadata(metadata);
  assertManifestShape(parsedMetadata, version, REQUIRED_PLATFORMS);
  validatePlatformEntries({
    metadata: parsedMetadata,
    version,
    requiredPlatforms: REQUIRED_PLATFORMS,
    resolveAsset(url) {
      const reference = urlAssetReference(url, repository);
      if (reference.kind !== 'github-asset-id') {
        fail('GitHub release updater URLs must use immutable release asset IDs.');
      }
      const asset = byId.get(reference.id);
      if (!asset) fail(`latest.json references unknown release asset ID ${reference.id}.`);
      return asset;
    },
    signatureContents(name) {
      return downloadedAssetText[name];
    }
  });

  return {
    version,
    tag,
    commit: asText(tagCommit),
    assets: [...required].sort(),
    platforms: [...REQUIRED_PLATFORMS]
  };
}

export function verifyLocalReleaseAssets({
  directory = 'release-assets',
  tag,
  requiredPlatforms = REQUIRED_PLATFORMS
} = {}) {
  const resolvedDirectory = path.resolve(directory);
  const version = versionFromTag(tag);
  const platforms = requiredPlatforms.map(asText).filter(Boolean);
  const requireFile = (name) => {
    const filePath = path.resolve(resolvedDirectory, name);
    if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size === 0) {
      fail(`missing or empty asset: ${name}`);
    }
    return filePath;
  };
  const metadata = parseMetadata(readFileSync(requireFile('latest.json'), 'utf8'));
  assertManifestShape(metadata, version, platforms);
  const expected = expectedAssetNames(version);
  platforms.forEach((platform) => {
    if (!expected[platform]) fail(`unsupported release platform: ${platform}.`);
    requireFile(expected[platform].archive);
    requireFile(expected[platform].signature);
    requireFile(expected[platform].dmg);
  });
  validatePlatformEntries({
    metadata,
    version,
    requiredPlatforms: platforms,
    resolveAsset(url) {
      const reference = urlAssetReference(url);
      if (reference.kind !== 'name') {
        fail('asset-ID update URLs require GitHub release verification mode.');
      }
      requireFile(reference.name);
      return { name: reference.name };
    },
    signatureContents(name) {
      return readFileSync(requireFile(name), 'utf8');
    }
  });
  return { version, platforms };
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cavalry-release-verifier'
    }
  });
  if (!response.ok) fail(`GitHub API ${response.status} for ${url}.`);
  return response.json();
}

async function githubAssetText(asset, token) {
  const response = await fetch(asset.url, {
    redirect: 'follow',
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cavalry-release-verifier'
    }
  });
  if (!response.ok) fail(`could not download release asset ${asset.name}: ${response.status}.`);
  return response.text();
}

async function githubTagCommit(repository, tag, token) {
  const ref = await githubJson(
    `https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
    token
  );
  let object = ref.object;
  for (let depth = 0; depth < 4 && object?.type === 'tag'; depth += 1) {
    const annotated = await githubJson(
      `https://api.github.com/repos/${repository}/git/tags/${object.sha}`,
      token
    );
    object = annotated.object;
  }
  if (object?.type !== 'commit' || !asText(object.sha)) {
    fail(`${tag} does not resolve to a commit.`);
  }
  return asText(object.sha);
}

export async function verifyGitHubRelease({ repository, tag, commit, token } = {}) {
  if (!REPOSITORY_PATTERN.test(asText(repository))) {
    fail(`invalid GitHub repository: ${repository || '(missing)'}.`);
  }
  if (!asText(token)) fail('GITHUB_TOKEN is required for draft release verification.');
  const version = versionFromTag(tag);
  const releases = await githubJson(
    `https://api.github.com/repos/${repository}/releases?per_page=100`,
    token
  );
  const matches = releases.filter((release) => asText(release.tag_name) === asText(tag));
  if (matches.length !== 1)
    fail(`expected one GitHub release for ${tag}, found ${matches.length}.`);
  const release = matches[0];
  const byName = new Map(release.assets.map((asset) => [asText(asset.name), asset]));
  const downloadedAssetText = {};
  const expected = expectedAssetNames(version);
  for (const name of [
    'latest.json',
    ...REQUIRED_PLATFORMS.map((platform) => expected[platform].signature)
  ]) {
    const asset = byName.get(name);
    if (!asset) fail(`release is missing asset: ${name}.`);
    downloadedAssetText[name] = await githubAssetText(asset, token);
  }
  return verifyGitHubReleaseSnapshot({
    release,
    repository,
    tag,
    commit,
    tagCommit: await githubTagCommit(repository, tag, token),
    metadata: downloadedAssetText['latest.json'],
    downloadedAssetText
  });
}

function parseOptions(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) fail(`--${key} requires a value.`);
      options[key] = next;
      index += 1;
    } else {
      positionals.push(value);
    }
  }
  return { options, positionals };
}

async function main() {
  const { options, positionals } = parseOptions(process.argv.slice(2));
  if (options.repository || options.tag || options.commit) {
    const result = await verifyGitHubRelease({
      repository: options.repository || process.env.GITHUB_REPOSITORY,
      tag: options.tag || process.env.GITHUB_REF_NAME,
      commit: options.commit || process.env.GITHUB_SHA,
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    });
    process.stdout.write(
      `Verified uploaded draft release ${result.tag} at ${result.commit} for ${result.platforms.join(', ')}.\n`
    );
    return;
  }
  const result = verifyLocalReleaseAssets({
    directory: positionals[0] || 'release-assets',
    tag: positionals[1] || process.env.GITHUB_REF_NAME,
    requiredPlatforms: asText(positionals[2] || REQUIRED_PLATFORMS.join(','))
      .split(',')
      .map(asText)
      .filter(Boolean)
  });
  process.stdout.write(
    `Verified signed Tauri updater assets for ${result.platforms.join(', ')}.\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
